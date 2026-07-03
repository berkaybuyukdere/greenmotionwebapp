import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getCollectionRef, getDocRef, isDemoUser } from '../utilities/firebaseHelpers';
import { SESSION_TOKEN_KEY } from '../constants/sessionKeys';
import { db } from './client';

// ===== Module-level auth state for demo routing =====
// Updated whenever auth state changes in the App component.
// Used by collRef/docRefHelper so sub-components don't need user/userProfile props.
export let _currentAuthUser = null;
export let _currentUserProfile = null;
/** When set, global admin reads/writes this franchise's scoped data (see firebaseHelpers). */
export let _franchiseIdOverride = null;

export function emptyFranchiseLegalBundle() {
    return {
        pdfLegalTextTr: '',
        pdfLegalTextEn: '',
        pdfLegalTextCheckoutTr: '',
        pdfLegalTextCheckoutEn: '',
        pdfLegalTextReturnTr: '',
        pdfLegalTextReturnEn: '',
        pdfLegalTextDamageTr: '',
        pdfLegalTextDamageEn: '',
    };
}

export let _franchiseLegalBundle = emptyFranchiseLegalBundle();

/** Mutators — ES module imports are read-only; App.js must use these setters. */
export function setCurrentAuthUser(value) {
    _currentAuthUser = value;
}

export function setCurrentUserProfile(value) {
    _currentUserProfile = value;
}

export function setFranchiseIdOverride(value) {
    _franchiseIdOverride = value;
}

export function setFranchiseLegalBundle(value) {
    _franchiseLegalBundle = value;
}

/** Get a demo-aware collection reference using the current auth state */
export function collRef(baseName) {
    return getCollectionRef(db, baseName, _currentAuthUser, _currentUserProfile, _franchiseIdOverride);
}

/** Get a demo-aware document reference using the current auth state */
export function docRefHelper(baseName, docId) {
    return getDocRef(db, baseName, docId, _currentAuthUser, _currentUserProfile, _franchiseIdOverride);
}

/** Check if the current user is a demo user */
export function isCurrentUserDemo() {
    return isDemoUser(_currentAuthUser, _currentUserProfile);
}

// ─── Concurrent-session management ──────────────────────────────────────────
// Web-only concurrent session guard.
// The iOS app uses a separate field (activeSessionId / isSessionActive) so
// iOS and web sessions are fully independent — a user logged in on iOS can
// open the web without any conflict, and vice-versa.
//
// Each browser session stamps a unique token on users/{uid}.activeSessionToken
// in Firestore and the same value in localStorage. If the tokens differ (new
// login elsewhere, or local storage was cleared while auth persisted), this
// client refreshes its token silently — no modal. Another tab/device that
// still holds the old token is signed out via the onSnapshot listener.
export function generateSessionToken() {
    try {
        return crypto.randomUUID();
    } catch {
        return Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
}

export async function completeLogin(uid) {
    const token = generateSessionToken();
    // Write to localStorage FIRST so the onSnapshot listener that fires
    // immediately after the Firestore write doesn't mistake us for an intruder.
    localStorage.setItem(SESSION_TOKEN_KEY, token);
    await updateDoc(doc(db, 'users', uid), {
        activeSessionToken: token,
        activeSessionAt: serverTimestamp(),
    });
}
// ────────────────────────────────────────────────────────────────────────────
