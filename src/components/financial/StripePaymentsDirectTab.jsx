import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  StripeDataTable,
  StripeListToolbar,
  StripeStatusBadge,
  StripeCustomerCell,
} from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { StripeCustomerWorkbenchModal } from './StripeCustomerWorkbenchModal';
import { CenterFeedbackToast } from './StripeFinFeedback';
import {
  stripeFinancialListDeposits,
  stripeFinancialListAudit,
  stripeFinancialListPayments,
  stripeFinancialListMailOrders,
} from '../../services/stripeFinancialApi';
import { buildStripeCustomerGroups } from '../../utilities/stripeCustomerGroups';
import { enrichDepositRow } from '../../utilities/stripeDepositDisplay';
import {
  mergePaymentsAndDeposits,
  filterDirectPaymentRows,
  paymentAmountMinor,
  paymentStatusDisplay,
  sortPaymentRows,
  paymentRowDate,
  paymentRowResCode,
  paymentRowCustomerName,
  resolvePaymentGroup,
  paymentRowKey,
} from '../../utilities/stripePaymentsRows';

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

export function StripePaymentsDirectTab({
  franchiseId,
  canPerformOperations = false,
  refreshToken = 0,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [mailOrders, setMailOrders] = useState([]);
  const [paymentRows, setPaymentRows] = useState([]);
  const [audit, setAudit] = useState([]);
  const [search, setSearch] = useState('');
  const [workbenchGroup, setWorkbenchGroup] = useState(null);
  const [centerFeedback, setCenterFeedback] = useState(null);
  const [initialWorkbenchTab, setInitialWorkbenchTab] = useState('direct');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setError('');
    const hasCached = paymentRows.length > 0;
    if (!hasCached) setLoading(true);
    stripeFinancialListAudit({ franchiseId, limit: 60 })
      .then((res) => setAudit(res.entries || []))
      .catch(() => {});
    try {
      const [depRes, payRes, mailRes] = await Promise.all([
        stripeFinancialListDeposits({ franchiseId, limit: 120, syncStripe: false }),
        stripeFinancialListPayments({ franchiseId, period: 'all', lookbackDays: 60 }),
        stripeFinancialListMailOrders({ franchiseId, limit: 120, syncStripe: false }),
      ]);
      const enrichedDeposits = (depRes.deposits || []).map(enrichDepositRow);
      const orders = mailRes.orders || [];
      const merged = mergePaymentsAndDeposits(payRes.transactions || [], enrichedDeposits, orders);
      setDeposits(enrichedDeposits);
      setMailOrders(orders);
      setPaymentRows(merged);
    } catch (e) {
      setError(e?.message || 'Failed to load direct payments');
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load, refreshToken]);

  const groups = useMemo(
    () => buildStripeCustomerGroups(deposits, mailOrders),
    [deposits, mailOrders],
  );

  const directRows = useMemo(
    () => sortPaymentRows(filterDirectPaymentRows(paymentRows), 'date_desc'),
    [paymentRows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return directRows;
    return directRows.filter((row) => {
      const hay = [
        paymentRowResCode(row),
        paymentRowCustomerName(row),
        row.customerEmail,
        row.channelLabel,
        row.paymentIntentId,
        (paymentAmountMinor(row) / 100).toFixed(2),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [directRows, search]);

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
              {row.channelLabel && (
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
        header: 'Card',
        render: (row) => (
          <StripePaymentMethodCell
            brand={row.cardBrand}
            last4={row.cardLast4}
            methodType="card"
          />
        ),
      },
      {
        key: 'res',
        header: 'RES',
        render: (row) => <span className="pal-fin-mono stripe-pay-ref">{paymentRowResCode(row)}</span>,
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
    const group = resolvePaymentGroup(row, groups, deposits, mailOrders);
    if (group) {
      setInitialWorkbenchTab('direct');
      setWorkbenchGroup(group);
    }
  };

  const workbenchGroupLive = useMemo(() => {
    if (!workbenchGroup) return null;
    return groups.find((g) => g.id === workbenchGroup.id) || workbenchGroup;
  }, [workbenchGroup, groups]);

  return (
    <div className="pal-stripe-tab-panel">
      <p className="pal-fin-subtitle pal-stripe-direct-intro">
        Manual charges and off-session card charges — select a row to refund or review activity.
      </p>
      <StripeListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search RES, customer, amount…"
        trailing={
          <button
            type="button"
            className="gm-btn gm-btn-secondary gm-btn-sm"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
      />
      {error && <div className="pal-fin-alert">{error}</div>}
      <StripeDataTable
        dense
        columns={columns}
        rows={filtered}
        loading={loading}
        emptyMessage="No direct payments yet — use New payment → Manual charge."
        onRowClick={openRow}
        selectedRowId={workbenchGroupLive?.id || null}
      />
      {workbenchGroupLive && (
        <StripeCustomerWorkbenchModal
          layout="drawer"
          group={workbenchGroupLive}
          franchiseId={franchiseId}
          showFinancialTotals={false}
          canPerformOperations={canPerformOperations}
          auditEntries={audit}
          initialTab={initialWorkbenchTab}
          onClose={() => setWorkbenchGroup(null)}
          onChanged={load}
          onCenterFeedback={setCenterFeedback}
        />
      )}
      <CenterFeedbackToast item={centerFeedback} onDismiss={() => setCenterFeedback(null)} />
    </div>
  );
}
