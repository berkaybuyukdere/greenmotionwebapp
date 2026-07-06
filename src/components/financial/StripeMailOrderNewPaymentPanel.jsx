import React, { useMemo, useState } from 'react';
import { Upload, X, User, Mail, Hash, Paperclip } from 'lucide-react';
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
  stripeFinancialCreateMailOrderPayment,
  stripeFinancialAttachMailOrderDocuments,
  stripeFinancialSendMailOrderEmail,
} from '../../services/stripeFinancialApi';
import { humanizeStripeFinancialError } from './StripeFinFeedback';
import { MAIL_ORDER_LINK_VALID_DAYS } from '../../utilities/mailOrderReminderUtils';

const emptyForm = {
  category: 'damage',
  resNo: defaultResCodeValue(),
  customerName: '',
  customerEmail: '',
  mailContent: '',
  unitAmountMajor: '',
  currency: 'chf',
};

const CATEGORY_OPTIONS = [
  { id: 'traffic_fine', title: 'Traffic fines', sub: 'SMTP · traffic fines mailbox', tone: 'traffic' },
  { id: 'damage', title: 'Damage', sub: 'SMTP · damage mailbox', tone: 'damage' },
  { id: 'extra', title: 'Extra', sub: 'Misc. charges · damage mailbox', tone: 'extra' },
];

function categoryBtnClass(category, active) {
  const base = 'pal-fin-category-btn';
  if (!active) return base;
  const tone = CATEGORY_OPTIONS.find((o) => o.id === category)?.tone || 'damage';
  return `${base} pal-fin-category-btn-active pal-fin-category-btn-active-${tone}`;
}

function mailPreviewSubject({ category, resNo }) {
  const res = formatResCodeForSubmit(resNo) || 'RES-—';
  const label = category === 'traffic_fine' ? 'Traffic fine' : category === 'extra' ? 'Extra charge' : 'Damage';
  return `${label} payment request — ${res}`;
}

function MailComposePreview({ to, subject, body, onBodyChange, files = [] }) {
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
          <span className="text-sm font-medium text-[var(--erpx-ink)]">{subject || '—'}</span>
        </div>
        <div className="pal-fin-mail-compose-row pal-fin-mail-compose-row-body">
          <span className="pal-fin-mail-compose-label">Body</span>
          <textarea
            className="pal-fin-mail-compose-input pal-fin-mail-compose-textarea"
            value={body}
            onChange={(e) => onBodyChange?.(e.target.value)}
            placeholder="Message body for the customer e-mail…"
          />
        </div>
      </div>
      <div className="pal-fin-mail-compose-preview">
        {body?.trim() ? body : 'Message body for the customer e-mail…'}
        {'\n\n'}
        [Pay button — amount shown after send]
      </div>
      {files.length > 0 && (
        <div className="pal-fin-mail-compose-attachments">
          <span className="pal-fin-mail-compose-label">
            <Paperclip size={12} aria-hidden /> Attachments ({files.length})
          </span>
          <ul className="pal-fin-attachment-preview-list">
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} className="pal-fin-attachment-preview-item">
                <Paperclip size={12} aria-hidden />
                <span className="truncate">{f.name}</span>
                <span className="pal-fin-attachment-preview-size">{Math.round(f.size / 1024)} KB</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function StripeMailOrderNewPaymentPanel({
  franchiseId,
  onClose,
  onSuccess,
  onFeedback,
}) {
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const formDirty = useMemo(
    () =>
      Boolean(
        resCodeNumberPart(form.resNo) ||
          form.customerName.trim() ||
          form.customerEmail.trim() ||
          form.mailContent.trim() ||
          form.unitAmountMajor.trim() ||
          files.length,
      ),
    [form, files],
  );

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

  const handleSubmit = async () => {
    const resNo = formatResCodeForSubmit(form.resNo);
    const customerName = form.customerName.trim();
    const customerEmail = form.customerEmail.trim();
    if (!isResCodeComplete(form.resNo)) {
      setError('RES number is required.');
      return;
    }
    if (!customerName) {
      setError('Customer name is required.');
      return;
    }
    const major = parseFloat(String(form.unitAmountMajor).replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter a valid price.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const unitAmount = Math.round(major * 100);
      const apiCategory = form.category === 'extra' ? 'damage' : form.category;
      const result = await stripeFinancialCreateMailOrderPayment({
        franchiseId,
        category: apiCategory,
        resNo,
        customerName,
        customerEmail,
        mailContent: form.mailContent.trim(),
        unitAmount,
        currency: form.currency,
        skipEmail: true,
      });
      if (files.length && result.mailOrderId) {
        await uploadDocuments(result.mailOrderId);
      }
      if (customerEmail) {
        await stripeFinancialSendMailOrderEmail({ franchiseId, mailOrderId: result.mailOrderId });
      }
      onFeedback?.({
        type: 'success',
        title: 'Payment e-mail sent',
        detail: customerEmail
          ? `Payment link e-mailed to ${customerEmail} for CHF ${major.toFixed(2)}.`
          : `Payment link created for CHF ${major.toFixed(2)}.`,
        at: new Date().toISOString(),
      });
      onSuccess?.();
      onClose?.();
    } catch (e) {
      const human = humanizeStripeFinancialError(e);
      onFeedback?.({
        type: 'error',
        title: human.title || 'Could not send payment mail',
        detail: human.detail || e?.message,
        at: new Date().toISOString(),
      });
      setError(e?.message || 'Could not send payment mail');
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (formDirty && !window.confirm('Discard this mail order draft?')) return;
    onClose?.();
  };

  return (
    <div
      className="pal-fin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div className="pal-fin-modal pal-fin-modal-wide pal-fin-modal-tall">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Mail order · Payment link</p>
            <h2 className="pal-fin-modal-title">Send payment request</h2>
            <p className="pal-fin-modal-sub">
              Customer receives e-mail with embedded Pay button. Link valid {MAIL_ORDER_LINK_VALID_DAYS} days.
            </p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={requestClose} disabled={saving} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pal-fin-modal-body pal-fin-new-payment-body pal-fin-new-payment-body-compact">
          {error && <div className="pal-fin-alert">{error}</div>}

          <div className="pal-fin-category-toggle pal-fin-category-toggle-3">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={categoryBtnClass(opt.id, form.category === opt.id)}
                onClick={() => setForm((f) => ({ ...f, category: opt.id }))}
              >
                <span className="pal-fin-category-btn-title">{opt.title}</span>
                <span className="pal-fin-category-btn-sub">{opt.sub}</span>
              </button>
            ))}
          </div>

          <label className="block pal-fin-field-block">
            <span className="pal-fin-field-label-row">
              <Hash size={14} aria-hidden />
              RES code *
            </span>
            <div className="pal-fin-res-prefill-row">
              <span className="pal-fin-res-prefix">RES-</span>
              <input
                className="pal-fin-input pal-fin-mono pal-fin-res-input"
                value={form.resNo}
                onChange={(e) => setForm((f) => ({ ...f, resNo: normalizeResCodeInput(e.target.value) }))}
                placeholder="17505"
              />
            </div>
            <span className="text-caption">Type number only — RES- prefix is added automatically.</span>
          </label>
          <div className="pal-fin-inline-form-row pal-fin-inline-form-row-padded">
            <label className="block pal-fin-field-block">
              <span className="pal-fin-field-label-row">
                <User size={14} aria-hidden />
                Customer name *
              </span>
              <input className="pal-fin-input" value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} placeholder="First and last name" />
            </label>
            <label className="block pal-fin-field-block">
              <span className="pal-fin-field-label-row">
                <Mail size={14} aria-hidden />
                Customer email *
              </span>
              <input type="email" className="pal-fin-input" value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} placeholder="name@example.com" />
            </label>
          </div>
          <MailComposePreview
            to={form.customerEmail}
            subject={mailPreviewSubject({ category: form.category, resNo: form.resNo })}
            body={form.mailContent}
            onBodyChange={(value) => setForm((f) => ({ ...f, mailContent: value }))}
            files={files}
          />
          <div className="pal-fin-inline-form-row">
            <label className="block">
              <span className="pal-fin-field-label">Price (CHF) *</span>
              <input className="pal-fin-input" inputMode="decimal" value={form.unitAmountMajor} onChange={(e) => setForm((f) => ({ ...f, unitAmountMajor: e.target.value }))} placeholder="1500.00" />
            </label>
            <label className="block">
              <span className="pal-fin-field-label">Currency</span>
              <select className="pal-fin-input" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                <option value="chf">CHF</option>
                <option value="eur">EUR</option>
              </select>
            </label>
          </div>

          <label className="block">
            <span className="pal-fin-field-label">Attachments</span>
            <div className="pal-fin-upload-zone">
              <input
                type="file"
                multiple
                id="new-payment-mail-order-files"
                className="sr-only"
                onChange={(e) => {
                  const picked = Array.from(e.target.files || []);
                  if (picked.length) setFiles((prev) => [...prev, ...picked]);
                  e.target.value = '';
                }}
              />
              <label htmlFor="new-payment-mail-order-files" className="gm-btn gm-btn-secondary gm-btn-sm cursor-pointer">
                <Upload size={14} />
                Add files
              </label>
            </div>
          </label>
        </div>

        <footer className="pal-fin-modal-footer">
          <button type="button" className="gm-btn gm-btn-secondary" onClick={requestClose} disabled={saving}>
            Close
          </button>
          <button type="button" className="gm-btn gm-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? 'Sending…' : 'Send payment e-mail'}
          </button>
        </footer>
      </div>
    </div>
  );
}
