/**
 * Firebase Demo/Franchise Isolation Helpers
 * 
 * Mirrors the iOS app pattern from FirebaseService.swift:
 * - demo@gmail.com -> demo_{baseName} collections (backward compat)
 * - Other demo users (isDemoAccount: true or email pattern) -> demo_environments/{userId}/{baseName}
 * - Production users -> franchises/{FRANCHISE_ID}/{baseName} collections
 * 
 * Collections that should NOT be demo-routed (shared/global):
 *   users, franchises, plateFormats, protocolTemplates, accidentCodes
 */

import { collection, doc } from 'firebase/firestore';
import { resolveSessionFranchiseId, isGlobalAdmin } from './userAccess';

// Old demo user email (backward compatibility)
const DEMO_USER_EMAIL = 'demo@gmail.com';

// Collections that remain global (not franchise-scoped)
// Keep in sync with iOS FirebaseService.isGlobalCollection (AracHasarKayit).
// NOTE: protocolTemplates is intentionally NOT in this list — templates are
// franchise-scoped so each franchise manages their own set independently.
const GLOBAL_COLLECTIONS = new Set([
    'users',
    'franchises',
    'smtpConfigurations',
    'notifications',
    'outgoingEmails',
    'plateFormats',
    'accidentCodes',
    'fcmTokens',
    'adminTests',
    'adminTestLogs',
]);

function resolveFranchiseId(userProfile) {
    const raw = userProfile?.franchiseId || userProfile?.countryCode || 'CH';
    return String(raw).toUpperCase();
}

/**
 * When userProfile.role is 'globaladmin', optionally route franchise-scoped
 * reads/writes to another franchise (platform support). Ignored for demo users.
 * Firestore rules must still allow the operation (role globaladmin on scoped paths).
 */
function normalizeScopeLevel(profile) {
    const s = String(profile?.scopeLevel ?? 'single')
        .toLowerCase()
        .trim();
    if (s === 'country_all' || s === 'selected' || s === 'single') return s;
    return 'single';
}

function userHasSessionFranchiseOverride(profile) {
    if (!profile) return false;
    const scope = normalizeScopeLevel(profile);
    const mem = profile.franchiseMemberships;
    const hasMem =
        mem &&
        typeof mem === 'object' &&
        Object.keys(mem).some((k) => mem[k] === true);
    return scope === 'country_all' || hasMem;
}

function resolveFranchiseIdForPath(userProfile, franchiseIdOverride) {
    const canOverrideFranchisePath = isGlobalAdmin(userProfile);
    if (
        canOverrideFranchisePath &&
        franchiseIdOverride != null &&
        String(franchiseIdOverride).trim() !== ''
    ) {
        return String(franchiseIdOverride).toUpperCase();
    }
    if (
        userHasSessionFranchiseOverride(userProfile) &&
        franchiseIdOverride != null &&
        String(franchiseIdOverride).trim() !== ''
    ) {
        return String(franchiseIdOverride).toUpperCase();
    }
    // Session franchise (incl. gm_selected_franchise) must drive scoped paths — same as iOS branch context.
    return resolveSessionFranchiseId(userProfile);
}

/** Hide fleet rows that iOS / web soft-delete (isDeleted and/or deletedAt). */
export function isAracSoftDeletedForList(row) {
    if (!row) return true;
    const d = row.isDeleted;
    if (d === true || d === 1 || d === '1' || d === 'true' || d === 'TRUE') return true;
    if (row.deletedAt != null && row.deletedAt !== '') return true;
    return false;
}

/**
 * Check if the current user is a demo user.
 * Matches iOS FirebaseService.isDemoUser logic.
 */
export function isDemoUser(user, userProfile) {
    // Check the Firestore-backed flag (most reliable)
    if (userProfile?.isDemoAccount === true) {
        return true;
    }

    if (!user?.email) return false;
    const email = user.email.toLowerCase();

    // Check email patterns: *_demo@* or demo_*@* or *@demo.example.com
    if (email.includes('_demo@') || email.startsWith('demo_') || email.endsWith('@demo.example.com')) {
        return true;
    }

    // Check old demo email (backward compatibility)
    if (email === DEMO_USER_EMAIL) {
        return true;
    }

    return false;
}

/**
 * Get a Firestore collection reference, routed to the correct collection
 * based on demo status. Mirrors iOS getCollectionReference().
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} baseName - Base collection name (e.g. 'araclar', 'protocols')
 * @param {Object} user - Firebase Auth user object
 * @param {Object} userProfile - User profile from Firestore
 * @param {string} [franchiseIdOverride] - Optional franchise id when role is globaladmin (see resolveFranchiseIdForPath)
 * @returns {CollectionReference}
 */
export function getCollectionRef(db, baseName, user, userProfile, franchiseIdOverride) {
    // Global collections stay top-level for all users
    if (GLOBAL_COLLECTIONS.has(baseName)) {
        return collection(db, baseName);
    }

    if (!isDemoUser(user, userProfile) || !user?.uid) {
        // Production: franchise-scoped collection
        const franchiseId = resolveFranchiseIdForPath(userProfile, franchiseIdOverride);
        return collection(db, 'franchises', franchiseId, baseName);
    }

    const email = user.email?.toLowerCase() || '';

    // Old demo user (demo@gmail.com) uses demo_* prefix for backward compatibility
    if (email === DEMO_USER_EMAIL) {
        return collection(db, `demo_${baseName}`);
    }

    // New demo users: subcollection structure - demo_environments/{userId}/{baseName}
    return collection(db, 'demo_environments', user.uid, baseName);
}

/**
 * Get a Firestore document reference, routed to the correct collection
 * based on demo status. Mirrors iOS pattern.
 * 
 * @param {Firestore} db - Firestore instance
 * @param {string} baseName - Base collection name (e.g. 'protocols', 'vacationTimes')
 * @param {string} docId - Document ID
 * @param {Object} user - Firebase Auth user object
 * @param {Object} userProfile - User profile from Firestore
 * @param {string} [franchiseIdOverride] - Optional franchise id when role is globaladmin
 * @returns {DocumentReference}
 */
export function getDocRef(db, baseName, docId, user, userProfile, franchiseIdOverride) {
    // Global collections stay top-level for all users
    if (GLOBAL_COLLECTIONS.has(baseName)) {
        return doc(db, baseName, docId);
    }

    if (!isDemoUser(user, userProfile) || !user?.uid) {
        // Production: franchise-scoped doc reference
        const franchiseId = resolveFranchiseIdForPath(userProfile, franchiseIdOverride);
        return doc(db, 'franchises', franchiseId, baseName, docId);
    }

    const email = user.email?.toLowerCase() || '';

    // Old demo user (demo@gmail.com) uses demo_* prefix
    if (email === DEMO_USER_EMAIL) {
        return doc(db, `demo_${baseName}`, docId);
    }

    // New demo users: subcollection structure
    return doc(db, 'demo_environments', user.uid, baseName, docId);
}
