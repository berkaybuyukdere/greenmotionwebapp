import React from 'react';

/**
 * Sharp Palantir-style KPI tile — matches Analytics page (vehicle-sentinel-theme).
 * tone: default | revenue (violet/paid) | warning (orange/unpaid) | hold | expense
 */
export function PalantirFinKpiCard({
  label,
  value,
  sub,
  moneySub = false,
  tone = 'default',
  className = '',
  onClick,
  active = false,
}) {
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
  const cls = `pal-analytics-kpi pal-dash-kpi pal-fin-kpi-sharp ${toneClass} ${onClick ? 'pal-fin-kpi-clickable' : ''} ${active ? 'pal-fin-kpi-active' : ''} ${className}`.trim();

  if (onClick) {
    return (
      <button type="button" className={cls} onClick={onClick} aria-pressed={active}>
        <p className="pal-analytics-kpi-label">{label}</p>
        <p className="pal-dash-kpi-value">{value}</p>
        {sub ? <p className={`pal-analytics-kpi-sub ${moneySub ? 'pal-analytics-kpi-money' : ''}`}>{sub}</p> : null}
      </button>
    );
  }

  return (
    <div className={cls}>
      <p className="pal-analytics-kpi-label">{label}</p>
      <p className="pal-dash-kpi-value">{value}</p>
      {sub ? <p className={`pal-analytics-kpi-sub ${moneySub ? 'pal-analytics-kpi-money' : ''}`}>{sub}</p> : null}
    </div>
  );
}

export function PalantirFinKpiRow({ children, className = '' }) {
  return <div className={`pal-analytics-kpi-row pal-fin-kpi-row ${className}`.trim()}>{children}</div>;
}
