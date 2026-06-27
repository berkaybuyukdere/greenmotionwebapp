/** Per-user, per-franchise KPI snapshot for instant dashboard paint (derived numbers only). */
const KEY_PREFIX = 'gm_dash_kpi_v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(uid, franchiseId) {
    return `${KEY_PREFIX}:${String(uid)}:${String(franchiseId || 'CH').toUpperCase()}`;
}

export function readDashboardBootstrap(uid, franchiseId) {
    if (!uid || typeof window === 'undefined') return null;
    try {
        const raw = sessionStorage.getItem(cacheKey(uid, franchiseId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const age = Date.now() - Number(parsed.savedAt || 0);
        if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_MS) return null;
        return parsed.kpis || null;
    } catch {
        return null;
    }
}

export function writeDashboardBootstrap(uid, franchiseId, kpis) {
    if (!uid || !kpis || typeof window === 'undefined') return;
    try {
        sessionStorage.setItem(
            cacheKey(uid, franchiseId),
            JSON.stringify({ savedAt: Date.now(), kpis }),
        );
    } catch {
        /* quota / private mode */
    }
}

export function clearDashboardBootstrapForUser(uid) {
    if (!uid || typeof window === 'undefined') return;
    try {
        const prefix = `${KEY_PREFIX}:${String(uid)}:`;
        const toRemove = [];
        for (let i = 0; i < sessionStorage.length; i += 1) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach((k) => sessionStorage.removeItem(k));
    } catch {
        /* ignore */
    }
}
