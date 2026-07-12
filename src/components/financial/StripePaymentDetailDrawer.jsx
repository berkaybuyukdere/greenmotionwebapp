import React, { useEffect, useMemo, useState } from 'react';
import { X, Ban, CreditCard, RotateCcw, Plus } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import {
  stripeFinancialCancelPaymentHold,
  stripeFinancialCaptureDeposit,
  stripeFinancialChargeSavedPaymentMethod,
  stripeFinancialIncrementDeposit,
  stripeFinancialRefundPayment,
} from '../../services/stripeFinancialApi';
import { humanizeStripeFinancialError } from './StripeFinFeedback';
import { logPaymentUiAction } from '../../utilities/logPaymentUiAction';
import { paymentFailureNote } from '../../utilities/stripePaymentsRows';
import { depositExpiryExplanation, depositCanOffSessionCharge } from '../../utilities/stripeDepositDisplay';

const BUCKET_VARIANT = {
  successful: 'success',
  hold: 'info',
  pending: 'warning',
  cancelled: 'danger',
  failed: 'danger',
  blocked: 'danger',
  refunded: 'warning',
  disputed: 'warning',
};

const BUCKET_LABEL = {
  successful: 'Succeeded',
  hold: 'Uncaptured',
  pending: 'Pending',
  cancelled: 'Canceled',
  failed: 'Failed',
  blocked: 'Blocked',
  refunded: 'Refunded',
  disputed: 'Disputed',
};

const CHANNEL_VARIANT = {
  Deposit: 'deposit',
  'WheelSys · Deposit': 'wheelsys',
  Terminal: 'info',
  'Mail order': 'neutral',
};

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function DetailRow({ label, value, mono, error }) {
  return (
    <div className="pal-pay-detail-row">
      <span className="pal-pay-detail-label">{label}</span>
      <span
        className={
          error
            ? 'pal-pay-detail-value pal-pay-error-text'
            : mono
              ? 'pal-pay-detail-value pal-fin-mono'
              : 'pal-pay-detail-value'
        }
      >
        {value || '—'}
      </span>
    </div>
  );
}

function resolveDepositLifecycle(transaction, deposit) {
  const depositStatus = String(deposit?.status || '').toLowerCase();
  const stripePiStatus = String(deposit?.stripeStatus || transaction?.stripeStatus || '').toLowerCase();
  const displayStatus = String(transaction?.depositDisplayStatus || '').toLowerCase();
  const bucket = transaction?.bucket || 'pending';

  const isCaptured =
    depositStatus === 'captured' ||
    stripePiStatus === 'succeeded' ||
    displayStatus === 'captured' ||
    displayStatus === 'captured_increased' ||
    (bucket === 'successful' && (transaction?.flowType === 'deposit' || Boolean(deposit))) ||
    // Non-deposit succeeded Stripe charges (direct / mail / terminal capture)
    (bucket === 'successful' &&
      !deposit &&
      transaction?.flowType !== 'deposit' &&
      String(transaction?.status || '').toLowerCase() !== 'requires_capture');

  const isCancelled =
    depositStatus === 'cancelled' ||
    displayStatus === 'cancelled' ||
    bucket === 'cancelled';

  const isAuthorizedHold =
    !isCaptured &&
    !isCancelled &&
    (depositStatus === 'authorized' ||
      stripePiStatus === 'requires_capture' ||
      transaction?.bucket === 'hold' ||
      displayStatus === 'hold' ||
      displayStatus === 'increased' ||
      (depositStatus === 'pending_collection' &&
        (stripePiStatus === 'requires_capture' || transaction?.bucket === 'hold')));

  const isPendingCollection =
    !isCaptured &&
    !isCancelled &&
    !isAuthorizedHold &&
    (depositStatus === 'pending_collection' || bucket === 'pending');

  const effectiveBucket = isCaptured
    ? 'successful'
    : isCancelled
      ? 'cancelled'
      : isAuthorizedHold
        ? 'hold'
        : isPendingCollection
          ? 'pending'
          : bucket;

  return {
    bucket: effectiveBucket,
    isCaptured,
    isCancelled,
    isAuthorizedHold,
    isPendingCollection,
    canCancel: isAuthorizedHold,
    canCaptureDeposit: isAuthorizedHold,
    canManageDeposit: isAuthorizedHold,
  };
}

export function StripePaymentDetailDrawer({
  transaction,
  deposit,
  franchiseId,
  layout = 'modal',
  fleetCars = [],
  canPerformOperations = true,
  onClose,
  onChanged,
  onFeedback,
}) {
  const [cancelReason, setCancelReason] = useState('');
  const [cancelConfirmStep, setCancelConfirmStep] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [totalAmountChf, setTotalAmountChf] = useState('');
  const [showIncreasePanel, setShowIncreasePanel] = useState(false);
  const [showCancelPanel, setShowCancelPanel] = useState(false);
  const [showChargePanel, setShowChargePanel] = useState(false);
  const [chargeAmountChf, setChargeAmountChf] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    if (layout !== 'inline') {
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }
    return undefined;
  }, [layout, onClose]);

  const lifecycle = useMemo(
    () => resolveDepositLifecycle(transaction, deposit),
    [transaction, deposit],
  );
  const {
    bucket,
    isCaptured,
    isCancelled,
    isAuthorizedHold,
    isPendingCollection,
    canCancel,
    canCaptureDeposit,
    canManageDeposit,
  } = lifecycle;
  const isDeposit = transaction?.flowType === 'deposit' || Boolean(deposit);
  const inline = layout === 'inline';

  const currentHoldCents =
    deposit?.currentHoldAmount || deposit?.initialAmount || transaction?.depositCurrentHold || 0;
  const currentHoldChf = currentHoldCents / 100;
  const increasePreview = useMemo(() => {
    const total = Number(totalAmountChf);
    if (!Number.isFinite(total) || total <= 0) return null;
    const additional = total - currentHoldChf;
    if (additional <= 0) return { additional: 0, valid: false };
    return { additional, valid: true, total };
  }, [totalAmountChf, currentHoldChf]);

  const failureNote = useMemo(
    () => paymentFailureNote(transaction || {}),
    [transaction],
  );

  const canRefund =
    canPerformOperations &&
    isCaptured &&
    Boolean(
      deposit?.paymentIntentId ||
        transaction?.paymentIntentId ||
        transaction?.mailOrderId,
    );

  const canChargeSavedToken =
    canPerformOperations &&
    Boolean(deposit?.paymentIntentId || transaction?.paymentIntentId) &&
    depositCanOffSessionCharge(
      deposit || {
        paymentIntentId: transaction?.paymentIntentId,
        status: transaction?.bucket === 'cancelled' ? 'cancelled' : transaction?.status,
        tokenSaved: transaction?.tokenSaved,
        stripePaymentMethodId: transaction?.stripePaymentMethodId,
        stripeCustomerId: transaction?.stripeCustomerId,
      },
    );

  const runChargeSaved = async () => {
    const amount = Number(chargeAmountChf);
    if (!Number.isFinite(amount) || amount < 0.5) {
      setError('Minimum charge is CHF 0.50');
      return;
    }
    const piId = deposit?.paymentIntentId || transaction?.paymentIntentId;
    if (!piId && !deposit?.id) {
      setError('No deposit with saved card on file.');
      return;
    }
    logClick('charge_saved', { amountChf: amount });
    setBusy(true);
    setError('');
    try {
      const res = await stripeFinancialChargeSavedPaymentMethod({
        franchiseId,
        ...(deposit?.id ? { depositId: deposit.id } : {}),
        ...(piId ? { paymentIntentId: piId } : {}),
        amountChf: amount,
      });
      const charged = (Number(res?.chargedAmount) || amount * 100) / 100;
      if (res?.topUpError) {
        pushFeedback(
          'error',
          'Hold captured — extra charge failed',
          res.topUpError,
        );
      } else if (res?.mode === 'capture') {
        pushFeedback('success', 'Hold captured', `CHF ${charged.toFixed(2)} captured from deposit hold.`);
      } else {
        pushFeedback('success', 'Charge completed', `CHF ${charged.toFixed(2)} charged from saved card.`);
      }
      setShowChargePanel(false);
      setChargeAmountChf('');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Charge failed', e);
      setError(e?.message || 'Charge failed');
    } finally {
      setBusy(false);
    }
  };

  const amountDisplay = useMemo(() => {
    if (!transaction) return '—';
    const cents = isCaptured
      ? deposit?.capturedAmount || transaction.amountReceived || transaction.amount
      : bucket === 'hold'
        ? transaction.holdAmount || transaction.amount
        : transaction.amountReceived || transaction.amount;
    return formatMoney(cents, transaction.currency);
  }, [transaction, bucket, isCaptured, deposit?.capturedAmount]);

  if (!transaction) return null;

  const channelLabel = transaction.channelLabel || (isDeposit ? 'Deposit' : null);
  const statusLabel = isCaptured
    ? 'Paid'
    : BUCKET_LABEL[bucket] || transaction.statusLabel || transaction.status;

  const pushFeedback = (type, title, detail, extra = {}) => {
    onFeedback?.({ type, title, detail, ...extra, at: new Date().toISOString() });
  };

  const pushFeedbackFromError = (defaultTitle, err) => {
    const friendly = humanizeStripeFinancialError(err);
    pushFeedback(
      'error',
      friendly.title || defaultTitle,
      friendly.detail,
      { code: friendly.code, nextSteps: friendly.nextSteps },
    );
  };

  const logClick = (button, extra = {}) => {
    logPaymentUiAction(franchiseId, button, {
      resCode: transaction.resCode || transaction.reference,
      paymentIntentId: transaction.paymentIntentId,
      depositId: deposit?.id || transaction.depositId,
      ...extra,
    });
  };

  const runCancel = async () => {
    logClick('release_hold');
    if (!cancelReason.trim()) {
      setError('Please enter a cancellation reason.');
      return;
    }
    if (!cancelConfirmStep) {
      setCancelConfirmStep(true);
      setError('');
      return;
    }
    if (cancelConfirmText.trim().toUpperCase() !== 'CANCEL') {
      setError('Type CANCEL to confirm release of this hold.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await stripeFinancialCancelPaymentHold({
        franchiseId,
        depositId: deposit?.id || transaction.depositId,
        paymentIntentId: transaction.paymentIntentId,
        reason: cancelReason.trim(),
      });
      pushFeedback('success', 'Hold released', 'Deposit released — customer and RES recorded in the list.');
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Cancel failed', e);
      setError(e?.message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const runCapture = async () => {
    logClick('capture');
    const depositId = deposit?.id || transaction.depositId;
    const paymentIntentId = deposit?.paymentIntentId || transaction.paymentIntentId;
    if (!paymentIntentId && !depositId) return;
    setBusy(true);
    setError('');
    try {
      const res = await stripeFinancialCaptureDeposit({
        franchiseId,
        ...(depositId ? { depositId } : {}),
        paymentIntentId,
      });
      const capturedChf =
        (Number(res?.amountReceived) || currentHoldCents || 0) / 100;
      pushFeedback(
        'success',
        'Hold captured',
        `CHF ${capturedChf.toFixed(2)} charged from the authorized deposit hold.`,
      );
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Capture failed', e);
      setError(e?.message || 'Capture failed');
    } finally {
      setBusy(false);
    }
  };

  const runRefund = async () => {
    logClick('refund');
    const pi = deposit?.paymentIntentId || transaction.paymentIntentId;
    const mailOrderId = transaction.mailOrderId || deposit?.mailOrderId || null;
    if (!pi && !mailOrderId) return;
    setBusy(true);
    setError('');
    try {
      await stripeFinancialRefundPayment({
        franchiseId,
        ...(pi ? { paymentIntentId: pi } : {}),
        ...(mailOrderId ? { mailOrderId } : {}),
      });
      pushFeedback('success', 'Refund issued', 'Full refund processed — logged to admin audit.');
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Refund failed', e);
      setError(e?.message || 'Refund failed');
    } finally {
      setBusy(false);
    }
  };

  const runIncrement = async () => {
    logClick('increase_hold');
    const depositId = deposit?.id || transaction.depositId;
    if (!depositId || !increasePreview?.valid) return;
    setBusy(true);
    setError('');
    try {
      await stripeFinancialIncrementDeposit({
        franchiseId,
        depositId,
        newAmountChf: increasePreview.total,
        customIncrease: true,
      });
      pushFeedback(
        'success',
        'Deposit authorization increased',
        `New hold CHF ${increasePreview.total.toFixed(2)} (+${increasePreview.additional.toFixed(2)}).`,
      );
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Increase failed', e);
      setError(e?.message || 'Increase failed');
    } finally {
      setBusy(false);
    }
  };

  const panelBody = (
    <>
      <header className={inline ? 'pal-pay-drawer-header' : 'pal-fin-modal-header'}>
        <div>
          <p className="pal-fin-eyebrow">{isCaptured ? 'Payment detail' : 'Deposit preview'}</p>
          <p className={inline ? 'pal-pay-drawer-amount' : 'pal-fin-modal-title pal-pay-modal-amount'}>
            {amountDisplay}
          </p>
          <div className="pal-pay-drawer-badges">
            <StripeStatusBadge
              sharp
              variant={BUCKET_VARIANT[bucket] || 'neutral'}
              label={statusLabel}
            />
            {channelLabel && (
              <StripeStatusBadge
                sharp
                variant={CHANNEL_VARIANT[channelLabel] || 'neutral'}
                label={channelLabel}
              />
            )}
          </div>
        </div>
        <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </header>

      {canPerformOperations && (canCaptureDeposit || canRefund || canChargeSavedToken) && (
        <div className="pal-pay-action-bar">
          {canCaptureDeposit && (
            <button
              type="button"
              className="gm-btn gm-btn-primary gm-btn-sm"
              disabled={busy}
              onClick={runCapture}
            >
              <CreditCard size={14} /> Capture
            </button>
          )}
          {canRefund && (
            <button
              type="button"
              className="gm-btn gm-btn-secondary gm-btn-sm"
              disabled={busy}
              onClick={runRefund}
            >
              <RotateCcw size={14} /> Refund
            </button>
          )}
          {canChargeSavedToken && (
            <button
              type="button"
              className={`gm-btn gm-btn-secondary gm-btn-sm ${showChargePanel ? 'pal-cust-pay-tool-active' : ''}`}
              disabled={busy}
              onClick={() => {
                logClick('new_payment');
                setShowChargePanel((v) => !v);
                setShowIncreasePanel(false);
                setShowCancelPanel(false);
              }}
            >
              <Plus size={14} /> New payment
            </button>
          )}
        </div>
      )}

      <div className={inline ? 'pal-pay-drawer-body' : 'pal-fin-modal-body pal-pay-detail-body'}>
        <DetailRow label="Customer" value={transaction.customerName} />
        <DetailRow label="Email" value={transaction.customerEmail} />
        <DetailRow label="Plate" value={transaction.plate} mono />
        <DetailRow
          label="RES code"
          value={transaction.resCode || transaction.reference || deposit?.resCode || transaction.displayDescription}
          mono
        />
        {transaction.category && (
          <DetailRow
            label="Category"
            value={
              String(transaction.category) === 'traffic_fine'
                ? 'Traffic fine'
                : String(transaction.category) === 'damage'
                  ? 'Traffic accident / damage'
                  : transaction.category
            }
          />
        )}
        {transaction.channelLabel && !channelLabel && (
          <DetailRow label="Channel" value={transaction.channelLabel} />
        )}
        <DetailRow label="Date" value={formatDate(transaction.createdAt)} />
        {transaction.paidAt && (
          <DetailRow label="Paid at" value={formatDate(transaction.paidAt)} />
        )}
        {isDeposit && (
          <DetailRow label="Deposit hold" value={formatMoney(currentHoldCents, transaction.currency)} />
        )}
        {(deposit?.tokenSaved || transaction?.tokenSaved) && (
          <div className="pal-pay-detail-row">
            <span className="pal-pay-detail-label">Token</span>
            <span className="pal-fin-token-saved-badge">Token saved</span>
          </div>
        )}
        {transaction.depositSource === 'wheelsys' && (
          <DetailRow label="Origin" value="WheelSys rental flow" />
        )}
        <div className="pal-pay-detail-row">
          <span className="pal-pay-detail-label">Card</span>
          <StripePaymentMethodCell
            brand={transaction.cardBrand}
            last4={transaction.cardLast4}
            methodType={transaction.paymentMethod}
          />
        </div>
        {transaction.paymentIntentId && (
          <DetailRow label="Payment intent" value={transaction.paymentIntentId} mono />
        )}
        {failureNote && <DetailRow label="Decline reason" value={failureNote} error />}
        {isCaptured && deposit?.capturedAt && (
          <DetailRow label="Captured at" value={formatDate(deposit.capturedAt)} />
        )}
        {isAuthorizedHold && deposit?.captureBefore && (
          <DetailRow label="Hold expires" value={formatDate(deposit.captureBefore)} />
        )}
        {isAuthorizedHold && deposit?.captureWindowDays != null && (
          <DetailRow
            label="Capture window"
            value={
              // Show Stripe's real remaining window — never inflate to 30 days;
              // holds without confirmed extended auth die in 5-7 days.
              deposit.extendedAuthorizationApplied
                ? `~${deposit.captureWindowDays} days left (extended auth)`
                : `~${deposit.captureWindowDays} days left`
            }
          />
        )}
        {(deposit?.tokenSaved || transaction?.tokenSaved) && (
          <DetailRow
            label="Card token"
            value="Saved — chargeable after release, refund, or expiry"
          />
        )}
        {deposit?.cancelledByName && (
          <DetailRow label="Released by" value={deposit.cancelledByName} />
        )}
        {(isCancelled || bucket === 'cancelled') && depositExpiryExplanation(deposit) && (
          <DetailRow label="Status detail" value={depositExpiryExplanation(deposit)} />
        )}
        {deposit?.cancelReason && !depositExpiryExplanation(deposit) && (
          <DetailRow label="Cancel note" value={deposit.cancelReason} />
        )}

        {isPendingCollection && (
          <p className="pal-fin-alert pal-fin-alert-warn">
            Waiting for card on POS — capture is available only after the hold is authorized.
          </p>
        )}

        {isCaptured && (
          <p className="pal-fin-alert pal-fin-alert-ok">
            Funds captured — reported as Paid / Successful.
          </p>
        )}

        {deposit?.emailSentAt && (
          <DetailRow
            label="Email"
            value={
              deposit.emailSentOk
                ? `Sent ${new Date(deposit.emailSentAt).toLocaleString()}`
                : deposit.emailSentMessage || 'Failed'
            }
          />
        )}

        {showChargePanel && canChargeSavedToken && (
          <div className="pal-pay-drawer-section pal-pay-increase-panel">
            <p className="text-caption">
              Charge the saved card — works after hold release, refund, or Stripe auto-expiry.
            </p>
            <label className="pal-fin-field pal-fin-field-full">
              <span>Amount (CHF)</span>
              <input
                type="number"
                min="0.5"
                step="0.05"
                value={chargeAmountChf}
                onChange={(e) => setChargeAmountChf(e.target.value)}
                placeholder="0.00"
                disabled={busy}
              />
            </label>
            <button
              type="button"
              className="gm-btn gm-btn-primary gm-btn-sm"
              disabled={busy}
              onClick={runChargeSaved}
            >
              Charge saved card
            </button>
          </div>
        )}

        {canManageDeposit && (
          <div className="pal-pay-drawer-section">
            <button
              type="button"
              className="pal-pay-expand-toggle"
              onClick={() => setShowIncreasePanel((v) => !v)}
            >
              {showIncreasePanel ? 'Hide' : 'Increase hold'}
            </button>
            {showIncreasePanel && (
              <div className="pal-pay-increase-panel">
                <p className="text-caption">
                  Current hold: <strong>{formatMoney(currentHoldCents, transaction.currency)}</strong>
                </p>
                <label className="pal-fin-field pal-fin-field-full">
                  <span>New total to authorize (CHF)</span>
                  <input
                    type="number"
                    min={currentHoldChf + 0.05}
                    step="0.05"
                    value={totalAmountChf}
                    onChange={(e) => setTotalAmountChf(e.target.value)}
                    placeholder={`e.g. ${(currentHoldChf + 100).toFixed(2)}`}
                    disabled={busy}
                  />
                </label>
                {increasePreview && (
                  <p
                    className={
                      increasePreview.valid
                        ? 'pal-pay-increase-delta pal-pay-increase-delta-ok'
                        : 'pal-pay-increase-delta pal-pay-increase-delta-warn'
                    }
                  >
                    {increasePreview.valid
                      ? `Additional authorization: ${increasePreview.additional.toFixed(2)} CHF`
                      : 'Total must be greater than current deposit hold'}
                  </p>
                )}
                <button
                  type="button"
                  className="gm-btn gm-btn-secondary gm-btn-sm"
                  disabled={busy || !increasePreview?.valid}
                  onClick={runIncrement}
                >
                  Authorize increase
                </button>
              </div>
            )}
          </div>
        )}

        {canCancel && (
          <div className="pal-pay-drawer-section pal-pay-drawer-cancel">
            <button
              type="button"
              className="pal-pay-expand-toggle pal-pay-expand-toggle-danger"
              onClick={() => setShowCancelPanel((v) => !v)}
            >
              {showCancelPanel ? 'Hide release' : 'Release hold'}
            </button>
            {showCancelPanel && (
              <>
                <label className="pal-fin-field pal-fin-field-full">
                  <span>Reason (required)</span>
                  <textarea
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="e.g. Customer declined, wrong amount…"
                    disabled={busy}
                  />
                </label>
                {cancelConfirmStep && (
                  <>
                    <p className="pal-cust-confirm-warn">
                      Type <strong>CANCEL</strong> to release this deposit hold.
                    </p>
                    <label className="pal-fin-field pal-fin-field-full">
                      <span>Confirmation</span>
                      <input
                        type="text"
                        className="pal-fin-input"
                        value={cancelConfirmText}
                        onChange={(e) => setCancelConfirmText(e.target.value)}
                        placeholder="CANCEL"
                        disabled={busy}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="gm-btn gm-btn-danger gm-btn-sm"
                  disabled={busy}
                  onClick={runCancel}
                >
                  <Ban size={14} /> {cancelConfirmStep ? 'Release deposit' : 'Cancel & release hold'}
                </button>
              </>
            )}
          </div>
        )}

        {error && <p className="pal-fin-alert pal-pay-error-text">{error}</p>}
      </div>
    </>
  );

  if (inline) {
    return (
      <aside className="pal-pay-drawer pal-pay-panel-inline" aria-label="Payment detail">
        {panelBody}
      </aside>
    );
  }

  if (layout === 'drawer') {
    return (
      <div className="pal-pay-drawer-backdrop" role="presentation" onClick={onClose}>
        <aside
          className="pal-pay-drawer"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          {panelBody}
        </aside>
      </div>
    );
  }

  return (
    <div className="pal-fin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pal-fin-modal pal-fin-modal-wide pal-pay-detail-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {panelBody}
      </div>
    </div>
  );
}
