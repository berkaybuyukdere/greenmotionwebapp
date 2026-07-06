import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, RefreshCw } from 'lucide-react';
import {
  StripeDataTable,
  StripeFilterChips,
  StripeListToolbar,
  StripeStatusBadge,
  StripeCustomerCell,
} from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { StripeCustomerWorkbenchModal } from './StripeCustomerWorkbenchModal';
import { StripePaymentDetailDrawer } from './StripePaymentDetailDrawer';
import { CenterFeedbackToast } from './StripeFinFeedback';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import {
  stripeFinancialListDeposits,
  stripeFinancialListAudit,
  stripeFinancialListPayments,
  stripeFinancialListMailOrders,
  stripeFinancialGetConfig,
} from '../../services/stripeFinancialApi';
import { buildStripeCustomerGroups } from '../../utilities/stripeCustomerGroups';
import { enrichDepositRow } from '../../utilities/stripeDepositDisplay';
import {
  mergePaymentsAndDeposits,
  paymentAmountMinor,
  paymentStatusDisplay,
  paymentMatchesFilter,
  computePaymentKpi,
  sortPaymentRows,
  paymentRowDate,
  paymentRowResCode,
  paymentRowCustomerName,
  resolvePaymentGroup,
  paymentRowKey,
} from '../../utilities/stripePaymentsRows';
import { isWalkInBookingCode } from '../../utilities/resCodeInput';

const SORT_OPTIONS = [
  { id: 'date_desc', label: 'Newest first' },
  { id: 'date_asc', label: 'Oldest first' },
  { id: 'amount_desc', label: 'Amount high → low' },
  { id: 'amount_asc', label: 'Amount low → high' },
];

function formatMoney(minor, currency = 'chf') {
  if (minor == null) return '—';
  const major = Number(minor) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return `CHF ${major.toFixed(2)}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function StripePaymentsDepositsTab({
  franchiseId,
  showFinancialTotals = false,
  canPerformOperations = false,
  refreshToken = 0,
}) {
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [mailOrders, setMailOrders] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);
  const [audit, setAudit] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [sortBy, setSortBy] = useState('date_desc');
  const [workbenchGroup, setWorkbenchGroup] = useState(null);
  const [workbenchInitialTab, setWorkbenchInitialTab] = useState('general');
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [centerFeedback, setCenterFeedback] = useState(null);
  const hasLoadedRef = useRef(false);

  const load = useCallback(
    async ({ syncStripe = false } = {}) => {
      if (!franchiseId) return;
      setError('');
      const hasCached = hasLoadedRef.current;
      if (!hasCached) setLoading(true);
      if (syncStripe) setSyncing(true);

      stripeFinancialListAudit({ franchiseId, limit: 60 })
        .then((res) => setAudit(res.entries || []))
        .catch(() => {});

      try {
        const [, depRes, payRes, mailRes] = await Promise.all([
          stripeFinancialGetConfig({ franchiseId }),
          stripeFinancialListDeposits({ franchiseId, limit: 150, syncStripe }),
          stripeFinancialListPayments({ franchiseId, period: 'all', lookbackDays: 60 }),
          stripeFinancialListMailOrders({ franchiseId, limit: 150, syncStripe: false }),
        ]);
        const enrichedDeposits = (depRes.deposits || []).map(enrichDepositRow);
        const orders = mailRes.orders || [];
        const merged = mergePaymentsAndDeposits(payRes.transactions || [], enrichedDeposits, orders);
        setDeposits(enrichedDeposits);
        setMailOrders(orders);
        setPaymentRows(merged);
      } catch (e) {
        setError(e?.message || 'Failed to load payments');
        if (!hasCached) {
          setDeposits([]);
          setPaymentRows([]);
        }
      } finally {
        setLoading(false);
        setSyncing(false);
        hasLoadedRef.current = true;
      }
    },
    [franchiseId],
  );

  useEffect(() => {
    load({ syncStripe: false });
  }, [load, refreshToken]);

  const groups = useMemo(
    () => buildStripeCustomerGroups(deposits, mailOrders),
    [deposits, mailOrders],
  );

  const sortedRows = useMemo(
    () => sortPaymentRows(paymentRows, sortBy),
    [paymentRows, sortBy],
  );

  const kpi = useMemo(() => computePaymentKpi(sortedRows), [sortedRows]);

  const filtered = useMemo(() => {
    let rows = sortedRows.filter((row) => paymentMatchesFilter(row, filter));
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      const amountMajor = (paymentAmountMinor(row) / 100).toFixed(2);
      const hay = [
        paymentRowResCode(row),
        paymentRowCustomerName(row),
        row.customerEmail,
        row.id,
        row.paymentIntentId,
        row.depositId,
        row.cardLast4,
        row.cardBrand,
        row.channelLabel,
        row.statusLabel,
        amountMajor,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sortedRows, filter, search]);

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'All', count: kpi.total },
      { id: 'captured', label: 'Succeeded', count: kpi.captured, dotColor: '#16a34a' },
      { id: 'refunded', label: 'Refunded', count: kpi.refunded, dotColor: '#d97706' },
      { id: 'failed', label: 'Failed', count: kpi.failed, dotColor: '#dc2626' },
      { id: 'hold', label: 'Uncaptured', count: kpi.hold, dotColor: '#2563eb' },
      { id: 'increased', label: 'Increased', count: kpi.increased, dotColor: '#9D7CD8' },
      { id: 'released', label: 'Canceled', count: kpi.released, dotColor: '#dc2626' },
    ],
    [kpi],
  );

  const columns = useMemo(
    () => [
      {
        key: 'amount',
        header: 'Amount',
        render: (row) => (
          <span className="stripe-pay-amount tabular-nums">
            {formatMoney(paymentAmountMinor(row), row.currency)}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => {
          const st = paymentStatusDisplay(row);
          return (
            <div className="stripe-pay-status-cell" title={st.note || undefined}>
              <StripeStatusBadge sharp variant={st.variant} label={st.label} />
              {row.channelLabel && row.flowType !== 'deposit' && (
                <StripeStatusBadge sharp variant="neutral" label={row.channelLabel} />
              )}
              {st.note && <span className="stripe-pay-status-note">{st.note}</span>}
            </div>
          );
        },
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <StripeCustomerCell
            name={paymentRowCustomerName(row)}
            email={row.customerEmail || paymentRowResCode(row)}
            plate={row.customerEmail ? paymentRowResCode(row) : ''}
          />
        ),
      },
      {
        key: 'method',
        header: 'Payment method',
        render: (row) => (
          <StripePaymentMethodCell
            brand={row.cardBrand}
            last4={row.cardLast4}
            methodType={row.source === 'terminal' || row.channel === 'terminal' ? 'card_present' : row.paymentMethod || 'card'}
          />
        ),
      },
      {
        key: 'res',
        header: 'RES',
        render: (row) => {
          const code = paymentRowResCode(row);
          const walkIn = isWalkInBookingCode(code);
          return (
            <span className="stripe-pay-ref-cell">
              <span className="pal-fin-mono stripe-pay-ref">{code}</span>
              {walkIn && (
                <StripeStatusBadge sharp variant="info" label="Walk-in" />
              )}
            </span>
          );
        },
      },
      {
        key: 'date',
        header: 'Date',
        render: (row) => (
          <span className="stripe-pay-date tabular-nums">{formatDate(paymentRowDate(row))}</span>
        ),
      },
    ],
    [],
  );

  const openRow = (row) => {
    setSelectedPayment(null);
    const group = resolvePaymentGroup(row, groups, deposits, mailOrders);
    if (group) {
      setWorkbenchInitialTab(row.bucket === 'hold' ? 'payments' : 'general');
      setWorkbenchGroup(group);
      return;
    }
    setWorkbenchGroup(null);
    setSelectedPayment(row);
  };

  const selectedPaymentLive = useMemo(() => {
    if (!selectedPayment) return null;
    const key = paymentRowKey(selectedPayment);
    return filtered.find((r) => paymentRowKey(r) === key) || selectedPayment;
  }, [selectedPayment, filtered]);

  const selectedDeposit = useMemo(() => {
    if (!selectedPaymentLive?.depositId) return null;
    return deposits.find((d) => d.id === selectedPaymentLive.depositId) || null;
  }, [selectedPaymentLive, deposits]);

  const workbenchGroupLive = useMemo(() => {
    if (!workbenchGroup) return null;
    return groups.find((g) => g.id === workbenchGroup.id) || workbenchGroup;
  }, [workbenchGroup, groups]);

  return (
    <div className="pal-stripe-tab-panel">
      <PalantirFinKpiRow>
        <PalantirFinKpiCard
          label="All payments"
          value={kpi.total}
          sub="Stripe + deposits"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <PalantirFinKpiCard
          label="Succeeded"
          value={kpi.captured}
          sub={showFinancialTotals ? formatMoney(kpi.capturedVol) : 'Paid / captured'}
          moneySub={showFinancialTotals}
          tone="paid"
          active={filter === 'captured'}
          onClick={() => setFilter('captured')}
        />
        <PalantirFinKpiCard
          label="Failed"
          value={kpi.failed}
          sub="Declined / blocked"
          tone="expense"
          active={filter === 'failed'}
          onClick={() => setFilter('failed')}
        />
        <PalantirFinKpiCard
          label="Uncaptured"
          value={kpi.hold}
          sub={showFinancialTotals ? formatMoney(kpi.holdVol) : `${kpi.hold} open hold${kpi.hold === 1 ? '' : 's'}`}
          moneySub={showFinancialTotals}
          tone="hold"
          active={filter === 'hold'}
          onClick={() => setFilter('hold')}
        />
        <PalantirFinKpiCard
          label="Increased"
          value={kpi.increased}
          sub="Hold raised"
          tone="warning"
          className="pal-fin-kpi-increased"
          active={filter === 'increased'}
          onClick={() => setFilter('increased')}
        />
        <PalantirFinKpiCard
          label="Canceled"
          value={kpi.released}
          sub="Released holds"
          tone="neutral"
          active={filter === 'released'}
          onClick={() => setFilter('released')}
        />
      </PalantirFinKpiRow>

      <StripeListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search amount, RES, name, card…"
        trailing={
          <>
            <label className="pal-fin-sort-select">
              <ArrowDownUp size={14} aria-hidden />
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort payments">
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="gm-btn gm-btn-secondary gm-btn-sm"
              onClick={() => load({ syncStripe: true })}
              disabled={loading || syncing}
              title="Sync from Stripe"
            >
              <RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
          </>
        }
      >
        <StripeFilterChips options={filterChips} value={filter} onChange={setFilter} variant="strip" />
      </StripeListToolbar>

      {error && <div className="pal-fin-alert">{error}</div>}

      <StripeDataTable
        dense
        columns={columns}
        rows={filtered}
        loading={loading}
        emptyMessage="No payments match your filters."
        onRowClick={openRow}
        selectedRowId={
          workbenchGroupLive?.deposits?.[0]?.id || selectedPaymentLive?.id || null
        }
      />

      {workbenchGroupLive && (
        <StripeCustomerWorkbenchModal
          layout="modal"
          group={workbenchGroupLive}
          franchiseId={franchiseId}
          initialTab={workbenchInitialTab === 'actions' ? 'payments' : workbenchInitialTab === 'overview' ? 'general' : workbenchInitialTab}
          showFinancialTotals={showFinancialTotals}
          canPerformOperations={canPerformOperations}
          auditEntries={audit}
          onClose={() => setWorkbenchGroup(null)}
          onChanged={() => load({ syncStripe: true })}
          onCenterFeedback={setCenterFeedback}
        />
      )}

      {selectedPaymentLive && (
        <StripePaymentDetailDrawer
          transaction={selectedPaymentLive}
          deposit={selectedDeposit}
          franchiseId={franchiseId}
          onClose={() => setSelectedPayment(null)}
          onChanged={() => load({ syncStripe: true })}
          onFeedback={setCenterFeedback}
        />
      )}

      <CenterFeedbackToast item={centerFeedback} onDismiss={() => setCenterFeedback(null)} />
    </div>
  );
}
