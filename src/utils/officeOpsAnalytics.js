/** Office ops revenue vs expense — aligned with Dashboard logic */

export const OFFICE_REVENUE_TYPES = ['POS Daily Closing', 'Additional Sales', 'Banking Transaction'];
export const OFFICE_EXPENSE_TYPES = ['Credit Card Receipt', 'Washing Expense', 'Traffic Fine'];

export function parseOfficeAmount(op) {
    return Number.parseFloat(op?.amount) || 0;
}

export function isOfficeRevenue(op) {
    if (!op) return false;
    if (op.type === 'Fuel Receipt') return Boolean(op.isCompleted);
    return OFFICE_REVENUE_TYPES.includes(op.type);
}

export function isOfficeExpense(op) {
    if (!op) return false;
    if (op.type === 'Fuel Receipt') return !op.isCompleted;
    return OFFICE_EXPENSE_TYPES.includes(op.type);
}

export function analyticsRangeBounds(preset) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    if (!preset || preset === 'all') return { start: null, end, label: 'All time' };

    const start = new Date();
    start.setHours(0, 0, 0, 0);

    const labels = { '1d': '1 day', '7d': '7 days', '30d': '30 days', '180d': '180 days', '1y': '1 year' };

    if (preset === '1d') {
        /* start is today 00:00 */
    } else if (preset === '7d') {
        start.setDate(start.getDate() - 6);
    } else if (preset === '30d') {
        start.setDate(start.getDate() - 29);
    } else if (preset === '180d') {
        start.setDate(start.getDate() - 179);
    } else if (preset === '1y') {
        start.setFullYear(start.getFullYear() - 1);
        start.setDate(start.getDate() + 1);
    }

    return { start, end, label: labels[preset] || preset };
}

export function opInAnalyticsRange(op, start, end, parseDate) {
    const d = parseDate(op?.date || op?.tarih || op?.createdAt);
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    return true;
}
