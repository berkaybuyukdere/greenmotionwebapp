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
import { Upload, X, CreditCard, Shield } from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../firebase/client';
import {
  defaultResCodeValue,
  formatResCodeForSubmit,
  isResCodeComplete,
  normalizeResCodeInput,
  resCodeNumberPart,
} from '../../utilities/resCodeInput';
import {
  stripeFinancialGetConfig,
  stripeFinancialCreateDirectCardOperation,
  stripeFinancialFinalizeDirectCardOperation,
  stripeFinancialAttachMailOrderDocuments,
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

const emptyForm = {
  category: 'damage',
  resNo: defaultResCodeValue(),
  customerName: '',
  customerEmail: '',
  cardholderName: '',
  unitAmountMajor: '',
  currency: 'chf',
  emailSubject: '',
  emailBodyHtml: '',
};

function DirectCardChargeForm({ franchiseId, initialGroup, onClose, onSuccess, onError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    resNo: initialGroup?.resCode ? normalizeResCodeInput(initialGroup.resCode.replace(/^RES-/i, '')) : emptyForm.resNo,
    customerName: initialGroup?.customerName || '',
    customerEmail: initialGroup?.customerEmail || '',
    cardholderName: initialGroup?.customerName || '',
  }));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const uploadDocuments = async (mailOrderId) => {
    if (!files.length) return [];
    const uploaded = [];
    for (const file of files.slice(0, 20)) {
      const path = `franchises/${franchiseId}/stripeMailOrders/${mailOrderId}/documents/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
      uploaded.push({
        name: file.name,
        storagePath: path,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
    }
    if (uploaded.length) {
      await stripeFinancialAttachMailOrderDocuments({ franchiseId, mailOrderId, documents: uploaded });
    }
    return uploaded;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    const resNo = formatResCodeForSubmit(form.resNo);
    const customerName = form.customerName.trim();
    const customerEmail = form.customerEmail.trim();
    const cardholderName = form.cardholderName.trim() || customerName;

    if (!isResCodeComplete(form.resNo)) {
      setFormError('RES number is required.');
      return;
    }
    if (!customerName) {
      setFormError('Customer name is required.');
      return;
    }
    if (!cardholderName) {
      setFormError('Cardholder name is required.');
      return;
    }
    const major = parseFloat(String(form.unitAmountMajor).replace(',', '.'));
    if (!Number.isFinite(major) || major < 0.5) {
      setFormError('Enter a valid amount (min CHF 0.50).');
      return;
    }

    const cardNumber = elements.getElement(CardNumberElement);
    if (!cardNumber) {
      setFormError('Card fields not ready — refresh and try again.');
      return;
    }

    setBusy(true);
    setFormError('');
    try {
      const unitAmount = Math.round(major * 100);
      const created = await stripeFinancialCreateDirectCardOperation({
        franchiseId,
        category: form.category,
        resNo,
        customerName,
        customerEmail,
        cardholderName,
        mailContent: form.emailBodyHtml.trim(),
        emailSubject: form.emailSubject.trim(),
        emailBodyHtml: form.emailBodyHtml.trim(),
        unitAmount,
        currency: form.currency,
      });

      if (files.length && created.mailOrderId) {
        await uploadDocuments(created.mailOrderId);
      }

      const { error: confirmError, paymentIntent } = await stripe.confirmCardPayment(
        created.clientSecret,
        {
          payment_method: {
            card: cardNumber,
            billing_details: {
              name: cardholderName,
              email: customerEmail || undefined,
            },
          },
        },
      );

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
        setFormError(friendly.displayText);
        onError?.(friendly);
        return;
      }
      if (paymentIntent?.status !== 'succeeded') {
        throw new Error(`Payment status: ${paymentIntent?.status || 'unknown'}`);
      }

      const finalized = await stripeFinancialFinalizeDirectCardOperation({
        franchiseId,
        mailOrderId: created.mailOrderId,
        paymentIntentId: paymentIntent.id,
        sendEmail: Boolean(customerEmail),
      });

      const last4 = finalized.cardLast4 ? ` · · · · ${finalized.cardLast4}` : '';
      onSuccess?.({
        title: 'Payment completed',
        detail: `CHF ${major.toFixed(2)} charged${last4}${finalized.emailSent ? ' · receipt e-mailed' : ''}`,
      });
      onClose();
    } catch (err) {
      const friendly = formatStripeDeclineForDisplay(err);
      setFormError(friendly.displayText);
      onError?.(friendly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pal-cust-new-op-form" onSubmit={handleSubmit}>
      {formError && <div className="pal-fin-alert">{formError}</div>}

      <div className="pal-fin-category-toggle">
        <button
          type="button"
          className={`pal-fin-category-btn ${form.category === 'traffic_fine' ? 'pal-fin-category-btn-active' : ''}`}
          onClick={() => setForm((f) => ({ ...f, category: 'traffic_fine' }))}
          disabled={busy}
        >
          <span className="pal-fin-category-btn-title">Traffic fines</span>
          <span className="pal-fin-category-btn-sub">SMTP · traffic fines mailbox</span>
        </button>
        <button
          type="button"
          className={`pal-fin-category-btn ${form.category === 'damage' ? 'pal-fin-category-btn-active' : ''}`}
          onClick={() => setForm((f) => ({ ...f, category: 'damage' }))}
          disabled={busy}
        >
          <span className="pal-fin-category-btn-title">Damage</span>
          <span className="pal-fin-category-btn-sub">SMTP · damage mailbox</span>
        </button>
      </div>

      <label className="pal-cust-field">
        <span>RES code *</span>
        <input
          className="pal-fin-input pal-fin-mono"
          value={form.resNo}
          onChange={(e) => setForm((f) => ({ ...f, resNo: normalizeResCodeInput(e.target.value) }))}
          placeholder="17505"
          disabled={busy}
        />
      </label>

      <div className="pal-cust-new-op-row">
        <label className="pal-cust-field">
          <span>Customer name *</span>
          <input
            className="pal-fin-input"
            value={form.customerName}
            onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
            disabled={busy}
          />
        </label>
        <label className="pal-cust-field">
          <span>Customer email</span>
          <input
            type="email"
            className="pal-fin-input"
            value={form.customerEmail}
            onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))}
            disabled={busy}
          />
        </label>
      </div>

      <div className="pal-cust-new-op-row">
        <label className="pal-cust-field">
          <span>Amount (CHF) *</span>
          <input
            className="pal-fin-input"
            inputMode="decimal"
            value={form.unitAmountMajor}
            onChange={(e) => setForm((f) => ({ ...f, unitAmountMajor: e.target.value }))}
            placeholder="150.00"
            disabled={busy}
          />
        </label>
        <label className="pal-cust-field">
          <span>Currency</span>
          <select
            className="pal-fin-input"
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
            disabled={busy}
          >
            <option value="chf">CHF</option>
            <option value="eur">EUR</option>
          </select>
        </label>
      </div>

      <section className="pal-cust-new-op-card-panel">
        <div className="pal-cust-new-op-card-head">
          <CreditCard size={16} />
          <span>Card details</span>
          <span className="pal-cust-new-op-card-secure">
            <Shield size={12} /> Secured by Stripe
          </span>
        </div>
        <label className="pal-cust-field">
          <span>Cardholder name *</span>
          <input
            className="pal-fin-input"
            value={form.cardholderName}
            onChange={(e) => setForm((f) => ({ ...f, cardholderName: e.target.value }))}
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

      <label className="pal-cust-field">
        <span>Attachments</span>
        <div className="pal-fin-upload-zone">
          <input
            type="file"
            multiple
            id="cust-new-op-files"
            className="sr-only"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
            disabled={busy}
          />
          <label htmlFor="cust-new-op-files" className="gm-btn gm-btn-secondary gm-btn-sm cursor-pointer">
            <Upload size={14} />
            Add files
          </label>
          {files.length > 0 && (
            <ul className="pal-fin-doc-list mt-2">
              {files.map((f) => (
                <li key={f.name}>{f.name}</li>
              ))}
            </ul>
          )}
        </div>
      </label>

      <label className="pal-cust-field">
        <span>E-mail subject</span>
        <input
          className="pal-fin-input"
          value={form.emailSubject}
          onChange={(e) => setForm((f) => ({ ...f, emailSubject: e.target.value }))}
          placeholder="Payment confirmation — RES-17505"
          disabled={busy}
        />
      </label>
      <label className="pal-cust-field">
        <span>E-mail context</span>
        <textarea
          className="pal-fin-input min-h-[96px]"
          value={form.emailBodyHtml}
          onChange={(e) => setForm((f) => ({ ...f, emailBodyHtml: e.target.value }))}
          placeholder="Message body sent to the customer after payment…"
          disabled={busy}
        />
      </label>

      <footer className="pal-fin-modal-footer pal-cust-new-op-footer">
        <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="gm-btn gm-btn-primary" disabled={busy || !stripe}>
          {busy ? 'Processing…' : 'Charge card'}
        </button>
      </footer>
    </form>
  );
}

export function StripeCustomerNewOperationModal({
  franchiseId,
  initialGroup = null,
  onClose,
  onSuccess,
  onError,
}) {
  const [publishableKey, setPublishableKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

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
    <div className="pal-fin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cust-new-op-title">
      <div className="pal-fin-modal pal-fin-modal-wide pal-cust-new-op-modal">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Customers · Direct charge</p>
            <h2 id="cust-new-op-title" className="pal-fin-modal-title">
              New operation
            </h2>
            <p className="pal-fin-modal-sub">
              Charge card now — traffic fine or damage. Receipt e-mail sent if customer email is provided.
            </p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pal-fin-modal-body pal-cust-new-op-body">
          {loading && <p className="pal-cust-empty">Loading Stripe…</p>}
          {loadError && <div className="pal-fin-alert">{loadError}</div>}
          {!loading && !loadError && stripePromise && (
            <Elements stripe={stripePromise}>
              <DirectCardChargeForm
                franchiseId={franchiseId}
                initialGroup={initialGroup}
                onClose={onClose}
                onSuccess={onSuccess}
                onError={onError}
              />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
