import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
    deleteDoc,
    deleteField,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    setDoc,
    Timestamp,
    updateDoc,
    where,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getAuth } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { getCollectionRef } from '../utilities/firebaseHelpers';
import { SITE_URL } from '../constants/siteBrand';
import { motion } from 'framer-motion';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Car, Check, CheckCircle, ChevronLeft, ChevronRight, Clock, Copy, FileSpreadsheet, FileText, IdCard, Link2, Mail, MapPin, Pencil, Phone, Plus, Search, Share2, Trash2, Upload, User, X } from 'lucide-react';
import { useToast } from './ToastNotification';
import { UnifiedDatePicker } from './UnifiedDatePicker';
import {
    buildPhoneForSave,
    CountryScrollSelect,
    hydratePhoneFieldsFromRow,
    IntlPhoneFields,
    useCountryRows,
} from './FrontDeskIntlFields';
import { normalizeNavForDedupe } from '../utilities/operationsDedupe';
import {
    buildRememberPayloadFromStaffForm,
    customerRememberDocId,
    mergeRememberIntoFormState,
} from '../utilities/frontDeskRemember';
import {
    displayTitleForStoredKey,
    loadTurkeyGarageBranches,
    matchingBranchStorageKey,
} from '../utilities/turkeyGarageBranches';
import { resolveOperationalFranchiseId } from '../utilities/franchiseIdResolve';
import { resolveSessionFranchiseId } from '../utilities/userAccess';
import {
    StripeCustomerCell,
    StripeStatusBadge,
    mapFrontDeskStatusBadge,
} from './StripeListUI';

/** Single optional ID field (TC or passport); legacy rows may still have split fields. */
function nationalIdFromStoredRow(row) {
    const direct = String(row?.customerNationalId || row?.nationalId || '').trim();
    if (direct) return direct.slice(0, 64);
    const tc = String(row?.tcKimlikNo || '').replace(/\D/g, '').slice(0, 11);
    if (tc) return tc;
    return String(row?.passportNumber || '').trim().slice(0, 64);
}

/** Staff form — Palantir / ERP dark shell (matches app theme). */
const FD_FORM_FIELD =
    'w-full px-3 py-2.5 rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)] text-[15px] text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)] focus:outline-none focus:border-[var(--erpx-brand)]';
const FD_FORM_SECTION =
    'rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-[var(--erpx-shadow-sm)]';
const FD_DATE_ROW = 'grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_7.5rem] gap-3 items-end';
const FD_LABEL = 'block text-[13px] font-medium mb-1 text-[var(--erpx-ink-secondary)]';
const FD_LABEL_SM = 'block text-[12px] font-medium mb-1 text-[var(--erpx-ink-secondary)]';
const FD_HINT = 'text-[12px] text-[var(--erpx-ink-muted)] leading-snug';
const FD_SECTION_TITLE =
    'text-[11px] font-semibold uppercase tracking-wide text-[var(--erpx-ink-muted)] mb-2 px-0.5';
const FD_SUBSECTION = 'rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-subtle)] p-4';

function displayName(row) {
    const first = String(row.firstName || '').trim();
    const family = String(row.familyName || row.lastName || '').trim();
    const merged = [first, family].filter(Boolean).join(' ').trim();
    return merged || row.fullName || 'Unnamed';
}

function buildKioskUrl(franchiseId) {
    const fid = String(franchiseId || 'CH').trim().toUpperCase() || 'CH';
    const base = (typeof window !== 'undefined' && window.location?.origin?.includes('vehiclesentinel'))
        ? window.location.origin
        : SITE_URL.replace(/\/$/, '');
    return `${base}/front-desk?franchise=${encodeURIComponent(fid)}`;
}

function statusLabel(row) {
    return row.status === 'completed' ? 'Done' : 'Pending';
}

function timestampToDate(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') {
        try {
            const d = ts.toDate();
            return Number.isNaN(d.getTime()) ? null : d;
        } catch {
            /* fall through */
        }
    }
    const sec = ts.seconds ?? ts._seconds;
    if (sec != null) return new Date(sec * 1000);
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
}

function toDayInputValue(date) {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function parseDayInput(value) {
    if (!value) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function digitsOnlyNav(value) {
    return String(value || '').replace(/\D/g, '');
}

/** Optional fleet fields (iOS / Firestore may use different keys). */
function pickFleetDepositAmount(car) {
    if (!car || typeof car !== 'object') return null;
    const raw =
        car.depositAmount ??
        car.depozitTutari ??
        car.depozit ??
        car.deposit ??
        car.securityDeposit ??
        car.guaranteeAmount;
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    const n = parseFloat(String(raw).replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function parseVehicleDepositInput(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const n = parseFloat(s.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

function isTurkeyFranchiseId(franchiseId) {
    return String(franchiseId || '').toUpperCase().startsWith('TR');
}

const SWISS_FD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function isSwissFranchiseId(franchiseId) {
    return /^CH/i.test(String(franchiseId || '').trim());
}

function millisFromFirestoreTimestamp(ts) {
    const d = timestampToDate(ts);
    return d ? d.getTime() : null;
}

/** CH* franchises: kiosk intake rows are auto-purged after 7 days (see Cloud Function). */
function swissFrontDeskRetentionFieldsForNewIntake(franchiseId) {
    if (!isSwissFranchiseId(franchiseId)) return {};
    return {
        retentionExpiresAt: Timestamp.fromMillis(Date.now() + SWISS_FD_RETENTION_MS),
        swissFrontDeskRetentionPolicy: 'CH-FADP-INTAKE-7D',
    };
}

function swissFrontDeskRetentionFieldsForBackfill(franchiseId, existingRow) {
    if (!isSwissFranchiseId(franchiseId) || !existingRow || existingRow.retentionExpiresAt) return {};
    const base =
        millisFromFirestoreTimestamp(existingRow.submittedAt) ||
        millisFromFirestoreTimestamp(existingRow.createdAt) ||
        Date.now();
    return {
        retentionExpiresAt: Timestamp.fromMillis(base + SWISS_FD_RETENTION_MS),
        swissFrontDeskRetentionPolicy: 'CH-FADP-INTAKE-7D',
    };
}

function normalizeExitStatus(row) {
    const raw = String(row?.status || row?.durum || '')
        .trim()
        .toLowerCase();
    if (raw === 'completed' || raw === 'done') return 'Completed';
    if (raw === 'parked') return 'Parked';
    return 'In Progress';
}

function deterministicPendingExitDocId(fid, aracIdStr, navDigits) {
    return `fd-${String(fid || 'CH').toUpperCase()}-${String(aracIdStr || '').trim()}-${String(navDigits || '').trim()}`;
}

function isUuidString(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

/** Same shape as Cloud Function `dedupeKey` for frontDeskCustomers. */
function buildFrontDeskDedupeKey(franchiseId, phone, submittedAtMillis) {
    const day = new Date(submittedAtMillis).toISOString().slice(0, 10);
    const digits = digitsOnlyNav(phone);
    return `${franchiseId}|${digits}|${day}`;
}

function toTimeInputValue(date) {
    if (!date || !(date instanceof Date) || Number.isNaN(date.getTime())) return '12:00';
    const h = date.getHours();
    const m = date.getMinutes();
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Combine yyyy-mm-dd + HH:mm (local) */
function combineDayAndTime(dayStr, timeStr) {
    const d = parseDayInput(dayStr);
    if (!d) return null;
    const raw = String(timeStr || '12:00').trim();
    const parts = raw.split(':');
    const hh = parseInt(parts[0], 10);
    const mm = parseInt(parts[1] != null ? parts[1] : '0', 10);
    const h = Number.isFinite(hh) ? Math.min(23, Math.max(0, hh)) : 12;
    const mi = Number.isFinite(mm) ? Math.min(59, Math.max(0, mm)) : 0;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, mi, 0, 0);
}

function fuelEighthsToYakitString(eighths) {
    const n = parseInt(String(eighths ?? ''), 10);
    if (!Number.isFinite(n) || n < 1 || n > 8) return null;
    return `${n}/8`;
}

function normalizeRoleKey(role) {
    return String(role ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s_-]+/g, '');
}

/** Matches Firestore rules for frontDeskCustomers manage permissions. */
function canManageFrontDeskCustomers(userProfile) {
    const r = normalizeRoleKey(userProfile?.role);
    return r === 'staff' || r === 'shuttle' || r === 'manager' || r === 'admin' || r === 'superadmin' || r === 'globaladmin';
}

/**
 * When `linkedExitId` is missing or stale, reuse an existing In Progress exit for the same vehicle + NAV
 * instead of creating a duplicate row (matches iOS Operations weak dedupe).
 */
/** Kiosk/staff GRT fields → iOS `ExitIslemi` rental-terms keys. */
function kioskTermsFieldsForExit(row) {
    const pdf = String(row?.kioskRentalTermsPdfUrl || '').trim();
    if (!pdf) return {};
    const lang = String(row?.kioskRentalTermsLanguage || 'tr').trim().toLowerCase() === 'en' ? 'en' : 'tr';
    const signedAt = row?.kioskRentalTermsSignedAt || null;
    return {
        trRentalTermsSignatureURL: pdf,
        trRentalTermsLanguage: lang,
        trRentalTermsAcceptedAt: signedAt || Timestamp.now(),
    };
}

/** Push national ID + kiosk GRT from front desk row onto the linked pending exit (iOS checkout). */
async function patchLinkedExitFromFrontDeskRow(exitColl, linkedExitId, mergedRow) {
    const exitId = String(linkedExitId || '').trim();
    if (!exitId) return;
    const nationalId = nationalIdFromStoredRow(mergedRow);
    const termsFields = kioskTermsFieldsForExit(mergedRow);
    if (!nationalId && !termsFields.trRentalTermsSignatureURL) return;
    try {
        await updateDoc(doc(exitColl, exitId), {
            ...(nationalId ? { customerNationalId: nationalId } : {}),
            ...termsFields,
        });
    } catch (e) {
        console.warn('[FrontDesk] patchLinkedExitFromFrontDeskRow failed:', e?.message || e);
    }
}

async function softDeleteExitDoc(exitColl, exitId, user) {
    const id = String(exitId || '').trim();
    if (!id) return;
    try {
        const ref = doc(exitColl, id);
        const snap = await getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data() || {};
        if (data.isDeleted) return;
        await updateDoc(ref, {
            isDeleted: true,
            deletedAt: Timestamp.now(),
            deletedBy: user?.uid || null,
        });
    } catch (e) {
        console.warn('[FrontDesk] softDeleteExitDoc failed:', e?.message || e);
    }
}

/** Pending exit already tied to this front-desk row (prevents cross-customer reuse). */
async function findExitIdByLinkedFrontDeskCustomer(exitColl, frontDeskDocId, aracIdStr) {
    const fdId = String(frontDeskDocId || '').trim();
    if (!fdId) return null;
    try {
        const q = query(exitColl, where('linkedFrontDeskCustomerId', '==', fdId), limit(20));
        const snap = await getDocs(q);
        let bestId = null;
        let bestCreated = -1;
        for (const d of snap.docs) {
            const data = d.data() || {};
            if (data.isDeleted) continue;
            if (aracIdStr && String(data.aracId || '').trim() !== aracIdStr) continue;
            const st = normalizeExitStatus(data);
            if (st !== 'In Progress' && st !== 'Parked') continue;
            let created = 0;
            if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
                created = data.createdAt.toMillis();
            } else if (data.createdAt?.seconds != null) {
                created = data.createdAt.seconds * 1000;
            }
            if (created >= bestCreated) {
                bestCreated = created;
                bestId = d.id;
            }
        }
        return bestId;
    } catch (e) {
        console.warn('[FrontDesk] findExitIdByLinkedFrontDeskCustomer failed:', e?.message || e);
        return null;
    }
}

async function findReusablePendingExitId(exitColl, aracIdStr, navDigits, excludeFrontDeskId = null) {
    const targetNav = digitsOnlyNav(navDigits);
    if (!aracIdStr || !targetNav) return null;
    try {
        const q = query(exitColl, where('aracId', '==', aracIdStr), limit(50));
        const snap = await getDocs(q);
        let bestId = null;
        let bestCreated = -1;
        for (const d of snap.docs) {
            const data = d.data();
            if (data.isDeleted) continue;
            const linkedFd = String(data.linkedFrontDeskCustomerId || '').trim();
            if (excludeFrontDeskId && linkedFd && linkedFd !== excludeFrontDeskId) continue;
            const st = normalizeExitStatus(data);
            if (st !== 'In Progress' && st !== 'Parked') continue;
            const navKey = normalizeNavForDedupe({ resKodu: data.resKodu, navKodu: data.navKodu });
            if (navKey !== targetNav) continue;
            let created = 0;
            if (data.createdAt && typeof data.createdAt.toMillis === 'function') {
                created = data.createdAt.toMillis();
            } else if (data.createdAt?.seconds != null) {
                created = data.createdAt.seconds * 1000;
            }
            if (created >= bestCreated) {
                bestCreated = created;
                bestId = d.id;
            }
        }
        return bestId;
    } catch (e) {
        console.warn('[FrontDesk] findReusablePendingExitId failed:', e?.message || e);
        return null;
    }
}

/**
 * Creates or updates franchises/.../exitIslemleri so iOS "Check Out Processes" shows a pending (orange) row.
 * Matches ExitIslemi (Swift): status "In Progress", NAV-prefixed codes for TR, same shape as iOS saves.
 */
async function upsertPendingExitForTurkeyHandover({
    db,
    user,
    userProfile,
    franchiseIdOverride,
    handoverFranchiseId,
    frontDeskDocId,
    editingRow,
    car,
    handoverPayload,
    firstName,
    familyName,
    email,
}) {
    const exitPathFranchiseId = String(handoverFranchiseId || franchiseIdOverride || '')
        .trim()
        .toUpperCase();
    const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, exitPathFranchiseId);
    const navDigits = String(handoverPayload.handoverNavKodu || '').trim();
    const navDisplay = navDigits ? `NAV-${navDigits}` : '';
    const aracIdStr = String(handoverPayload.handoverAracId || '').trim();
    const plaka = String(car.plaka || '').trim();
    const custFirst = String(firstName || '').trim();
    const custLast = String(familyName || '').trim();
    const fid = String(handoverFranchiseId || 'CH').toUpperCase();
    if (!isTurkeyFranchiseId(fid)) {
        throw new Error('Front-desk pending checkout handover is Turkey-only.');
    }
    const yakitStr = fuelEighthsToYakitString(handoverPayload.handoverFuelEighths);
    const branchStr =
        String(handoverPayload.handoverPickupBranch || handoverPayload.handoverExitBranch || '').trim() || null;
    const dropStr =
        String(handoverPayload.handoverDropoffBranch || '').trim() || null;
    const kmNum = (() => {
        const k = handoverPayload.handoverKm;
        if (k == null || k === '') return null;
        const n = Number(k);
        return Number.isFinite(n) ? n : null;
    })();
    const fdDocId = String(frontDeskDocId || '').trim();
    const termsFields = kioskTermsFieldsForExit(editingRow);
    const existingId = editingRow?.linkedExitId ? String(editingRow.linkedExitId).trim() : '';

    const updateFields = {
        aracId: aracIdStr,
        aracPlaka: plaka,
        resKodu: navDisplay,
        navKodu: navDisplay || null,
        customerFirstName: custFirst || null,
        customerLastName: custLast || null,
        customerEmail: email || null,
        customerNationalId: nationalIdFromStoredRow(editingRow) || null,
        exitTarihi: handoverPayload.plannedCheckoutAt,
        plannedCheckinAt: handoverPayload.plannedCheckinAt ?? null,
        km: kmNum,
        yakitSeviyesi: yakitStr,
        bayiAdi: branchStr,
        pickUpBranch: branchStr,
        dropOffBranch: dropStr,
        franchiseId: fid,
        notlar: '',
        ...(fdDocId ? { linkedFrontDeskCustomerId: fdDocId } : {}),
        ...termsFields,
    };

    const patchExistingPendingExit = async (targetId, existingData) => {
        const targetRef = doc(exitColl, targetId);
        if (isUuidString(targetId)) {
            await updateDoc(targetRef, {
                id: targetId,
                ...updateFields,
            });
            return targetId;
        }
        const migratedId =
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        await setDoc(doc(exitColl, migratedId), {
            ...existingData,
            id: migratedId,
            ...updateFields,
            createdAt: existingData.createdAt || Timestamp.now(),
            fotograflar: Array.isArray(existingData.fotograflar) ? existingData.fotograflar : [],
            status: normalizeExitStatus(existingData),
        }, { merge: true });
        await updateDoc(targetRef, {
            isDeleted: true,
            deletedAt: Timestamp.now(),
            deletedBy: user?.uid || null,
        });
        return migratedId;
    };

    const byFdId = await findExitIdByLinkedFrontDeskCustomer(exitColl, fdDocId, aracIdStr);
    if (byFdId) {
        const byFdRef = doc(exitColl, byFdId);
        const byFdSnap = await getDoc(byFdRef);
        if (byFdSnap.exists()) {
            const byFdData = byFdSnap.data() || {};
            if (!byFdData.isDeleted) {
                const st = normalizeExitStatus(byFdData);
                if (st === 'In Progress' || st === 'Parked') {
                    return patchExistingPendingExit(byFdId, byFdData);
                }
            }
        }
    }

    if (existingId) {
        const existingRef = doc(exitColl, existingId);
        const snap = await getDoc(existingRef);
        if (snap.exists()) {
            const existingData = snap.data() || {};
            if (existingData.isDeleted) {
                // fall through — never resurrect a deleted checkout
            } else if (String(existingData.aracId || '').trim() === aracIdStr) {
                const st = normalizeExitStatus(existingData);
                if (st === 'In Progress' || st === 'Parked') {
                    return patchExistingPendingExit(existingId, existingData);
                }
            }
        }
    }

    const reuseId = await findReusablePendingExitId(exitColl, aracIdStr, navDigits, fdDocId);
    if (reuseId) {
        const reuseRef = doc(exitColl, reuseId);
        const reuseSnap = await getDoc(reuseRef);
        const reuseData = reuseSnap.exists() ? (reuseSnap.data() || {}) : {};
        return patchExistingPendingExit(reuseId, reuseData);
    }

    const newId =
        typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const qrToken =
        typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : newId;
    const nationalIdForNewExit = nationalIdFromStoredRow(editingRow) || null;

    // Single-doc transactional create: protects against staff double-tap creating
    // two pending exits for the same NAV/vehicle while still letting us write all
    // fields up-front (no read needed because newId is freshly generated).
    const newDocRef = doc(exitColl, newId);
    await runTransaction(exitColl.firestore, async (tx) => {
        const existingSnap = await tx.get(newDocRef);
        if (existingSnap.exists()) {
            // Extremely unlikely (random UUID collision) — merge instead of crash.
            tx.update(newDocRef, {
                id: newId,
                ...updateFields,
                customerNationalId: nationalIdForNewExit,
            });
            return;
        }
        tx.set(newDocRef, {
            id: newId,
            aracId: aracIdStr,
            aracPlaka: plaka,
            exitTarihi: handoverPayload.plannedCheckoutAt,
            plannedCheckinAt: handoverPayload.plannedCheckinAt ?? null,
            createdAt: Timestamp.now(),
            fotograflar: [],
            notlar: '',
            resKodu: navDisplay,
            navKodu: navDisplay || null,
            km: kmNum,
            yakitSeviyesi: yakitStr,
            bayiAdi: branchStr,
            pickUpBranch: branchStr,
            dropOffBranch: dropStr,
            customerFirstName: custFirst || null,
            customerLastName: custLast || null,
            customerEmail: email || null,
            customerNationalId: nationalIdForNewExit,
            customerSignatureURL: null,
            checkoutEmailSentAt: null,
            checkoutEmailLastStatus: null,
            checkoutEmailRecipient: null,
            qrToken,
            status: 'In Progress',
            createdBy: user?.uid || null,
            assistantCompanyName: car.assistantCompanyName ?? null,
            assistantCompanyPhone: car.assistantCompanyPhone ?? null,
            franchiseId: fid,
            ...(fdDocId ? { linkedFrontDeskCustomerId: fdDocId } : {}),
            ...termsFields,
        });
    });
    return newId;
}

function kioskRentalTermsStoragePath(row, franchiseId) {
    const stored = String(row?.kioskRentalTermsPdfStoragePath || '').trim();
    if (stored) return stored;
    const gs = String(row?.kioskRentalTermsPdfUrl || '').trim();
    if (gs.startsWith('gs://')) {
        const rest = gs.slice('gs://'.length);
        const slash = rest.indexOf('/');
        if (slash > 0) return rest.slice(slash + 1);
    }
    const docId = String(row?.id || '').trim();
    const fid = String(franchiseId || '').trim();
    if (docId && fid) return `franchises/${fid}/kiosk-rental-terms/${docId}.pdf`;
    return '';
}

/** Open kiosk-signed GRT (Storage SDK first, then Cloud Function fallback). */
function KioskRentalTermsOpenButton({
    franchiseId,
    customerDocId,
    customerRow = null,
    storage = null,
    functionsApp = null,
    className = '',
}) {
    const { error: toastError } = useToast();
    const [loading, setLoading] = useState(false);

    const openPdf = async () => {
        const fid = String(franchiseId || '').trim();
        const docId = String(customerDocId || '').trim();
        if (!fid || !docId) {
            toastError('Cannot open signed rental terms.');
            return;
        }
        setLoading(true);
        try {
            const row = customerRow || { id: docId };
            const objectPath = kioskRentalTermsStoragePath(row, fid);
            if (storage && objectPath) {
                try {
                    const url = await getDownloadURL(ref(storage, objectPath));
                    if (url) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                        return;
                    }
                } catch (storageErr) {
                    console.warn('[FrontDesk] storage getDownloadURL', storageErr);
                }
            }
            if (!functionsApp) {
                throw new Error('Signed rental terms could not be opened.');
            }
            const fn = httpsCallable(functionsApp, 'getKioskRentalTermsSignedUrl');
            const res = await fn({ franchiseId: fid, customerDocId: docId });
            const url = String(res?.data?.signedUrl || '').trim();
            if (!url) throw new Error('No download URL returned');
            window.open(url, '_blank', 'noopener,noreferrer');
        } catch (e) {
            console.warn('[FrontDesk] open kiosk GRT', e);
            toastError(
                e?.message ||
                    'Signed General Rental Terms not found. Customer must complete signing on the kiosk.'
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <button
            type="button"
            onClick={() => void openPdf()}
            disabled={loading}
            className={
                className ||
                'text-[14px] text-[#0A84FF] hover:underline font-medium disabled:opacity-50'
            }
        >
            {loading ? 'Opening…' : 'Open signed PDF'}
        </button>
    );
}

export function FrontDeskCustomersView({
    db,
    storage,
    user,
    userProfile,
    franchiseIdOverride = null,
    cars = [],
    effectiveFranchiseId: effectiveFranchiseIdProp = null,
    functionsApp = null,
}) {
    const { error: toastError, success: toastSuccess } = useToast();
    const { rows: countryRows, loading: countriesLoading } = useCountryRows();
    const [rows, setRows] = useState([]);
    const [filter, setFilter] = useState('all');
    const [editing, setEditing] = useState(null);
    /** Staff-created row (same form as edit; persisted with setDoc + staff metadata). */
    const [isCreatingNew, setIsCreatingNew] = useState(false);
    const [formState, setFormState] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [detailRow, setDetailRow] = useState(null);
    const [kioskCopied, setKioskCopied] = useState(false);
    const [statusUpdatingId, setStatusUpdatingId] = useState(null);
    const [bulkMode, setBulkMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState([]);
    const [bulkDeleting, setBulkDeleting] = useState(false);
    const [detailDeleting, setDetailDeleting] = useState(false);
    /** `yyyy-mm-dd` local day, or '' = no day filter */
    const [filterCalendarDay, setFilterCalendarDay] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const editInitialSnapshotRef = useRef(null);
    const prevCountryRowsLenRef = useRef(null);
    const webDocUploadRef = useRef(null);
    const webDocUploadCategoryRef = useRef(null);
    const [webDocUploadingCategory, setWebDocUploadingCategory] = useState(null);
    const [webDocUploading, setWebDocUploading] = useState(false);

    const [showKioskLegalEditor, setShowKioskLegalEditor] = useState(false);
    const [franchiseLegalDraft, setFranchiseLegalDraft] = useState({
        termsConditionsTr: '',
        termsConditionsEn: '',
        termsConditionsDe: '',
        privacyPolicyTr: '',
        privacyPolicyEn: '',
        privacyPolicyDe: '',
    });
    const [franchiseLegalSaving, setFranchiseLegalSaving] = useState(false);
    const [turkeyGarageBranches, setTurkeyGarageBranches] = useState([]);
    const [turkeyBranchesLoading, setTurkeyBranchesLoading] = useState(false);

    /** Single franchise key for kiosk URL, Firestore listener, and handover — must match. */
    const operationalFranchiseId = useMemo(
        () =>
            resolveOperationalFranchiseId(
                effectiveFranchiseIdProp ||
                    franchiseIdOverride ||
                    resolveSessionFranchiseId(userProfile)
            ),
        [effectiveFranchiseIdProp, franchiseIdOverride, userProfile]
    );

    const collRef = useMemo(
        () => getCollectionRef(db, 'frontDeskCustomers', user, userProfile, operationalFranchiseId),
        [db, user, userProfile, operationalFranchiseId]
    );

    const kioskFranchiseId = operationalFranchiseId;
    const handoverFranchiseId = operationalFranchiseId;

    const isTurkeyHandover = handoverFranchiseId.startsWith('TR');

    const kioskUrl = useMemo(() => buildKioskUrl(kioskFranchiseId), [kioskFranchiseId]);

    const canManage = useMemo(() => canManageFrontDeskCustomers(userProfile), [userProfile]);

    const readRememberCustomerDefault = useCallback(() => {
        try {
            return typeof window !== 'undefined' && window.localStorage.getItem('gm_frontdesk_remember_customer') !== '0';
        } catch {
            return true;
        }
    }, []);

    const upsertRememberedCustomerIfEnabled = useCallback(
        async (franchiseUpper, state, phoneBuilt) => {
            if (!state || state.rememberCustomer === false) return;
            const payload = buildRememberPayloadFromStaffForm(franchiseUpper, state, phoneBuilt);
            if (!payload) return;
            const ref = doc(db, 'franchises', franchiseUpper, 'customerContactRemember', customerRememberDocId(payload.email));
            await setDoc(ref, { ...payload, updatedAt: Timestamp.now() }, { merge: true });
        },
        [db]
    );

    const tryAutofillRememberedCustomer = useCallback(
        async (emailRaw) => {
            const em = String(emailRaw || '').trim().toLowerCase();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return;
            const fid = String(handoverFranchiseId || '').toUpperCase();
            if (!fid) return;
            try {
                const ref = doc(db, 'franchises', fid, 'customerContactRemember', customerRememberDocId(em));
                const snap = await getDoc(ref);
                if (!snap.exists()) return;
                const d = snap.data() || {};
                setFormState((prev) => {
                    if (!prev) return prev;
                    const merged = mergeRememberIntoFormState(prev, d);
                    if (JSON.stringify(merged) === JSON.stringify(prev)) return prev;
                    return merged;
                });
            } catch (e) {
                console.warn('[FrontDesk] remember autofill', e);
            }
        },
        [db, handoverFranchiseId]
    );

    useEffect(() => {
        if (!formState || (!isCreatingNew && !editing)) return undefined;
        const em = String(formState.email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.toLowerCase())) return undefined;
        const t = window.setTimeout(() => {
            void tryAutofillRememberedCustomer(em);
        }, 650);
        return () => window.clearTimeout(t);
    }, [formState?.email, isCreatingNew, editing, tryAutofillRememberedCustomer]);

    const vehicleCandidates = useMemo(() => {
        const q = String(formState?.vehicleSearchQuery || '').trim().toLowerCase();
        const list = cars || [];
        if (!q) return list.slice(0, 15);
        const words = q.split(/\s+/).filter(Boolean);
        return list
            .filter((c) => {
                const blob = [c.plaka, c.marka, c.model, c.kategori].filter(Boolean).join(' ').toLowerCase();
                return words.every((w) => blob.includes(w));
            })
            .slice(0, 15);
    }, [cars, formState?.vehicleSearchQuery]);

    const selectedHandoverCar = useMemo(() => {
        if (!formState?.handoverVehicleId) return null;
        return (cars || []).find((c) => String(c.id || c.documentId) === String(formState.handoverVehicleId)) || null;
    }, [cars, formState?.handoverVehicleId]);

    useEffect(() => {
        if (!canManage) {
            setBulkMode(false);
            setSelectedIds([]);
        }
    }, [canManage]);

    useEffect(() => {
        const len = countryRows.length;
        if (prevCountryRowsLenRef.current === null) {
            prevCountryRowsLenRef.current = len;
            return;
        }
        const prevLen = prevCountryRowsLenRef.current;
        prevCountryRowsLenRef.current = len;
        if (prevLen !== 0 || len === 0 || !editing?.id) return;
        setFormState((fs) => {
            if (!fs) return fs;
            return { ...fs, ...hydratePhoneFieldsFromRow(editing, countryRows, isTurkeyHandover) };
        });
    }, [countryRows, countryRows.length, editing, isTurkeyHandover]);

    /** Kiosk signed GRT after handover save — keep linked pending exit in sync for iOS checkout. */
    useEffect(() => {
        if (!editing?.id || !isTurkeyHandover || !user) return;
        const linked = String(editing.linkedExitId || '').trim();
        const pdf = String(editing.kioskRentalTermsPdfUrl || '').trim();
        if (!linked || !pdf) return;
        const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, handoverFranchiseId);
        patchLinkedExitFromFrontDeskRow(exitColl, linked, editing);
    }, [
        editing?.id,
        editing?.linkedExitId,
        editing?.kioskRentalTermsPdfUrl,
        editing?.customerNationalId,
        editing?.kioskRentalTermsLanguage,
        isTurkeyHandover,
        handoverFranchiseId,
        user,
        userProfile,
        db,
    ]);

    useEffect(() => {
        if (!canManage || !handoverFranchiseId) return undefined;
        const fref = doc(db, 'franchises', handoverFranchiseId);
        const unsub = onSnapshot(
            fref,
            (snap) => {
                const d = snap.exists() ? snap.data() || {} : {};
                setFranchiseLegalDraft({
                    termsConditionsTr: String(d.termsConditionsTr || ''),
                    termsConditionsEn: String(d.termsConditionsEn || ''),
                    termsConditionsDe: String(d.termsConditionsDe || ''),
                    privacyPolicyTr: String(d.privacyPolicyTr || ''),
                    privacyPolicyEn: String(d.privacyPolicyEn || ''),
                    privacyPolicyDe: String(d.privacyPolicyDe || ''),
                });
            },
            (err) => {
                console.error(err);
                toastError(err.message || 'Could not load kiosk legal texts');
            }
        );
        return () => unsub();
    }, [db, canManage, handoverFranchiseId, toastError]);

    const saveFranchiseKioskLegal = async () => {
        if (!canManage) return;
        setFranchiseLegalSaving(true);
        try {
            await updateDoc(doc(db, 'franchises', handoverFranchiseId), {
                termsConditionsTr: String(franchiseLegalDraft.termsConditionsTr || '').trim(),
                termsConditionsEn: String(franchiseLegalDraft.termsConditionsEn || '').trim(),
                termsConditionsDe: String(franchiseLegalDraft.termsConditionsDe || '').trim(),
                privacyPolicyTr: String(franchiseLegalDraft.privacyPolicyTr || '').trim(),
                privacyPolicyEn: String(franchiseLegalDraft.privacyPolicyEn || '').trim(),
                privacyPolicyDe: String(franchiseLegalDraft.privacyPolicyDe || '').trim(),
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || user?.email || '',
            });
            toastSuccess('Kiosk terms & privacy saved.');
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Could not save legal texts');
        } finally {
            setFranchiseLegalSaving(false);
        }
    };

    const copyKioskUrl = async () => {
        try {
            await navigator.clipboard.writeText(kioskUrl);
            setKioskCopied(true);
            toastSuccess('Kiosk link copied.');
            setTimeout(() => setKioskCopied(false), 2000);
        } catch {
            toastError('Could not copy.');
        }
    };

    const shareKioskUrl = async () => {
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'Front-desk kiosk',
                    text: 'Open on iPad for customer intake.',
                    url: kioskUrl,
                });
            } else {
                await copyKioskUrl();
            }
        } catch (e) {
            if (e?.name !== 'AbortError') {
                toastError(e?.message || 'Share failed.');
            }
        }
    };

    const copyField = async (text, label) => {
        const t = String(text || '').trim();
        if (!t) return;
        try {
            await navigator.clipboard.writeText(t);
            toastSuccess(`${label} copied.`);
        } catch {
            toastError('Could not copy.');
        }
    };

    useEffect(() => {
        const qy = query(collRef, orderBy('submittedAt', 'desc'), limit(200));
        const unsub = onSnapshot(
            qy,
            (snap) => {
                setRows(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
            },
            (err) => {
                console.error(err);
                toastError(err.message || 'Could not load customers');
            }
        );
        return unsub;
    }, [collRef, toastError]);

    const filtered = useMemo(() => {
        if (filter === 'pending') {
            return rows.filter((r) => r.status !== 'completed');
        }
        if (filter === 'done') {
            return rows.filter((r) => r.status === 'completed');
        }
        return rows;
    }, [rows, filter]);

    const searchFiltered = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return filtered;
        return filtered.filter((row) => {
            const blob = [
                displayName(row),
                row.fullName,
                row.email,
                row.phone,
                row.customerNationalId,
                row.nationalId,
                row.tcKimlikNo,
                row.passportNumber,
                row.addressLine,
                row.city,
                row.postalCode,
                row.country,
            ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return blob.includes(q);
        });
    }, [filtered, searchQuery]);

    const dateFiltered = useMemo(() => {
        const day = parseDayInput(filterCalendarDay);
        if (!day) return searchFiltered;
        const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
        const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);

        return searchFiltered.filter((row) => {
            const submittedAt = timestampToDate(row.submittedAt);
            if (!submittedAt) return false;
            return submittedAt >= dayStart && submittedAt <= dayEnd;
        });
    }, [searchFiltered, filterCalendarDay]);

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil(dateFiltered.length / pageSize)),
        [dateFiltered.length, pageSize]
    );

    const paginatedRows = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return dateFiltered.slice(start, start + pageSize);
    }, [dateFiltered, currentPage, pageSize]);

    useEffect(() => {
        setSelectedIds([]);
    }, [filter, searchQuery, filterCalendarDay, rows.length]);

    useEffect(() => {
        setCurrentPage(1);
    }, [filter, searchQuery, filterCalendarDay, pageSize]);

    useEffect(() => {
        if (currentPage > totalPages) {
            setCurrentPage(totalPages);
        }
    }, [currentPage, totalPages]);

    const openEdit = (row) => {
        if (!canManage) {
            toastError('You do not have permission to edit customer records.');
            return;
        }
        const pc = row.plannedCheckoutAt ? timestampToDate(row.plannedCheckoutAt) : null;
        const pi = row.plannedCheckinAt ? timestampToDate(row.plannedCheckinAt) : null;
        const phoneBits = hydratePhoneFieldsFromRow(row, countryRows, isTurkeyHandover);
        const next = {
            firstName: row.firstName || '',
            familyName: row.familyName || row.lastName || '',
            email: row.email || '',
            phoneDialCca2: phoneBits.phoneDialCca2,
            phoneNationalDigits: phoneBits.phoneNationalDigits,
            nationalId: nationalIdFromStoredRow(row),
            addressLine: row.addressLine || '',
            city: row.city || '',
            postalCode: row.postalCode || '',
            country: row.country || '',
            statusUi: row.status === 'completed' ? 'done' : 'pending',
            handoverVehicleId: row.handoverAracId || '',
            handoverNavDigits: row.handoverNavKodu ? digitsOnlyNav(row.handoverNavKodu) : '',
            plannedCheckoutDay: pc ? toDayInputValue(pc) : '',
            plannedCheckinDay: pi ? toDayInputValue(pi) : '',
            plannedCheckoutTime: pc ? toTimeInputValue(pc) : '09:00',
            plannedCheckinTime: pi ? toTimeInputValue(pi) : '17:00',
            handoverKm: row.handoverKm != null && row.handoverKm !== '' ? String(row.handoverKm) : '',
            handoverFuelEighths:
                row.handoverFuelEighths != null && row.handoverFuelEighths !== ''
                    ? String(row.handoverFuelEighths)
                    : '8',
            handoverPickupBranch: row.handoverPickupBranch || row.handoverExitBranch || '',
            handoverDropoffBranch: row.handoverDropoffBranch || '',
            vehicleSearchQuery: '',
            vehicleDepositAmount:
                row.vehicleDepositAmount != null && row.vehicleDepositAmount !== ''
                    ? String(row.vehicleDepositAmount)
                    : '',
            draftClientId: null,
            customerDocuments:
                row.customerDocuments && typeof row.customerDocuments === 'object'
                    ? JSON.parse(JSON.stringify(row.customerDocuments))
                    : {},
            rememberCustomer: readRememberCustomerDefault(),
        };
        editInitialSnapshotRef.current = JSON.stringify(next);
        setIsCreatingNew(false);
        setEditing(row);
        setFormState(next);
    };

    const openAddEntry = () => {
        if (!canManage) {
            toastError('You do not have permission to add customer records.');
            return;
        }
        setDetailRow(null);
        const trName = countryRows.find((c) => c.cca2 === 'TR')?.name || 'Turkey';
        const chName = countryRows.find((c) => c.cca2 === 'CH')?.name || '';
        const defCca = isTurkeyHandover ? 'TR' : countryRows.find((c) => c.cca2 === 'CH')?.cca2 || 'CH';
        const draftClientId =
            typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const empty = {
            firstName: '',
            familyName: '',
            email: '',
            phoneDialCca2: defCca,
            phoneNationalDigits: '',
            nationalId: '',
            addressLine: '',
            city: '',
            postalCode: '',
            country: isTurkeyHandover ? trName : chName,
            draftClientId,
            customerDocuments: {},
            statusUi: 'pending',
            handoverVehicleId: '',
            handoverNavDigits: '',
            plannedCheckoutDay: '',
            plannedCheckinDay: '',
            plannedCheckoutTime: '09:00',
            plannedCheckinTime: '17:00',
            handoverKm: '',
            handoverFuelEighths: '8',
            handoverPickupBranch: '',
            handoverDropoffBranch: '',
            vehicleSearchQuery: '',
            vehicleDepositAmount: '',
            rememberCustomer: readRememberCustomerDefault(),
        };
        editInitialSnapshotRef.current = JSON.stringify(empty);
        setEditing(null);
        setIsCreatingNew(true);
        setFormState(empty);
    };

    const requestCloseEdit = useCallback(() => {
        if (saving || deleting) return;
        if (!formState) {
            setEditing(null);
            setIsCreatingNew(false);
            editInitialSnapshotRef.current = null;
            return;
        }
        const initial = editInitialSnapshotRef.current;
        const dirty = initial != null && JSON.stringify(formState) !== initial;
        if (dirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
        setEditing(null);
        setIsCreatingNew(false);
        setFormState(null);
        editInitialSnapshotRef.current = null;
    }, [formState, saving, deleting]);

    useEffect(() => {
        if (!editing && !isCreatingNew) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') requestCloseEdit();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editing, isCreatingNew, requestCloseEdit]);

    useEffect(() => {
        if (!isTurkeyHandover || (!isCreatingNew && !editing)) {
            setTurkeyGarageBranches([]);
            return undefined;
        }
        let cancelled = false;
        setTurkeyBranchesLoading(true);
        (async () => {
            try {
                const list = await loadTurkeyGarageBranches(db, handoverFranchiseId);
                if (!cancelled) setTurkeyGarageBranches(list);
            } catch (e) {
                console.warn('[FrontDesk] turkey branches', e);
                if (!cancelled) setTurkeyGarageBranches([]);
            } finally {
                if (!cancelled) setTurkeyBranchesLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [db, handoverFranchiseId, isTurkeyHandover, isCreatingNew, editing]);

    useEffect(() => {
        if (!formState || !isTurkeyHandover || turkeyGarageBranches.length === 0) return;
        const sessionKey = matchingBranchStorageKey(turkeyGarageBranches, handoverFranchiseId);
        if (!sessionKey) return;
        setFormState((prev) => {
            if (!prev) return prev;
            const next = { ...prev };
            let changed = false;
            if (!String(prev.handoverPickupBranch || '').trim()) {
                next.handoverPickupBranch = sessionKey;
                changed = true;
            }
            if (!String(prev.handoverDropoffBranch || '').trim()) {
                next.handoverDropoffBranch = sessionKey;
                changed = true;
            }
            return changed ? next : prev;
        });
    }, [formState, isTurkeyHandover, turkeyGarageBranches, handoverFranchiseId]);

    const saveEdit = async () => {
        if (!editing?.id || !formState) return;
        if (!canManage) {
            toastError('You do not have permission to edit customer records.');
            return;
        }
        const firstName = String(formState.firstName || '').trim();
        const familyName = String(formState.familyName || '').trim();
        const nat = String(formState.phoneNationalDigits || '').replace(/\D/g, '');
        if (!nat) {
            toastError('Please enter a telephone number (national digits).');
            return;
        }
        const phone = buildPhoneForSave(formState.phoneDialCca2, formState.phoneNationalDigits, countryRows).trim();
        const email = String(formState.email || '').trim();
        const addressLine = String(formState.addressLine || '').trim();
        const city = String(formState.city || '').trim();
        const postalCode = String(formState.postalCode || '').trim();
        const country = String(formState.country || '').trim();
        const status = formState.statusUi === 'done' ? 'completed' : 'awaiting_staff';
        const customerNationalId = String(formState.nationalId || '').trim().slice(0, 64);

        if (!phone || !email || !addressLine || !city || !postalCode || !country) {
            toastError('Please fill all required contact and address fields.');
            return;
        }

        const fullName = [firstName, familyName].filter(Boolean).join(' ').trim() || editing.fullName || 'Pending customer';
        const vehicleDepositAmount = parseVehicleDepositInput(formState.vehicleDepositAmount);

        let handoverPayload = {};
        if (isTurkeyHandover) {
            const vid = String(formState.handoverVehicleId || '').trim();
            const nav = digitsOnlyNav(formState.handoverNavDigits);
            const co = formState.plannedCheckoutDay;
            const ci = formState.plannedCheckinDay;
            const anyHandover = !!(vid || nav || co || ci);
            if (anyHandover) {
                if (!vid || !nav || !co || !ci) {
                    toastError('Turkey: fill vehicle, NAV code, planned checkout date, and planned check-in date (or clear all vehicle fields).');
                    return;
                }
                const car = (cars || []).find((c) => String(c.id || c.documentId) === vid);
                if (!car) {
                    toastError('Selected vehicle not found in fleet list.');
                    return;
                }
                const coDt = combineDayAndTime(co, formState.plannedCheckoutTime || '09:00');
                const ciDt = combineDayAndTime(ci, formState.plannedCheckinTime || '17:00');
                if (!coDt || !ciDt) {
                    toastError('Invalid planned dates or times.');
                    return;
                }
                const checkoutTs = Timestamp.fromDate(coDt);
                const checkinTs = Timestamp.fromDate(ciDt);
                const kmRaw = String(formState.handoverKm || '').trim();
                const kmParsed = kmRaw === '' ? null : Number(kmRaw);
                const handoverKmFinal = Number.isFinite(kmParsed) ? kmParsed : null;
                const feParsed = parseInt(String(formState.handoverFuelEighths || '8'), 10);
                const handoverFuelEighths = Number.isFinite(feParsed) && feParsed >= 1 && feParsed <= 8 ? feParsed : 8;
                const handoverPickupBranch = String(formState.handoverPickupBranch || '').trim() || null;
                const handoverDropoffBranch = String(formState.handoverDropoffBranch || '').trim() || null;
                handoverPayload = {
                    handoverAracId: vid,
                    handoverPlaka: String(car.plaka || '').trim() || null,
                    handoverKategori: car.kategori ?? null,
                    handoverMarka: car.marka ?? null,
                    handoverModel: car.model ?? null,
                    handoverKm: handoverKmFinal,
                    handoverFuelEighths,
                    handoverPickupBranch,
                    handoverDropoffBranch,
                    handoverExitBranch: handoverPickupBranch,
                    handoverNavKodu: nav,
                    plannedCheckoutAt: checkoutTs,
                    plannedCheckinAt: checkinTs,
                    iosPrefillStatus: 'checkout_ready',
                    vehiclePlate: String(car.plaka || '').trim() || null,
                    resCode: null,
                };
            } else {
                handoverPayload = {
                    handoverAracId: null,
                    handoverPlaka: null,
                    handoverKategori: null,
                    handoverMarka: null,
                    handoverModel: null,
                    handoverKm: null,
                    handoverFuelEighths: null,
                    handoverPickupBranch: null,
                    handoverDropoffBranch: null,
                    handoverExitBranch: null,
                    handoverNavKodu: null,
                    plannedCheckoutAt: null,
                    plannedCheckinAt: null,
                    iosPrefillStatus: 'none',
                    resCode: null,
                    vehiclePlate: null,
                };
            }
        } else {
            handoverPayload = {
                resCode: null,
                vehiclePlate: null,
            };
        }

        setSaving(true);
        try {
            let linkedExitId = null;
            const shouldClearLinkedExit =
                isTurkeyHandover &&
                handoverPayload.iosPrefillStatus === 'none' &&
                String(editing?.linkedExitId || '').trim();
            if (shouldClearLinkedExit) {
                const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, handoverFranchiseId);
                await softDeleteExitDoc(exitColl, String(editing.linkedExitId).trim(), user);
            }
            if (
                isTurkeyHandover &&
                handoverPayload.iosPrefillStatus === 'checkout_ready' &&
                handoverPayload.handoverAracId
            ) {
                const vid = String(formState.handoverVehicleId || '').trim();
                const car = (cars || []).find((c) => String(c.id || c.documentId) === vid);
                if (!car) {
                    toastError('Selected vehicle not found in fleet list.');
                    setSaving(false);
                    return;
                }
                linkedExitId = await upsertPendingExitForTurkeyHandover({
                    db,
                    user,
                    userProfile,
                    franchiseIdOverride,
                    handoverFranchiseId,
                    frontDeskDocId: editing.id,
                    editingRow: { ...editing, ...formState },
                    car,
                    handoverPayload,
                    firstName,
                    familyName,
                    email,
                });
            }

            await updateDoc(doc(collRef, editing.id), {
                firstName: firstName || null,
                lastName: familyName || null,
                familyName: familyName || null,
                middleName: deleteField(),
                fullName,
                phone,
                email,
                addressLine,
                city,
                postalCode,
                country,
                status,
                completedAt: status === 'completed' ? Timestamp.now() : null,
                customerNationalId: customerNationalId || null,
                tcKimlikNo: deleteField(),
                passportNumber: deleteField(),
                vehicleDepositAmount,
                customerDocuments:
                    formState.customerDocuments && typeof formState.customerDocuments === 'object'
                        ? formState.customerDocuments
                        : editing.customerDocuments || {},
                ...handoverPayload,
                ...(linkedExitId
                    ? { linkedExitId }
                    : shouldClearLinkedExit
                      ? { linkedExitId: deleteField() }
                      : {}),
                ...swissFrontDeskRetentionFieldsForBackfill(handoverFranchiseId, editing),
            });
            if (isTurkeyHandover) {
                const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, handoverFranchiseId);
                const syncExitId = String(linkedExitId || editing?.linkedExitId || '').trim();
                if (syncExitId) {
                    await patchLinkedExitFromFrontDeskRow(exitColl, syncExitId, {
                        ...editing,
                        ...formState,
                        customerNationalId,
                    });
                }
            }
            await upsertRememberedCustomerIfEnabled(handoverFranchiseId, formState, phone);
            toastSuccess('Customer record updated.');
            editInitialSnapshotRef.current = null;
            setEditing(null);
            setFormState(null);
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Update failed');
        } finally {
            setSaving(false);
        }
    };

    const saveNewEntry = async () => {
        if (!isCreatingNew || !formState) return;
        if (!canManage) {
            toastError('You do not have permission to add customer records.');
            return;
        }
        const firstName = String(formState.firstName || '').trim();
        const familyName = String(formState.familyName || '').trim();
        const natNew = String(formState.phoneNationalDigits || '').replace(/\D/g, '');
        if (!natNew) {
            toastError('Please enter a telephone number (national digits).');
            return;
        }
        const phone = buildPhoneForSave(formState.phoneDialCca2, formState.phoneNationalDigits, countryRows).trim();
        const emailRaw = String(formState.email || '').trim();
        const emailLower = emailRaw.toLowerCase();
        const addressLine = String(formState.addressLine || '').trim();
        const city = String(formState.city || '').trim();
        const postalCode = String(formState.postalCode || '').trim();
        const country = String(formState.country || '').trim();
        const status = formState.statusUi === 'done' ? 'completed' : 'awaiting_staff';
        const customerNationalId = String(formState.nationalId || '').trim().slice(0, 64);

        if (!phone || !emailRaw || !addressLine || !city || !postalCode || !country) {
            toastError('Please fill all required contact and address fields.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
            toastError('Please enter a valid email address.');
            return;
        }

        const fullName = [firstName, familyName].filter(Boolean).join(' ').trim() || 'Pending customer';
        const vehicleDepositAmount = parseVehicleDepositInput(formState.vehicleDepositAmount);

        let handoverPayload = {};
        if (isTurkeyHandover) {
            const vid = String(formState.handoverVehicleId || '').trim();
            const nav = digitsOnlyNav(formState.handoverNavDigits);
            const co = formState.plannedCheckoutDay;
            const ci = formState.plannedCheckinDay;
            const anyHandover = !!(vid || nav || co || ci);
            if (anyHandover) {
                if (!vid || !nav || !co || !ci) {
                    toastError('Turkey: fill vehicle, NAV code, planned checkout date, and planned return date (or clear all vehicle fields).');
                    return;
                }
                const car = (cars || []).find((c) => String(c.id || c.documentId) === vid);
                if (!car) {
                    toastError('Selected vehicle not found in fleet list.');
                    return;
                }
                const coDt = combineDayAndTime(co, formState.plannedCheckoutTime || '09:00');
                const ciDt = combineDayAndTime(ci, formState.plannedCheckinTime || '17:00');
                if (!coDt || !ciDt) {
                    toastError('Invalid planned dates or times.');
                    return;
                }
                const checkoutTs = Timestamp.fromDate(coDt);
                const checkinTs = Timestamp.fromDate(ciDt);
                const kmRaw = String(formState.handoverKm || '').trim();
                const kmParsed = kmRaw === '' ? null : Number(kmRaw);
                const handoverKmFinal = Number.isFinite(kmParsed) ? kmParsed : null;
                const feParsed = parseInt(String(formState.handoverFuelEighths || '8'), 10);
                const handoverFuelEighths = Number.isFinite(feParsed) && feParsed >= 1 && feParsed <= 8 ? feParsed : 8;
                const handoverPickupBranch = String(formState.handoverPickupBranch || '').trim() || null;
                const handoverDropoffBranch = String(formState.handoverDropoffBranch || '').trim() || null;
                handoverPayload = {
                    handoverAracId: vid,
                    handoverPlaka: String(car.plaka || '').trim() || null,
                    handoverKategori: car.kategori ?? null,
                    handoverMarka: car.marka ?? null,
                    handoverModel: car.model ?? null,
                    handoverKm: handoverKmFinal,
                    handoverFuelEighths,
                    handoverPickupBranch,
                    handoverDropoffBranch,
                    handoverExitBranch: handoverPickupBranch,
                    handoverNavKodu: nav,
                    plannedCheckoutAt: checkoutTs,
                    plannedCheckinAt: checkinTs,
                    iosPrefillStatus: 'checkout_ready',
                    vehiclePlate: String(car.plaka || '').trim() || null,
                    resCode: null,
                };
            } else {
                handoverPayload = {
                    handoverAracId: null,
                    handoverPlaka: null,
                    handoverKategori: null,
                    handoverMarka: null,
                    handoverModel: null,
                    handoverKm: null,
                    handoverFuelEighths: null,
                    handoverPickupBranch: null,
                    handoverDropoffBranch: null,
                    handoverExitBranch: null,
                    handoverNavKodu: null,
                    plannedCheckoutAt: null,
                    plannedCheckinAt: null,
                    iosPrefillStatus: 'none',
                    resCode: null,
                    vehiclePlate: null,
                };
            }
        } else {
            handoverPayload = {
                resCode: null,
                vehiclePlate: null,
            };
        }

        const newDocId =
            String(formState.draftClientId || '').trim() ||
            (typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`);
        const nowMs = Date.now();

        setSaving(true);
        try {
            const tsToIso = (ts) => {
                if (!ts) return null;
                try {
                    const d = typeof ts.toDate === 'function' ? ts.toDate() : new Date(ts);
                    return Number.isNaN(d.getTime()) ? null : d.toISOString();
                } catch {
                    return null;
                }
            };

            if (!functionsApp) {
                throw new Error('Cloud Functions not available');
            }

            // 1) Create the front-desk row FIRST. If this fails, we never spawn an exit
            //    row whose linkedFrontDeskCustomerId points at a non-existent FD doc
            //    (which was the orphan source previously).
            const createFn = httpsCallable(functionsApp, 'staffCreateFrontDeskCustomer');
            await createFn({
                franchiseId: handoverFranchiseId,
                docId: newDocId,
                firstName,
                familyName,
                fullName,
                phone,
                email: emailLower,
                addressLine,
                city,
                postalCode,
                country,
                status,
                customerNationalId: customerNationalId || null,
                vehicleDepositAmount,
                rememberCustomer: formState.rememberCustomer !== false,
                phoneDialCca2: formState.phoneDialCca2 || null,
                phoneNationalDigits: formState.phoneNationalDigits || null,
                ...handoverPayload,
                plannedCheckoutAt: tsToIso(handoverPayload.plannedCheckoutAt),
                plannedCheckinAt: tsToIso(handoverPayload.plannedCheckinAt),
                customerDocuments:
                    formState.customerDocuments && Object.keys(formState.customerDocuments).length
                        ? formState.customerDocuments
                        : undefined,
            });

            // 2) Upsert pending exit (Turkey + handover only).
            let linkedExitId = null;
            if (
                isTurkeyHandover &&
                handoverPayload.iosPrefillStatus === 'checkout_ready' &&
                handoverPayload.handoverAracId
            ) {
                const vid = String(formState.handoverVehicleId || '').trim();
                const car = (cars || []).find((c) => String(c.id || c.documentId) === vid);
                if (!car) {
                    toastError('Selected vehicle not found in fleet list.');
                    setSaving(false);
                    return;
                }
                linkedExitId = await upsertPendingExitForTurkeyHandover({
                    db,
                    user,
                    userProfile,
                    franchiseIdOverride,
                    handoverFranchiseId,
                    frontDeskDocId: newDocId,
                    editingRow: {
                        ...formState,
                        customerNationalId,
                    },
                    car,
                    handoverPayload,
                    firstName,
                    familyName,
                    email: emailLower,
                });
            }

            // 3) Patch the FD doc with the resolved linkedExitId (best-effort — staff
            //    can still find the row via linkedFrontDeskCustomerId on the exit).
            if (linkedExitId) {
                try {
                    await updateDoc(doc(collRef, newDocId), {
                        linkedExitId,
                    });
                } catch (e) {
                    console.warn('[FrontDesk] saveNewEntry linkedExitId patch failed', e?.message || e);
                }
            }
            toastSuccess('Customer record created.');
            editInitialSnapshotRef.current = null;
            setIsCreatingNew(false);
            setFormState(null);
        } catch (e) {
            console.error('[FrontDesk] saveNewEntry failed', e);
            const code = String(e?.code || e?.details?.code || '').replace(/^functions\//, '');
            if (code === 'permission-denied') {
                toastError(
                    'Permission denied. Ensure your role is active and the correct franchise is selected (global admin: pick branch in the header).'
                );
            } else if (code === 'unauthenticated') {
                toastError('Session expired — sign in again.');
            } else {
                toastError(e.message || 'Could not create record');
            }
        } finally {
            setSaving(false);
        }
    };

    const deleteRecordById = async (id, afterDelete) => {
        if (!id) return false;
        if (!canManage) {
            toastError('You do not have permission to delete customer records.');
            return false;
        }
        if (!window.confirm('Delete this customer record permanently?')) return false;
        setDeleting(true);
        try {
            const rowSnap = await getDoc(doc(collRef, id));
            const row = rowSnap.exists() ? rowSnap.data() : null;
            const linkedExit = row?.linkedExitId ? String(row.linkedExitId).trim() : '';
            if (linkedExit && isTurkeyHandover) {
                const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, handoverFranchiseId);
                await softDeleteExitDoc(exitColl, linkedExit, user);
            }
            await deleteDoc(doc(collRef, id));
            toastSuccess('Customer record deleted.');
            if (afterDelete) afterDelete();
            return true;
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Delete failed');
            return false;
        } finally {
            setDeleting(false);
        }
    };

    const removeRecord = async () => {
        if (!editing?.id) return;
        await deleteRecordById(editing.id, () => {
            setEditing(null);
            setFormState(null);
        });
    };

    const uploadWebCustomerDocument = async (category, file) => {
        if (!storage || !file || !canManage) return;
        const docId = editing?.id || formState?.draftClientId;
        if (!docId) return;
        setWebDocUploading(true);
        setWebDocUploadingCategory(category);
        try {
            const fid = String(handoverFranchiseId || 'CH').toUpperCase();
            const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
            const ext = isPdf ? 'pdf' : 'jpg';
            const contentType = isPdf ? 'application/pdf' : 'image/jpeg';
            const objectPath = `franchises/${fid}/frontDeskCustomers/${docId}/${category}/${crypto.randomUUID()}.${ext}`;
            const sref = ref(storage, objectPath);
            await uploadBytes(sref, file, { contentType });
            const url = await getDownloadURL(sref);
            const entry = {
                url,
                contentType,
                fileName: file.name || (isPdf ? 'document.pdf' : 'photo.jpg'),
                uploadedAt: Timestamp.now(),
            };

            if (isCreatingNew) {
                setFormState((p) => {
                    if (!p) return p;
                    const prevDocs =
                        p.customerDocuments && typeof p.customerDocuments === 'object' ? { ...p.customerDocuments } : {};
                    const arr = Array.isArray(prevDocs[category]) ? [...prevDocs[category]] : [];
                    arr.push(entry);
                    prevDocs[category] = arr;
                    return { ...p, customerDocuments: prevDocs };
                });
            } else {
                const dref = doc(collRef, editing.id);
                const snap = await getDoc(dref);
                const prev = snap.data() || {};
                const prevDocs =
                    prev.customerDocuments && typeof prev.customerDocuments === 'object' ? { ...prev.customerDocuments } : {};
                const arr = Array.isArray(prevDocs[category]) ? [...prevDocs[category]] : [];
                arr.push(entry);
                prevDocs[category] = arr;
                await updateDoc(dref, { customerDocuments: prevDocs });
                setEditing((prevRow) =>
                    prevRow && prevRow.id === editing.id ? { ...prevRow, customerDocuments: prevDocs } : prevRow
                );
                setFormState((p) => (p ? { ...p, customerDocuments: prevDocs } : p));
            }
            toastSuccess('Document uploaded.');
        } catch (e) {
            console.error(e);
            toastError(e?.message || 'Upload failed');
        } finally {
            setWebDocUploading(false);
            setWebDocUploadingCategory(null);
            webDocUploadCategoryRef.current = null;
            if (webDocUploadRef.current) webDocUploadRef.current.value = '';
        }
    };

    const toggleSelect = (id) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const toggleSelectAllVisible = () => {
        const visibleIds = paginatedRows.map((r) => r.id);
        if (visibleIds.length === 0) return;
        const allSelected = visibleIds.every((id) => selectedIds.includes(id));
        if (allSelected) {
            setSelectedIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
        } else {
            setSelectedIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
        }
    };

    const bulkDeleteSelected = async () => {
        if (selectedIds.length === 0) return;
        if (!canManage) {
            toastError('You do not have permission to delete customer records.');
            return;
        }
        if (!window.confirm(`Delete ${selectedIds.length} selected customer record(s)?`)) return;
        setBulkDeleting(true);
        try {
            await Promise.all(selectedIds.map((id) => deleteDoc(doc(collRef, id))));
            toastSuccess(`${selectedIds.length} customer record(s) deleted.`);
            setSelectedIds([]);
            setBulkMode(false);
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Bulk delete failed');
        } finally {
            setBulkDeleting(false);
        }
    };

    /** Display timestamps consistently with iOS/Firestore (seconds-based) */
    const fmt = (ts) => {
        const d = timestampToDate(ts);
        return d ? format(d, 'dd MMM yyyy HH:mm') : '—';
    };

    const fullAddress = (row) =>
        [row.addressLine, row.postalCode, row.city, row.country].filter(Boolean).join(', ') || '—';

    const quickUpdateStatus = async (row, nextUiStatus) => {
        if (!row?.id) return;
        if (!canManage) {
            toastError('You do not have permission to update status.');
            return;
        }
        const nextStatus = nextUiStatus === 'done' ? 'completed' : 'awaiting_staff';
        setStatusUpdatingId(row.id);
        try {
            await updateDoc(doc(collRef, row.id), {
                status: nextStatus,
                completedAt: nextStatus === 'completed' ? Timestamp.now() : null,
            });
            if (nextStatus === 'completed' && isTurkeyHandover && row.linkedExitId && row.plannedCheckinAt) {
                try {
                    const exitColl = getCollectionRef(db, 'exitIslemleri', user, userProfile, handoverFranchiseId);
                    await updateDoc(doc(exitColl, String(row.linkedExitId).trim()), {
                        plannedCheckinAt: row.plannedCheckinAt,
                    });
                } catch (syncErr) {
                    console.warn('[FrontDesk] Could not sync plannedCheckinAt to exit', syncErr);
                }
            }
            toastSuccess('Status updated.');
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Could not update status');
        } finally {
            setStatusUpdatingId(null);
        }
    };

    const filterBtn = (active) =>
        active ? 'pal-btn pal-btn-sm pal-btn-primary' : 'pal-btn pal-btn-sm';

    const sheetFont = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif' };

    const exportRows = useMemo(() => {
        return dateFiltered.map((row) => ({
            submittedAt: fmt(row.submittedAt),
            status: statusLabel(row),
            fullName: displayName(row),
            email: row.email || '',
            phone: row.phone || '',
            address: fullAddress(row),
        }));
    }, [dateFiltered]);

    const exportExcel = () => {
        if (exportRows.length === 0) {
            toastError('No records to export for selected filters.');
            return;
        }
        const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
        const headers = ['Submitted', 'Status', 'Customer', 'Email', 'Phone', 'Address'];
        const lines = [
            headers.map(escapeCsv).join(','),
            ...exportRows.map((row) =>
                [
                    row.submittedAt,
                    row.status,
                    row.fullName,
                    row.email,
                    row.phone,
                    row.address,
                ]
                    .map(escapeCsv)
                    .join(',')
            ),
        ];
        const csvContent = `\uFEFF${lines.join('\n')}`;
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const dateSuffix = toDayInputValue(new Date());
        anchor.href = url;
        anchor.download = `front-desk-customers-${kioskFranchiseId}-${dateSuffix}.csv`;
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(url);
        toastSuccess('Excel export downloaded.');
    };

    const exportPdf = () => {
        if (exportRows.length === 0) {
            toastError('No records to export for selected filters.');
            return;
        }
        const docPdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        docPdf.setFontSize(12);
        docPdf.text(`Front-desk customers (${kioskFranchiseId})`, 40, 36);
        docPdf.setFontSize(9);
        docPdf.text(`Generated: ${new Date().toLocaleString('en-GB')}`, 40, 52);
        autoTable(docPdf, {
            startY: 64,
            head: [['Submitted', 'Status', 'Customer', 'Email', 'Phone', 'Address']],
            body: exportRows.map((row) => [
                row.submittedAt,
                row.status,
                row.fullName,
                row.email,
                row.phone,
                row.address,
            ]),
            styles: { fontSize: 8, cellPadding: 4, valign: 'middle' },
            headStyles: { fillColor: [37, 99, 235] },
        });
        const dateSuffix = toDayInputValue(new Date());
        docPdf.save(`front-desk-customers-${kioskFranchiseId}-${dateSuffix}.pdf`);
        toastSuccess('PDF export downloaded.');
    };

    return (
        <div className="w-full min-w-0 erpx-page space-y-5">
            <div className="erpx-page-header !mb-0 pb-5 border-b border-[var(--erpx-border)]">
                <div className="min-w-0">
                    <h1 className="erpx-page-title">
                        Front-desk customers
                    </h1>
                    <p className="erpx-page-subtitle max-w-xl">
                        Review kiosk submissions and update records.
                        {isTurkeyHandover && (
                            <span className="block mt-1 text-[#8e8e93] dark:text-[#98989d]">
                                Turkey: link a fleet vehicle + NAV + planned dates to prefill the iOS check-out / return flow.
                            </span>
                        )}
                    </p>
                    <p className="text-[13px] text-[var(--erpx-ink-muted)] mt-2 tabular-nums">
                        <span className="font-medium text-[var(--erpx-ink)]">{rows.length}</span> total
                        {searchQuery.trim() || filterCalendarDay ? (
                            <span className="ml-2">
                                · <span className="font-medium text-[var(--erpx-ink)]">{dateFiltered.length}</span>{' '}
                                match{dateFiltered.length === 1 ? '' : 'es'}
                            </span>
                        ) : null}
                    </p>
                    {canManage && (
                        <div className="mt-3">
                            <button
                                type="button"
                                onClick={openAddEntry}
                                className="pal-btn pal-btn-primary"
                            >
                                <Plus size={18} strokeWidth={2.25} />
                                Add entry
                            </button>
                        </div>
                    )}
                </div>
                <div className="pal-fd-kiosk-block w-full lg:w-auto lg:min-w-[min(100%,22rem)] xl:min-w-[28rem]">
                    <p className="pal-fd-kiosk-label flex items-center gap-1.5">
                        <Link2 size={12} className="shrink-0 opacity-80" />
                        Kiosk (iPad) · {kioskFranchiseId}
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2">
                        <input
                            readOnly
                            value={kioskUrl}
                            className="pal-fd-kiosk-url"
                            onFocus={(e) => e.target.select()}
                            title={kioskUrl}
                        />
                        <div className="flex gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={copyKioskUrl}
                                className="pal-btn pal-btn-primary"
                                title="Copy link"
                            >
                                {kioskCopied ? <Check size={16} strokeWidth={2.5} /> : <Copy size={16} strokeWidth={2.5} />}
                                Copy
                            </button>
                            <button
                                type="button"
                                onClick={shareKioskUrl}
                                className="pal-btn"
                                title="Share"
                            >
                                <Share2 size={16} />
                                Share
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {canManage && (
                <div className="pal-fd-section">
                    <div className="pal-fd-section-header">
                        <div>
                            <h3 className="pal-fd-section-title">
                                Kiosk · Terms &amp; Privacy
                            </h3>
                            <p className={`${FD_HINT} mt-0.5`}>
                                Shown to customers on the iPad kiosk ({handoverFranchiseId}).
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setShowKioskLegalEditor((v) => !v)}
                            className="pal-btn pal-btn-sm"
                        >
                            {showKioskLegalEditor ? 'Hide' : 'Edit'}
                        </button>
                    </div>
                    {showKioskLegalEditor && (
                        <div className="pal-fd-section-body space-y-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className={FD_LABEL_SM}>Terms &amp; Conditions (TR)</label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.termsConditionsTr}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, termsConditionsTr: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                                <div>
                                    <label className={FD_LABEL_SM}>
                                        Terms &amp; Conditions (EN)
                                    </label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.termsConditionsEn}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, termsConditionsEn: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                                <div>
                                    <label className={FD_LABEL_SM}>
                                        Terms &amp; Conditions (DE)
                                    </label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.termsConditionsDe}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, termsConditionsDe: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                                <div>
                                    <label className={FD_LABEL_SM}>
                                        Privacy Policy (TR)
                                    </label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.privacyPolicyTr}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, privacyPolicyTr: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                                <div>
                                    <label className={FD_LABEL_SM}>
                                        Privacy Policy (EN)
                                    </label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.privacyPolicyEn}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, privacyPolicyEn: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                                <div>
                                    <label className={FD_LABEL_SM}>
                                        Privacy Policy (DE)
                                    </label>
                                    <textarea
                                        rows={4}
                                        value={franchiseLegalDraft.privacyPolicyDe}
                                        onChange={(e) =>
                                            setFranchiseLegalDraft((p) => ({ ...p, privacyPolicyDe: e.target.value }))
                                        }
                                        className={FD_FORM_FIELD}
                                    />
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    disabled={franchiseLegalSaving}
                                    onClick={() => void saveFranchiseKioskLegal()}
                                    className="pal-btn pal-btn-primary disabled:opacity-50"
                                >
                                    {franchiseLegalSaving ? 'Saving…' : 'Save terms & privacy'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-3 sm:gap-y-2 max-w-3xl">
                <label className="gm-search-box min-w-0 w-full sm:flex-1 sm:min-w-[12rem] max-w-none">
                    <Search size={16} className="shrink-0 text-[var(--erpx-ink-muted)]" />
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search by name, email, phone, or address…"
                    />
                </label>
                <div className="flex flex-col gap-1 w-full sm:w-[11rem] sm:shrink-0">
                    <span className="text-[11px] font-medium text-[var(--erpx-ink-muted)]">
                        Filter by date
                    </span>
                    <UnifiedDatePicker
                        value={filterCalendarDay}
                        onChange={(v) => setFilterCalendarDay(v || '')}
                        clearable
                        allowFutureDates
                        placement="below"
                        size="sm"
                        className="w-full"
                    />
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {[
                    { id: 'all', label: 'All' },
                    { id: 'pending', label: 'Pending' },
                    { id: 'done', label: 'Done' },
                ].map((t) => (
                    <button key={t.id} type="button" onClick={() => setFilter(t.id)} className={filterBtn(filter === t.id)}>
                        {t.label}
                        {t.id === 'all' ? ` (${rows.length})` : t.id === 'pending' ? ` (${rows.filter((r) => r.status !== 'completed').length})` : ` (${rows.filter((r) => r.status === 'completed').length})`}
                    </button>
                ))}
            </div>

            <div className="hidden md:block gm-table-wrap rounded-xl overflow-x-auto">
                <div className="flex flex-wrap items-center gap-2 px-3 py-3 border-b border-[var(--erpx-border)]">
                    <button type="button" onClick={exportExcel} className="pal-btn pal-btn-sm">
                        <FileSpreadsheet size={14} />
                        Export Excel
                    </button>
                    <button type="button" onClick={exportPdf} className="pal-btn pal-btn-sm">
                        <FileText size={14} />
                        Export PDF
                    </button>
                    {canManage && (
                        <button
                            type="button"
                            onClick={() => {
                                setBulkMode((prev) => !prev);
                                setSelectedIds([]);
                            }}
                            className="pal-btn pal-btn-sm"
                        >
                            Bulk delete
                        </button>
                    )}
                    {canManage && bulkMode && (
                        <>
                            <button type="button" onClick={toggleSelectAllVisible} className="pal-btn pal-btn-sm">
                                {paginatedRows.length > 0 && paginatedRows.every((r) => selectedIds.includes(r.id))
                                    ? 'Unselect all (page)'
                                    : 'Select all (page)'}
                            </button>
                            <button
                                type="button"
                                disabled={selectedIds.length === 0 || bulkDeleting}
                                onClick={bulkDeleteSelected}
                                className="pal-btn pal-btn-danger pal-btn-sm disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={14} />
                                {bulkDeleting ? 'Deleting…' : `Delete selected (${selectedIds.length})`}
                            </button>
                        </>
                    )}
                </div>
                <table className="gm-table w-full table-fixed text-left">
                    <colgroup>
                        {bulkMode && <col style={{ width: '4%' }} />}
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '32%' }} />
                        <col style={{ width: '14%' }} />
                        <col style={{ width: '12%' }} />
                    </colgroup>
                    <thead>
                        <tr>
                            {bulkMode && <th>Select</th>}
                            <th>Customer</th>
                            <th>Phone</th>
                            <th>Address</th>
                            <th>Status</th>
                            <th>Submitted</th>
                        </tr>
                    </thead>
                    <tbody>
                        {paginatedRows.length === 0 && (
                            <tr>
                                <td colSpan={bulkMode ? 6 : 5} className="px-3 py-8 text-center text-sm text-[var(--erpx-ink-muted)]">
                                    {rows.length === 0
                                        ? `No kiosk submissions yet for ${operationalFranchiseId}. Share the iPad link above.`
                                        : filter !== 'all' && filtered.length === 0
                                          ? `No ${filter} records — ${rows.length} total in franchise. Try the All tab.`
                                          : 'No records match your filters or search.'}
                                </td>
                            </tr>
                        )}
                        {paginatedRows.map((row) => (
                            <tr
                                key={row.id}
                                onClick={() => {
                                    if (bulkMode) {
                                        toggleSelect(row.id);
                                        return;
                                    }
                                    if (canManage) {
                                        openEdit(row);
                                    } else {
                                        setDetailRow(row);
                                    }
                                }}
                            >
                                {bulkMode && (
                                    <td className="align-middle">
                                        <input
                                            type="checkbox"
                                            checked={selectedIds.includes(row.id)}
                                            onChange={() => toggleSelect(row.id)}
                                            onClick={(e) => e.stopPropagation()}
                                            className="h-4 w-4 cursor-pointer"
                                            aria-label={`Select ${displayName(row)}`}
                                        />
                                    </td>
                                )}
                                <td className="align-middle">
                                    <div className="flex items-center gap-2 min-w-0">
                                        {row.kioskRentalTermsPdfUrl ? (
                                            <span
                                                className="shrink-0 text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[#0A84FF]/15 text-[#0A84FF]"
                                                title="General rental terms signed on kiosk"
                                            >
                                                GRT
                                            </span>
                                        ) : null}
                                        <StripeCustomerCell
                                            name={displayName(row)}
                                            email={row.email}
                                        />
                                        <button
                                            type="button"
                                            title="Copy email"
                                            className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-[#2563eb] hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                copyField(row.email, 'Email');
                                            }}
                                        >
                                            <Copy size={13} strokeWidth={2} />
                                        </button>
                                    </div>
                                </td>
                                <td className="align-middle text-[var(--erpx-ink-secondary)]">
                                    <div className="flex items-center gap-1 min-w-0">
                                        <span className="truncate tabular-nums" title={row.phone || ''}>
                                            {row.phone || '—'}
                                        </span>
                                        <button
                                            type="button"
                                            title="Copy phone"
                                            className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-[#2563eb] hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                copyField(row.phone, 'Phone');
                                            }}
                                        >
                                            <Copy size={13} strokeWidth={2} />
                                        </button>
                                    </div>
                                </td>
                                <td className="align-middle text-[var(--erpx-ink-secondary)]">
                                    <div className="flex items-center gap-1 min-w-0">
                                        <span className="truncate" title={fullAddress(row)}>
                                            {fullAddress(row)}
                                        </span>
                                        <button
                                            type="button"
                                            title="Copy address"
                                            className="shrink-0 p-1 rounded-md text-zinc-500 hover:text-[#2563eb] hover:bg-zinc-200/60 dark:text-zinc-400 dark:hover:bg-zinc-700/60"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const a = fullAddress(row);
                                                copyField(a === '—' ? '' : a, 'Address');
                                            }}
                                        >
                                            <Copy size={13} strokeWidth={2} />
                                        </button>
                                    </div>
                                </td>
                                <td className="align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                    {(() => {
                                        const badge = mapFrontDeskStatusBadge(row.status);
                                        return (
                                            <StripeStatusBadge
                                                variant={badge.variant}
                                                label={badge.label}
                                            />
                                        );
                                    })()}
                                </td>
                                <td className="align-middle whitespace-nowrap text-[var(--erpx-ink-muted)]">
                                    {fmt(row.submittedAt)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="grid gap-sap-3 md:hidden">
                {paginatedRows.length === 0 && (
                    <p className="text-sm text-[var(--erpx-ink-muted)]">No records in this tab.</p>
                )}
                {paginatedRows.map((row) => (
                    <motion.button
                        key={row.id}
                        type="button"
                        onClick={() => (canManage ? openEdit(row) : setDetailRow(row))}
                        layout
                        className="pal-fd-card"
                    >
                        <div className="flex flex-wrap items-start justify-between gap-sap-3">
                            <div className="flex items-start gap-sap-3 min-w-0">
                                <div className="p-2 rounded-md bg-[var(--erpx-subtle)]">
                                    <User size={18} className="text-[var(--erpx-brand)]" />
                                </div>
                                <div className="min-w-0">
                                    <p className="font-semibold text-[var(--erpx-ink)] truncate">{displayName(row)}</p>
                                    <p className="text-sm text-[var(--erpx-ink-secondary)]">{row.email}</p>
                                    <p className="text-sm text-[var(--erpx-ink-secondary)]">{row.phone}</p>
                                    <p className="text-xs mt-1 text-[var(--erpx-ink-secondary)] line-clamp-2">{fullAddress(row)}</p>
                                    <p className="text-[11px] mt-1 flex items-center gap-1 text-[var(--erpx-ink-muted)]">
                                        <Clock size={12} />
                                        {fmt(row.submittedAt)}
                                    </p>
                                </div>
                            </div>
                            <div>
                                {row.status === 'completed' ? (
                                    <span className="gm-badge gm-badge-success">
                                        <CheckCircle size={12} />
                                        Done
                                    </span>
                                ) : (
                                    <span className="gm-badge gm-badge-warning">
                                        <Clock size={12} />
                                        Pending
                                    </span>
                                )}
                            </div>
                        </div>
                    </motion.button>
                ))}
            </div>

            <div className="pal-fd-pagination">
                <p className="text-[12px] text-[var(--erpx-ink-muted)]">
                    Showing{' '}
                    <span className="font-medium text-[var(--erpx-ink)]">
                        {dateFiltered.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
                    </span>{' '}
                    -{' '}
                    <span className="font-medium text-[var(--erpx-ink)]">
                        {Math.min(currentPage * pageSize, dateFiltered.length)}
                    </span>{' '}
                    of{' '}
                    <span className="font-medium text-[var(--erpx-ink)]">
                        {dateFiltered.length}
                    </span>{' '}
                    records
                </p>
                <div className="flex items-center gap-2">
                    <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value) || 25)}
                        className="pal-fd-pagination-select"
                    >
                        {[10, 25, 50, 100].map((size) => (
                            <option key={size} value={size}>
                                {size} / page
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="pal-btn pal-btn-sm !p-2 disabled:opacity-50"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className="text-xs tabular-nums min-w-[64px] text-center text-[var(--erpx-ink-muted)]">
                        Page {currentPage}/{totalPages}
                    </span>
                    <button
                        type="button"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        className="pal-btn pal-btn-sm !p-2 disabled:opacity-50"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            {detailRow && !editing && !isCreatingNew && (
                <div className="pal-fd-sheet-overlay" onClick={() => setDetailRow(null)}>
                    <div
                        role="dialog"
                        aria-modal="true"
                        className="pal-fd-sheet"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="pal-fd-sheet-header">
                            <div className="min-w-0">
                                <p className="pal-fd-sheet-eyebrow">Customer record</p>
                                <h3 className="pal-fd-sheet-title truncate">{displayName(detailRow)}</h3>
                                <p className="pal-fd-sheet-sub">{statusLabel(detailRow)}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setDetailRow(null)}
                                className="pal-btn pal-btn-icon"
                                aria-label="Close"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="pal-fd-sheet-body">
                            {[
                                {
                                    icon: <Mail size={16} className="text-[var(--erpx-ink-muted)]" />,
                                    label: 'Email',
                                    value: detailRow.email || '—',
                                    copyLabel: 'Email',
                                    copyVal: detailRow.email,
                                },
                                {
                                    icon: <Phone size={16} className="text-[var(--erpx-ink-muted)]" />,
                                    label: 'Phone',
                                    value: detailRow.phone || '—',
                                    copyLabel: 'Phone',
                                    copyVal: detailRow.phone,
                                },
                                {
                                    icon: <IdCard size={16} className="text-[var(--erpx-ink-muted)]" />,
                                    label: 'National ID',
                                    value: nationalIdFromStoredRow(detailRow) || '—',
                                    copyLabel: 'National ID',
                                    copyVal: nationalIdFromStoredRow(detailRow) || '',
                                },
                                {
                                    icon: <MapPin size={16} className="text-[var(--erpx-ink-muted)]" />,
                                    label: 'Address',
                                    value: fullAddress(detailRow),
                                    copyLabel: 'Address',
                                    copyVal: fullAddress(detailRow) === '—' ? '' : fullAddress(detailRow),
                                },
                                {
                                    icon: <FileText size={16} className="text-[var(--erpx-ink-muted)]" />,
                                    label: 'Security deposit',
                                    value:
                                        detailRow.vehicleDepositAmount != null &&
                                        detailRow.vehicleDepositAmount !== ''
                                            ? String(detailRow.vehicleDepositAmount)
                                            : '—',
                                    copyLabel: 'Deposit',
                                    copyVal:
                                        detailRow.vehicleDepositAmount != null &&
                                        detailRow.vehicleDepositAmount !== ''
                                            ? String(detailRow.vehicleDepositAmount)
                                            : '',
                                },
                            ].map((row) => (
                                <div key={row.label} className="pal-fd-sheet-row">
                                    <span className="mt-0.5 shrink-0">{row.icon}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="pal-fd-sheet-row-label">{row.label}</p>
                                        <p className="pal-fd-sheet-row-value">{row.value}</p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => copyField(row.copyVal, row.copyLabel)}
                                        className="pal-btn pal-btn-icon shrink-0"
                                        title={`Copy ${row.label.toLowerCase()}`}
                                    >
                                        <Copy size={16} strokeWidth={2} />
                                    </button>
                                </div>
                            ))}
                            {isTurkeyHandover && detailRow?.id && (
                                <div className="pal-fd-sheet-row">
                                    <span className="mt-0.5 shrink-0">
                                        <FileText size={16} className="text-[var(--erpx-brand)]" />
                                    </span>
                                    <div className="min-w-0 flex-1 space-y-1">
                                        <p className="pal-fd-sheet-row-label">General rental terms</p>
                                        <KioskRentalTermsOpenButton
                                            franchiseId={handoverFranchiseId}
                                            customerDocId={detailRow.id}
                                            customerRow={detailRow}
                                            storage={storage}
                                            functionsApp={functionsApp}
                                        />
                                    </div>
                                </div>
                            )}
                            <div className="pal-fd-sheet-row text-[12px] text-[var(--erpx-ink-muted)] tabular-nums">
                                Submitted · {fmt(detailRow.submittedAt)}
                            </div>
                        </div>

                        <div className="pal-fd-sheet-footer">
                            <button type="button" onClick={() => setDetailRow(null)} className="pal-btn">
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const r = detailRow;
                                    setDetailRow(null);
                                    openEdit(r);
                                }}
                                className="pal-btn pal-btn-primary inline-flex items-center gap-2"
                            >
                                <Pencil size={16} strokeWidth={2.5} />
                                Edit
                            </button>
                            {canManage && (
                            <button
                                type="button"
                                disabled={detailDeleting}
                                onClick={async () => {
                                    if (!detailRow?.id) return;
                                    setDetailDeleting(true);
                                    const ok = await deleteRecordById(detailRow.id, () => setDetailRow(null));
                                    setDetailDeleting(false);
                                    if (ok) setSelectedIds((prev) => prev.filter((id) => id !== detailRow.id));
                                }}
                                className="pal-btn pal-btn-danger disabled:opacity-60 inline-flex items-center gap-2"
                            >
                                <Trash2 size={16} strokeWidth={2.5} />
                                {detailDeleting ? 'Deleting…' : 'Delete'}
                            </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {(editing || isCreatingNew) && formState && (
                <motion.div
                    role="dialog"
                    aria-modal="true"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="pal-fullscreen-editor pal-fd-editor z-[200]"
                >
                    <header>
                        <button
                            type="button"
                            onClick={requestCloseEdit}
                            disabled={saving || deleting}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[15px] font-medium text-[var(--erpx-brand)] hover:bg-[var(--erpx-brand-muted)] disabled:opacity-50"
                        >
                            <ChevronLeft size={22} strokeWidth={2.25} />
                            Back
                        </button>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-[17px] font-semibold text-[var(--erpx-ink)] truncate">
                                {isCreatingNew ? 'Add customer record' : 'Edit customer record'}
                            </h3>
                            <p className="text-[13px] text-[var(--erpx-ink-muted)] truncate">
                                {isCreatingNew
                                    ? [formState.firstName, formState.familyName].filter(Boolean).join(' ').trim() ||
                                      'Manual entry — staff'
                                    : displayName(editing)}
                            </p>
                        </div>
                        {canManage && editing && !isCreatingNew && (
                            <button
                                type="button"
                                onClick={removeRecord}
                                className="pal-btn pal-btn-danger shrink-0"
                                disabled={saving || deleting}
                            >
                                <Trash2 size={14} />
                                {deleting ? 'Deleting…' : 'Delete'}
                            </button>
                        )}
                    </header>

                    <div className="pal-fs-body">
                        <div className="w-full max-w-none grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5 items-start">
                            <div className="space-y-2">
                                <h4 className={FD_SECTION_TITLE}>Customer</h4>
                            <section className={`${FD_FORM_SECTION} p-4 sm:p-5 space-y-3`}>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label className={FD_LABEL}>First name</label>
                                <input
                                    value={formState.firstName}
                                    onChange={(e) => setFormState((p) => ({ ...p, firstName: e.target.value }))}
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div>
                                <label className={FD_LABEL}>Last name</label>
                                <input
                                    value={formState.familyName}
                                    onChange={(e) => setFormState((p) => ({ ...p, familyName: e.target.value }))}
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <IntlPhoneFields
                                    countries={countryRows}
                                    loading={countriesLoading}
                                    dialCca2={formState.phoneDialCca2}
                                    nationalDigits={formState.phoneNationalDigits}
                                    onChangeDialCca2={(cca2) => setFormState((p) => ({ ...p, phoneDialCca2: cca2 }))}
                                    onChangeNationalDigits={(digits) =>
                                        setFormState((p) => ({ ...p, phoneNationalDigits: digits }))
                                    }
                                    disabled={saving || deleting}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={FD_LABEL}>Email *</label>
                                <input
                                    value={formState.email}
                                    onChange={(e) => setFormState((p) => ({ ...p, email: e.target.value }))}
                                    onBlur={(e) => {
                                        void tryAutofillRememberedCustomer(e.target.value);
                                    }}
                                    className={FD_FORM_FIELD}
                                />
                                <p className={`${FD_HINT} mt-1`}>
                                    When this email was saved before, matching fields fill in automatically (empty fields only).
                                </p>
                            </div>
                            <label className="sm:col-span-2 flex items-start gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    className="mt-1 rounded border-[var(--erpx-border)] accent-[var(--erpx-brand)]"
                                    checked={formState.rememberCustomer !== false}
                                    onChange={(e) => {
                                        const on = e.target.checked;
                                        try {
                                            if (typeof window !== 'undefined') {
                                                window.localStorage.setItem('gm_frontdesk_remember_customer', on ? '1' : '0');
                                            }
                                        } catch {
                                            /* ignore */
                                        }
                                        setFormState((p) => (p ? { ...p, rememberCustomer: on } : p));
                                    }}
                                />
                                <span className={`${FD_HINT} leading-snug`}>
                                    <span className="font-medium">Remember customer</span> for this franchise: save name, phone,
                                    address, and ID fields under this email so the next visit (web, kiosk, or iOS) can auto-fill.
                                </span>
                            </label>
                            <div className="sm:col-span-2">
                                <label className={FD_LABEL}>National ID</label>
                                <input
                                    autoComplete="off"
                                    value={formState.nationalId}
                                    onChange={(e) =>
                                        setFormState((p) => ({
                                            ...p,
                                            nationalId: e.target.value.trimStart().slice(0, 64),
                                        }))
                                    }
                                    placeholder="Optional — T.C. kimlik or passport number"
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <label className={FD_LABEL}>Street / number *</label>
                                <input
                                    value={formState.addressLine}
                                    onChange={(e) => setFormState((p) => ({ ...p, addressLine: e.target.value }))}
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div>
                                <label className={FD_LABEL}>City *</label>
                                <input
                                    value={formState.city}
                                    onChange={(e) => setFormState((p) => ({ ...p, city: e.target.value }))}
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div>
                                <label className={FD_LABEL}>Postal code *</label>
                                <input
                                    value={formState.postalCode}
                                    onChange={(e) => setFormState((p) => ({ ...p, postalCode: e.target.value }))}
                                    className={FD_FORM_FIELD}
                                />
                            </div>
                            <div className="sm:col-span-2">
                                <CountryScrollSelect
                                    countries={countryRows}
                                    loading={countriesLoading}
                                    valueName={formState.country}
                                    onSelectName={(name) => setFormState((p) => ({ ...p, country: name }))}
                                    disabled={saving || deleting}
                                />
                            </div>
                                </div>
                            </section>
                            </div>

                            <div className="space-y-2">
                                <h4 className={FD_SECTION_TITLE}>Vehicle &amp; rental</h4>
                            <section className={`${FD_FORM_SECTION} p-4 sm:p-5 space-y-4`}>
                            <div>
                                <label className={FD_LABEL}>
                                    Vehicle security deposit (manual)
                                </label>
                                <input
                                    inputMode="decimal"
                                    value={formState.vehicleDepositAmount}
                                    onChange={(e) => setFormState((p) => ({ ...p, vehicleDepositAmount: e.target.value }))}
                                    placeholder="e.g. 500 or 500.50"
                                    className={FD_FORM_FIELD}
                                />
                                {isTurkeyHandover && selectedHandoverCar && pickFleetDepositAmount(selectedHandoverCar) != null && (
                                    <p className={`${FD_HINT} mt-1`}>
                                        Fleet record: {pickFleetDepositAmount(selectedHandoverCar)} (you can override above)
                                    </p>
                                )}
                            </div>

                            {editing?.id && isTurkeyHandover && (
                                <div className={`space-y-2 ${FD_SUBSECTION} border border-[var(--erpx-brand)]/30 bg-[var(--erpx-brand-muted)] p-3`}>
                                    <p className="text-[14px] font-semibold text-[var(--erpx-ink)]">General rental terms (kiosk)</p>
                                    <p className={FD_HINT}>
                                        Signed on the customer kiosk
                                        {(() => {
                                            const kioskLang = String(
                                                editing?.kioskRentalTermsLanguage || ''
                                            ).trim();
                                            return kioskLang
                                                ? ` · ${kioskLang === 'en' ? 'English' : 'Turkish'}`
                                                : '';
                                        })()}
                                        . Stored privately in Firebase; use the button below to view.
                                        Also shown on iOS at check-out.
                                    </p>
                                    <KioskRentalTermsOpenButton
                                        franchiseId={handoverFranchiseId}
                                        customerDocId={editing.id}
                                        customerRow={editing}
                                        storage={storage}
                                        functionsApp={functionsApp}
                                    />
                                    {String(editing?.kioskRentalTermsPdfUrl || '').trim() ? (
                                        <p className={`${FD_HINT} text-[#34C759]`}>PDF linked to this record</p>
                                    ) : (
                                        <p className={FD_HINT}>
                                            No link on record yet — if the customer signed on the kiosk, try Open
                                            signed PDF (file may still be in storage).
                                        </p>
                                    )}
                                </div>
                            )}
                            {(editing || isCreatingNew) && (
                                <div className={`space-y-3 ${FD_SUBSECTION}`}>
                                    <p className="text-[14px] font-semibold text-[var(--erpx-ink)]">
                                        Documents
                                    </p>
                                    <p className={FD_HINT}>
                                        ID photos and PDFs from the iOS app or uploaded here (same fields as Customer Info Scan on iOS).
                                        {isCreatingNew ? ' Files are stored with this record when you tap Create record.' : null}
                                    </p>
                                    <input
                                        ref={webDocUploadRef}
                                        type="file"
                                        accept="image/*,application/pdf"
                                        className="hidden"
                                        onChange={(e) => {
                                            const f = e.target.files?.[0];
                                            const cat = webDocUploadCategoryRef.current;
                                            if (f && cat) void uploadWebCustomerDocument(cat, f);
                                        }}
                                    />
                                    {['generalRentalTerms', 'drivingLicense', 'nationalId', 'passport'].map((cat) => {
                                        const label =
                                            cat === 'generalRentalTerms'
                                                ? 'General rental terms (signed)'
                                                : cat === 'drivingLicense'
                                                  ? 'Driving license'
                                                  : cat === 'nationalId'
                                                    ? 'National ID'
                                                    : 'Passport';
                                        const mergedDocs =
                                            formState.customerDocuments && typeof formState.customerDocuments === 'object'
                                                ? formState.customerDocuments
                                                : editing?.customerDocuments;
                                        const arr =
                                            mergedDocs && typeof mergedDocs === 'object' ? mergedDocs[cat] : null;
                                        const list = Array.isArray(arr) ? arr : [];
                                        return (
                                            <div key={cat} className={`space-y-2 ${FD_SUBSECTION} p-3`}>
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erpx-ink-muted)]">
                                                        {label}
                                                    </p>
                                                    {canManage && storage && cat !== 'generalRentalTerms' && (
                                                        <button
                                                            type="button"
                                                            disabled={webDocUploading || saving}
                                                            onClick={() => {
                                                                webDocUploadCategoryRef.current = cat;
                                                                webDocUploadRef.current?.click();
                                                            }}
                                                            className="pal-btn text-[12px] !py-1 !px-2"
                                                        >
                                                            <Upload size={12} />
                                                            {webDocUploading && webDocUploadingCategory === cat ? 'Uploading…' : 'Upload photo / PDF'}
                                                        </button>
                                                    )}
                                                </div>
                                                {list.length > 0 ? (
                                                    <ul className="space-y-1">
                                                        {list.map((entry, idx) => {
                                                            const url = String(entry?.url || '').trim();
                                                            const isPrivateGrt =
                                                                cat === 'generalRentalTerms' &&
                                                                (url.startsWith('gs://') || !url.startsWith('http'));
                                                            if (isPrivateGrt && editing?.id) {
                                                                return (
                                                                    <li key={idx}>
                                                                        <KioskRentalTermsOpenButton
                                                                            franchiseId={handoverFranchiseId}
                                                                            customerDocId={editing.id}
                                                                            customerRow={editing}
                                                                            storage={storage}
                                                                            functionsApp={functionsApp}
                                                                        />
                                                                    </li>
                                                                );
                                                            }
                                                            return (
                                                                <li key={idx}>
                                                                    <a
                                                                        href={url}
                                                                        target="_blank"
                                                                        rel="noreferrer"
                                                                        className="text-[14px] text-[#0A84FF] hover:underline truncate block"
                                                                    >
                                                                        {entry.fileName || url || 'Open'}
                                                                    </a>
                                                                </li>
                                                            );
                                                        })}
                                                    </ul>
                                                ) : cat === 'generalRentalTerms' && editing?.id ? (
                                                    <KioskRentalTermsOpenButton
                                                        franchiseId={handoverFranchiseId}
                                                        customerDocId={editing.id}
                                                        customerRow={editing}
                                                        storage={storage}
                                                        functionsApp={functionsApp}
                                                    />
                                                ) : (
                                                    <p className={`${FD_HINT} text-[11px]`}>No files yet.</p>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {isTurkeyHandover && (
                                <div className={`space-y-3 ${FD_SUBSECTION}`}>
                                    <p className="text-[13px] font-semibold text-[var(--erpx-ink)] flex items-center gap-2">
                                        <Car size={16} className="shrink-0 opacity-80" />
                                        Vehicle &amp; handover
                                    </p>
                                    <p className={FD_HINT}>
                                        Select the fleet vehicle, reservation code (NAV), odometer, fuel, branch, and planned checkout / return times. Field staff completes photos on the device.
                                    </p>
                                    <div>
                                        <label className={FD_LABEL_SM}>Search fleet</label>
                                        <input
                                            value={formState.vehicleSearchQuery}
                                            onChange={(e) => setFormState((p) => ({ ...p, vehicleSearchQuery: e.target.value }))}
                                            placeholder="Plate, brand, model…"
                                            className={FD_FORM_FIELD}
                                        />
                                    </div>
                                    {vehicleCandidates.length > 0 && (
                                        <div className="pal-fd-vehicle-list">
                                            {vehicleCandidates.map((c) => {
                                                const vid = String(c.id || c.documentId);
                                                const active = formState.handoverVehicleId === vid;
                                                return (
                                                    <button
                                                        key={vid}
                                                        type="button"
                                                        onClick={() => {
                                                            const dep = pickFleetDepositAmount(c);
                                                            setFormState((p) => ({
                                                                ...p,
                                                                handoverVehicleId: vid,
                                                                vehicleSearchQuery: '',
                                                                vehicleDepositAmount:
                                                                    dep != null ? String(dep) : (p.vehicleDepositAmount || ''),
                                                            }));
                                                        }}
                                                        className={active ? 'active' : undefined}
                                                    >
                                                        <span className="font-semibold tabular-nums">{c.plaka || '—'}</span>
                                                        <span className="text-[var(--erpx-ink-muted)]">
                                                            {' '}
                                                            · {c.kategori || '—'} · {c.marka || ''} {c.model || ''}
                                                            {c.km != null && c.km !== '' ? ` · ${c.km} km` : ''}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {selectedHandoverCar && (
                                        <div className="pal-fd-vehicle-selected">
                                            <span className="font-semibold">Selected:</span>{' '}
                                            {selectedHandoverCar.plaka} · {selectedHandoverCar.kategori} · {selectedHandoverCar.marka}{' '}
                                            {selectedHandoverCar.model}
                                            {selectedHandoverCar.km != null && selectedHandoverCar.km !== ''
                                                ? ` · ${selectedHandoverCar.km} km`
                                                : ''}
                                            {pickFleetDepositAmount(selectedHandoverCar) != null ? (
                                                <span className={`block mt-1 ${FD_HINT}`}>
                                                    Fleet deposit: {pickFleetDepositAmount(selectedHandoverCar)}
                                                </span>
                                            ) : null}
                                        </div>
                                    )}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-sap-3">
                                        <div>
                                            <label className={FD_LABEL_SM}>NAV code (digits)</label>
                                            <input
                                                inputMode="numeric"
                                                value={formState.handoverNavDigits}
                                                onChange={(e) =>
                                                    setFormState((p) => ({ ...p, handoverNavDigits: digitsOnlyNav(e.target.value) }))
                                                }
                                                placeholder="e.g. 606821"
                                                className={FD_FORM_FIELD}
                                            />
                                        </div>
                                        <div>
                                            <label className={FD_LABEL_SM}>KM (odometer)</label>
                                            <input
                                                inputMode="numeric"
                                                value={formState.handoverKm}
                                                onChange={(e) =>
                                                    setFormState((p) => ({ ...p, handoverKm: e.target.value.replace(/\D/g, '') }))
                                                }
                                                placeholder="e.g. 45200"
                                                className={FD_FORM_FIELD}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-sap-3">
                                        <div>
                                            <label className={FD_LABEL_SM}>Fuel level (eighths)</label>
                                            <select
                                                value={formState.handoverFuelEighths}
                                                onChange={(e) =>
                                                    setFormState((p) => ({ ...p, handoverFuelEighths: e.target.value }))
                                                }
                                                className={FD_FORM_FIELD}
                                            >
                                                {[8, 7, 6, 5, 4, 3, 2, 1].map((n) => (
                                                    <option key={n} value={String(n)}>
                                                        {n}/8
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={FD_LABEL_SM}>Pick up branch</label>
                                            <select
                                                value={formState.handoverPickupBranch}
                                                onChange={(e) =>
                                                    setFormState((p) => ({ ...p, handoverPickupBranch: e.target.value }))
                                                }
                                                disabled={turkeyBranchesLoading || saving || deleting}
                                                className={FD_FORM_FIELD}
                                            >
                                                <option value="">
                                                    {turkeyBranchesLoading ? 'Loading branches…' : 'Select pick-up branch'}
                                                </option>
                                                {formState.handoverPickupBranch &&
                                                    !turkeyGarageBranches.some(
                                                        (b) => b.storageKey === formState.handoverPickupBranch
                                                    ) && (
                                                        <option value={formState.handoverPickupBranch}>
                                                            {displayTitleForStoredKey(formState.handoverPickupBranch)}
                                                        </option>
                                                    )}
                                                {turkeyGarageBranches.map((b) => (
                                                    <option key={b.storageKey} value={b.storageKey}>
                                                        {b.displayName}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className={FD_LABEL_SM}>Drop off branch</label>
                                            <select
                                                value={formState.handoverDropoffBranch}
                                                onChange={(e) =>
                                                    setFormState((p) => ({ ...p, handoverDropoffBranch: e.target.value }))
                                                }
                                                disabled={turkeyBranchesLoading || saving || deleting}
                                                className={FD_FORM_FIELD}
                                            >
                                                <option value="">
                                                    {turkeyBranchesLoading ? 'Loading branches…' : 'Select drop-off branch'}
                                                </option>
                                                {formState.handoverDropoffBranch &&
                                                    !turkeyGarageBranches.some(
                                                        (b) => b.storageKey === formState.handoverDropoffBranch
                                                    ) && (
                                                        <option value={formState.handoverDropoffBranch}>
                                                            {displayTitleForStoredKey(formState.handoverDropoffBranch)}
                                                        </option>
                                                    )}
                                                {turkeyGarageBranches.map((b) => (
                                                    <option key={b.storageKey} value={b.storageKey}>
                                                        {b.displayName}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="space-y-4 pt-3 mt-1 border-t border-black/[0.08]">
                                        <p className="text-[12px] font-semibold text-[#6c6c70]">Planned checkout &amp; return</p>
                                        <div className={FD_DATE_ROW}>
                                            <div className="min-w-0">
                                                <label className={FD_LABEL_SM}>Checkout date</label>
                                                <UnifiedDatePicker
                                                    placement="above"
                                                    size="fd"
                                                    value={formState.plannedCheckoutDay}
                                                    onChange={(v) => setFormState((p) => ({ ...p, plannedCheckoutDay: v }))}
                                                    clearable
                                                    allowFutureDates
                                                />
                                            </div>
                                            <div>
                                                <label className={FD_LABEL_SM}>Time</label>
                                                <input
                                                    type="time"
                                                    value={formState.plannedCheckoutTime}
                                                    onChange={(e) =>
                                                        setFormState((p) => ({ ...p, plannedCheckoutTime: e.target.value }))
                                                    }
                                                    className={FD_FORM_FIELD}
                                                />
                                            </div>
                                        </div>
                                        <div className={FD_DATE_ROW}>
                                            <div className="min-w-0">
                                                <label className={FD_LABEL_SM}>Return date</label>
                                                <UnifiedDatePicker
                                                    placement="above"
                                                    size="fd"
                                                    value={formState.plannedCheckinDay}
                                                    onChange={(v) => setFormState((p) => ({ ...p, plannedCheckinDay: v }))}
                                                    clearable
                                                    allowFutureDates
                                                />
                                            </div>
                                            <div>
                                                <label className={FD_LABEL_SM}>Time</label>
                                                <input
                                                    type="time"
                                                    value={formState.plannedCheckinTime}
                                                    onChange={(e) =>
                                                        setFormState((p) => ({ ...p, plannedCheckinTime: e.target.value }))
                                                    }
                                                    className={FD_FORM_FIELD}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                            </section>
                            </div>
                        </div>
                    </div>

                    <footer className="pal-fs-footer shrink-0 px-4 sm:px-6 py-3">
                        <div className="w-full flex gap-2 justify-end">
                            <button
                                type="button"
                                onClick={requestCloseEdit}
                                className="pal-btn"
                                disabled={saving || deleting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => (isCreatingNew ? saveNewEntry() : saveEdit())}
                                disabled={saving}
                                className="pal-btn pal-btn-primary disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {isCreatingNew ? <Plus size={14} /> : <Pencil size={14} />}
                                {saving ? 'Saving…' : isCreatingNew ? 'Create record' : 'Save changes'}
                            </button>
                        </div>
                    </footer>
                </motion.div>
            )}
        </div>
    );
}
