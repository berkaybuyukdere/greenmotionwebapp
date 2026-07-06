import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, CreditCard } from 'lucide-react';
import { stripeFinancialListAudit } from '../../services/stripeFinancialApi';

const ACTION_LABELS = {
  payment_ui_click: 'Payment UI click',
  deposit_captured: 'Deposit captured',
  payment_hold_cancelled: 'Hold released',
  payment_refunded: 'Payment refunded',
  direct_card_operation_paid: 'Direct card charge',
  mail_order_email_sent: 'Mail order sent',
  deposit_authorized: 'Deposit authorized',
  deposit_incremented: 'Hold increased',
};

function formatAuditLabel(entry) {
  if (entry.action === 'payment_ui_click' && entry.detail?.button) {
    const btn = String(entry.detail.button).replace(/_/g, ' ');
    return `Payment: ${btn}`;
  }
  return ACTION_LABELS[entry.action] || entry.action?.replace(/_/g, ' ') || 'Stripe action';
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function AdminStripePaymentAuditSection({ franchiseId = 'CH' }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setError('');
    setLoading(true);
    try {
      const res = await stripeFinancialListAudit({ franchiseId, limit: 120 });
      setEntries(res.entries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load Stripe payment logs');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const rows = useMemo(() => entries.slice(0, 80), [entries]);

  return (
    <div className="pal-dash-panel mt-6">
      <div className="pal-dash-panel-header flex items-center justify-between gap-3">
        <div>
          <h2 className="pal-dash-panel-title flex items-center gap-2">
            <CreditCard size={16} aria-hidden />
            Stripe payment operations
          </h2>
          <p className="pal-fin-subtitle text-sm mt-1">
            Captures, refunds, deposits, mail orders, and staff button clicks — franchise {franchiseId}
          </p>
        </div>
        <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <div className="pal-dash-panel-body">
        {error && <p className="pal-fin-alert mb-3">{error}</p>}
        {loading && rows.length === 0 ? (
          <p className="text-sm text-[var(--erpx-ink-muted)]">Loading Stripe logs…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-[var(--erpx-ink-muted)]">No Stripe payment activity logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="gm-table w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">When</th>
                  <th className="text-left">Staff</th>
                  <th className="text-left">Action</th>
                  <th className="text-left">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id || `${entry.createdAt}-${entry.action}`}>
                    <td className="tabular-nums whitespace-nowrap">{formatWhen(entry.createdAt)}</td>
                    <td>{entry.actorName || entry.actorEmail || entry.uid || '—'}</td>
                    <td>{formatAuditLabel(entry)}</td>
                    <td className="text-[var(--erpx-ink-secondary)]">
                      {entry.detail?.resCode || entry.detail?.paymentIntentId || entry.detail?.depositId || entry.message || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
