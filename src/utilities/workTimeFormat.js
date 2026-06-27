export function pad2(n) {
    return String(n).padStart(2, '0');
}

export function monthKeyFromDate(d) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function dayKeyRangeForMonth(year, monthIndex) {
    const end = new Date(year, monthIndex + 1, 0);
    const startKey = `${year}-${pad2(monthIndex + 1)}-01`;
    const endKey = `${year}-${pad2(monthIndex + 1)}-${pad2(end.getDate())}`;
    return { startKey, endKey };
}

export function formatDuration(minutes) {
    const m = Math.max(0, Number(minutes) || 0);
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return `${mm}m`;
    if (mm === 0) return `${h}h`;
    return `${h}h ${mm}m`;
}

export function formatDurationDecimal(minutes) {
    return (Math.max(0, Number(minutes) || 0) / 60).toFixed(1);
}

export function monthTitle(d) {
    return d.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}

/** e.g. `2026-05-03 · Sat` */
export function formatDayKeyWithWeekday(dayKey) {
    const [y, mo, d] = String(dayKey || '').split('-').map(Number);
    if (!y || !mo || !d) return String(dayKey || '');
    const date = new Date(y, mo - 1, d);
    const weekday = date.toLocaleDateString('en-GB', { weekday: 'short' });
    return `${dayKey} · ${weekday}`;
}

export function tsToTimeInput(ts) {
    if (!ts?.seconds) return '09:00';
    const d = new Date(ts.seconds * 1000);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function applyTimeOnDayKey(dayKey, timeStr, Timestamp) {
    const [y, mo, da] = dayKey.split('-').map(Number);
    const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
    const d = new Date(y, mo - 1, da, hh, mm, 0, 0);
    return Timestamp.fromDate(d);
}

export function isManagerRole(profile) {
    const r = String(profile?.role || '').toLowerCase();
    return r === 'manager' || r === 'admin' || r === 'superadmin' || r === 'globaladmin';
}
