/** Europe/Zurich day key (yyyy-mm-dd) for staff-facing daily KPIs. */
export function todayKeyZurich() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function isoOnZurichDay(iso, dayKey = todayKeyZurich()) {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Zurich',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return key === dayKey;
}

export function sumMailOrderDailyKpi(orders, dayKey = todayKeyZurich()) {
  let paidCount = 0;
  let unpaidCount = 0;
  let paidVol = 0;
  let unpaidVol = 0;
  for (const o of orders || []) {
    if (!isoOnZurichDay(o.createdAt || o.paidAt || o.linkSentAt, dayKey)) continue;
    const amt = Number(o.amount) || 0;
    if (o.status === 'paid') {
      paidCount += 1;
      paidVol += amt;
    } else {
      unpaidCount += 1;
      unpaidVol += amt;
    }
  }
  return { dayKey, paidCount, unpaidCount, paidVol, unpaidVol };
}

export function resolveMailOrderCustomerLabel(row) {
  return (
    String(row?.customerName || row?.cardholderName || '').trim() ||
    String(row?.customerEmail || '').split('@')[0] ||
    '—'
  );
}
