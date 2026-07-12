/**
 * Multi-franchise access helpers (web + shared semantics with iOS).
 * Source of truth: `users/{uid}.roleScope` (see `roleScope.js`).
 * Backward compatible: missing roleScope => derive from legacy
 *   role/franchiseId/scopeLevel/franchiseMemberships/countryCode.
 */

import {
    resolveRoleScope,
    isGlobalScope,
    isCountryScope,
    userFranchiseIdList,
    canAccessFranchise as canAccessFranchiseFromScope,
    scopeCountryCode,
    legacyScopeLevelFromScope,
} from './roleScope';

const GM_SELECTED_FRANCHISE_KEY = 'gm_selected_franchise';

export function normalizeRoleKey(role) {
    return String(role ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s_-]+/g, '');
}

/** Same franchise permissions as `staff` (e.g. shuttle drivers). */
export function isStaffLikeRole(userProfile) {
    const r = normalizeRoleKey(userProfile?.role);
    return r === 'staff' || r === 'shuttle';
}

/** Platform operator: cross-franchise login and Firestore path override. */
export function isGlobalAdmin(userProfile) {
    if (!userProfile) return false;
    if (isGlobalScope(userProfile)) return true;
    const r = normalizeRoleKey(userProfile.role);
    if (r === 'globaladmin') return true;
    // Legacy: superadmin + isGlobalAdmin flag (migrate to role globaladmin in Firestore)
    if (r === 'superadmin' && userProfile.isGlobalAdmin === true) return true;
    return false;
}

/** Country admin (covers either whole country or selected franchise subset). */
export function isCountryAdmin(userProfile) {
    return isCountryScope(userProfile);
}

/** Resolved (canonical) roleScope for the profile. */
export function profileRoleScope(userProfile) {
    return resolveRoleScope(userProfile);
}

/** @deprecated Use isGlobalAdmin — kept for existing imports */
export function isCrossFranchisePlatformOperator(userProfile) {
    return isGlobalAdmin(userProfile);
}

/** Franchise-scoped admin (former superadmin within one franchise). */
export function isFranchiseAdmin(userProfile) {
    if (!userProfile || isGlobalAdmin(userProfile)) return false;
    const r = normalizeRoleKey(userProfile.role);
    return r === 'admin' || r === 'superadmin';
}

/** Full platform admin sidebar (Franchises, User Management, Roles & Rules, …). */
export function canAccessAdminPanel(userProfile) {
    return isGlobalAdmin(userProfile);
}

/** May open franchise-scoped user management (globaladmin or franchise admin). */
export function canManageFranchiseUsers(userProfile) {
    return isGlobalAdmin(userProfile) || isFranchiseAdmin(userProfile);
}

/** Franchise CRUD and license limits — globaladmin only. */
export function canManageFranchises(userProfile) {
    return isGlobalAdmin(userProfile);
}

/** Roles assignable when creating/editing users (never grant globaladmin from franchise admin). */
export function assignableRolesForActor(actorProfile) {
    if (isGlobalAdmin(actorProfile)) {
        return ['staff', 'shuttle', 'viewer', 'manager', 'admin', 'garage', 'finance_cashier', 'globaladmin'];
    }
    if (isFranchiseAdmin(actorProfile)) {
        return ['staff', 'shuttle', 'viewer', 'manager', 'admin', 'garage', 'finance_cashier'];
    }
    return ['staff', 'shuttle', 'viewer'];
}

export function canAssignRole(actorProfile, targetRole) {
    const key = normalizeRoleKey(targetRole);
    return assignableRolesForActor(actorProfile).includes(key);
}

export function normalizeScopeLevel(profile) {
    // Prefer the canonical roleScope when present.
    if (profile && profile.roleScope && typeof profile.roleScope === 'object') {
        return legacyScopeLevelFromScope(profile);
    }
    const s = String(profile?.scopeLevel ?? 'single')
        .toLowerCase()
        .trim();
    if (s === 'country_all' || s === 'selected' || s === 'single') return s;
    return 'single';
}

/** User may pick a franchise at login and needs Firestore path override (non–globaladmin). */
export function userNeedsLoginFranchiseOverride(userProfile) {
    if (!userProfile || isCrossFranchisePlatformOperator(userProfile)) return false;
    const ids = userFranchiseIdList(userProfile);
    if (ids === null) return true; // country-wide
    if (ids.length > 1) return true; // multi-franchise
    const scope = normalizeScopeLevel(userProfile);
    if (scope === 'country_all') return true;
    const mem = profileFranchiseMembershipKeys(userProfile);
    return mem.length > 0;
}

function profileFranchiseMembershipKeys(userProfile) {
    const mem = userProfile?.franchiseMemberships;
    if (!mem || typeof mem !== 'object') return [];
    return Object.keys(mem).filter((k) => mem[k] === true);
}

/**
 * Resolved franchise for session: login picker (localStorage) or default or primary.
 */
export function resolveSessionFranchiseId(userProfile) {
    if (!userProfile) return 'CH';
    const primary = String(userProfile.franchiseId || '').trim().toUpperCase();
    const def = String(userProfile.defaultFranchiseId || '').trim().toUpperCase();
    const cc = (scopeCountryCode(userProfile) || userProfile.countryCode || 'CH').toUpperCase();
    let stored = '';
    try {
        stored =
            typeof window !== 'undefined'
                ? String(localStorage.getItem(GM_SELECTED_FRANCHISE_KEY) || '').trim().toUpperCase()
                : '';
    } catch {
        stored = '';
    }

    if (!userNeedsLoginFranchiseOverride(userProfile)) {
        // Prefer explicit login franchise (localStorage) when rules allow — matches iOS branch picker.
        if (stored && userCanAccessFranchiseAtLogin(userProfile, stored, cc)) {
            return stored;
        }
        return primary || stored || cc;
    }

    const candidates = [stored, def, primary].filter(Boolean);
    for (const c of candidates) {
        if (userCanAccessFranchiseAtLogin(userProfile, c, cc)) {
            return c;
        }
    }
    // Last resort: pick first franchise from explicit list (country-subset case).
    const list = userFranchiseIdList(userProfile);
    if (Array.isArray(list) && list.length) return list[0];
    return primary || def || cc;
}

/**
 * Login-time check: selected franchise allowed for this profile and country context.
 * @param {string} expectedCountryCode - ISO code from login country picker (e.g. CH, TR)
 */
export function userCanAccessFranchiseAtLogin(userProfile, selectedFranchiseId, expectedCountryCode) {
    if (!userProfile) return false;
    const sel = String(selectedFranchiseId || '').trim().toUpperCase();
    if (!sel) return false;

    if (isCrossFranchisePlatformOperator(userProfile)) return true;

    const expected = String(expectedCountryCode || '').trim().toUpperCase();
    const profileCountry = (scopeCountryCode(userProfile) || '').toUpperCase();
    if (profileCountry !== expected) return false;

    // Use canonical roleScope check first.
    if (canAccessFranchiseFromScope(userProfile, sel)) return true;

    // Legacy fallback: country-root profile id (e.g. TR) with branch franchise doc id (e.g. TR_SAW).
    const primary = String(userProfile.franchiseId || '').trim().toUpperCase();
    if (
        primary &&
        primary.length === 2 &&
        sel.length > primary.length + 1 &&
        sel.startsWith(`${primary}_`)
    ) {
        return true;
    }

    return false;
}

export function normalizeUsernameForStore(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || s.length > 64) return '';
    if (!/^[a-z0-9._-]+$/.test(s)) return '';
    return s;
}

/**
 * In-app / admin list handle: stored `username`, else `firstName` (default handle), else legacy `nickname`.
 */
export function profileDisplayHandle(profile) {
    const u = String(profile?.username ?? '').trim();
    if (u) return u;
    const fn = String(profile?.firstName ?? '').trim();
    if (fn) return fn;
    return String(profile?.nickname ?? '').trim();
}

/**
 * Sanitize optional profile handle (letters/spaces/punctuation; no control chars). Max 64 chars.
 * Used for Firestore `username` (replaces legacy `nickname`).
 */
export function sanitizeProfileUsername(raw) {
    let s = String(raw ?? '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
        .trim()
        .replace(/\s+/g, ' ');
    if (s.length > 64) s = s.slice(0, 64);
    return s;
}

/** Lowercase slug for optional `usernameNormalized` (search / uniqueness) when the handle allows it. */
export function computeUsernameNormalizedForStore(raw) {
    const display = sanitizeProfileUsername(raw);
    if (!display) return '';
    let n = normalizeUsernameForStore(display);
    if (n) return n;
    const collapsed = normalizeUsernameForStore(display.replace(/\s+/g, ''));
    return collapsed || '';
}

/**
 * Patch fields for Firestore `users` when saving the unified username (caller merges into payload).
 * Caller must apply `deleteField()` for null usernameNormalized when using Firebase v9 modular SDK.
 * @param {string} [firstNameFallback] — if `raw` is empty after sanitize, use first name (default username).
 * @returns {{ username: string, usernameNormalized: string|null } | { clearAll: true }}
 */
export function buildProfileUsernameSaveParts(raw, firstNameFallback = '') {
    let display = sanitizeProfileUsername(raw);
    if (!display) {
        display = sanitizeProfileUsername(firstNameFallback);
    }
    if (!display) {
        return { clearAll: true };
    }
    const norm = computeUsernameNormalizedForStore(display);
    return {
        username: display,
        usernameNormalized: norm || null,
    };
}
