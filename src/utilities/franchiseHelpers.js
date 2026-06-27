import { normalizeRoleKey } from './userAccess';
import { formatCurrency } from './dateFormatters';
import { _franchiseLegalBundle, emptyFranchiseLegalBundle } from '../firebase/authScope';
import {
    swissStyleReportPdfEnabled,
    isUKFranchiseId,
    ukPdfDisplayName,
    customerSelfFillQrEnabled,
    buildCustomerSelfFillUrl,
    defaultCapabilitiesForCountry,
    franchiseReadinessChecks,
} from './franchiseCapabilities';

export {
    swissStyleReportPdfEnabled,
    isUKFranchiseId,
    ukPdfDisplayName,
    customerSelfFillQrEnabled,
    buildCustomerSelfFillUrl,
    defaultCapabilitiesForCountry,
    franchiseReadinessChecks,
};

export const PDF_COPYRIGHT_FOOTER = 'Copyrighted document. All rights reserved.';

export function buildBilingualPdfLegalText() {
    const b = _franchiseLegalBundle || emptyFranchiseLegalBundle();
    const legacyTr = String(b.pdfLegalTextTr || '').trim();
    const legacyEn = String(b.pdfLegalTextEn || '').trim();
    const tr = String(b.pdfLegalTextDamageTr || '').trim() || legacyTr;
    const en = String(b.pdfLegalTextDamageEn || '').trim() || legacyEn;
    if (!tr && !en) return '';
    if (tr && en) return `${tr}\n\n${en}`;
    return tr || en;
}
export function isSabihaFranchiseId(franchiseId) {
    const id = String(franchiseId || '').toUpperCase();
    return id.includes('SABIHA') || id.includes('SAW');
}

export function isGermanyFranchiseId(franchiseId) {
    return String(franchiseId || '').toUpperCase().startsWith('DE');
}

/** Matches Firestore scoped rules: office_Return is TR + CH only. */
export function canUseOfficeReturns(franchiseId) {
    const id = String(franchiseId || '').toUpperCase();
    return id.startsWith('TR') || id.startsWith('CH');
}

export function germanyPdfDisplayName(franchiseId, explicit) {
    const e = String(explicit || '').trim();
    if (e && !/green motion/i.test(e)) return e;
    return 'Germany Düsseldorf';
}

export function bookingCodeLabelForFranchise(franchiseId) {
    if (isTurkeyFranchiseId(franchiseId)) return 'NAV Code';
    if (isGermanyFranchiseId(franchiseId)) return 'RNT Code';
    return 'RES Code';
}

/** Turkey franchise codes (e.g. TR, TR-SABIHA) — dual TR/EN PDFs on web */
export function isTurkeyFranchiseId(franchiseId) {
    return String(franchiseId || '').toUpperCase().startsWith('TR');
}

export function bookingCodeLabelForFranchisePdf(lang, franchiseId) {
    if (lang === 'tr') {
        return isTurkeyFranchiseId(franchiseId) ? 'NAV Kodu' : 'RES Kodu';
    }
    return bookingCodeLabelForFranchise(franchiseId);
}

/** Checkout / damage PDF lang: accepts `{ lang: 'tr'|'en' }` or legacy `'tr'` string third arg. */
export function normalizeCheckoutPdfLang(opts) {
    if (opts == null) return 'en';
    if (typeof opts === 'string') {
        const s = opts.trim().toLowerCase();
        return s === 'tr' || s === 'tur' ? 'tr' : 'en';
    }
    const raw = opts.lang;
    if (raw == null) return 'en';
    const s = String(raw).trim().toLowerCase();
    if (s === 'tr' || s === 'tur' || s === 'turkish') return 'tr';
    return 'en';
}

export function formatDateForPdfBody(date, lang) {
    if (!date || Number.isNaN(date.getTime())) return 'N/A';
    return date.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
    });
}

export function pdfLangStrings(lang) {
    const en = {
        damageReport: 'Damage Report',
        checkoutReport: 'Checkout Report',
        returnReport: 'Return Report',
        vehicleInformation: 'Vehicle Information',
        licensePlate: 'License Plate',
        brand: 'Brand',
        model: 'Model',
        category: 'Category',
        damageRecord: 'Damage Record',
        checkoutRecord: 'Checkout Record',
        status: 'Status',
        date: 'Date',
        kilometers: 'Kilometers',
        damagePhotos: 'Damage Photos',
        noDamages: 'No damages recorded',
        checkoutPhotos: 'Checkout Photos',
        exitBranch: 'Exit Branch',
        pickUpBranch: 'Pick up branch',
        dropOffBranch: 'Drop off branch',
        notes: 'Notes',
        handoverWatermark: 'Handover',
        returnWatermark: 'Return',
        imageUnavailable: 'Image unavailable',
        vehicle: 'Vehicle',
        returnDate: 'Return Date',
        entryBranch: 'Entry Branch',
        notAvailable: 'N/A',
        pageOf: (i, n) => `Page ${i} of ${n}`,
    };
    const tr = {
        damageReport: 'Hasar Raporu',
        checkoutReport: 'Çıkış (Teslim) Raporu',
        returnReport: 'İade Raporu',
        vehicleInformation: 'Araç Bilgileri',
        licensePlate: 'Plaka',
        brand: 'Marka',
        model: 'Model',
        category: 'Kategori',
        damageRecord: 'Hasar Kaydı',
        checkoutRecord: 'Çıkış Kaydı',
        status: 'Durum',
        date: 'Tarih',
        kilometers: 'Kilometre',
        damagePhotos: 'Hasar Fotoğrafları',
        noDamages: 'Kayıtlı hasar bulunmuyor',
        checkoutPhotos: 'Çıkış Fotoğrafları',
        exitBranch: 'Çıkış şubesi',
        pickUpBranch: 'Alış şubesi',
        dropOffBranch: 'Bırakış şubesi',
        notes: 'Notlar',
        handoverWatermark: 'Teslim',
        returnWatermark: 'İade',
        imageUnavailable: 'Görüntü yüklenemedi',
        vehicle: 'Araç',
        returnDate: 'İade tarihi',
        entryBranch: 'Giriş şubesi',
        notAvailable: '—',
        pageOf: (i, n) => `Sayfa ${i} / ${n}`,
    };
    return lang === 'tr' ? tr : en;
}

export function getExitBookingCode(exit) {
    return exit?.navKodu || exit?.resKodu || '';
}

/** Finance / analytics visibility: globaladmin, superadmin, admin, manager */
export function canViewFinancialData(userProfile) {
    const r = String(userProfile?.role || '').toLowerCase().trim();
    return r === 'globaladmin' || r === 'superadmin' || r === 'admin' || r === 'manager';
}

export function isGarageOnlyRole(userProfile) {
    return normalizeRoleKey(userProfile?.role) === 'garage';
}

export function canAccessFrontDeskCustomersWeb(userProfile) {
    return !isGarageOnlyRole(userProfile);
}

/** Fleet category rename / bulk delete (matches iOS `UserProfile.canManageVehicleCategories`). */
export function canManageVehicleCategoriesWeb(userProfile) {
    const r = normalizeRoleKey(userProfile?.role);
    return r === 'manager' || r === 'admin' || r === 'superadmin' || r === 'globaladmin';
}

export function formatFinancialAmount(amount, canView) {
    if (!canView) return '—';
    return formatCurrency(amount);
}
