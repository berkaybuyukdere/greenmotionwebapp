/**
 * Franchise capability matrix — single place for “does feature X work for franchise Y?”
 * New branches (UK, future EU) should extend prefix helpers here, not scatter checks.
 */

const FRANCHISE_ID_RE = /^[A-Z0-9][A-Z0-9_-]{0,62}[A-Z0-9]$/;

export function normalizeFranchiseId(franchiseId) {
    return String(franchiseId || '').trim().toUpperCase();
}

export function normalizeCountryCode(raw) {
    const s = String(raw || '').trim().toUpperCase();
    if (s === 'GB') return 'UK';
    return s;
}

export function franchiseCountryPrefix(franchiseId) {
    const id = normalizeFranchiseId(franchiseId);
    if (!id) return '';
    const idx = id.indexOf('_');
    return idx > 0 ? id.slice(0, idx) : id;
}

export function isValidFranchiseIdFormat(franchiseId) {
    const id = normalizeFranchiseId(franchiseId);
    return id.length >= 2 && id.length <= 64 && FRANCHISE_ID_RE.test(id);
}

export function isTurkeyFranchiseId(franchiseId) {
    return normalizeFranchiseId(franchiseId).startsWith('TR');
}

export function isGermanyFranchiseId(franchiseId) {
    return normalizeFranchiseId(franchiseId).startsWith('DE');
}

export function isSwitzerlandFranchiseId(franchiseId) {
    return normalizeFranchiseId(franchiseId).startsWith('CH');
}

export function isUKFranchiseId(franchiseId) {
    const id = normalizeFranchiseId(franchiseId);
    return id.startsWith('UK') || id.startsWith('GB');
}

/** CH + DE + UK use Swiss-style checkout/return/damage PDF renderer. */
export function swissStyleReportPdfEnabled(franchiseId) {
    const id = normalizeFranchiseId(franchiseId);
    return id.startsWith('CH') || id.startsWith('DE') || id.startsWith('UK') || id.startsWith('GB');
}

/**
 * Customer QR self-fill (return.html / checkout.html) — universal for every valid franchise.
 * Firestore path: franchises/{franchiseId}/returnFormData|checkoutFormData/{token}
 */
export function customerSelfFillQrEnabled(franchiseId) {
    return isValidFranchiseIdFormat(franchiseId);
}

export const CUSTOMER_FORM_WEB_BASE_URL =
    (typeof process !== 'undefined' && process.env?.REACT_APP_CUSTOMER_FORM_BASE_URL) ||
    'https://vehiclesentinel.com';

export function buildCustomerSelfFillUrl(kind, token, franchiseId, baseUrl = CUSTOMER_FORM_WEB_BASE_URL) {
    const fr = normalizeFranchiseId(franchiseId);
    const tok = String(token || '').trim();
    if (!customerSelfFillQrEnabled(fr) || tok.length < 10) return null;
    const page = kind === 'checkout' ? 'checkout.html' : 'return.html';
    const root = String(baseUrl || CUSTOMER_FORM_WEB_BASE_URL).replace(/\/+$/, '');
    const q = new URLSearchParams({ token: tok, franchise: fr });
    return `${root}/${page}?${q.toString()}`;
}

/** Defaults written to Firestore when admin creates a franchise. */
export function defaultCapabilitiesForCountry(countryCode) {
    const cc = normalizeCountryCode(countryCode);
    const tr = cc === 'TR';
    return {
        customerQrReturn: true,
        customerQrCheckout: true,
        swissStyleReports: !tr,
        plateValidation: cc === 'TR' || cc === 'UK' || cc === 'DE' || cc === 'CH',
        version: 1,
    };
}

/** Human checklist for admin / readiness API. */
export function franchiseReadinessChecks(franchiseDoc) {
    const d = franchiseDoc || {};
    const fid = normalizeFranchiseId(d.franchiseId || d.id);
    const cc = normalizeCountryCode(d.countryCode);
    return [
        {
            id: 'franchise_active',
            ok: d.isActive !== false,
            label: 'Franchise is active',
        },
        {
            id: 'franchise_id',
            ok: isValidFranchiseIdFormat(fid),
            label: `Valid franchise ID (${fid || 'missing'})`,
        },
        {
            id: 'country_code',
            ok: cc.length >= 2,
            label: `Country code set (${cc || 'missing'})`,
        },
        {
            id: 'customer_qr_return',
            ok: customerSelfFillQrEnabled(fid),
            label: 'Customer return QR (return.html)',
        },
        {
            id: 'customer_qr_checkout',
            ok: customerSelfFillQrEnabled(fid),
            label: 'Customer checkout QR (checkout.html)',
        },
        {
            id: 'swiss_pdf',
            ok: !cc || cc === 'TR' || swissStyleReportPdfEnabled(fid),
            label: trOrSwissPdfLabel(cc),
        },
    ];
}

function trOrSwissPdfLabel(cc) {
    if (cc === 'TR') return 'Turkey dual-language PDF';
    if (cc === 'CH' || cc === 'DE' || cc === 'UK' || cc === 'GB') return 'Swiss-style PDF reports';
    return 'PDF report template configured';
}

export function ukPdfDisplayName(franchiseId, explicit) {
    const e = String(explicit || '').trim();
    if (e && !/green motion/i.test(e)) return e;
    const prefix = franchiseCountryPrefix(franchiseId);
    if (prefix === 'UK' || prefix === 'GB') return 'United Kingdom';
    return 'United Kingdom';
}
