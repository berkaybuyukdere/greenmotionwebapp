import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import { PalantirWorkbench, PalantirCommandBar } from '../palantir/PalantirWorkbench';
import {
  StripeFilterChips,
  StripeListToolbar,
  StripeStatusBadge,
  StripeDataTable,
} from '../StripeListUI';
import {
  stripeFinancialGetConfig,
  stripeFinancialListDisputes,
  stripeFinancialGetDispute,
  stripeFinancialListAudit,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const STATUS_VARIANT = {
  warning_needs_response: 'warning',
  needs_response: 'warning',
  under_review: 'info',
  warning_under_review: 'info',
  won: 'success',
  lost: 'danger',
  charge_refunded: 'neutral',
};

function disputeStatusVariant(status) {
  return STATUS_VARIANT[status] || 'neutral';
}

function formatStripeMoney(amount, currency) {
  if (amount == null) return '—';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return formatCurrency(major);
  }
}

function formatUnix(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

export function StripeChargebacksView({ franchiseId, user }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [disputes, setDisputes] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [audit, setAudit] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [stripeMode, setStripeMode] = useState('unset');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await stripeFinancialGetConfig({ franchiseId });
      setConfigured(cfg?.configured !== false);
      setStripeMode(cfg?.mode || 'unset');
      const res = await stripeFinancialListDisputes({ franchiseId, limit: 100 });
      setDisputes(res.disputes || []);
      const auditRes = await stripeFinancialListAudit({ franchiseId, limit: 25 });
      setAudit(auditRes.entries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load chargebacks');
      setDisputes([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = disputes;
    if (filter !== 'all') {
      rows = rows.filter((d) => d.status === filter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (d) =>
        d.id?.toLowerCase().includes(q) ||
        d.reason?.toLowerCase().includes(q) ||
        String(d.charge || '').toLowerCase().includes(q)
    );
  }, [disputes, filter, search]);

  const filterOptions = useMemo(() => {
    const counts = {};
    for (const d of disputes) {
      counts[d.status] = (counts[d.status] || 0) + 1;
    }
    return [
      { id: 'all', label: 'All', count: disputes.length },
      { id: 'needs_response', label: 'Needs response', count: counts.needs_response || 0, dotColor: '#f59e0b' },
      { id: 'under_review', label: 'Under review', count: counts.under_review || 0, dotColor: '#3b82f6' },
      { id: 'won', label: 'Won', count: counts.won || 0, dotColor: '#22c55e' },
      { id: 'lost', label: 'Lost', count: counts.lost || 0, dotColor: '#ef4444' },
    ];
  }, [disputes]);

  const openDetail = async (row) => {
    setSelected(row);
    setDetail(row);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const res = await stripeFinancialGetDispute({ franchiseId, disputeId: row.id });
      setDetail(res.dispute || row);
    } catch {
      setDetail(row);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => setDetailOpen(false);

  const columns = [
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StripeStatusBadge
          variant={disputeStatusVariant(row.status)}
          label={String(row.status || '').replace(/_/g, ' ')}
        />
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (row) => formatStripeMoney(row.amount, row.currency),
    },
    { key: 'reason', header: 'Reason', render: (row) => row.reason || '—' },
    { key: 'charge', header: 'Charge', render: (row) => (
      <span className="font-mono text-xs">{String(row.charge || '—').slice(0, 20)}</span>
    ) },
    { key: 'created', header: 'Opened', render: (row) => formatUnix(row.created) },
  ];

  return (
    <div className="pal-fin-root">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe</p>
          <h1 className="pal-fin-title">Chargebacks</h1>
          <p className="pal-fin-subtitle">
            Disputes pipeline — status, evidence deadlines, and linked charges.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
        </div>
        <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={load} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Sync
        </button>
      </header>

      {!configured && (
        <div className="pal-fin-alert" style={{ borderColor: 'var(--erpx-amber-border)', background: 'var(--erpx-amber-bg)', color: 'var(--erpx-amber)' }}>
          <AlertTriangle size={16} className="inline mr-1" />
          Set STRIPE_SECRET_KEY on Cloud Functions.
        </div>
      )}

      {error && <div className="pal-fin-alert">{error}</div>}

      <div className="pal-fin-toolbar">
        <StripeListToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search dispute id, reason, charge…"
        />
        <StripeFilterChips options={filterOptions} value={filter} onChange={setFilter} />
      </div>

      <div className="pal-fin-grid-single">
        <div className="pal-fin-main pal-fin-main-full">
          <StripeDataTable
            dense
            columns={columns}
            rows={filtered}
            loading={loading}
            emptyMessage="No chargebacks found for this filter."
            onRowClick={openDetail}
          />
        </div>
      </div>

      {detailOpen && selected && (
        <PalantirWorkbench onClose={closeDetail} size="fit">
          <PalantirCommandBar
            eyebrow="Chargeback"
            title={detail?.id || selected.id}
            subtitle={detail?.reason || selected.reason || 'Dispute detail'}
            onClose={closeDetail}
          />
          <div className="p-5 max-h-[70vh] overflow-y-auto">
            {detailLoading ? (
              <p className="text-sm text-[var(--erpx-ink-muted)]">Loading…</p>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Status</dt>
                  <dd>{detail?.status}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Amount</dt>
                  <dd>{formatStripeMoney(detail?.amount, detail?.currency)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Reason</dt>
                  <dd>{detail?.reason}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Charge</dt>
                  <dd className="font-mono text-xs break-all">{detail?.charge}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Payment intent</dt>
                  <dd className="font-mono text-xs break-all">{detail?.paymentIntent || '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[var(--erpx-ink-muted)]">Created</dt>
                  <dd>{formatUnix(detail?.created)}</dd>
                </div>
                {detail?.evidenceDetails?.due_by && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-[var(--erpx-ink-muted)]">Evidence due</dt>
                    <dd>{formatUnix(detail.evidenceDetails.due_by)}</dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        </PalantirWorkbench>
      )}
    </div>
  );
}
