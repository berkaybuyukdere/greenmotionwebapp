import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import {
  StripeFilterChips,
  StripeListToolbar,
  StripeStatusBadge,
  StripeDataTable,
} from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { StripeDepositModal } from './StripeDepositModal';
import { StripePaymentDetailDrawer } from './StripePaymentDetailDrawer';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import {
  stripeFinancialGetConfig,
  stripeFinancialListPayments,
  stripeFinancialListDeposits,
  stripeFinancialListAudit,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const BUCKET_VARIANT = {
  successful: 'success',
  hold: 'info',
  pending: 'warning',
  cancelled: 'danger',
};

const DEPOSIT_STATUS_VARIANT = {
  hold: 'info',
  increased: 'warning',
  captured: 'success',
  captured_increased: 'success',
  pending: 'warning',
  cancelled: 'danger',
};

const DEPOSIT_STATUS_LABEL = {
  hold: 'Hold',
  increased: 'Increased',
  captured: 'Captured',
  captured_increased: 'Captured (after increase)',
  pending: 'Pending',
  cancelled: 'Canceled',
};

const PERIOD_PRESETS = [
  { id: '1d', label: '1d' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: 'all', label: 'All' },
];

const BUCKET_LABEL = {
  successful: 'Paid',
  hold: 'Hold',
  pending: 'Pending',
  cancelled: 'Canceled',
};

const CHANNEL_VARIANT = {
  Deposit: 'deposit',
  'WheelSys · Deposit': 'wheelsys',
  Terminal: 'info',
  'Mail order': 'neutral',
  Online: 'neutral',
};

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

function formatStripeDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function todayKeyZurich() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function SummaryCard({ label, count, total, currency, variant }) {
  return (
    <div className={`pal-fin-summary-card pal-fin-summary-${variant}`}>
      <p className="pal-fin-summary-label">{label}</p>
      <p className="pal-fin-summary-count">{count}</p>
      <p className="pal-fin-summary-total">{formatStripeMoney(total, currency)}</p>
    </div>
  );
}

export function StripePaymentsView({ franchiseId, showFinancialTotals = true, fleetCars = [] }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [stripeMode, setStripeMode] = useState('unset');
  const [period, setPeriod] = useState('1d');
  const [dayKey, setDayKey] = useState(todayKeyZurich());
  const [transactions, setTransactions] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [summary, setSummary] = useState(null);
  const [dailySummary, setDailySummary] = useState(null);
  const [syncedAt, setSyncedAt] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);
  const [audit, setAudit] = useState([]);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await stripeFinancialGetConfig({ franchiseId });
      setConfigured(cfg?.configured !== false);
      setStripeMode(cfg?.mode || 'unset');
      const [payRes, depRes, auditRes] = await Promise.all([
        stripeFinancialListPayments({ franchiseId, dayKey, period }),
        stripeFinancialListDeposits({ franchiseId, limit: 30 }),
        stripeFinancialListAudit({ franchiseId, limit: 50 }),
      ]);
      setTransactions(payRes.transactions || []);
      setSummary(payRes.summary || null);
      setDailySummary(payRes.dailySummary || null);
      setDeposits(depRes.deposits || []);
      setAudit(
        (auditRes.entries || []).filter((a) =>
          String(a.action || '').includes('deposit') || String(a.action || '').includes('terminal'),
        ),
      );
      setSyncedAt(payRes.syncedAt || new Date().toISOString());
    } catch (e) {
      setError(e?.message || 'Failed to load payments');
      setTransactions([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [franchiseId, dayKey, period]);

  useEffect(() => {
    load();
  }, [load]);

  const currency = transactions[0]?.currency || 'chf';

  const depositByPi = useMemo(() => {
    const map = new Map();
    deposits.forEach((d) => {
      if (d.paymentIntentId) map.set(d.paymentIntentId, d);
    });
    return map;
  }, [deposits]);

  const filtered = useMemo(() => {
    let rows = transactions;
    if (filter !== 'all') rows = rows.filter((tx) => tx.bucket === filter);
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (tx) =>
        tx.customerName?.toLowerCase().includes(q) ||
        tx.displayDescription?.toLowerCase().includes(q) ||
        tx.id?.toLowerCase().includes(q) ||
        tx.description?.toLowerCase().includes(q) ||
        tx.reference?.toLowerCase().includes(q) ||
        tx.plate?.toLowerCase().includes(q) ||
        tx.customerEmail?.toLowerCase().includes(q) ||
        tx.paymentIntentId?.toLowerCase().includes(q),
    );
  }, [transactions, filter, search]);

  const activeDeposits = useMemo(
    () => deposits.filter((d) => ['authorized', 'pending_collection'].includes(d.status)),
    [deposits],
  );

  const filterChips = useMemo(() => {
    const s = summary || {
      successful: { count: 0 },
      hold: { count: 0 },
      pending: { count: 0 },
      cancelled: { count: 0 },
    };
    return [
      { id: 'all', label: 'All', count: transactions.length },
      { id: 'successful', label: 'Paid', count: s.successful?.count || 0, dotColor: '#16a34a' },
      { id: 'hold', label: 'Hold', count: s.hold?.count || 0, dotColor: '#2563eb' },
      { id: 'pending', label: 'Pending', count: s.pending?.count || 0, dotColor: '#d97706' },
      { id: 'cancelled', label: 'Canceled', count: s.cancelled?.count || 0, dotColor: '#dc2626' },
    ];
  }, [transactions.length, summary]);

  const columns = useMemo(
    () => [
      {
        key: 'amount',
        header: 'Amount',
        render: (row) => (
          <span className="stripe-pay-amount">
            {formatStripeMoney(
              row.bucket === 'hold' ? row.holdAmount || row.amount : row.amountReceived || row.amount,
              row.currency,
            )}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => {
          const depStatus = row.depositDisplayStatus;
          const statusVariant = depStatus || (row.bucket === 'successful' ? 'paid' : row.bucket === 'hold' ? 'hold' : row.bucket === 'cancelled' ? 'danger' : 'unpaid');
          const statusLabel = depStatus
            ? DEPOSIT_STATUS_LABEL[depStatus]
            : BUCKET_LABEL[row.bucket] || row.statusLabel || row.status;
          return (
          <div className="stripe-pay-status-cell">
            <StripeStatusBadge sharp variant={statusVariant} label={statusLabel} />
            {row.tokenSaved && (
              <StripeStatusBadge sharp variant="success" label="Token saved" />
            )}
            {row.channelLabel && (
              <StripeStatusBadge
                sharp
                variant={CHANNEL_VARIANT[row.channelLabel] || 'neutral'}
                label={row.channelLabel}
              />
            )}
          </div>
          );
        },
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div className="stripe-pay-customer-block">
            <span className="stripe-pay-customer-name">{row.customerName || '—'}</span>
            {(row.plate || row.customerEmail) && (
              <span className="stripe-pay-customer-sub">
                {[row.plate, row.customerEmail].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
        ),
      },
      {
        key: 'payment',
        header: 'Card',
        render: (row) => (
          <StripePaymentMethodCell
            brand={row.cardBrand}
            last4={row.cardLast4}
            methodType={row.paymentMethod}
          />
        ),
      },
      {
        key: 'reference',
        header: 'Reference',
        render: (row) => (
          <span className="stripe-pay-ref">{row.displayDescription || row.reference || row.plate || '—'}</span>
        ),
      },
      {
        key: 'date',
        header: 'Date',
        render: (row) => (
          <span className="stripe-pay-date tabular-nums">{formatStripeDate(row.createdAt)}</span>
        ),
      },
    ],
    [],
  );

  const depositKpi = useMemo(() => {
    let holdVol = 0;
    let holdCount = 0;
    let paidVol = 0;
    let paidCount = 0;
    let pos1Vol = 0;
    let pos2Vol = 0;
    for (const tx of transactions) {
      const amt = Number(tx.holdAmount || tx.amountReceived || tx.amount) || 0;
      if (tx.depositDisplayStatus === 'hold' || tx.depositDisplayStatus === 'increased' || tx.bucket === 'hold') {
        holdCount += 1;
        holdVol += amt;
      }
      if (tx.depositDisplayStatus === 'captured' || tx.depositDisplayStatus === 'captured_increased' || (tx.bucket === 'successful' && tx.flowType === 'deposit')) {
        paidCount += 1;
        paidVol += amt;
      }
    }
    for (const d of deposits) {
      const amt = Number(d.currentHoldAmount || d.initialAmount) || 0;
      const label = String(d.readerLabel || d.readerId || '').toLowerCase();
      if (label.includes('pos 1') || label.includes('pos1') || (d.isDefault && !label.includes('pos 2'))) {
        pos1Vol += amt;
      } else if (label.includes('pos 2') || label.includes('pos2')) {
        pos2Vol += amt;
      }
    }
    return { holdVol, holdCount, paidVol, paidCount, pos1Vol, pos2Vol };
  }, [transactions, deposits]);

  const selectedDeposit = useMemo(() => {
    if (!selectedTx) return null;
    if (selectedTx.depositId) {
      return deposits.find((d) => d.id === selectedTx.depositId) || null;
    }
    return selectedTx.paymentIntentId ? depositByPi.get(selectedTx.paymentIntentId) : null;
  }, [selectedTx, deposits, depositByPi]);

  return (
    <div className="pal-fin-root pal-analytics-page pal-fin-stripe-page">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Deposits</h1>
          <p className="pal-fin-subtitle">
            Terminal deposit holds, incremental authorization, and capture — one row per transaction.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
          {syncedAt && (
            <p className="text-[11px] text-[var(--erpx-ink-muted)] mt-2">
              Last sync: {new Date(syncedAt).toLocaleString()} (Europe/Zurich)
            </p>
          )}
        </div>
        <div className="pal-fin-command-actions pal-fin-command-actions-symmetric">
          <button
            type="button"
            className="gm-btn gm-btn-primary gm-btn-sm pal-fin-action-btn"
            onClick={() => setShowDepositModal(true)}
          >
            <Plus size={15} /> New deposit
          </button>
          <input
            type="date"
            className="pal-fin-input pal-fin-date-input pal-fin-action-btn"
            value={dayKey}
            onChange={(e) => setDayKey(e.target.value)}
            title="End date"
          />
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm pal-fin-action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      <div className="pal-fin-toolbar">
        <div className="pal-fin-chips">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pal-fin-chip pal-fin-chip-symmetric ${period === p.id ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!configured && (
        <div className="pal-fin-alert pal-fin-alert-warn">
          Stripe CH secret key missing. Set STRIPE_CH_SECRET_KEY and redeploy functions.
        </div>
      )}

      {error && <div className="pal-fin-alert">{error}</div>}

      {activeDeposits.length > 0 && (
        <div className="pal-fin-deposits-banner">
          <strong>{activeDeposits.length} active deposit hold{activeDeposits.length > 1 ? 's' : ''}</strong>
          <span> — click a row to preview, cancel, or manage the hold.</span>
        </div>
      )}

      {summary && showFinancialTotals && (
        <PalantirFinKpiRow>
          <PalantirFinKpiCard
            label="Hold"
            value={formatStripeMoney(depositKpi.holdVol || summary.hold?.amount, currency)}
            sub={`${depositKpi.holdCount || summary.hold?.count || 0} authorizations`}
            tone="hold"
          />
          <PalantirFinKpiCard
            label="Captured"
            value={formatStripeMoney(depositKpi.paidVol || summary.successful?.amount, currency)}
            sub={`${depositKpi.paidCount || summary.successful?.count || 0} paid`}
            tone="paid"
          />
          <PalantirFinKpiCard
            label="1. POS"
            value={formatStripeMoney(depositKpi.pos1Vol, currency)}
            sub="Terminal hold volume"
            tone="default"
          />
          <PalantirFinKpiCard
            label="2. POS"
            value={formatStripeMoney(depositKpi.pos2Vol, currency)}
            sub="Terminal hold volume"
            tone="default"
          />
        </PalantirFinKpiRow>
      )}

      {dailySummary && !showFinancialTotals && (
        <PalantirFinKpiRow>
          <PalantirFinKpiCard
            label="Today · Deposits"
            value={dailySummary.count ?? 0}
            sub={`${dailySummary.count ?? 0} transaction${dailySummary.count === 1 ? '' : 's'} today`}
            tone="hold"
          />
          <PalantirFinKpiCard
            label="Today · Volume"
            value={formatStripeMoney(dailySummary.volume, currency)}
            sub={`Zurich day ${dailySummary.dayKey || dayKey}`}
            tone="paid"
          />
        </PalantirFinKpiRow>
      )}

      <StripeListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search name, plate, reference, email…"
      >
        <StripeFilterChips options={filterChips} value={filter} onChange={setFilter} variant="strip" />
      </StripeListToolbar>

      <div className="pal-fin-grid-single">
        <div className="pal-fin-main pal-fin-main-full">
          <StripeDataTable
            dense
            columns={columns}
            rows={filtered.map((row) => ({
              ...row,
              id: row.paymentIntentId || row.chargeId || row.id,
            }))}
            loading={loading}
            emptyMessage={`No Stripe payments for selected period.`}
            onRowClick={setSelectedTx}
            selectedRowId={selectedTx?.id}
          />
        </div>
      </div>

      {showDepositModal && (
        <StripeDepositModal
          franchiseId={franchiseId}
          fleetCars={fleetCars}
          onClose={() => setShowDepositModal(false)}
          onSuccess={load}
        />
      )}

      {selectedTx && (
        <StripePaymentDetailDrawer
          transaction={selectedTx}
          deposit={selectedDeposit}
          franchiseId={franchiseId}
          onClose={() => setSelectedTx(null)}
          onChanged={load}
        />
      )}

      {audit.length > 0 && (
        <section className="pal-fin-audit-panel mt-6">
          <p className="pal-fin-eyebrow">Deposit activity log</p>
          <ul className="pal-fin-audit-list">
            {audit.slice(0, 20).map((entry) => (
              <li key={entry.id || `${entry.action}-${entry.createdAt}`} className="pal-fin-audit-row">
                <span className="pal-fin-mono text-xs">{entry.action}</span>
                <span className="text-caption">
                  {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '—'}
                </span>
                {entry.detail && (
                  <span className="text-xs text-[var(--erpx-ink-muted)] truncate">
                    {JSON.stringify(entry.detail)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
