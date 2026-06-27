/**
 * Per-franchise remembered customer contact (keyed by normalized email) for front desk / kiosk / iOS.
 */

/** Firestore document id for `franchises/{fid}/customerContactRemember/{id}` — must match Cloud Functions + iOS. */
export function customerRememberDocId(email) {
    return String(email || '')
        .trim()
        .toLowerCase()
        .replace(/\//g, '_')
        .replace(/#/g, '_')
        .replace(/\?/g, '_');
}

export function isValidRememberEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

/**
 * Build merge payload for `customerContactRemember` from staff web form state.
 * @param {string} franchiseIdUpper
 * @param {object} formState
 * @param {string} phoneBuilt - full phone string from buildPhoneForSave
 */
export function buildRememberPayloadFromStaffForm(franchiseIdUpper, formState, phoneBuilt) {
    const email = String(formState?.email || '')
        .trim()
        .toLowerCase();
    if (!isValidRememberEmail(email)) return null;
    const fid = String(franchiseIdUpper || '').trim().toUpperCase();
    if (!fid) return null;
    return {
        franchiseId: fid,
        email,
        firstName: String(formState.firstName || '').trim() || null,
        familyName: String(formState.familyName || '').trim() || null,
        phoneDialCca2: String(formState.phoneDialCca2 || '').trim().toUpperCase() || null,
        phoneNationalDigits: String(formState.phoneNationalDigits || '').replace(/\D/g, '') || null,
        phone: String(phoneBuilt || '').trim() || null,
        addressLine: String(formState.addressLine || '').trim() || null,
        city: String(formState.city || '').trim() || null,
        postalCode: String(formState.postalCode || '').trim() || null,
        country: String(formState.country || '').trim() || null,
        customerNationalId: String(formState.nationalId || formState.customerNationalId || '').trim().slice(0, 64) || null,
        lastSource: 'staff_web',
    };
}

/** Apply remembered fields only where the current form field is still empty (avoid clobbering edits). */
export function mergeRememberIntoFormState(prev, data) {
    if (!prev || !data) return prev;
    const pick = (current, remembered) => {
        const c = String(current ?? '').trim();
        if (c) return c;
        return String(remembered ?? '').trim();
    };
    const next = { ...prev };
    next.firstName = pick(prev.firstName, data.firstName);
    next.familyName = pick(prev.familyName, data.familyName || data.lastName);
    next.addressLine = pick(prev.addressLine, data.addressLine);
    next.city = pick(prev.city, data.city);
    next.postalCode = pick(prev.postalCode, data.postalCode);
    next.country = pick(prev.country, data.country);
    const rememberedId =
        data.customerNationalId ||
        data.nationalId ||
        data.tcKimlikNo ||
        data.passportNumber;
    next.nationalId = pick(prev.nationalId, rememberedId);
    const prevNat = String(prev.phoneNationalDigits || '').replace(/\D/g, '');
    if (!prevNat) {
        if (data.phoneNationalDigits) {
            next.phoneNationalDigits = String(data.phoneNationalDigits).replace(/\D/g, '');
        }
        if (data.phoneDialCca2) {
            next.phoneDialCca2 = String(data.phoneDialCca2).trim().toUpperCase();
        }
    }
    return next;
}

