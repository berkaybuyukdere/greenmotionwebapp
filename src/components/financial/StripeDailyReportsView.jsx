import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, CreditCard, AlertTriangle, Mail, BarChart3 } from 'lucide-react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';
import { PalantirWorkbench, PalantirCommandBar } from '../palantir/PalantirWorkbench';
import { chStripeGetDailyReports } from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const PERIODS = [
  { id: '1d', label: '1D' },
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '180d', label: '180D' },
  { id: '1y', label: '1Y' },
];

const CATEGORY_LABELS = {
  traffic_fine: 'Traffic fine',
  damage: 'Damage',
  other: 'Other',
};

function centsToMajor(cents) {
  return (Number(cents) || 0) / 100;
}

function formatChfVolume(cents) {
  return formatCurrency(centsToMajor(cents));
}

function shortDayLabel(dayKey) {
  if (!dayKey) return '';
  const parts = String(dayKey).split('-');
  if (parts.length !== 3) return dayKey;
  return `${parts[2]}.${parts[1]}`;
}

function KpiCard({ title, count, volume, icon: Icon, accent }) {
  return (
    <div className="pal-fin-kpi-card" style={{ borderColor: accent }}>
      <div className="pal-fin-kpi-head">
        <Icon size={16} style={{ color: accent }} />
        <span>{title}</span>
      </div>
      <div className="pal-fin-kpi-value">{count}</div>
      <div className="pal-fin-kpi-sub">{formatChfVolume(volume)}</div>
    </div>
  );
}

export function StripeDailyReportsView({ franchiseId }) {
  const [period, setPeriod] = useState('7d');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState(null);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const data = await chStripeGetDailyReports({ franchiseId, period });
      setSnapshot(data);
    } catch (e) {
      setError(e?.message || 'Failed to load daily reports');
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, [franchiseId, period]);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = useMemo(() => {
    const series = snapshot?.dailySeries || [];
    return series.map((day) => ({
      day: shortDayLabel(day.dayKey),
      dayKey: day.dayKey,
      payments: centsToMajor(day.payments?.volume),
      paymentCount: day.payments?.count || 0,
      chargebacks: centsToMajor(day.chargebacks?.volume),
      chargebackCount: day.chargebacks?.count || 0,
      mailOrder: centsToMajor(day.mailOrder?.volume),
      trafficFine: centsToMajor(day.mailOrder?.byCategory?.traffic_fine?.volume),
      damage: centsToMajor(day.mailOrder?.byCategory?.damage?.volume),
      mailOther: centsToMajor(day.mailOrder?.byCategory?.other?.volume),
    }));
  }, [snapshot]);

  const kpis = snapshot?.kpis;
  const byCategory = kpis?.mailOrder?.byCategory || {};

  return (
    <PalantirWorkbench
      title="Daily reports"
      subtitle="Stripe KPIs — payments, chargebacks, and mail order by category"
      eyebrow="Finance · Stripe"
      icon={BarChart3}
      loading={loading}
      error={error}
      onRetry={load}
    >
      <PalantirCommandBar>
        <div className="pal-fin-period-chips" role="tablist" aria-label="Report period">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={period === p.id}
              className={`pal-fin-period-chip${period === p.id ? ' is-active' : ''}`}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button type="button" className="pal-btn pal-btn-ghost" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'pal-spin' : ''} />
          Sync
        </button>
      </PalantirCommandBar>

      {snapshot && (
        <p className="pal-fin-range-caption">
          {snapshot.startDayKey} — {snapshot.endDayKey}
          {snapshot.syncedAt ? ` · synced ${new Date(snapshot.syncedAt).toLocaleTimeString()}` : ''}
        </p>
      )}

      {kpis && (
        <div className="pal-fin-kpi-row">
          <KpiCard
            title="Payments"
            count={kpis.payments?.count || 0}
            volume={kpis.payments?.volume || 0}
            icon={CreditCard}
            accent="#22c55e"
          />
          <KpiCard
            title="Chargebacks"
            count={kpis.chargebacks?.count || 0}
            volume={kpis.chargebacks?.volume || 0}
            icon={AlertTriangle}
            accent="#f97316"
          />
          <KpiCard
            title="Mail order"
            count={kpis.mailOrder?.count || 0}
            volume={kpis.mailOrder?.volume || 0}
            icon={Mail}
            accent="#a855f7"
          />
        </div>
      )}

      {chartData.length > 0 && (
        <>
          <section className="pal-fin-chart-section">
            <h3 className="pal-fin-chart-title">Payment volume (CHF)</h3>
            <div className="pal-fin-chart-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e1e24', border: '1px solid #333' }}
                    formatter={(v) => [formatCurrency(v), 'CHF']}
                  />
                  <Bar dataKey="payments" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="pal-fin-chart-section">
            <h3 className="pal-fin-chart-title">Chargebacks (CHF)</h3>
            <div className="pal-fin-chart-wrap">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e1e24', border: '1px solid #333' }}
                    formatter={(v) => [formatCurrency(v), 'CHF']}
                  />
                  <Line type="monotone" dataKey="chargebacks" stroke="#f97316" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="pal-fin-chart-section">
            <h3 className="pal-fin-chart-title">Mail order by category (CHF)</h3>
            <div className="pal-fin-chart-wrap">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="day" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{ background: '#1e1e24', border: '1px solid #333' }}
                    formatter={(v) => [formatCurrency(v), 'CHF']}
                  />
                  <Legend />
                  <Bar dataKey="trafficFine" name="Traffic fine" stackId="mo" fill="#6366f1" />
                  <Bar dataKey="damage" name="Damage" stackId="mo" fill="#ec4899" />
                  <Bar dataKey="mailOther" name="Other" stackId="mo" fill="#64748b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="pal-fin-category-breakdown">
            <h3 className="pal-fin-chart-title">Mail order totals by category</h3>
            <div className="pal-fin-category-grid">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => {
                const m = byCategory[key] || { count: 0, volume: 0 };
                return (
                  <div key={key} className="pal-fin-category-cell">
                    <div className="pal-fin-category-label">{label}</div>
                    <div className="pal-fin-category-count">{m.count} tx</div>
                    <div className="pal-fin-category-vol">{formatChfVolume(m.volume)}</div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </PalantirWorkbench>
  );
}
