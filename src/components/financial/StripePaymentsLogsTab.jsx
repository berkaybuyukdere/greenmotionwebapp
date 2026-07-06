import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  StripeDataTable,
  StripeFilterChips,
  StripeListToolbar,
  StripeStatusBadge,
  StripeCustomerCell,
} from '../StripeListUI';
import { stripeFinancialListAudit } from '../../services/stripeFinancialApi';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import {
  auditAmountMinor,
  auditCustomerLine,
  auditDescriptionLine,
  auditStatusDisplay,
  formatAuditOperation,
} from '../../utilities/stripeDepositDisplay';

function formatMoney(minor, currency = 'chf') {
  if (minor == null) return '—';
  const major = Number(minor) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(major);
  } catch {
    return `CHF ${major.toFixed(2)}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function StripePaymentsLogsTab({ franchiseId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const res = await stripeFinancialListAudit({ franchiseId, limit: 120 });
      setEntries(res.entries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load logs');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = entries;
    if (filter === 'deposit') {
      rows = rows.filter((e) => String(e.action || '').includes('deposit'));
    } else if (filter === 'terminal') {
      rows = rows.filter((e) => String(e.action || '').includes('terminal'));
    } else if (filter === 'charge') {
      rows = rows.filter((e) => /charge|saved/.test(String(e.action || '')));
    }
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => {
      const d = e.detail || {};
      const hay = [
        e.actorName,
        auditCustomerLine(e),
        auditDescriptionLine(e),
        formatAuditOperation(e),
        d.resCode,
        d.customerName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [entries, filter, search]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      deposit: entries.filter((e) => String(e.action || '').includes('deposit')).length,
      charge: entries.filter((e) => /charge|saved/.test(String(e.action || ''))).length,
      terminal: entries.filter((e) => String(e.action || '').includes('terminal')).length,
    }),
    [entries],
  );

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'deposit', label: 'Deposits', count: counts.deposit, dotColor: '#2563eb' },
      { id: 'charge', label: 'Charges', count: counts.charge, dotColor: '#16a34a' },
      { id: 'terminal', label: 'Terminal', count: counts.terminal, dotColor: '#6b7280' },
    ],
    [counts],
  );

  const columns = useMemo(
    () => [
      {
        key: 'amount',
        header: 'Amount',
        render: (row) => (
          <span className="stripe-pay-amount tabular-nums">
            {formatMoney(auditAmountMinor(row))}
          </span>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        render: (row) => {
          const st = auditStatusDisplay(row);
          return <StripeStatusBadge sharp variant={st.variant} label={st.label} />;
        },
      },
      {
        key: 'operation',
        header: 'Operation',
        render: (row) => (
          <span className="stripe-pay-ref">{formatAuditOperation(row)}</span>
        ),
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => {
          const d = row.detail || {};
          return (
            <StripeCustomerCell
              name={d.customerName || auditCustomerLine(row)}
              email={d.customerEmail || ''}
              plate={d.resCode || ''}
            />
          );
        },
      },
      {
        key: 'actor',
        header: 'By',
        render: (row) => <span className="stripe-pay-date">{row.actorName || 'Staff'}</span>,
      },
      {
        key: 'date',
        header: 'Date',
        render: (row) => <span className="stripe-pay-date tabular-nums">{formatDate(row.createdAt)}</span>,
      },
    ],
    [],
  );

  return (
    <div className="pal-stripe-tab-panel">
      <PalantirFinKpiRow>
        <PalantirFinKpiCard
          label="All events"
          value={counts.all}
          sub="Activity log"
          active={filter === 'all'}
          onClick={() => setFilter('all')}
        />
        <PalantirFinKpiCard
          label="Deposits"
          value={counts.deposit}
          sub="Hold & release"
          tone="hold"
          active={filter === 'deposit'}
          onClick={() => setFilter('deposit')}
        />
        <PalantirFinKpiCard
          label="Charges"
          value={counts.charge}
          sub="Card payments"
          tone="paid"
          active={filter === 'charge'}
          onClick={() => setFilter('charge')}
        />
        <PalantirFinKpiCard
          label="Terminal"
          value={counts.terminal}
          sub="POS actions"
          tone="default"
          active={filter === 'terminal'}
          onClick={() => setFilter('terminal')}
        />
      </PalantirFinKpiRow>

      <StripeListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search RES, customer, operation…"
        trailing={
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
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
        emptyMessage="No activity matches your filters."
      />
    </div>
  );
}
