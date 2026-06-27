/** Parse Firestore Timestamp, iOS TimeInterval, ISO string, or Date. */
export function parseRecordDate(dateValue) {
    if (!dateValue) return null;

    if (dateValue.seconds) {
        return new Date(dateValue.seconds * 1000);
    }

    if (typeof dateValue === 'object' && typeof dateValue.toDate === 'function') {
        return dateValue.toDate();
    }

    if (typeof dateValue === 'number') {
        if (dateValue > 0 && dateValue < 1_000_000_000) {
            const referenceDateMillis = new Date('2001-01-01T00:00:00Z').getTime();
            return new Date(referenceDateMillis + dateValue * 1000);
        }
        if (dateValue > 1_000_000_000_000) {
            return new Date(dateValue);
        }
        if (dateValue > 1_000_000_000) {
            return new Date(dateValue * 1000);
        }
    }

    if (typeof dateValue === 'string') {
        const parsed = new Date(dateValue);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(dateValue);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isSameCalendarDay(date, day) {
    if (!date || !day) return false;
    return (
        date.getFullYear() === day.getFullYear() &&
        date.getMonth() === day.getMonth() &&
        date.getDate() === day.getDate()
    );
}

export function startOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

export function customerDisplayName(record) {
    if (!record) return '—';
    const direct = String(record.musteriAdi || record.customerName || record.customer || '').trim();
    if (direct) return direct;
    const first = String(record.customerFirstName || '').trim();
    const last = String(record.customerLastName || '').trim();
    const joined = [first, last].filter(Boolean).join(' ');
    return joined || '—';
}

export function formatJournalTime(date) {
    if (!date) return '—';
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function formatJournalDate(date) {
    if (!date) return '—';
    return date.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
