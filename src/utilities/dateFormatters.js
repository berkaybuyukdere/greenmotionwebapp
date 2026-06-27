import { format as formatDateFns } from 'date-fns';
import { getActiveFranchiseCurrencyCode } from '../franchiseCurrency';

// Utility Functions
export const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    // Handle Firestore Timestamp, number (Unix timestamp or TimeInterval), or Date object
    let date;
    if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
        // Handle both formats:
        // 1. Unix timestamp (seconds since 1970-01-01) - values > 1 billion
        // 2. TimeInterval (seconds since 2001-01-01) - values < 1 billion
        if (timestamp > 1000000000) {
            // Unix timestamp format
            date = new Date(timestamp * 1000);
        } else {
            // iOS TimeInterval format (seconds since 2001-01-01)
            const referenceDateMillis = new Date('2001-01-01T00:00:00Z').getTime();
            date = new Date(referenceDateMillis + timestamp * 1000);
        }
    } else {
        date = new Date(timestamp);
    }
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatDateTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    // Handle Firestore Timestamp, number (Unix timestamp or TimeInterval), or Date object
    let date;
    if (timestamp.seconds) {
        date = new Date(timestamp.seconds * 1000);
    } else if (typeof timestamp === 'number') {
        // Handle both formats:
        // 1. Unix timestamp (seconds since 1970-01-01) - values > 1 billion
        // 2. TimeInterval (seconds since 2001-01-01) - values < 1 billion
        if (timestamp > 1000000000) {
            // Unix timestamp format
            date = new Date(timestamp * 1000);
        } else {
            // iOS TimeInterval format (seconds since 2001-01-01)
            const referenceDateMillis = new Date('2001-01-01T00:00:00Z').getTime();
            date = new Date(referenceDateMillis + timestamp * 1000);
        }
    } else {
        date = new Date(timestamp);
    }
    return date.toLocaleString('en-US', { 
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};

export const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: getActiveFranchiseCurrencyCode(),
    }).format(amount || 0);
};

export function coerceTimestampToDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value.seconds !== undefined) return new Date(value.seconds * 1000);
    if (typeof value === 'number') {
        if (value > 1000000000) return new Date(value * 1000);
        const ref = new Date('2001-01-01T00:00:00Z').getTime();
        return new Date(ref + value * 1000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

export function sanitizeFilenamePart(s) {
    return String(s || 'unknown')
        .replace(/[^\w-]+/g, '_')
        .slice(0, 80);
}

export function latestDamageOperationDate(hasarKayitlari) {
    if (!hasarKayitlari?.length) return null;
    let best = null;
    for (const h of hasarKayitlari) {
        if (h.isDeleted) continue;
        const d = coerceTimestampToDate(h.tarih);
        if (d && (!best || d > best)) best = d;
    }
    return best;
}

export const parseInputDate = (value) => {
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDateTimeLabel = (value, endOfDay = false) => {
    const date = parseInputDate(value);
    if (!date) return 'N/A';
    const hour = endOfDay ? 23 : 0;
    const minute = endOfDay ? 59 : 0;
    const marker = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 === 0 ? 12 : hour % 12;
    return `${formatDateFns(date, 'MMM d, yyyy')} @ ${displayHour}:${String(minute).padStart(2, '0')}${marker}`;
};

export const isSameDateOnly = (a, b) => {
    if (!a || !b) return false;
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
};



/** Normalize Firestore / iOS timestamps to a JS Date (returns null when invalid). */
export function getDateFromTimestamp(timestamp) {
    return coerceTimestampToDate(timestamp);
}
