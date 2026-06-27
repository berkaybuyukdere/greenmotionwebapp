/**
 * Unified roleScope model (web + iOS source of truth).
 *
 * Firestore `users/{uid}.roleScope = { level, countryCode, franchiseIds }`:
 *   - `level: 'global'`    → globaladmin (bypasses franchise filter)
 *   - `level: 'country'`   → country admin
 *       * `franchiseIds: []` → ALL franchises in `countryCode`
 *       * `franchiseIds: ['TR_X', 'TR_Y']` → selected franchise subset (same country)
 *   - `level: 'franchise'` → single (or multi) franchise (`franchiseIds.length >= 1`)
 *
 * Backward compatibility: when `roleScope` is missing we derive from
 *   legacy `role`/`franchiseId`/`scopeLevel`/`franchiseMemberships`/`countryCode`.
 *
 * `role` is independent: `admin | manager | staff | shuttle | viewer | garage` (and legacy
 * `globaladmin` / `superadmin`). `level === 'global'` is what grants platform
 * superpowers; legacy `role === 'globaladmin'` is still treated as global level.
 */

export const ROLE_SCOPE_LEVELS = ['global', 'country', 'franchise'];

function normalizeFid(value) {
    return String(value ?? '').trim().toUpperCase();
}

function normalizeCountry(value) {
    return String(value ?? '').trim().toUpperCase();
}

function normalizeRoleKey(role) {
    return String(role ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s_-]+/g, '');
}

/** Read possibly-legacy scope from a user profile and produce the canonical shape. */
export function resolveRoleScope(userProfile) {
    if (!userProfile || typeof userProfile !== 'object') {
        return { level: 'franchise', countryCode: '', franchiseIds: [] };
    }
    const role = normalizeRoleKey(userProfile.role);
    const rs = userProfile.roleScope;

    // 1) New-shape roleScope (preferred).
    if (rs && typeof rs === 'object' && typeof rs.level === 'string') {
        const level = ROLE_SCOPE_LEVELS.includes(rs.level) ? rs.level : 'franchise';
        const countryCode = normalizeCountry(rs.countryCode || userProfile.countryCode || '');
        const franchiseIds = Array.isArray(rs.franchiseIds)
            ? Array.from(new Set(rs.franchiseIds.map(normalizeFid).filter(Boolean)))
            : [];
        if (level === 'global') {
            return { level: 'global', countryCode: '', franchiseIds: [] };
        }
        if (level === 'country') {
            return { level: 'country', countryCode, franchiseIds };
        }
        // franchise
        const fallback = normalizeFid(userProfile.franchiseId);
        return {
            level: 'franchise',
            countryCode,
            franchiseIds: franchiseIds.length ? franchiseIds : (fallback ? [fallback] : []),
        };
    }

    // 2) Legacy: globaladmin role implies global level (bypass).
    if (role === 'globaladmin') {
        return { level: 'global', countryCode: '', franchiseIds: [] };
    }
    if (role === 'superadmin' && userProfile.isGlobalAdmin === true) {
        return { level: 'global', countryCode: '', franchiseIds: [] };
    }

    // 3) Legacy scopeLevel + franchiseMemberships.
    const legacyScope = String(userProfile.scopeLevel ?? 'single').toLowerCase().trim();
    const countryCode = normalizeCountry(userProfile.countryCode || '');
    const primary = normalizeFid(userProfile.franchiseId);

    const membershipIds = (() => {
        const m = userProfile.franchiseMemberships;
        if (!m || typeof m !== 'object') return [];
        const out = [];
        for (const [k, v] of Object.entries(m)) {
            if (v === true) {
                const fid = normalizeFid(k);
                if (fid) out.push(fid);
            }
        }
        return out;
    })();

    if (legacyScope === 'country_all') {
        return { level: 'country', countryCode, franchiseIds: [] };
    }
    if (legacyScope === 'selected') {
        const ids = membershipIds.length ? membershipIds : (primary ? [primary] : []);
        return { level: 'country', countryCode, franchiseIds: ids };
    }
    // legacyScope === 'single' (or anything else)
    return {
        level: 'franchise',
        countryCode,
        franchiseIds: primary ? [primary] : [],
    };
}

/** Platform operator (Firestore bypass + Admin UI). */
export function isGlobalScope(userProfile) {
    return resolveRoleScope(userProfile).level === 'global';
}

/** True for country admin (covers selected-subset or whole country). */
export function isCountryScope(userProfile) {
    return resolveRoleScope(userProfile).level === 'country';
}

/** True for a single-franchise (legacy "admin" within one franchise). */
export function isSingleFranchiseScope(userProfile) {
    const scope = resolveRoleScope(userProfile);
    return scope.level === 'franchise' && scope.franchiseIds.length <= 1;
}

/** ISO country code stored on the scope (or legacy profile.countryCode). */
export function scopeCountryCode(userProfile) {
    const scope = resolveRoleScope(userProfile);
    return scope.countryCode || normalizeCountry(userProfile?.countryCode);
}

/**
 * Resolve the list of franchises a user may operate on.
 * Returns `null` when the level is `country` AND `franchiseIds` is empty
 * (= entire country — concrete list is computed against the franchises collection).
 * Returns the explicit list for `country` (subset) or `franchise`.
 * Returns `null` for `global` (everything).
 */
export function userFranchiseIdList(userProfile) {
    const scope = resolveRoleScope(userProfile);
    if (scope.level === 'global') return null;
    if (scope.level === 'country' && scope.franchiseIds.length === 0) return null;
    return scope.franchiseIds.slice();
}

/**
 * Membership check used by the login franchise picker and runtime guards.
 * @param {string[]|null} countryFranchises - All franchise ids in the user's countryCode
 *   (optional; pass for accurate "country-wide" expansion). When null, only the
 *   explicit list / global is considered.
 */
export function canAccessFranchise(userProfile, franchiseId, countryFranchises = null) {
    const scope = resolveRoleScope(userProfile);
    if (scope.level === 'global') return true;
    const target = normalizeFid(franchiseId);
    if (!target) return false;
    if (scope.level === 'franchise') {
        return scope.franchiseIds.map(normalizeFid).includes(target);
    }
    // country
    if (scope.franchiseIds.length === 0) {
        if (Array.isArray(countryFranchises)) {
            return countryFranchises.map(normalizeFid).includes(target);
        }
        // Without a franchise list, accept any fid that *starts with* the country
        // (covers `TR_XYZ` under `TR` for legacy compatibility — Firestore rules
        // still enforce the doc.countryCode match).
        const cc = normalizeCountry(scope.countryCode);
        if (!cc) return false;
        return target === cc || target.startsWith(`${cc}_`);
    }
    return scope.franchiseIds.map(normalizeFid).includes(target);
}

/** Legacy `franchiseMemberships` map derived from the resolved scope. */
export function franchiseMembershipsMapFromScope(userProfile) {
    const scope = resolveRoleScope(userProfile);
    if (scope.level === 'global') return null;
    if (scope.level === 'country' && scope.franchiseIds.length === 0) return null;
    const ids = scope.franchiseIds;
    if (ids.length <= 1) return null;
    const map = {};
    for (const fid of ids) map[normalizeFid(fid)] = true;
    return map;
}

/** Legacy `scopeLevel` string derived from the resolved scope (for backward compat). */
export function legacyScopeLevelFromScope(userProfile) {
    const scope = resolveRoleScope(userProfile);
    if (scope.level === 'global') return 'country_all';
    if (scope.level === 'country' && scope.franchiseIds.length === 0) return 'country_all';
    if (scope.level === 'country') return 'selected';
    return scope.franchiseIds.length > 1 ? 'selected' : 'single';
}

/** Default franchiseId stored on the user doc (login picker fallback). */
export function defaultFranchiseIdFromScope(userProfile) {
    const scope = resolveRoleScope(userProfile);
    if (scope.level === 'global') return '';
    if (scope.franchiseIds.length) return normalizeFid(scope.franchiseIds[0]);
    return scope.countryCode || '';
}

/**
 * Validate a candidate roleScope (for callable input or admin UI).
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function validateRoleScopeInput(input, { knownFranchises = null } = {}) {
    if (input == null || typeof input !== 'object') {
        return { ok: false, error: 'roleScope must be an object' };
    }
    const level = String(input.level || '').toLowerCase().trim();
    if (!ROLE_SCOPE_LEVELS.includes(level)) {
        return { ok: false, error: `roleScope.level must be one of ${ROLE_SCOPE_LEVELS.join('/')}` };
    }
    if (level === 'global') {
        return { ok: true, value: { level: 'global', countryCode: '', franchiseIds: [] } };
    }

    const countryCode = normalizeCountry(input.countryCode);
    if (!countryCode || countryCode.length < 2 || countryCode.length > 8) {
        return { ok: false, error: 'roleScope.countryCode required for country/franchise level' };
    }

    const rawIds = Array.isArray(input.franchiseIds) ? input.franchiseIds : [];
    const franchiseIds = Array.from(new Set(rawIds.map(normalizeFid).filter(Boolean)));

    if (level === 'franchise') {
        if (franchiseIds.length === 0) {
            return { ok: false, error: 'roleScope.franchiseIds required for level=franchise' };
        }
    }
    if (knownFranchises && knownFranchises.length) {
        const knownMap = new Map(knownFranchises.map((f) => [normalizeFid(f.franchiseId || f.id), f]));
        for (const fid of franchiseIds) {
            const f = knownMap.get(fid);
            if (!f) {
                return { ok: false, error: `franchiseId ${fid} not found` };
            }
            const fc = normalizeCountry(f.countryCode);
            if (fc && fc !== countryCode) {
                return { ok: false, error: `franchiseId ${fid} belongs to ${fc}, expected ${countryCode}` };
            }
        }
    }
    return { ok: true, value: { level, countryCode, franchiseIds } };
}
