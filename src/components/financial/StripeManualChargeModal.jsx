import React, { useEffect, useMemo, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardNumberElement,
  CardExpiryElement,
  CardCvcElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { CheckCircle2, CreditCard, Loader2, Shield, X, XCircle } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import {
  defaultResCodeValue,
  formatResCodeForSubmit,
  isResCodeComplete,
  normalizeResCodeInput,
} from '../../utilities/resCodeInput';
import {
  stripeFinancialGetConfig,
  stripeFinancialCreateDirectCardOperation,
  stripeFinancialFinalizeDirectCardOperation,
  stripeFinancialPersistDirectCardSnapshot,
} from '../../services/stripeFinancialApi';
import { formatStripeDeclineForDisplay } from '../../utilities/stripeDeclineMessages';
import { recordOfficeOperationForCharge } from './StripeCustomerNewOperationModal';

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '13px',
      color: '#1a2332',
      '::placeholder': { color: '#8b95a5' },
    },
    invalid: { color: '#dc2626' },
  },
};

const CATEGORIES = [
  { id: 'damage', label: 'Damage' },
  { id: 'extra', label: 'Extra' },
  { id: 'traffic_fine', label: 'Traffic' },
];

function apiCategory(category) {
  if (category === 'extra') return 'damage';
  return category;
}

function CompactChargeForm({ franchiseId, onClose, onSuccess, onFeedback }) {
  const stripe = useStripe();
  const elements = useElements();
  const [step, setStep] = useState('form');
  const [category, setCategory] = useState('damage');
  const [resNo, setResNo] = useState(defaultResCodeValue);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [amountChf, setAmountChf] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resultDetail, setResultDetail] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    const name = customerName.trim();
    const holder = cardholderName.trim() || name;
    const major = parseFloat(String(amountChf).replace(',', '.'));

    if (!isResCodeComplete(resNo)) {
      setError('RES number is required.');
      return;
    }
    if (!name) {
      setError('Customer name is required.');
      return;
    }
    if (!Number.isFinite(major) || major < 0.5) {
      setError('Enter a valid amount (min CHF 0.50).');
      return;
    }

    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) {
      setError('Card fields not ready.');
      return;
    }

    setBusy(true);
    setError('');
    setStep('processing');

    try {
      const resCode = formatResCodeForSubmit(resNo);
      const created = await stripeFinancialCreateDirectCardOperation({
        franchiseId,
        category: apiCategory(category),
        resNo: resCode,
        customerName: name,
        customerEmail: customerEmail.trim(),
        cardholderName: holder,
        unitAmount: Math.round(major * 100),
        currency: 'chf',
      });

      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(created.clientSecret, {
        payment_method: {
          card: cardNumber,
          billing_details: { name: holder },
        },
      });

      if (confirmError) {
        const piId = confirmError.payment_intent?.id || created.paymentIntentId;
        if (piId) {
          await stripeFinancialPersistDirectCardSnapshot({
            franchiseId,
            mailOrderId: created.mailOrderId,
            paymentIntentId: piId,
          });
        }
        const friendly = formatStripeDeclineForDisplay(confirmError);
        setError(friendly.displayText);
        setResultDetail(friendly.detail || friendly.displayText);
        setStep('declined');
        onFeedback?.({
          type: 'error',
          title: friendly.title || 'Charge declined',
          detail: friendly.detail || friendly.displayText,
          code: friendly.code,
          at: new Date().toISOString(),
        });
        return;
      }

      if (paymentIntent?.status !== 'succeeded') {
        throw new Error(`Payment status: ${paymentIntent?.status || 'unknown'}`);
      }

      const finalized = await stripeFinancialFinalizeDirectCardOperation({
        franchiseId,
        mailOrderId: created.mailOrderId,
        paymentIntentId: paymentIntent.id,
        sendEmail: false,
      });

      await recordOfficeOperationForCharge({
        franchiseId,
        category,
        resNo: resCode,
        customerName: name,
        amountMajor: major,
        mailOrderId: created.mailOrderId,
        paymentIntentId: paymentIntent.id,
      });

      const last4 = finalized.cardLast4 ? ` · · · · ${finalized.cardLast4}` : '';
      const detail = `CHF ${major.toFixed(2)} charged${last4}`;
      setResultDetail(detail);
      setStep('done');
      onFeedback?.({
        type: 'success',
        title: 'Payment successful',
        detail,
        at: new Date().toISOString(),
      });
      onSuccess?.();
    } catch (err) {
      const friendly = formatStripeDeclineForDisplay(err);
      setError(friendly.displayText);
      setResultDetail(friendly.detail || friendly.displayText);
      setStep('declined');
      onFeedback?.({
        type: 'error',
        title: friendly.title || 'Charge failed',
        detail: friendly.detail || friendly.displayText,
        at: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pal-fin-modal-compact-form" onSubmit={handleSubmit}>
      {step === 'form' && (
        <>
          <div className="pal-fin-compact-categories">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`pal-fin-compact-cat ${category === cat.id ? 'pal-fin-compact-cat-active' : ''}`}
                onClick={() => setCategory(cat.id)}
                disabled={busy}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="pal-fin-form-grid pal-fin-form-grid-compact">
            <label className="pal-fin-field pal-fin-field-full">
              <span>RES code *</span>
              <div className="pal-fin-res-prefill-row">
                <span className="pal-fin-res-prefix">RES-</span>
                <input
                  className="pal-fin-mono pal-fin-res-input"
                  value={resNo}
                  onChange={(e) => setResNo(normalizeResCodeInput(e.target.value))}
                  placeholder="17505"
                  disabled={busy}
                />
              </div>
            </label>
            <label className="pal-fin-field">
              <span>Customer name *</span>
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} disabled={busy} />
            </label>
            <label className="pal-fin-field pal-fin-field-full">
              <span>Customer email</span>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="name@example.com"
                disabled={busy}
              />
            </label>
            <label className="pal-fin-field">
              <span>Amount (CHF) *</span>
              <input
                inputMode="decimal"
                value={amountChf}
                onChange={(e) => setAmountChf(e.target.value)}
                placeholder="150.00"
                disabled={busy}
              />
            </label>
            <label className="pal-fin-field pal-fin-field-full">
              <span>Cardholder name *</span>
              <input
                value={cardholderName}
                onChange={(e) => setCardholderName(e.target.value)}
                autoComplete="cc-name"
                disabled={busy}
              />
            </label>
            <label className="pal-fin-field pal-fin-field-full">
              <span className="pal-fin-card-label-row">
                Card number *
                <span className="pal-fin-card-secure">
                  <Shield size={11} /> Stripe
                </span>
              </span>
              <div className="pal-cust-stripe-field pal-cust-stripe-field-compact">
                <CardNumberElement options={CARD_ELEMENT_OPTIONS} />
              </div>
            </label>
            <label className="pal-fin-field">
              <span>Expiry *</span>
              <div className="pal-cust-stripe-field pal-cust-stripe-field-compact">
                <CardExpiryElement options={CARD_ELEMENT_OPTIONS} />
              </div>
            </label>
            <label className="pal-fin-field">
              <span>CVC *</span>
              <div className="pal-cust-stripe-field pal-cust-stripe-field-compact">
                <CardCvcElement options={CARD_ELEMENT_OPTIONS} />
              </div>
            </label>
          </div>
          {error && <p className="pal-fin-alert">{error}</p>}
        </>
      )}

      {step === 'processing' && (
        <div className="pal-fin-terminal-state pal-fin-terminal-state-loading">
          <div className="pal-fin-terminal-state-icon">
            <Loader2 className="animate-spin" size={26} />
          </div>
          <p className="pal-fin-terminal-state-title">Processing card charge…</p>
          <p className="pal-fin-terminal-state-detail">Secured by Stripe — do not close this window.</p>
        </div>
      )}

      {step === 'done' && (
        <div className="pal-fin-terminal-state pal-fin-terminal-state-success">
          <div className="pal-fin-terminal-state-icon">
            <CheckCircle2 size={26} />
          </div>
          <StripeStatusBadge sharp variant="success" label="Paid" />
          <p className="pal-fin-terminal-state-title">Charge successful</p>
          <p className="pal-fin-terminal-state-detail">{resultDetail}</p>
        </div>
      )}

      {step === 'declined' && (
        <div className="pal-fin-terminal-state pal-fin-terminal-state-declined">
          <div className="pal-fin-terminal-state-icon">
            <XCircle size={26} />
          </div>
          <StripeStatusBadge sharp variant="danger" label="Declined" />
          <p className="pal-fin-terminal-state-title">Charge failed</p>
          <p className="pal-fin-terminal-state-detail">{resultDetail || error}</p>
        </div>
      )}

      <footer className="pal-fin-modal-footer">
        {step === 'form' && (
          <>
            <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="gm-btn gm-btn-primary" disabled={busy || !stripe}>
              <CreditCard size={14} /> Charge card
            </button>
          </>
        )}
        {(step === 'done' || step === 'declined') && (
          <button type="button" className="gm-btn gm-btn-primary" onClick={onClose}>
            Done
          </button>
        )}
        {step === 'declined' && (
          <button type="button" className="gm-btn gm-btn-secondary" onClick={() => { setStep('form'); setError(''); }}>
            Try again
          </button>
        )}
      </footer>
    </form>
  );
}

export function StripeManualChargeModal({ franchiseId, onClose, onSuccess, onFeedback }) {
  const [publishableKey, setPublishableKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await stripeFinancialGetConfig({ franchiseId });
        const pk = String(cfg?.publishableKey || '').trim();
        if (!pk) throw new Error('Stripe publishable key not configured');
        if (!cancelled) setPublishableKey(pk);
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'Stripe not configured');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [franchiseId]);

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  return (
    <div
      className="pal-fin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
    >
      <div className="pal-fin-modal pal-fin-modal-wide pal-fin-modal-charge">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Manual charge</p>
            <h2 className="pal-fin-modal-title">Charge card</h2>
            <p className="pal-fin-modal-sub">Enter customer details and card — press Esc to close.</p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="pal-fin-modal-body pal-fin-modal-charge-body">
          {loading && <p className="pal-fin-empty">Loading Stripe…</p>}
          {loadError && <div className="pal-fin-alert">{loadError}</div>}
          {!loading && !loadError && stripePromise && (
            <Elements stripe={stripePromise}>
              <CompactChargeForm
                franchiseId={franchiseId}
                onClose={onClose}
                onSuccess={onSuccess}
                onFeedback={onFeedback}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
