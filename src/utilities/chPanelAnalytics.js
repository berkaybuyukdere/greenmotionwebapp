/**
 * CH Operations Panel analytics — ported from iOS CHPanelAnalyticsEngine.swift
 */

export const CH_PANEL_PERIODS = ['daily', 'weekly', 'monthly'];

export function periodLabel(period) {
  switch (period) {
    case 'daily':
      return 'Daily';
    case 'weekly':
      return 'Weekly';
    case 'monthly':
      return 'Monthly';
    default:
      return period;
  }
}

function startOfDay(date, calendar) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addWeeks(date, weeks) {
  return addDays(date, weeks * 7);
}

function weekStart(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day + 6) % 7;
  d.setDate(d.getDate() - diff);
  return d;
}

function monthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatLabel(date, pattern) {
  const fmt = new Intl.DateTimeFormat('en-GB', pattern);
  return fmt.format(date);
}

function bucketBounds(period, index, rangeStart, now) {
  const todayEnd = addDays(startOfDay(now), 1);

  if (period === 'daily') {
    const day = addDays(startOfDay(rangeStart), index);
    const end = new Date(Math.min(addDays(day, 1).getTime(), todayEnd.getTime()));
    return {
      start: day,
      end,
      label: formatLabel(day, { weekday: 'short', day: '2-digit' }),
    };
  }

  if (period === 'weekly') {
    const start = addWeeks(rangeStart, index);
    const weekEnd = addWeeks(start, 1);
    const end = new Date(Math.min(weekEnd.getTime(), todayEnd.getTime()));
    const startLbl = formatLabel(start, { day: '2-digit', month: 'short' });
    return { start, end, label: `W${index + 1} · ${startLbl}` };
  }

  const monthStartDate = rangeStart;
  const day = addDays(monthStartDate, index);
  const nextDay = addDays(day, 1);
  const end = new Date(Math.min(nextDay.getTime(), todayEnd.getTime()));
  return {
    start: day,
    end,
    label: formatLabel(day, { day: 'numeric', month: 'short' }),
  };
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (value?.seconds != null) return new Date(value.seconds * 1000);
  if (typeof value === 'number') {
    if (value > 1e12) return new Date(value);
    if (value > 1e9) return new Date(value * 1000);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inRange(date, start, end) {
  if (!date) return false;
  const t = date.getTime();
  return t >= start.getTime() && t < end.getTime();
}

/**
 * @param {object} opts
 * @param {'daily'|'weekly'|'monthly'} opts.period
 * @param {Array} opts.damages - { tarih, fotograflar, isDeleted }
 * @param {Array} opts.officeOperations - { date, amount, type, franchiseId }
 * @param {Array} [opts.trafficContracts] - { createdAt, paidAmount }
 * @param {Array} [opts.auditLogs] - { timestamp }
 * @param {Date} [opts.now]
 */
export function buildCHPanelSnapshot({
  period,
  damages = [],
  officeOperations = [],
  trafficContracts = [],
  auditLogs = [],
  now = new Date(),
}) {
  let rangeStart;
  let bucketCount;

  if (period === 'daily') {
    rangeStart = addDays(startOfDay(now), -6);
    bucketCount = 7;
  } else if (period === 'weekly') {
    const ws = weekStart(now);
    rangeStart = addWeeks(ws, -3);
    bucketCount = 4;
  } else {
    rangeStart = monthStart(now);
    bucketCount = Math.max(1, now.getDate());
  }

  const activeDamages = damages.filter((d) => !d.isDeleted);
  const parsedDamages = activeDamages
    .map((d) => ({ ...d, _date: parseDate(d.tarih || d.date) }))
    .filter((d) => d._date);

  const parsedOps = officeOperations
    .map((op) => ({ ...op, _date: parseDate(op.date || op.tarih || op.createdAt) }))
    .filter((op) => op._date);

  const parsedTraffic = trafficContracts
    .map((t) => ({ ...t, _date: parseDate(t.createdAt || t.date) }))
    .filter((t) => t._date);

  const buckets = [];
  for (let i = 0; i < bucketCount; i += 1) {
    const { start, end, label } = bucketBounds(period, i, rangeStart, now);
    const periodDamages = parsedDamages.filter((d) => inRange(d._date, start, end));
    const periodOps = parsedOps.filter((op) => inRange(op._date, start, end));
    const periodTraffic = parsedTraffic.filter((t) => inRange(t._date, start, end));
    const officeRev = periodOps.reduce((sum, op) => sum + (Number(op.amount) || 0), 0);
    const trafficRev = periodTraffic.reduce(
      (sum, t) => sum + (Number(t.paidAmount) || 0),
      0
    );
    const photos = periodDamages.reduce(
      (sum, d) => sum + (Array.isArray(d.fotograflar) ? d.fotograflar.length : 0),
      0
    );
    buckets.push({
      id: label,
      label,
      start,
      end,
      damageCount: periodDamages.length,
      damagePhotos: photos,
      officeRevenue: officeRev + trafficRev,
      officeTransactionCount: periodOps.length + periodTraffic.length,
    });
  }

  const filteredOps = parsedOps.filter((op) => op._date >= rangeStart);
  const filteredTraffic = parsedTraffic.filter((t) => t._date >= rangeStart);
  const byType = {};
  filteredOps.forEach((op) => {
    const type = String(op.type || 'other');
    if (!byType[type]) byType[type] = { count: 0, totalAmount: 0 };
    byType[type].count += 1;
    byType[type].totalAmount += Number(op.amount) || 0;
  });

  let officeBreakdown = Object.entries(byType).map(([type, v]) => ({
    id: type,
    type,
    count: v.count,
    totalAmount: v.totalAmount,
  }));

  const trafficTotal = filteredTraffic.reduce(
    (sum, t) => sum + (Number(t.paidAmount) || 0),
    0
  );
  if (filteredTraffic.length > 0) {
    officeBreakdown.push({
      id: 'traffic_accident',
      type: 'traffic_accident',
      count: filteredTraffic.length,
      totalAmount: trafficTotal,
    });
  }
  officeBreakdown.sort((a, b) => b.totalAmount - a.totalAmount);

  const totalRevenue = buckets.reduce((sum, b) => sum + b.officeRevenue, 0);
  const totalDamages = parsedDamages.filter((d) => d._date >= rangeStart).length;
  const periodAudit = auditLogs.filter((log) => {
    const ts = parseDate(log.timestamp);
    return ts && ts >= rangeStart;
  });

  return {
    period,
    buckets,
    officeBreakdown,
    totalRevenue,
    totalDamages,
    totalAuditEntries: periodAudit.length,
    rangeStart,
    summaryForAI: buildAISummary({
      period,
      buckets,
      officeBreakdown,
      totalRevenue,
      totalDamages,
      auditCount: periodAudit.length,
    }),
  };
}

function buildAISummary({
  period,
  buckets,
  officeBreakdown,
  totalRevenue,
  totalDamages,
  auditCount,
}) {
  const bucketLines = buckets
    .map(
      (b) =>
        `${b.label}: damages=${b.damageCount}, revenue=${b.officeRevenue.toFixed(2)}, ops=${b.officeTransactionCount}`
    )
    .join('\n');
  const typeLines = officeBreakdown
    .slice(0, 8)
    .map((r) => `${r.type}: count=${r.count}, total=${r.totalAmount.toFixed(2)}`)
    .join('\n');
  return `Franchise analytics snapshot (Switzerland fleet app).
Period grouping: ${period}.
Total damages in range: ${totalDamages}.
Total revenue in range: ${totalRevenue.toFixed(2)}.
Audit log entries in range: ${auditCount}.
Buckets:
${bucketLines}
Revenue breakdown:
${typeLines}`;
}

export function auditRowsFromLogs(logs) {
  return logs.map((log) => ({
    id: String(log.id || log.documentId || ''),
    timestamp: parseDate(log.timestamp) || new Date(),
    userName: log.userName || log.userId || 'User',
    action: log.action || '',
    tableName: log.tableName || '',
    recordId: log.recordId || '',
  }));
}

export function officeTypeLabel(raw) {
  if (raw === 'traffic_accident') return 'Traffic accident revenue';
  const labels = {
    'Credit Card Receipt': 'Credit card',
    'POS Daily Closing': 'POS closing',
    'Fuel Receipt': 'Fuel',
    'Washing Expense': 'Washing',
    'Additional Sales': 'Additional sales',
    'Banking Transaction': 'Banking',
    'Traffic Fine': 'Traffic fine',
  };
  return labels[raw] || raw.replace(/_/g, ' ');
}
