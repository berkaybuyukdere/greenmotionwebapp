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
import { CreditCard, Shield } from 'lucide-react';
import { isDirectCardOrder } from '../../utilities/stripeCustomerGroups';
import {
  stripeFinancialGetConfig,
  stripeFinancialRetryDirectCardOperation,
  stripeFinancialRetryDirectCardSavedPayment,
  stripeFinancialFinalizeDirectCardOperation,
  stripeFinancialPersistDirectCardSnapshot,
} from '../../services/stripeFinancialApi';
import { formatStripeDeclineForDisplay } from '../../utilities/stripeDeclineMessages';

const CARD_ELEMENT_OPTIONS = {
  style: {
    base: {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: '14px',
      color: '#1a2332',
      '::placeholder': { color: '#8b95a5' },
    },
    invalid: { color: '#dc2626' },
  },
};

function formatMoneyMinor(amount, currency = 'chf') {
  const major = Number(amount) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency).toUpperCase(),
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${String(currency).toUpperCase()}`;
  }
}

function formatCardBrand(brand) {
  const b = String(brand || '').trim();
  if (!b) return 'Card';
  return b.charAt(0).toUpperCase() + b.slice(1);
}

function formatExpiry(month, year) {
  if (!month || !year) return '—';
  const mm = String(month).padStart(2, '0');
  const yy = String(year).length === 4 ? String(year).slice(-2) : String(year).padStart(2, '0');
  return `${mm} / ${yy}`;
}

function SavedCardPanel({ order }) {
  const name = order.cardholderName || order.customerName || '—';
  const last4 = order.cardLast4 || '????';
  const brand = formatCardBrand(order.cardBrand);
  const expiry = formatExpiry(order.cardExpMonth, order.cardExpYear);

  return (
    <section className="pal-cust-new-op-card-panel pal-cust-saved-card-panel">
      <div className="pal-cust-new-op-card-head">
        <CreditCard size={16} />
        <span>Card on file</span>
        <span className="pal-cust-new-op-card-secure">
          <Shield size={12} /> Saved from prior attempt
        </span>
      </div>
      <dl className="pal-cust-saved-card-dl">
        <div className="pal-cust-saved-card-row">
          <dt>Cardholder</dt>
          <dd>{name}</dd>
        </div>
        <div className="pal-cust-saved-card-row">
          <dt>Number</dt>
          <dd className="pal-fin-mono">•••• •••• •••• {last4}</dd>
        </div>
        <div className="pal-cust-saved-card-row">
          <dt>Expiry</dt>
          <dd className="pal-fin-mono">{expiry}</dd>
        </div>
        <div className="pal-cust-saved-card-row">
          <dt>Brand</dt>
          <dd>{brand}</dd>
        </div>
      </dl>
    </section>
  );
}

function RetryChargeForm({
  franchiseId,
  mailOrder,
  onSuccess,
  onError,
  onCancel,
  onCardUpdated,
  busy,
  setBusy,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [order, setOrder] = useState(mailOrder);
  const [amountChf, setAmountChf] = useState(() =>
    mailOrder?.amount != null ? String(Number(mailOrder.amount) / 100) : '',
  );
  const [cardholderName, setCardholderName] = useState(
    mailOrder?.cardholderName || mailOrder?.customerName || '',
  );
  const [useDifferentCard, setUseDifferentCard] = useState(false);
  const [formError, setFormError] = useState('');

  const hasSavedCard = Boolean(
    order?.stripePaymentMethodId || (order?.cardLast4 && !useDifferentCard),
  );
  const canChargeSaved = Boolean(order?.stripePaymentMethodId && !useDifferentCard);

  useEffect(() => {
    setOrder(mailOrder);
    setAmountChf(mailOrder?.amount != null ? String(Number(mailOrder.amount) / 100) : '');
    setCardholderName(mailOrder?.cardholderName || mailOrder?.customerName || '');
    setUseDifferentCard(false);
    setFormError('');
  }, [mailOrder?.id, mailOrder?.amount, mailOrder?.cardLast4, mailOrder?.stripePaymentMethodId]);

  const persistSnapshot = async (paymentIntentId) => {
    if (!paymentIntentId) return null;
    try {
      const saved = await stripeFinancialPersistDirectCardSnapshot({
        franchiseId,
        mailOrderId: order.id,
        paymentIntentId,
      });
      const merged = { ...order, ...saved };
      setOrder(merged);
      onCardUpdated?.(merged);
      return merged;
    } catch {
      return null;
    }
  };

  const runSavedCard = async (unitAmount) => {
    const retried = await stripeFinancialRetryDirectCardSavedPayment({
      franchiseId,
      mailOrderId: order.id,
      unitAmount,
    });
    if (retried.status !== 'succeeded') {
      throw new Error(`Payment status: ${retried.status || 'unknown'}`);
    }
    return stripeFinancialFinalizeDirectCardOperation({
      franchiseId,
      mailOrderId: order.id,
      paymentIntentId: retried.paymentIntentId,
      sendEmail: Boolean(order.customerEmail),
    });
  };

  const runWithCardEntry = async (unitAmount) => {
    if (!stripe || !elements) {
      throw new Error('Stripe not ready');
    }
    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) {
      throw new Error('Card fields not ready');
    }

    const prepared = await stripeFinancialRetryDirectCardOperation({
      franchiseId,
      mailOrderId: order.id,
      unitAmount,
    });

    const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(prepared.clientSecret, {
      payment_method: {
        card: cardNumber,
        billing_details: {
          name: cardholderName.trim() || order.customerName || undefined,
          email: order.customerEmail || undefined,
        },
      },
    });

    const piId = paymentIntent?.id || confirmError?.payment_intent?.id || prepared.paymentIntentId;
    if (piId) {
      await persistSnapshot(piId);
    }

    if (confirmError) {
      throw formatStripeDeclineForDisplay(confirmError);
    }
    if (paymentIntent?.status !== 'succeeded') {
      throw new Error(`Payment status: ${paymentIntent?.status || 'unknown'}`);
    }

    return stripeFinancialFinalizeDirectCardOperation({
      franchiseId,
      mailOrderId: order.id,
      paymentIntentId: paymentIntent.id,
      sendEmail: Boolean(order.customerEmail),
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const major = parseFloat(String(amountChf).replace(',', '.'));
    if (!Number.isFinite(major) || major < 0.5) {
      setFormError('Enter a valid amount (min CHF 0.50).');
      return;
    }
    const unitAmount = Math.round(major * 100);

    setBusy(true);
    setFormError('');
    try {
      const finalized = canChargeSaved
        ? await runSavedCard(unitAmount)
        : await runWithCardEntry(unitAmount);
      const last4 = finalized.cardLast4 || order.cardLast4;
      const suffix = last4 ? ` · · · · ${last4}` : '';
      onSuccess?.({
        title: 'Payment completed',
        detail: `${formatMoneyMinor(unitAmount, order.currency)} charged${suffix}${
          finalized.emailSent ? ' · receipt e-mailed' : ''
        }`,
      });
    } catch (err) {
      const friendly = formatStripeDeclineForDisplay(err);
      setFormError(friendly.displayText);
      onError?.(friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pal-cust-retry-panel" onSubmit={handleSubmit}>
      {formError && <div className="pal-fin-decline-alert">{formError}</div>}

      <div className="pal-cust-retry-summary">
        <span className="pal-fin-mono">{order.resNo}</span>
        <span>{order.customerName}</span>
        {order.customerEmail && <span className="pal-cust-timeline-meta">{order.customerEmail}</span>}
      </div>

      <label className="pal-cust-field">
        <span>Amount (CHF) *</span>
        <input
          type="number"
          min="0.5"
          step="0.05"
          className="pal-fin-input"
          value={amountChf}
          onChange={(e) => setAmountChf(e.target.value)}
          disabled={busy}
        />
        <small>Original: {formatMoneyMinor(order.amount, order.currency)}</small>
      </label>

      {hasSavedCard && !useDifferentCard ? (
        <>
          <SavedCardPanel order={order} />
          {!canChargeSaved && (
            <p className="pal-cust-timeline-hint">
              Card details saved — enter CVC below or use a different card to retry.
            </p>
          )}
          <button
            type="button"
            className="gm-btn gm-btn-secondary gm-btn-sm pal-cust-use-diff-card"
            onClick={() => setUseDifferentCard(true)}
            disabled={busy}
          >
            Use different card
          </button>
        </>
      ) : (
        <section className="pal-cust-new-op-card-panel">
          <div className="pal-cust-new-op-card-head">
            <CreditCard size={16} />
            <span>Card details</span>
            <span className="pal-cust-new-op-card-secure">
              <Shield size={12} /> Secured by Stripe
            </span>
          </div>
          {order.cardLast4 && (
            <button
              type="button"
              className="gm-btn gm-btn-secondary gm-btn-sm pal-cust-use-diff-card"
              onClick={() => setUseDifferentCard(false)}
              disabled={busy}
            >
              Back to saved card ·••• {order.cardLast4}
            </button>
          )}
          <label className="pal-cust-field">
            <span>Cardholder name *</span>
            <input
              className="pal-fin-input"
              value={cardholderName}
              onChange={(e) => setCardholderName(e.target.value)}
              autoComplete="cc-name"
              disabled={busy}
            />
          </label>
          <label className="pal-cust-field">
            <span>Card number *</span>
            <div className="pal-cust-stripe-field">
              <CardNumberElement options={CARD_ELEMENT_OPTIONS} />
            </div>
          </label>
          <div className="pal-cust-new-op-row">
            <label className="pal-cust-field">
              <span>Expiry *</span>
              <div className="pal-cust-stripe-field">
                <CardExpiryElement options={CARD_ELEMENT_OPTIONS} />
              </div>
            </label>
            <label className="pal-cust-field">
              <span>CVC *</span>
              <div className="pal-cust-stripe-field">
                <CardCvcElement options={CARD_ELEMENT_OPTIONS} />
              </div>
            </label>
          </div>
        </section>
      )}

      <div className="pal-cust-retry-actions">
        <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={onCancel} disabled={busy}>
          Back
        </button>
        <button
          type="submit"
          className="gm-btn gm-btn-primary gm-btn-sm"
          disabled={busy || ((!canChargeSaved || useDifferentCard) && !stripe)}
        >
          {busy ? 'Processing…' : canChargeSaved && !useDifferentCard ? 'Charge saved card' : 'Retry charge'}
        </button>
      </div>
    </form>
  );
}

export function mailOrderCanRetryDirectCharge(order) {
  if (!order || order.status === 'paid') return false;
  return isDirectCardOrder(order);
}

export function StripeDirectCardRetryPanel({
  franchiseId,
  mailOrder,
  onSuccess,
  onError,
  onCancel,
  onCardUpdated,
}) {
  const [publishableKey, setPublishableKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hydratedOrder, setHydratedOrder] = useState(mailOrder);

  useEffect(() => {
    setHydratedOrder(mailOrder);
  }, [mailOrder]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const cfg = await stripeFinancialGetConfig({ franchiseId });
        const pk = String(cfg?.publishableKey || '').trim();
        if (!pk) throw new Error('Stripe publishable key not configured');
        if (!cancelled) setPublishableKey(pk);

        if (mailOrder?.paymentIntentId && !mailOrder?.cardLast4) {
          try {
            const saved = await stripeFinancialPersistDirectCardSnapshot({
              franchiseId,
              mailOrderId: mailOrder.id,
              paymentIntentId: mailOrder.paymentIntentId,
            });
            if (!cancelled) {
              const merged = { ...mailOrder, ...saved };
              setHydratedOrder(merged);
              onCardUpdated?.(merged);
            }
          } catch {
            /* no card on PI yet */
          }
        }
      } catch (e) {
        if (!cancelled) setLoadError(e?.message || 'Stripe not configured');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [franchiseId, mailOrder?.id, mailOrder?.paymentIntentId, mailOrder?.cardLast4, onCardUpdated]);

  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey],
  );

  if (!mailOrder) return null;

  return (
    <div className="pal-cust-retry-wrap">
      <header className="pal-cust-retry-head">
        <p className="pal-fin-eyebrow">Retry direct charge</p>
        <h3 className="pal-cust-retry-title">Unpaid operation</h3>
      </header>
      {loading && <p className="pal-cust-empty">Loading card…</p>}
      {loadError && <div className="pal-fin-alert">{loadError}</div>}
      {!loading && !loadError && stripePromise && (
        <Elements stripe={stripePromise}>
          <RetryChargeForm
            franchiseId={franchiseId}
            mailOrder={hydratedOrder}
            onSuccess={onSuccess}
            onError={onError}
            onCancel={onCancel}
            onCardUpdated={onCardUpdated}
            busy={busy}
            setBusy={setBusy}
          />
        </Elements>
      )}
    </div>
  );
}
