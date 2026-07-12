import React, { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, AlertOctagon, Info, X } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { humanizeStripeCardDecline } from '../../utilities/stripeDeclineMessages';

export function humanizeStripeFinancialError(err) {
  const raw = String(err?.message || err || '');
  const msg = raw
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    .trim();
  if (/deposit not found for paymentintent|deposit not found/i.test(msg)) {
    return {
      title: 'Deposit record missing',
      detail:
        'Stripe shows this payment but our deposit log was not linked yet. Wait for Sync to finish, then try again — the system will auto-link from Stripe.',
      code: 'DEPOSIT_BACKFILL',
    };
  }
  if (/deposit hold was cancelled|hold was cancelled|create a fresh deposit/i.test(msg)) {
    return {
      title: 'Could not charge saved card',
      detail:
        'The authorization hold is no longer active, but the saved card should still work. Refresh the customer, then try New payment again. If it still fails, run a new deposit on POS once.',
      code: 'HOLD_RELEASED',
    };
  }
  if (
    /without Customer attachment/i.test(msg) ||
    /may not be used again/i.test(msg) ||
    /not linked to a Stripe customer/i.test(msg)
  ) {
    return {
      title: 'Card cannot be reused',
      detail:
        'This deposit was created before customer linking was required. Start a new deposit on the POS terminal — after hold and cancel, the card will be chargeable from Actions.',
      code: 'PM_REUSE_BLOCKED',
    };
  }
  if (/card_present/i.test(msg) && /cannot be saved/i.test(msg)) {
    return {
      title: 'Terminal card not reusable',
      detail:
        'The POS swipe token cannot be charged directly. Use a deposit created with the latest flow: authorize on terminal, cancel hold, then charge from Actions.',
      code: 'CARD_PRESENT_BLOCKED',
    };
  }
  const cardDecline = humanizeStripeCardDecline(err);
  if (cardDecline.declineCode && cardDecline.declineCode !== 'generic_decline') {
    return {
      title: cardDecline.title,
      detail: cardDecline.detail,
      nextSteps: cardDecline.nextSteps,
      code: cardDecline.code,
    };
  }
  if (/declined|card_declined|payment failed/i.test(msg)) {
    return {
      title: cardDecline.title,
      detail: cardDecline.detail,
      nextSteps: cardDecline.nextSteps,
      code: cardDecline.code,
    };
  }
  return { title: null, detail: msg || 'Something went wrong', code: null };
}

export function CenterFeedbackToast({ item, onDismiss }) {
  if (!item) return null;
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const Icon = isSuccess ? CheckCircle2 : isError ? AlertOctagon : Info;
  const eyebrow = isSuccess ? 'Operation complete' : isError ? 'Operation failed' : 'Notice';
  const cls = isSuccess
    ? 'pal-cust-center-toast pal-cust-center-toast-success'
    : isError
      ? 'pal-cust-center-toast pal-cust-center-toast-error'
      : 'pal-cust-center-toast pal-cust-center-toast-info';

  return (
    <div
      className="pal-cust-center-toast-wrap"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      onClick={onDismiss}
    >
      <div className={cls} onClick={(e) => e.stopPropagation()}>
        <div className="pal-cust-center-toast-accent" aria-hidden="true" />
        <header className="pal-cust-center-toast-head">
          <p className="pal-fin-eyebrow pal-cust-center-toast-eyebrow">{eyebrow}</p>
          <button type="button" className="pal-cust-center-toast-close" onClick={onDismiss} aria-label="Dismiss">
            <X size={16} />
          </button>
        </header>
        <div className="pal-cust-center-toast-body">
          <StripeStatusBadge
            sharp
            variant={isSuccess ? 'success' : isError ? 'danger' : 'info'}
            label={isSuccess ? 'Paid' : isError ? 'Failed' : 'Notice'}
          />
          <Icon className="pal-cust-center-toast-icon" size={26} strokeWidth={1.75} aria-hidden="true" />
          <p className="pal-cust-center-toast-title">{item.title}</p>
          {item.detail && <p className="pal-cust-center-toast-detail">{item.detail}</p>}
          {item.nextSteps && <p className="pal-cust-center-toast-next">{item.nextSteps}</p>}
          {(item.code || item.at) && (
            <p className="pal-fin-mono pal-cust-center-toast-meta">
              {item.code && <span>{item.code}</span>}
              {item.at && <span>{new Date(item.at).toLocaleTimeString()}</span>}
            </p>
          )}
        </div>
        <footer className="pal-cust-center-toast-footer">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </footer>
      </div>
    </div>
  );
}

export function useStripeFinFeedback() {
  const [centerFeedback, setCenterFeedback] = useState(null);

  const dismiss = useCallback(() => setCenterFeedback(null), []);

  const showFeedback = useCallback((item) => {
    setCenterFeedback({ ...item, at: item.at || new Date().toISOString() });
  }, []);

  const showSuccess = useCallback(
    (title, detail, extra = {}) => {
      showFeedback({ type: 'success', title, detail, ...extra });
    },
    [showFeedback],
  );

  const showError = useCallback(
    (title, detail, extra = {}) => {
      showFeedback({ type: 'error', title, detail, ...extra });
    },
    [showFeedback],
  );

  const showFromError = useCallback(
    (defaultTitle, err) => {
      const friendly = humanizeStripeFinancialError(err);
      showFeedback({
        type: 'error',
        title: friendly.title || defaultTitle,
        detail: friendly.detail,
        code: friendly.code,
        nextSteps: friendly.nextSteps,
      });
    },
    [showFeedback],
  );

  const toast = useMemo(
    () => <CenterFeedbackToast item={centerFeedback} onDismiss={dismiss} />,
    [centerFeedback, dismiss],
  );

  return { centerFeedback, showFeedback, showSuccess, showError, showFromError, dismiss, toast };
}
