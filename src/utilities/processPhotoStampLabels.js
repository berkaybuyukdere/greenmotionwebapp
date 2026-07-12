import { format } from 'date-fns';
import { coerceTimestampToDate } from './dateFormatters';
import { isGermanyFranchiseId } from './franchiseHelpers';

/** First process photo = handover; later photos = return (damage reports only). */
export function stamp(globalIndex, handoverDate, returnDate) {
    if (globalIndex === 0) {
        return { label: 'HANDOVER', date: handoverDate };
    }
    return { label: 'RETURN', date: returnDate };
}

/** Check-out / return PDFs — date stamp only (no HANDOVER/RETURN labels on photos). */
export function stampProcessPhoto(eventDate, opts = {}) {
    const deFranchise = Boolean(opts.deFranchise);
    return {
        label: '',
        date: eventDate,
        time: deFranchise ? formatPDFTime(eventDate) : null,
    };
}

export function formatDisplayDate(date, includeTime) {
    const d = coerceTimestampToDate(date);
    if (!d) return 'N/A';
    return format(d, includeTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy');
}

export function formatPDFDate(date, includeTime) {
    return formatDisplayDate(date, includeTime);
}

export function formatPDFTime(date) {
    const d = coerceTimestampToDate(date);
    if (!d) return '';
    return format(d, 'HH:mm');
}

/** UI / inspector dates: DE franchises include time, others date only. */
export function formatProcessDate(date, franchiseId) {
    return formatDisplayDate(date, isGermanyFranchiseId(franchiseId));
}
