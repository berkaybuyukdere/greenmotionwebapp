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
import { Upload, X, CreditCard, Shield, Terminal } from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { setDoc, getDoc, Timestamp } from 'firebase/firestore';
import { storage } from '../../firebase/client';
import { docRefHelper } from '../../firebase/authScope';
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
  stripeFinancialAttachMailOrderDocuments,
  stripeFinancialPersistDirectCardSnapshot,
} from '../../services/stripeFinancialApi';
import { formatStripeDeclineForDisplay } from '../../utilities/stripeDeclineMessages';
import { StripeDepositModal } from './StripeDepositModal';

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

const CATEGORY_META = {
  traffic_fine: { title: 'Traffic fines', sub: 'SMTP · traffic fines mailbox', tone: 'traffic' },
  damage: { title: 'Damage', sub: 'SMTP · damage mailbox', tone: 'damage' },
  extra: { title: 'Extra', sub: 'Misc. charges · damage mailbox', tone: 'extra' },
  walk_in: { title: 'Walk in', sub: 'No RES · deposit or manual card', tone: 'walk' },
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

function categoryBtnClass(category, active) {
  const meta = CATEGORY_META[category];
  const base = 'pal-fin-category-btn';
  if (!active) return base;
  const toneClass =
    meta?.tone === 'traffic'
      ? 'pal-fin-category-btn-active-traffic'
      : meta?.tone === 'damage' || meta?.tone === 'extra'
        ? 'pal-fin-category-btn-active-damage'
        : meta?.tone === 'walk'
          ? 'pal-fin-category-btn-active-walk'
          : '';
  return `${base} pal-fin-category-btn-active ${toneClass}`.trim();
}

function apiCategory(category) {
  if (category === 'extra') return 'damage';
  if (category === 'walk_in') return 'damage';
  return category;
}

/** Canonical `RES-{digits}` form, mirroring iOS TrafficAccidentContract.canonicalRES. */
function canonicalResCode(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (s.startsWith('RES-')) s = s.slice(4);
  else if (s.startsWith('RES')) s = s.slice(3).replace(/^[-_ ]+/, '');
  const digits = s.replace(/\D/g, '');
  return digits ? `RES-${digits}` : '';
}

/** Stable primary contract doc id, mirroring iOS TrafficAccidentContract.stableDocumentId. */
async function trafficContractStableDocId(franchiseId, canonicalRes) {
  const key = `${String(franchiseId).toUpperCase()}|${canonicalRes}|primary`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { docId: `tac_${hex.slice(0, 32)}`, idempotencyKey: key };
}

/**
 * Mirror a completed Stripe charge into Office Operations so traffic fines
 * land under "Traffic Fine" and damage charges under "Traffic Accident".
 * Damage charges additionally create a `traffic_accident_contracts` record in
 * the exact shape the iOS app's Traffic Accidents feature already reads, so
 * they show up on iOS with no app change (RES-idempotent: an existing primary
 * contract for the RES gets a supplement line instead of being overwritten).
 * Fire-and-forget: a failure here must never break the payment flow itself.
 */
async function recordOfficeOperationForCharge({
  franchiseId,
  category,
  resNo,
  customerName,
  amountMajor,
  mailOrderId,
  paymentIntentId,
}) {
  const officeType =
    category === 'traffic_fine' ? 'Traffic Fine'
      : category === 'damage' ? 'Traffic Accident'
        : null;
  if (!officeType) return;
  const amount = Number(amountMajor) || 0;
  const operationId = crypto.randomUUID();

  try {
    const iosTimeInterval = (Date.now() - new Date('2001-01-01T00:00:00Z').getTime()) / 1000;
    await setDoc(docRefHelper('office_operations', operationId), {
      id: operationId,
      type: officeType,
      date: iosTimeInterval,
      amount,
      photos: [],
      vehiclePlate: null,
      posCount: null,
      posAmounts: null,
      notes: '',
      isCompleted: false,
      resCode: resNo || null,
      referenceNumber: resNo || null,
      plate: null,
      customerName: customerName || null,
      status: 'done',
      washedBy: null,
      washingDate: null,
      source: 'stripe',
      stripeMailOrderId: mailOrderId || null,
      stripePaymentIntentId: paymentIntentId || null,
      franchiseId,
    });
  } catch (err) {
    console.warn('[stripe] office operation mirror failed', err?.message);
  }

  if (category !== 'damage') return;
  try {
    const canonicalRes = canonicalResCode(resNo);
    if (!canonicalRes) return;
    const { docId, idempotencyKey } = await trafficContractStableDocId(franchiseId, canonicalRes);
    const now = Timestamp.now();
    const contractBase = {
      photos: [],
      amount,
      resCode: canonicalRes,
      paidAmount: amount,
      createdAt: now,
      createdTs: now,
      contractIssueDate: now,
      processedDate: now,
      franchiseId: String(franchiseId).toUpperCase(),
      createdByName: 'Stripe',
      paymentMethod: 'officePayment',
      linkedPaymentOfficeOperationDocumentId: operationId,
      source: 'stripe',
      stripePaymentIntentId: paymentIntentId || null,
    };
    const primaryRef = docRefHelper('traffic_accident_contracts', docId);
    const existing = await getDoc(primaryRef);
    if (!existing.exists()) {
      await setDoc(primaryRef, {
        ...contractBase,
        id: crypto.randomUUID(),
        documentId: docId,
        idempotencyKey,
      });
    } else {
      const supplementDocId = crypto.randomUUID();
      await setDoc(docRefHelper('traffic_accident_contracts', supplementDocId), {
        ...contractBase,
        id: supplementDocId,
        documentId: supplementDocId,
        supplementOfDocumentId: docId,
      });
    }
  } catch (err) {
    console.warn('[stripe] traffic accident contract mirror failed', err?.message);
  }
}

function MailComposePreview({ to, subject, onSubjectChange, body, onBodyChange, files = [] }) {
  return (
    <section className="pal-fin-mail-compose" aria-label="E-mail preview">
      <div className="pal-fin-mail-compose-toolbar">E-mail preview</div>
      <div className="pal-fin-mail-compose-fields">
        <div className="pal-fin-mail-compose-row">
          <span className="pal-fin-mail-compose-label">To</span>
          <span className="text-sm text-[var(--erpx-ink-secondary)]">{to || '—'}</span>
        </div>
        <div className="pal-fin-mail-compose-row">
          <span className="pal-fin-mail-compose-label">Subject</span>
          <input
            className="pal-fin-mail-compose-input"
            value={subject}
            onChange={(e) => onSubjectChange?.(e.target.value)}
            placeholder="Payment confirmation — RES-17505"
          />
        </div>
        <div className="pal-fin-mail-compose-row pal-fin-mail-compose-row-body">
          <span className="pal-fin-mail-compose-label">Body</span>
          <textarea
            className="pal-fin-mail-compose-input pal-fin-mail-compose-textarea"
            value={body}
            onChange={(e) => onBodyChange?.(e.target.value)}
            placeholder="Message body sent to the customer after payment…"
          />
        </div>
      </div>
      <div className="pal-fin-mail-compose-preview">
        {body?.trim() ? body : 'Receipt message preview…'}
      </div>
      {files.length > 0 && (
        <div className="pal-fin-mail-compose-attachments">
          <span className="pal-fin-mail-compose-label">Attachments</span>
          <ul>
            {files.map((f) => (
              <li key={f.name}>{f.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DirectCardChargeForm({
  franchiseId,
  initialGroup,
  categories,
  onClose,
  onSuccess,
  onError,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    category: categories.includes('damage') ? 'damage' : categories[0] || 'damage',
    resNo: initialGroup?.resCode
      ? normalizeResCodeInput(initialGroup.resCode.replace(/^RES-/i, ''))
      : emptyForm.resNo,
    customerName: initialGroup?.customerName || '',
    customerEmail: initialGroup?.customerEmail || '',
    cardholderName: initialGroup?.customerName || '',
  }));
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [showDepositModal, setShowDepositModal] = useState(false);
  const isWalkIn = form.category === 'walk_in';
  const showCardForm = !isWalkIn || form.walkInMode === 'manual';

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

    const resNo = isWalkIn ? 'WALK-IN' : formatResCodeForSubmit(form.resNo);
    const customerName = form.customerName.trim();
    const customerEmail = form.customerEmail.trim();
    const cardholderName = form.cardholderName.trim() || customerName;

    if (!isWalkIn && !isResCodeComplete(form.resNo)) {
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
        category: apiCategory(form.category),
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

      await recordOfficeOperationForCharge({
        franchiseId,
        category: form.category,
        resNo,
        customerName,
        amountMajor: major,
        mailOrderId: created.mailOrderId,
        paymentIntentId: paymentIntent.id,
      });

      const last4 = finalized.cardLast4 ? ` · · · · ${finalized.cardLast4}` : '';
      onSuccess?.({
        title: 'Payment completed',
        detail: `CHF ${major.toFixed(2)} charged${last4}${finalized.emailSent ? ' · receipt e-mailed' : ''}${finalized.tokenSaved ? ' · token saved' : ''}`,
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

  const toggleClass =
    categories.length >= 4
      ? 'pal-fin-category-toggle-4'
      : categories.length === 3
        ? 'pal-fin-category-toggle-3'
        : '';

  return (
    <>
      <form className="pal-cust-new-op-form" onSubmit={handleSubmit}>
        {formError && <div className="pal-fin-alert">{formError}</div>}

        <div className={`pal-fin-category-toggle ${toggleClass}`.trim()}>
          {categories.map((cat) => {
            const meta = CATEGORY_META[cat] || { title: cat, sub: '' };
            return (
              <button
                key={cat}
                type="button"
                className={categoryBtnClass(cat, form.category === cat)}
                onClick={() => setForm((f) => ({ ...f, category: cat, walkInMode: null }))}
                disabled={busy}
              >
                <span className="pal-fin-category-btn-title">{meta.title}</span>
                <span className="pal-fin-category-btn-sub">{meta.sub}</span>
              </button>
            );
          })}
        </div>

        {isWalkIn && (
          <div className="pal-cust-walk-in-actions">
            <button
              type="button"
              className={`gm-btn gm-btn-secondary ${form.walkInMode === 'deposit' ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setForm((f) => ({ ...f, walkInMode: 'deposit' }))}
              disabled={busy}
            >
              <Terminal size={14} />
              Deposit on terminal
            </button>
            <button
              type="button"
              className={`gm-btn gm-btn-secondary ${form.walkInMode === 'manual' ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setForm((f) => ({ ...f, walkInMode: 'manual' }))}
              disabled={busy}
            >
              <CreditCard size={14} />
              Charge card manually
            </button>
          </div>
        )}

        {isWalkIn && form.walkInMode === 'deposit' && (
          <div className="pal-cust-action-card">
            <p className="pal-cust-action-card-sub">
              Authorize a deposit hold on POS. Card token is saved after successful authorization.
            </p>
            <button
              type="button"
              className="gm-btn gm-btn-primary pal-cust-action-btn"
              onClick={() => setShowDepositModal(true)}
              disabled={busy || !form.customerName.trim()}
            >
              Open terminal deposit
            </button>
          </div>
        )}

        {showCardForm && (
          <>
            {!isWalkIn && (
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
            )}

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

            <MailComposePreview
              to={form.customerEmail}
              subject={form.emailSubject}
              onSubjectChange={(value) => setForm((f) => ({ ...f, emailSubject: value }))}
              body={form.emailBodyHtml}
              onBodyChange={(value) => setForm((f) => ({ ...f, emailBodyHtml: value }))}
              files={files}
            />
          </>
        )}

        {showCardForm && (
          <footer className="pal-fin-modal-footer pal-cust-new-op-footer">
            <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="gm-btn gm-btn-primary" disabled={busy || !stripe}>
              {busy ? 'Processing…' : 'Charge card'}
            </button>
          </footer>
        )}

        {isWalkIn && !form.walkInMode && (
          <footer className="pal-fin-modal-footer pal-cust-new-op-footer">
            <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose}>
              Cancel
            </button>
          </footer>
        )}
      </form>

      {showDepositModal && (
        <StripeDepositModal
          franchiseId={franchiseId}
          onClose={() => setShowDepositModal(false)}
          onSuccess={() => {
            setShowDepositModal(false);
            onSuccess?.({
              title: 'Deposit authorized',
              detail: 'Terminal hold complete · card token saved for future charges.',
            });
            onClose();
          }}
        />
      )}
    </>
  );
}

export function StripeCustomerNewOperationModal({
  franchiseId,
  initialGroup = null,
  categories = ['traffic_fine', 'damage', 'extra', 'walk_in'],
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

  const needsStripeElements = categories.some((c) => c !== 'walk_in') || categories.includes('walk_in');

  return (
    <div className="pal-fin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="cust-new-op-title">
      <div className="pal-fin-modal pal-fin-modal-wide pal-cust-new-op-modal">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Customers · Operations</p>
            <h2 id="cust-new-op-title" className="pal-fin-modal-title">
              New operation
            </h2>
            <p className="pal-fin-modal-sub">
              Charge card, send payment mail, or authorize a walk-in deposit on POS.
            </p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pal-fin-modal-body pal-cust-new-op-body">
          {loading && <p className="pal-cust-empty">Loading Stripe…</p>}
          {loadError && <div className="pal-fin-alert">{loadError}</div>}
          {!loading && !loadError && stripePromise && needsStripeElements && (
            <Elements stripe={stripePromise}>
              <DirectCardChargeForm
                franchiseId={franchiseId}
                initialGroup={initialGroup}
                categories={categories}
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
