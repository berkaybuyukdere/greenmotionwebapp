import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { StripeDataTable } from '../StripeListUI';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import { chStripeGetDailyReports, stripeFinancialListDeposits } from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const PERIOD_PRESETS = [
  { id: '1d', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: '180d', label: '6 months' },
];

function todayKeyZurich() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function centsToMajor(cents) {
  return (Number(cents) || 0) / 100;
}

function formatChfVolume(cents) {
  return formatCurrency(centsToMajor(cents));
}

function formatDayLabel(dayKey) {
  if (!dayKey) return '—';
  const [y, m, d] = String(dayKey).split('-');
  if (!d) return dayKey;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function MetricCell({ count, volume }) {
  return (
    <div className="pal-fin-report-metric-cell">
      <span className="pal-fin-report-metric-vol">{formatChfVolume(volume)}</span>
      <span className="pal-fin-report-metric-count">{count} tx</span>
    </div>
  );
}

export function StripeDailyReportsView({ franchiseId }) {
  const [period, setPeriod] = useState('7d');
  const [customMode, setCustomMode] = useState(false);
  const [startDayKey, setStartDayKey] = useState('');
  const [endDayKey, setEndDayKey] = useState(todayKeyZurich());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);
  const [deposits, setDeposits] = useState([]);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    if (customMode && (!startDayKey || !endDayKey || startDayKey > endDayKey)) {
      setError('Select a valid date range.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [data, depRes] = await Promise.all([
        chStripeGetDailyReports({
          franchiseId,
          period: customMode ? undefined : period,
          startDayKey: customMode ? startDayKey : undefined,
          endDayKey: customMode ? endDayKey : undefined,
        }),
        stripeFinancialListDeposits({ franchiseId, limit: 100 }),
      ]);
      setSnapshot(data);
      setDeposits(depRes.deposits || []);
    } catch (e) {
      setError(e?.message || 'Failed to load reports');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [franchiseId, period, customMode, startDayKey, endDayKey]);

  useEffect(() => {
    load();
  }, [load]);

  const tableRows = useMemo(() => {
    const series = snapshot?.dailySeries || [];
    return series.map((day) => {
      const pay = day.payments || { count: 0, volume: 0 };
      const dep = day.deposits || { count: 0, volume: 0 };
      const cb = day.chargebacks || { count: 0, volume: 0 };
      const mo = day.mailOrder || { count: 0, volume: 0 };
      return {
        id: day.dayKey,
        dayLabel: formatDayLabel(day.dayKey),
        payments: pay,
        deposits: dep,
        chargebacks: cb,
        mailOrder: mo,
        totalVol: pay.volume + dep.volume + cb.volume + mo.volume,
      };
    });
  }, [snapshot]);

  const totals = useMemo(() => {
    const kpis = snapshot?.kpis;
    if (!kpis) return null;
    const pay = kpis.payments || { count: 0, volume: 0 };
    const dep = kpis.deposits || { count: 0, volume: 0 };
    const cb = kpis.chargebacks || { count: 0, volume: 0 };
    const mo = kpis.mailOrder || { count: 0, volume: 0 };
    return {
      payments: pay,
      deposits: dep,
      chargebacks: cb,
      mailOrder: mo,
      totalVol: pay.volume + dep.volume + cb.volume + mo.volume,
      totalCount: pay.count + dep.count + cb.count + mo.count,
    };
  }, [snapshot]);

  const columns = useMemo(
    () => [
      {
        key: 'day',
        header: 'Date',
        render: (row) => <span className="pal-fin-mono pal-fin-report-date">{row.dayLabel}</span>,
      },
      {
        key: 'payments',
        header: 'Payments',
        render: (row) => <MetricCell count={row.payments.count} volume={row.payments.volume} />,
      },
      {
        key: 'deposits',
        header: 'Deposits',
        render: (row) => <MetricCell count={row.deposits.count} volume={row.deposits.volume} />,
      },
      {
        key: 'chargebacks',
        header: 'Chargebacks',
        render: (row) => <MetricCell count={row.chargebacks.count} volume={row.chargebacks.volume} />,
      },
      {
        key: 'mailOrder',
        header: 'Mail order',
        render: (row) => <MetricCell count={row.mailOrder.count} volume={row.mailOrder.volume} />,
      },
      {
        key: 'total',
        header: 'Day total',
        render: (row) => (
          <span className="pal-fin-report-total">{formatChfVolume(row.totalVol)}</span>
        ),
      },
    ],
    [],
  );

  const kpis = snapshot?.kpis;

  const posKpi = useMemo(() => {
    let pos1 = 0;
    let pos2 = 0;
    let holdVol = 0;
    for (const d of deposits) {
      const amt = Number(d.currentHoldAmount || d.initialAmount) || 0;
      const label = String(d.readerLabel || d.readerId || '').toLowerCase();
      if (d.status === 'authorized' || d.status === 'pending_collection') holdVol += amt;
      if (label.includes('pos 2') || label.includes('pos2')) pos2 += amt;
      else pos1 += amt;
    }
    return { pos1, pos2, holdVol };
  }, [deposits]);

  const selectPreset = (id) => {
    setCustomMode(false);
    setPeriod(id);
  };

  const enableCustom = () => {
    setCustomMode(true);
    if (!startDayKey) {
      const end = todayKeyZurich();
      const parts = end.split('-').map(Number);
      const d = new Date(parts[0], parts[1] - 1, parts[2]);
      d.setDate(d.getDate() - 6);
      const start = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Zurich',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
      setStartDayKey(start);
      setEndDayKey(end);
    }
  };

  return (
    <div className="erpx-page pal-analytics-page pal-fin-stripe-page pal-fin-reports-dashboard">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Stripe daily dashboard</h1>
          <p className="pal-fin-subtitle">
            Volume and transaction counts by channel — Europe/Zurich business days.
          </p>
          {snapshot && (
            <p className="pal-fin-range-caption">
              {snapshot.startDayKey} → {snapshot.endDayKey}
              {snapshot.syncedAt ? ` · synced ${new Date(snapshot.syncedAt).toLocaleTimeString()}` : ''}
            </p>
          )}
        </div>
        <div className="pal-fin-command-actions pal-fin-command-actions-symmetric">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm pal-fin-action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {error && <div className="pal-fin-alert">{error}</div>}

      <div className="pal-fin-toolbar pal-fin-toolbar-reports">
        <div className="pal-fin-chips" role="tablist" aria-label="Report period">
          {PERIOD_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={!customMode && period === p.id}
              className={`pal-fin-chip pal-fin-chip-symmetric ${!customMode && period === p.id ? 'pal-fin-chip-active' : ''}`}
              onClick={() => selectPreset(p.id)}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={customMode}
            className={`pal-fin-chip pal-fin-chip-symmetric ${customMode ? 'pal-fin-chip-active' : ''}`}
            onClick={enableCustom}
          >
            Custom
          </button>
        </div>
      </div>

      {customMode && (
        <div className="pal-fin-custom-range-row">
          <label className="pal-fin-field">
            <span>From</span>
            <input type="date" className="pal-fin-input" value={startDayKey} onChange={(e) => setStartDayKey(e.target.value)} />
          </label>
          <label className="pal-fin-field">
            <span>To</span>
            <input type="date" className="pal-fin-input" value={endDayKey} onChange={(e) => setEndDayKey(e.target.value)} />
          </label>
          <button type="button" className="gm-btn gm-btn-primary gm-btn-sm pal-fin-action-btn" onClick={load} disabled={loading}>
            Apply
          </button>
        </div>
      )}

      {kpis && (
        <section className="pal-fin-dashboard-kpis">
          <PalantirFinKpiRow>
            <PalantirFinKpiCard
              label="Deposit hold"
              value={formatChfVolume(posKpi.holdVol || kpis.deposits?.volume)}
              sub={`${kpis.deposits?.count || 0} holds in period`}
              tone="hold"
            />
            <PalantirFinKpiCard
              label="Paid"
              value={formatChfVolume(kpis.payments?.volume)}
              sub={`${kpis.payments?.count || 0} payments`}
              tone="paid"
            />
            <PalantirFinKpiCard
              label="Mail order unpaid"
              value={formatChfVolume(kpis.mailOrder?.volume)}
              sub={`${kpis.mailOrder?.count || 0} links`}
              tone="unpaid"
            />
            <PalantirFinKpiCard
              label="1. POS"
              value={formatChfVolume(posKpi.pos1)}
              sub="Terminal volume"
              tone="default"
            />
            <PalantirFinKpiCard
              label="2. POS"
              value={formatChfVolume(posKpi.pos2)}
              sub="Terminal volume"
              tone="default"
            />
            <PalantirFinKpiCard
              label="Chargebacks"
              value={formatChfVolume(kpis.chargebacks?.volume)}
              sub={`${kpis.chargebacks?.count || 0} disputes`}
              tone="expense"
            />
          </PalantirFinKpiRow>
          {totals && (
            <div className="pal-fin-dashboard-grand-total">
              <span className="pal-fin-dashboard-grand-label">Period total</span>
              <span className="pal-fin-dashboard-grand-value">{formatChfVolume(totals.totalVol)}</span>
              <span className="pal-fin-dashboard-grand-sub">{totals.totalCount} transactions</span>
            </div>
          )}
        </section>
      )}

      <div className="pal-fin-grid-single pal-analytics-data-panel">
        <div className="pal-fin-main pal-fin-main-full">
          <div className="pal-fin-report-table-section">
            <div className="pal-fin-report-table-head">
              <p className="pal-fin-section-title">Daily breakdown</p>
              <p className="pal-fin-section-hint">Each row is one Zurich calendar day</p>
            </div>
            <StripeDataTable
              dense
              columns={columns}
              rows={tableRows}
              loading={loading}
              emptyMessage="No Stripe activity in this period."
            />
            {totals && tableRows.length > 0 && (
              <div className="pal-fin-report-totals-row">
                <span className="pal-fin-report-totals-label">Period total</span>
                <MetricCell count={totals.payments.count} volume={totals.payments.volume} />
                <MetricCell count={totals.deposits.count} volume={totals.deposits.volume} />
                <MetricCell count={totals.chargebacks.count} volume={totals.chargebacks.volume} />
                <MetricCell count={totals.mailOrder.count} volume={totals.mailOrder.volume} />
                <span className="pal-fin-report-total">{formatChfVolume(totals.totalVol)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
