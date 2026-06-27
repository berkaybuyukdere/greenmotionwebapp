/**
 * Franchise-aware license plates: TR, UK, and default (CH-style).
 */
const TR_PLATE_RE = /^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,3}[0-9]{2,4}$/;
/** WheelSys / fleet XLSX may include 4-letter series (e.g. 34TEST37) or compact plates (34PUS205). */
const TR_PLATE_FLEET_IMPORT_RE = /^(0[1-9]|[1-7][0-9]|8[01])[A-Z]{1,4}[0-9]{2,4}$/;
/** Current UK format: AB12CDE */
const UK_PLATE_CURRENT_RE = /^[A-Z]{2}[0-9]{2}[A-Z]{3}$/;
/** Prefix style: A123BCD */
const UK_PLATE_PREFIX_RE = /^[A-Z][0-9]{1,3}[A-Z]{3}$/;

export function normalizePlateCompact(input) {
    return String(input || '')
        .toUpperCase()
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9]/g, '');
}

function isTurkeyFranchiseIdForPlate(franchiseId) {
    return String(franchiseId || '').trim().toUpperCase().startsWith('TR');
}

function isUKFranchiseIdForPlate(franchiseId) {
    const f = String(franchiseId || '').trim().toUpperCase();
    return f.startsWith('GB') || f.startsWith('UK');
}

export function isTurkeyFranchiseIdForPlateExport(franchiseId) {
    return isTurkeyFranchiseIdForPlate(franchiseId);
}

export function isUKFranchiseIdForPlateExport(franchiseId) {
    return isUKFranchiseIdForPlate(franchiseId);
}

export function shouldNormalizePlateCompact(franchiseId) {
    return isTurkeyFranchiseIdForPlate(franchiseId) || isUKFranchiseIdForPlate(franchiseId);
}

export function isValidTurkishPlateCompact(normalized) {
    const s = normalizePlateCompact(normalized);
    return s.length >= 5 && s.length <= 9 && TR_PLATE_RE.test(s);
}

export function isValidTurkishPlateCompactForFleetImport(normalized) {
    const s = normalizePlateCompact(normalized);
    return s.length >= 5 && s.length <= 10 && TR_PLATE_FLEET_IMPORT_RE.test(s);
}

export function isValidUKPlateCompact(normalized) {
    const s = normalizePlateCompact(normalized);
    if (s.length < 5 || s.length > 8) return false;
    return UK_PLATE_CURRENT_RE.test(s) || UK_PLATE_PREFIX_RE.test(s);
}

/** Display: "34 FC 6302" */
export function formatTurkishPlateForDisplay(raw) {
    const s = normalizePlateCompact(raw);
    const m = s.match(/^(0[1-9]|[1-7][0-9]|8[01])([A-Z]{1,3})([0-9]{2,4})$/);
    if (!m) return String(raw || '').trim().toUpperCase();
    return `${m[1]} ${m[2]} ${m[3]}`;
}

/** Display: "AB12 CDE" or "A123 BCD" */
export function formatUKPlateForDisplay(raw) {
    const s = normalizePlateCompact(raw);
    let m = s.match(/^([A-Z]{2})([0-9]{2})([A-Z]{3})$/);
    if (m) return `${m[1]}${m[2]} ${m[3]}`;
    m = s.match(/^([A-Z])([0-9]{1,3})([A-Z]{3})$/);
    if (m) return `${m[1]}${m[2]} ${m[3]}`;
    return String(raw || '').trim().toUpperCase();
}

export function formatPlateForDisplay(franchiseId, raw) {
    if (isTurkeyFranchiseIdForPlate(franchiseId)) return formatTurkishPlateForDisplay(raw);
    if (isUKFranchiseIdForPlate(franchiseId)) return formatUKPlateForDisplay(raw);
    return String(raw || '').trim().toUpperCase();
}

export function platePlaceholderForFranchise(franchiseId) {
    if (isTurkeyFranchiseIdForPlate(franchiseId)) return '34 FC 6302';
    if (isUKFranchiseIdForPlate(franchiseId)) return 'AB12 CDE';
    return 'ZH 123456';
}

export function plateHintForFranchise(franchiseId) {
    if (isTurkeyFranchiseIdForPlate(franchiseId)) {
        return '01–81 + letters + digits (e.g. 34 FC 6302)';
    }
    if (isUKFranchiseIdForPlate(franchiseId)) {
        return 'UK format: 2 letters + 2 digits + 3 letters (e.g. AB12 CDE)';
    }
    return '';
}

export function validatePlateForFleetImportOrExplain(franchiseId, rawPlate) {
    if (isTurkeyFranchiseIdForPlate(franchiseId)) {
        const n = normalizePlateCompact(rawPlate);
        if (!isValidTurkishPlateCompactForFleetImport(n)) {
            return {
                ok: false,
                message:
                    'Invalid Turkish plate. Use format: 01–81 + letters + 2–4 digits (e.g. 34 FC 6302 or 34PUS205).',
            };
        }
        return { ok: true };
    }
    return validatePlateForFranchiseOrExplain(franchiseId, rawPlate);
}

export function validatePlateForFranchiseOrExplain(franchiseId, rawPlate) {
    if (isTurkeyFranchiseIdForPlate(franchiseId)) {
        const n = normalizePlateCompact(rawPlate);
        if (!isValidTurkishPlateCompact(n)) {
            return {
                ok: false,
                message:
                    'Invalid Turkish plate. Use format: 01–81 + 1–3 letters + 2–4 digits (e.g. 34 FC 6302).',
            };
        }
        return { ok: true };
    }
    if (isUKFranchiseIdForPlate(franchiseId)) {
        const n = normalizePlateCompact(rawPlate);
        if (!isValidUKPlateCompact(n)) {
            return {
                ok: false,
                message:
                    'Invalid UK plate. Use current format AB12 CDE (2 letters, 2 digits, 3 letters).',
            };
        }
        return { ok: true };
    }
    return { ok: true };
}
