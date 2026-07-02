import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Lock, Mail, User, Plus, CreditCard } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import { StripeCustomerWorkbenchModal, CenterFeedbackToast } from './StripeCustomerWorkbenchModal';
import { StripeCustomerNewOperationModal } from './StripeCustomerNewOperationModal';
import {
  stripeFinancialListDeposits,
  stripeFinancialListMailOrders,
  stripeFinancialListAudit,
  stripeFinancialGetConfig,
} from '../../services/stripeFinancialApi';
import { buildStripeCustomerGroups } from '../../utilities/stripeCustomerGroups';

function formatStripeMoney(minor, currency = 'chf') {
  if (minor == null) return '—';
  const major = Number(minor) / 100;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(major);
  } catch {
    return `CHF ${major.toFixed(2)}`;
  }
}

function CountSignal({ icon: Icon, count, label, tone }) {
  return (
    <span className={`pal-cust-count-signal pal-cust-count-signal-${tone || 'neutral'}`} title={label}>
      <span className="pal-cust-count-signal-icon" aria-hidden="true">
        <Icon size={12} strokeWidth={2.25} />
      </span>
      <span className="pal-cust-count-signal-value">{count}</span>
    </span>
  );
}

export function StripeCustomersView({ franchiseId, showFinancialTotals = false }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stripeMode, setStripeMode] = useState('unset');
  const [syncedAt, setSyncedAt] = useState('');
  const [deposits, setDeposits] = useState([]);
  const [mailOrders, setMailOrders] = useState([]);
  const [audit, setAudit] = useState([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [workbenchGroup, setWorkbenchGroup] = useState(null);
  const [centerFeedback, setCenterFeedback] = useState(null);
  const [showNewOperation, setShowNewOperation] = useState(false);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const [cfg, depRes, mailRes, auditRes] = await Promise.all([
        stripeFinancialGetConfig({ franchiseId }),
        stripeFinancialListDeposits({ franchiseId, limit: 300 }),
        stripeFinancialListMailOrders({ franchiseId, limit: 300 }),
        stripeFinancialListAudit({ franchiseId, limit: 60 }),
      ]);
      setStripeMode(cfg?.mode || 'unset');
      setDeposits(depRes.deposits || []);
      setMailOrders(mailRes.orders || []);
      setAudit(auditRes.entries || []);
      setSyncedAt(new Date().toISOString());
    } catch (e) {
      setError(e?.message || 'Failed to load customers');
      setDeposits([]);
      setMailOrders([]);
      setAudit([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => buildStripeCustomerGroups(deposits, mailOrders), [deposits, mailOrders]);

  const kpi = useMemo(() => {
    let activeHolds = 0;
    let holdVol = 0;
    let unpaidMail = 0;
    let unpaidVol = 0;
    for (const g of groups) {
      for (const d of g.deposits) {
        if (['authorized', 'pending_collection'].includes(d.status)) {
          activeHolds += 1;
          holdVol += Number(d.currentHoldAmount || d.initialAmount) || 0;
        }
      }
      for (const o of g.mailOrders) {
        if (o.status !== 'paid') {
          unpaidMail += 1;
          unpaidVol += Number(o.amount) || 0;
        }
      }
    }
    return { customers: groups.length, activeHolds, holdVol, unpaidMail, unpaidVol };
  }, [groups]);

  const filtered = useMemo(() => {
    let rows = groups;
    if (filter === 'hold') {
      rows = rows.filter((g) => g.deposits.some((d) => ['authorized', 'pending_collection'].includes(d.status)));
    } else if (filter === 'mail_unpaid') {
      rows = rows.filter((g) => g.mailOrders.some((o) => o.status !== 'paid'));
    } else if (filter === 'direct_unpaid') {
      rows = rows.filter((g) => (g.directOrders || []).some((o) => o.status !== 'paid'));
    } else if (filter === 'deposits') {
      rows = rows.filter((g) => g.deposits.length > 0);
    }
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (g) =>
        g.displayTitle?.toLowerCase().includes(q) ||
        g.resCode?.toLowerCase().includes(q) ||
        g.customerName?.toLowerCase().includes(q) ||
        g.customerEmail?.toLowerCase().includes(q),
    );
  }, [groups, search, filter]);

  const workbenchGroupLive = useMemo(() => {
    if (!workbenchGroup) return null;
    return groups.find((g) => g.id === workbenchGroup.id) || workbenchGroup;
  }, [workbenchGroup, groups]);

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'All', count: groups.length },
      {
        id: 'hold',
        label: 'Active hold',
        count: groups.filter((g) => g.deposits.some((d) => ['authorized', 'pending_collection'].includes(d.status))).length,
      },
      {
        id: 'mail_unpaid',
        label: 'Unpaid mail',
        count: groups.filter((g) => g.mailOrders.some((o) => o.status !== 'paid')).length,
      },
      ...(showFinancialTotals
        ? [
            {
              id: 'direct_unpaid',
              label: 'Unpaid direct',
              count: groups.filter((g) => (g.directOrders || []).some((o) => o.status !== 'paid')).length,
            },
          ]
        : []),
      { id: 'deposits', label: 'With deposits', count: groups.filter((g) => g.deposits.length > 0).length },
    ],
    [groups],
  );

  const openWorkbench = (row) => {
    setWorkbenchGroup(row);
  };

  const handleCenterFeedback = (item) => {
    setCenterFeedback(item);
  };

  return (
    <div className="pal-fin-root pal-analytics-page pal-fin-stripe-page pal-cust-root">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Customers</h1>
          <p className="pal-fin-subtitle">
            Click a customer to open the workspace — deposits, mail orders, and card actions.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
          {syncedAt && (
            <p className="pal-cust-sync-caption">
              Synced {new Date(syncedAt).toLocaleString()} · Europe/Zurich
            </p>
          )}
        </div>
        <div className="pal-fin-command-actions pal-fin-command-actions-symmetric">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm pal-fin-action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          {showFinancialTotals && (
            <button
              type="button"
              className="gm-btn gm-btn-primary gm-btn-sm pal-fin-action-btn"
              onClick={() => setShowNewOperation(true)}
            >
              <Plus size={15} />
              New operation
            </button>
          )}
        </div>
      </header>

      <PalantirFinKpiRow>
        <PalantirFinKpiCard label="Customers" value={kpi.customers} sub="Unique RES / email groups" tone="default" />
        <PalantirFinKpiCard
          label="Active holds"
          value={kpi.activeHolds}
          sub={showFinancialTotals ? formatStripeMoney(kpi.holdVol) : `${kpi.activeHolds} open`}
          tone="hold"
        />
        <PalantirFinKpiCard
          label="Unpaid mail"
          value={kpi.unpaidMail}
          sub={showFinancialTotals ? formatStripeMoney(kpi.unpaidVol) : 'Awaiting payment'}
          tone="unpaid"
        />
        <PalantirFinKpiCard label="Deposits" value={deposits.length} sub="Terminal records" tone="revenue" />
      </PalantirFinKpiRow>

      {error && <div className="pal-fin-alert">{error}</div>}

      <div className="pal-fin-toolbar">
        <label className="pal-fin-search">
          <Search size={16} className="text-[var(--erpx-ink-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search RES, name, email…"
          />
        </label>
        <div className="pal-fin-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`pal-fin-chip pal-fin-chip-symmetric ${filter === chip.id ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="pal-fin-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pal-fin-grid-single">
        <div className="pal-fin-main pal-fin-main-full">
          <div className="pal-fin-table-wrap">
            <table className="pal-fin-table pal-fin-table-dense pal-cust-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Signals</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="pal-fin-empty">Loading registry…</td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="pal-fin-empty">No customers match your filters.</td>
                  </tr>
                ) : (
                  filtered.map((row) => {
                    const hasHold = row.deposits.some((d) => ['authorized', 'pending_collection'].includes(d.status));
                    const unpaidMail = row.mailOrders.filter((o) => o.status !== 'paid').length;
                    const unpaidDirect = (row.directOrders || []).filter((o) => o.status !== 'paid').length;
                    const hasToken = row.deposits.some((d) => d.tokenSaved || d.stripePaymentMethodId);
                    return (
                      <tr
                        key={row.id}
                        className="pal-fin-table-row-clickable"
                        onClick={() => openWorkbench(row)}
                      >
                        <td>
                          <div className="pal-cust-row-identity">
                            <span className="pal-cust-row-icon" aria-hidden="true">
                              <User size={14} />
                            </span>
                            <div className="pal-cust-row-text">
                              <span className="pal-cust-res pal-fin-mono">{row.resCode || row.displayTitle}</span>
                              {row.customerName && row.customerName !== row.resCode && (
                                <span className="pal-cust-name">{row.customerName}</span>
                              )}
                              {row.customerEmail && <span className="pal-cust-email">{row.customerEmail}</span>}
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="pal-cust-signals">
                            <CountSignal icon={Lock} count={row.deposits.length} label="Deposits" tone={hasHold ? 'hold' : 'neutral'} />
                            {showFinancialTotals && (row.directOrders || []).length > 0 && (
                              <CountSignal
                                icon={CreditCard}
                                count={(row.directOrders || []).length}
                                label="Direct"
                                tone={unpaidDirect ? 'warn' : 'neutral'}
                              />
                            )}
                            <CountSignal icon={Mail} count={row.mailOrders.length} label="Mail" tone={unpaidMail ? 'warn' : 'neutral'} />
                          </div>
                        </td>
                        <td>
                          <div className="pal-cust-status-cell">
                            {hasHold && <StripeStatusBadge sharp variant="hold" label="Hold" />}
                            {hasToken && !hasHold && <StripeStatusBadge sharp variant="success" label="Token" />}
                            {unpaidMail > 0 && <StripeStatusBadge sharp variant="unpaid" label={`${unpaidMail} mail`} />}
                            {unpaidDirect > 0 && (
                              <StripeStatusBadge sharp variant="warning" label={`${unpaidDirect} direct`} />
                            )}
                            {!hasHold && unpaidMail === 0 && unpaidDirect === 0 && !hasToken && (
                              <StripeStatusBadge sharp variant="neutral" label="Clear" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {workbenchGroupLive && (
        <StripeCustomerWorkbenchModal
          group={workbenchGroupLive}
          franchiseId={franchiseId}
          showFinancialTotals={showFinancialTotals}
          auditEntries={audit}
          onClose={() => setWorkbenchGroup(null)}
          onChanged={load}
          onCenterFeedback={handleCenterFeedback}
        />
      )}

      {showNewOperation && (
        <StripeCustomerNewOperationModal
          franchiseId={franchiseId}
          onClose={() => setShowNewOperation(false)}
          onSuccess={(item) => {
            setCenterFeedback({ type: 'success', ...item, at: new Date().toISOString() });
            load();
          }}
          onError={(friendly) => {
            setCenterFeedback({
              type: 'error',
              title: friendly?.title || 'Charge failed',
              detail: friendly?.detail || friendly?.displayText,
              nextSteps: friendly?.nextSteps,
              code: friendly?.code,
              at: new Date().toISOString(),
            });
          }}
        />
      )}

      <CenterFeedbackToast item={centerFeedback} onDismiss={() => setCenterFeedback(null)} />
    </div>
  );
}
