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
import {
  stripeFinancialGetConfig,
  stripeFinancialListPayments,
  stripeFinancialListDeposits,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const BUCKET_VARIANT = {
  successful: 'success',
  hold: 'info',
  pending: 'warning',
  cancelled: 'danger',
};

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

export function StripePaymentsView({ franchiseId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [stripeMode, setStripeMode] = useState('unset');
  const [dayKey, setDayKey] = useState(todayKeyZurich());
  const [transactions, setTransactions] = useState([]);
  const [deposits, setDeposits] = useState([]);
  const [summary, setSummary] = useState(null);
  const [syncedAt, setSyncedAt] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [selectedTx, setSelectedTx] = useState(null);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await stripeFinancialGetConfig({ franchiseId });
      setConfigured(cfg?.configured !== false);
      setStripeMode(cfg?.mode || 'unset');
      const [payRes, depRes] = await Promise.all([
        stripeFinancialListPayments({ franchiseId, dayKey }),
        stripeFinancialListDeposits({ franchiseId, limit: 30 }),
      ]);
      setTransactions(payRes.transactions || []);
      setSummary(payRes.summary || null);
      setDeposits(depRes.deposits || []);
      setSyncedAt(payRes.syncedAt || new Date().toISOString());
    } catch (e) {
      setError(e?.message || 'Failed to load payments');
      setTransactions([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [franchiseId, dayKey]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(load, 45000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

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
        render: (row) => (
          <div className="stripe-pay-status-cell">
            <StripeStatusBadge
              sharp
              variant={BUCKET_VARIANT[row.bucket] || 'neutral'}
              label={BUCKET_LABEL[row.bucket] || row.statusLabel || row.status}
            />
            {row.channelLabel && (
              <StripeStatusBadge
                sharp
                variant={CHANNEL_VARIANT[row.channelLabel] || 'neutral'}
                label={row.channelLabel}
              />
            )}
          </div>
        ),
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

  const selectedDeposit = useMemo(() => {
    if (!selectedTx) return null;
    if (selectedTx.depositId) {
      return deposits.find((d) => d.id === selectedTx.depositId) || null;
    }
    return selectedTx.paymentIntentId ? depositByPi.get(selectedTx.paymentIntentId) : null;
  }, [selectedTx, deposits, depositByPi]);

  return (
    <div className="pal-fin-root">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Payments</h1>
          <p className="pal-fin-subtitle">
            Terminal deposits, mail-order links, and card holds — one row per payment (no duplicates).
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
          {syncedAt && (
            <p className="text-[11px] text-[var(--erpx-ink-muted)] mt-2">
              Last sync: {new Date(syncedAt).toLocaleString()} (Europe/Zurich)
            </p>
          )}
        </div>
        <div className="pal-fin-command-actions">
          <button
            type="button"
            className="gm-btn gm-btn-primary gm-btn-sm"
            onClick={() => setShowDepositModal(true)}
          >
            <Plus size={15} /> New payment
          </button>
          <label className="pal-fin-check pal-fin-check-inline">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <input
            type="date"
            className="pal-fin-input pal-fin-date-input"
            value={dayKey}
            onChange={(e) => setDayKey(e.target.value)}
          />
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

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

      {summary && (
        <div className="pal-fin-summary-row pal-fin-summary-row-4">
          <SummaryCard
            label="Paid"
            count={summary.successful?.count || 0}
            total={summary.successful?.amount || 0}
            currency={currency}
            variant="success"
          />
          <SummaryCard
            label="Hold amount"
            count={summary.hold?.count || 0}
            total={summary.hold?.amount || 0}
            currency={currency}
            variant="hold"
          />
          <SummaryCard
            label="Pending"
            count={summary.pending?.count || 0}
            total={summary.pending?.amount || 0}
            currency={currency}
            variant="pending"
          />
          <SummaryCard
            label="Canceled"
            count={summary.cancelled?.count || 0}
            total={summary.cancelled?.amount || 0}
            currency={currency}
            variant="cancelled"
          />
        </div>
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
            emptyMessage={`No Stripe payments for ${dayKey}.`}
            onRowClick={setSelectedTx}
          />
        </div>
      </div>

      {showDepositModal && (
        <StripeDepositModal
          franchiseId={franchiseId}
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
    </div>
  );
}
