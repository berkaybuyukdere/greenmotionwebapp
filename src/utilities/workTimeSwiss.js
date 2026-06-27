import { isSwissFranchiseId } from './fileLibraryHelpers';

/** Raw minutes from clock-in / clock-out (no break deduction). */
export function computeRawWorkMinutes(clockInTs, clockOutTs) {
    if (!clockInTs?.seconds || !clockOutTs?.seconds) return 0;
    const start = new Date(clockInTs.seconds * 1000);
    let end = new Date(clockOutTs.seconds * 1000);
    if (end <= start) end = new Date(end.getTime() + 86400000);
    return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * Switzerland: shifts longer than 4h bill 30 minutes less (mandatory break).
 * Skipped when `ohnePause` is true.
 */
export function applySwissWorkBreakDeduction(rawMinutes) {
    const raw = Math.max(0, Number(rawMinutes) || 0);
    if (raw <= 240) return raw;
    return Math.max(0, raw - 30);
}

export function billingMinutesForFranchise(rawMinutes, franchiseId, options = {}) {
    const raw = Math.max(0, Number(rawMinutes) || 0);
    if (!isSwissFranchiseId(franchiseId)) return raw;
    if (options.ohnePause === true) return raw;
    return applySwissWorkBreakDeduction(raw);
}

/** Minutes shown in UI / exports / month totals. */
export function effectiveWorkMinutes(entry, franchiseId) {
    if (entry?.isHoliday) return 0;
    const ohnePause = entry?.ohnePause === true;
    if (!isSwissFranchiseId(franchiseId)) {
        return Math.max(0, Number(entry?.totalMinutes) || 0);
    }
    const fromClocks = computeRawWorkMinutes(entry?.clockIn, entry?.clockOut);
    if (fromClocks > 0) {
        return billingMinutesForFranchise(fromClocks, franchiseId, { ohnePause });
    }
    if (ohnePause) return Math.max(0, Number(entry?.totalMinutes) || 0);
    return billingMinutesForFranchise(entry?.totalMinutes, franchiseId, { ohnePause });
}

export function swissBreakWasApplied(entry, franchiseId) {
    if (!isSwissFranchiseId(franchiseId) || entry?.isHoliday || entry?.ohnePause === true) {
        return false;
    }
    const raw =
        computeRawWorkMinutes(entry?.clockIn, entry?.clockOut) ||
        Math.max(0, Number(entry?.totalMinutes) || 0);
    return raw > 240;
}
