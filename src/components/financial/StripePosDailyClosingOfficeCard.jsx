import React, { useEffect, useState } from 'react';
import {
  chStripeListPosDailyClosing,
  chStripeSumPosDailyClosingMonth,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

function zurichTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isCurrentMonthSelected(selectedMonth) {
  const now = new Date();
  const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return String(selectedMonth || '').slice(0, 7) === key;
}

export function StripePosDailyClosingOfficeCard({
  franchiseId,
  selectedMonth,
  showFinancialTotals = false,
  showDailyTotals = false,
}) {
  const canViewMonthly = showFinancialTotals;
  const canViewDaily = showDailyTotals || showFinancialTotals;
  const [todayTotal, setTodayTotal] = useState(null);
  const [monthlyTotal, setMonthlyTotal] = useState(null);
  const [loadingToday, setLoadingToday] = useState(false);
  const [loadingMonth, setLoadingMonth] = useState(false);

  const heroTotal = monthlyTotal;

  useEffect(() => {
    if (!canViewDaily || !isCurrentMonthSelected(selectedMonth)) {
      setTodayTotal(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoadingToday(true);
      try {
        const res = await chStripeListPosDailyClosing({
          franchiseId,
          dayKey: zurichTodayKey(),
        });
        if (!cancelled) {
          setTodayTotal(Number(res.totalAmount || 0) / 100);
        }
      } catch {
        if (!cancelled) setTodayTotal(null);
      } finally {
        if (!cancelled) setLoadingToday(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [franchiseId, selectedMonth, canViewDaily]);

  useEffect(() => {
    if (!canViewMonthly) {
      setMonthlyTotal(null);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setLoadingMonth(true);
      try {
        const res = await chStripeSumPosDailyClosingMonth({
          franchiseId,
          yearMonth: selectedMonth,
        });
        if (!cancelled) {
          setMonthlyTotal(Number(res.totalAmount || 0) / 100);
        }
      } catch {
        if (!cancelled) setMonthlyTotal(null);
      } finally {
        if (!cancelled) setLoadingMonth(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [franchiseId, selectedMonth, canViewMonthly]);

  const monthDisplay = canViewMonthly
    ? (heroTotal != null ? formatCurrency(heroTotal) : (loadingMonth ? '…' : '—'))
    : '—';

  const todayDisplay = canViewDaily && isCurrentMonthSelected(selectedMonth)
    ? (todayTotal != null ? formatCurrency(todayTotal) : (loadingToday ? '…' : null))
    : null;

  return (
    <div className="gm-stripe-metric-tile pal-pos-daily-office-card">
      <div className="gm-stripe-metric-tile-label">POS Daily Closing</div>
      <div className="gm-stripe-metric-tile-body">
        <span className="gm-stripe-metric-tile-value">
          {canViewMonthly ? monthDisplay : todayDisplay != null ? todayDisplay : '—'}
        </span>
      </div>
      <div className="pal-pos-daily-office-footer">
        <span className="gm-stripe-metric-tile-count">
          Terminal captures 07:00–22:00 · POS1/POS2
        </span>
        {canViewMonthly && todayDisplay != null && (
          <span className="pal-pos-daily-monthly-total">
            <span className="pal-pos-daily-monthly-label">Today</span>
            <span className="pal-pos-daily-monthly-value">{todayDisplay}</span>
          </span>
        )}
      </div>
    </div>
  );
}
