import React from 'react';
import { X, ExternalLink, Mail } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import {
  formatMailOrderDate,
  formatMailOrderDateTime,
  getMailOrderReminderDisplay,
  reminderToneClass,
} from '../../utilities/mailOrderReminderUtils';

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

function DetailRow({ label, value, mono }) {
  return (
    <div className="pal-pay-detail-row">
      <span className="pal-pay-detail-label">{label}</span>
      <span className={mono ? 'pal-pay-detail-value pal-fin-mono' : 'pal-pay-detail-value'}>{value || '—'}</span>
    </div>
  );
}

function categoryLabel(category) {
  if (category === 'traffic_fine') return 'Traffic fines';
  if (category === 'damage') return 'Damage';
  return category || '—';
}

export function StripeMailOrderDetailDrawer({ order, onClose }) {
  if (!order) return null;

  const paid = order.status === 'paid';
  const emailSent = Boolean(order.emailSentAt);
  const rem1 = getMailOrderReminderDisplay(order.reminder1, '1st');
  const rem2 = getMailOrderReminderDisplay(order.reminder2, '2nd');

  return (
    <div className="pal-pay-drawer-backdrop" onClick={onClose} role="presentation">
      <aside className="pal-pay-drawer" onClick={(e) => e.stopPropagation()} aria-label="Mail order details">
        <header className="pal-pay-drawer-header">
          <div>
            <p className="pal-fin-eyebrow">Mail order</p>
            <h2 className="pal-pay-drawer-amount">{order.resNo || order.productName}</h2>
            <p className="pal-pay-drawer-sub">{formatMoney(order.amount, order.currency)}</p>
          </div>
          <button type="button" className="pal-pay-drawer-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pal-pay-drawer-badges">
          <StripeStatusBadge
            sharp
            variant={paid ? 'success' : emailSent ? 'info' : 'warning'}
            label={paid ? 'Paid' : emailSent ? 'Email sent' : 'Awaiting payment'}
          />
          <StripeStatusBadge sharp variant="neutral" label={categoryLabel(order.category)} />
          {order.linkStatus === 'expired' && !paid && (
            <StripeStatusBadge sharp variant="danger" label="Link expired" />
          )}
        </div>

        <div className="pal-pay-drawer-body">
          <DetailRow label="Customer" value={order.customerName} />
          <DetailRow label="Email" value={order.customerEmail} />
          <DetailRow label="Mail content" value={order.mailContent || order.description} />
          <DetailRow label="Link sent" value={formatMailOrderDateTime(order.linkSentAt || order.createdAt)} />
          <DetailRow label="Valid until" value={formatMailOrderDate(order.linkValidUntil)} />

          {emailSent && (
            <DetailRow label="Email sent" value={formatMailOrderDateTime(order.emailSentAt)} />
          )}

          <div className="pal-fin-reminder-drawer-block">
            <p className="pal-fin-inspector-title">Reminders</p>
            <div className={`pal-fin-status ${reminderToneClass(rem1.tone)}`}>
              <span className="pal-fin-status-dot" />
              1st — {rem1.label} · {formatMailOrderDate(rem1.plannedAt)}
            </div>
            <div className={`pal-fin-status ${reminderToneClass(rem2.tone)}`}>
              <span className="pal-fin-status-dot" />
              2nd — {rem2.label} · {formatMailOrderDate(rem2.plannedAt)}
            </div>
          </div>

          {(order.documents || []).length > 0 && (
            <div>
              <p className="pal-fin-inspector-title">Attachments</p>
              <ul className="pal-fin-doc-list">
                {order.documents.map((d) => (
                  <li key={d.storagePath || d.name}>{d.name || d.storagePath}</li>
                ))}
              </ul>
            </div>
          )}

          {order.paymentUrl && (
            <a
              href={order.paymentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="gm-btn gm-btn-secondary gm-btn-sm w-full mt-4"
            >
              <ExternalLink size={15} />
              Open payment link
            </a>
          )}

          {emailSent && (
            <p className="pal-fin-drawer-note">
              <Mail size={14} className="inline mr-1 align-text-bottom" />
              Payment email was sent to the customer. A new link cannot be generated for this record.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
