/**
 * Dedupe keys for Operations / checkout lists when multiple Firestore docs
 * represent the same logical exit or return (e.g. web pending + iOS completed).
 */

export function normalizeNavForDedupe(ex) {
    const raw = String(ex.resKodu || ex.navKodu || '').trim();
    const digits = raw.replace(/\D/g, '');
    return digits || raw.toLowerCase();
}

export function exitBusinessDedupeKey(ex, plateStr) {
    const qt = String(ex.qrToken || '').trim();
    if (qt) return `qr:${qt}`;
    const nav = normalizeNavForDedupe(ex);
    const plate = String(plateStr || ex.aracPlaka || '')
        .replace(/\s+/g, '')
        .toLowerCase();
    const aid = String(ex.aracId || '').trim();
    if (aid && nav) return `aid:${aid}|nav:${nav}`;
    if (plate && nav) return `plt:${plate}|nav:${nav}`;
    return `id:${ex.id || ex.documentId || ''}`;
}

/** When pending uses `qr:*` and completed doc has no token, strong keys differ — match by vehicle + NAV. */
export function exitWeakDedupeKey(ex, plateStr) {
    const nav = normalizeNavForDedupe(ex);
    if (!nav) return null;
    const plate = String(plateStr || ex.aracPlaka || '')
        .replace(/\s+/g, '')
        .toLowerCase();
    const aid = String(ex.aracId || '').trim();
    if (aid) return `w:aid:${aid}|nav:${nav}`;
    if (plate) return `w:plt:${plate}|nav:${nav}`;
    return null;
}

/** Normalize linked checkout id for return dedupe (Firestore doc id vs payload `id` field). */
export function normalizeLinkedExitIdForReturn(r) {
    const le = String(r.linkedExitId || '').trim().toLowerCase();
    if (le) return le;
    if (r.expectedReturnPlanned) {
        const docId = String(r.id || r.documentId || '').trim().toLowerCase();
        if (docId) return docId;
        const legacy = String(r.legacyId || '').trim().toLowerCase();
        if (legacy) return legacy;
    }
    return '';
}

/** Pending returns: same linked exit or same vehicle + calendar day + email (aligns with iOS OperationsHubView). */
export function returnPendingDedupeKey(r, plateStr, dayStartMs) {
    const le = normalizeLinkedExitIdForReturn(r);
    if (le) return `le:${le}`;
    const email = String(r.customerEmail || '')
        .trim()
        .toLowerCase();
    const docId = String(r.id || r.documentId || '').trim().toLowerCase();
    if (!email) return `id:${docId}`;
    const plate = String(plateStr || r.aracPlaka || '')
        .replace(/\s+/g, '')
        .toLowerCase();
    const aid = String(r.aracId || '').trim().toLowerCase();
    const d = typeof dayStartMs === 'number' ? dayStartMs : 0;
    return `w:aid:${aid}|plt:${plate}|d:${d}|em:${email}`;
}

/** Collapse duplicate Firestore return docs (e.g. Cloud Function + iOS race) before Operations filters. */
export function dedupeReturnRowsForOperationsList(returns, plateFn) {
    const list = returns || [];
    const byDocId = new Map();
    for (const r of list) {
        const docId = String(r.id || r.documentId || '').trim();
        if (!docId) continue;
        const prev = byDocId.get(docId);
        if (!prev || returnSortKey(r) > returnSortKey(prev)) {
            byDocId.set(docId, r);
        }
    }
    const docDeduped = Array.from(byDocId.values());
    const byLink = new Map();
    const out = [];
    const sorted = [...docDeduped].sort((a, b) => returnSortKey(b) - returnSortKey(a));
    for (const r of sorted) {
        const le = normalizeLinkedExitIdForReturn(r);
        if (le) {
            if (byLink.has(le)) continue;
            byLink.set(le, true);
            out.push(r);
            continue;
        }
        out.push(r);
    }
    return out;
}

export function dedupePendingReturnsByKey(sortedPendingReturns, plateFn, dayStartMs) {
    const seen = new Set();
    const out = [];
    for (const r of sortedPendingReturns) {
        const k = returnPendingDedupeKey(r, plateFn(r), dayStartMs);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
    }
    return out;
}

export function returnBusinessDedupeKey(r, plateStr) {
    const le = String(r.linkedExitId || '').trim();
    if (le) return `le:${le}`;
    const plate = String(plateStr || r.aracPlaka || '')
        .replace(/\s+/g, '')
        .toLowerCase();
    const aid = String(r.aracId || '').trim();
    if (aid && plate) return `aid:${aid}|plt:${plate}`;
    return `id:${r.id || r.documentId || ''}`;
}

/** Drop pending exits that have a Completed sibling with the same business or weak (vehicle+NAV) key. */
/**
 * Multiple pending exit docs for the same vehicle + NAV (different qrToken) — keep newest-first list order.
 */
export function dedupePendingExitsByWeakKey(sortedPendingExits, plateFn) {
    const seen = new Set();
    const out = [];
    for (const e of sortedPendingExits) {
        const wk = exitWeakDedupeKey(e, plateFn(e));
        if (wk) {
            if (seen.has(wk)) continue;
            seen.add(wk);
        }
        out.push(e);
    }
    return out;
}

export function filterExitsForOperationsList(exits, plateFn) {
    const list = exits || [];
    const completedStrong = new Set();
    const completedWeak = new Set();
    for (const e of list) {
        if (String(e.status || '') === 'Completed') {
            completedStrong.add(exitBusinessDedupeKey(e, plateFn(e)));
            const wk = exitWeakDedupeKey(e, plateFn(e));
            if (wk) completedWeak.add(wk);
        }
    }
    return list.filter((e) => {
        if (String(e.status || '') === 'Completed') return true;
        if (completedStrong.has(exitBusinessDedupeKey(e, plateFn(e)))) return false;
        const wk = exitWeakDedupeKey(e, plateFn(e));
        return !(wk && completedWeak.has(wk));
    });
}

function tsToDate(raw) {
    if (!raw) return null;
    if (raw?.seconds != null) return new Date(raw.seconds * 1000);
    if (raw instanceof Date) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function dayStartMsFromTimestamp(raw) {
    const d = tsToDate(raw);
    if (!d) return 0;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function exitSortKey(ex) {
    const c = tsToDate(ex.createdAt) || tsToDate(ex.exitTarihi);
    return c ? c.getTime() : 0;
}

function returnSortKey(r) {
    const c = tsToDate(r.createdAt) || tsToDate(r.iadeTarihi);
    return c ? c.getTime() : 0;
}

/** Same key logic as OperationsHubView `dedupePendingReturnsByKey`, but each row uses its own calendar day (for all-dates vehicle lists). */
export function dedupePendingReturnsByKeyPerRowDay(sortedPendingReturns, plateFn) {
    const seen = new Set();
    const out = [];
    for (const r of sortedPendingReturns) {
        const dayStartMs = dayStartMsFromTimestamp(r.iadeTarihi || r.createdAt);
        const k = returnPendingDedupeKey(r, plateFn(r), dayStartMs);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
    }
    return out;
}

/**
 * Pre-filtered exits for a single vehicle. Matches OperationsHubView dedupe (document id, pending vs completed NAV/QR, weak keys) without calendar-day filter.
 */
export function dedupeVehicleExitsForDisplay(exits, plateFn) {
    const list = exits || [];
    const idDedupeMap = new Map();
    for (const e of list) {
        const key = e.id || e.documentId;
        if (key) {
            idDedupeMap.set(key, e);
        } else {
            idDedupeMap.set(e, e);
        }
    }
    const ex = Array.from(idDedupeMap.values());

    const completedExitStrong = new Set();
    const completedExitWeak = new Set();
    for (const e of ex) {
        if (String(e.status || '') === 'Completed') {
            completedExitStrong.add(exitBusinessDedupeKey(e, plateFn(e)));
            const wk = exitWeakDedupeKey(e, plateFn(e));
            if (wk) completedExitWeak.add(wk);
        }
    }
    const pe = dedupePendingExitsByWeakKey(
        ex
            .filter((e) => e.status !== 'Completed')
            .filter((e) => {
                if (completedExitStrong.has(exitBusinessDedupeKey(e, plateFn(e)))) return false;
                const wk = exitWeakDedupeKey(e, plateFn(e));
                return !(wk && completedExitWeak.has(wk));
            })
            .sort((a, b) => exitSortKey(b) - exitSortKey(a)),
        plateFn
    );

    const deSorted = ex.filter((e) => e.status === 'Completed').sort((a, b) => exitSortKey(b) - exitSortKey(a));
    const seenDoneStrong = new Set();
    const seenDoneWeak = new Set();
    const de = deSorted.filter((e) => {
        const k = exitBusinessDedupeKey(e, plateFn(e));
        if (seenDoneStrong.has(k)) return false;
        const wk = exitWeakDedupeKey(e, plateFn(e));
        if (wk && seenDoneWeak.has(wk)) return false;
        seenDoneStrong.add(k);
        if (wk) seenDoneWeak.add(wk);
        return true;
    });

    return [...pe, ...de].sort((a, b) => exitSortKey(b) - exitSortKey(a));
}

/**
 * Pre-filtered returns for a single vehicle. Matches OperationsHubView return rules without calendar-day filter.
 */
export function dedupeVehicleReturnsForDisplay(returns, plateFn) {
    const ret = returns || [];

    const completedReturnKeys = new Set();
    const completedLinkedExitIds = new Set();
    for (const r of ret) {
        if (String(r.status || '') === 'Completed') {
            completedReturnKeys.add(returnBusinessDedupeKey(r, plateFn(r)));
            if (r.linkedExitId) completedLinkedExitIds.add(String(r.linkedExitId).trim());
        }
    }

    const pr = dedupePendingReturnsByKeyPerRowDay(
        dedupeReturnRowsForOperationsList(
            ret.filter((r) => r.status !== 'Completed'),
            plateFn
        )
            .filter((r) => {
                const linkId = normalizeLinkedExitIdForReturn(r);
                if (!linkId) return true;
                if (completedLinkedExitIds.has(linkId)) return true;
                if (r.expectedReturnPlanned) return false;
                return true;
            })
            .filter((r) => !completedReturnKeys.has(returnBusinessDedupeKey(r, plateFn(r))))
            .sort((a, b) => returnSortKey(b) - returnSortKey(a)),
        plateFn
    );

    const drSorted = ret.filter((r) => r.status === 'Completed').sort((a, b) => returnSortKey(b) - returnSortKey(a));
    const dr = dedupePendingReturnsByKeyPerRowDay(drSorted, plateFn);

    return [...pr, ...dr].sort((a, b) => returnSortKey(b) - returnSortKey(a));
}
