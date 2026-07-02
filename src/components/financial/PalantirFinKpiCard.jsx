import React from 'react';

/**
 * Sharp Palantir-style KPI tile — matches Analytics page (vehicle-sentinel-theme).
 * tone: default | revenue (violet/paid) | warning (orange/unpaid) | hold | expense
 */
export function PalantirFinKpiCard({ label, value, sub, tone = 'default', className = '' }) {
  const toneClass =
    tone === 'revenue' || tone === 'paid'
      ? 'pal-analytics-kpi-revenue'
      : tone === 'warning' || tone === 'unpaid'
        ? 'pal-analytics-kpi-warning'
        : tone === 'hold'
          ? 'pal-analytics-kpi-hold'
          : tone === 'expense'
            ? 'pal-analytics-kpi-expense'
            : '';
  return (
    <div className={`pal-analytics-kpi pal-dash-kpi pal-fin-kpi-sharp ${toneClass} ${className}`.trim()}>
      <p className="pal-analytics-kpi-label">{label}</p>
      <p className="pal-dash-kpi-value">{value}</p>
      {sub ? <p className="pal-analytics-kpi-sub">{sub}</p> : null}
    </div>
  );
}

export function PalantirFinKpiRow({ children, className = '' }) {
  return <div className={`pal-analytics-kpi-row pal-fin-kpi-row ${className}`.trim()}>{children}</div>;
}
