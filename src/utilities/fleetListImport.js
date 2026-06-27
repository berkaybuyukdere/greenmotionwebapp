/**
 * Fleet list import (Düsseldorf-style XLSX / CSV):
 * Columns: Plate, Make, Model, Category (+ other columns ignored).
 * Only plate, marka, model, kategori are read; rows are grouped by category for preview.
 */

import * as XLSX from 'xlsx';
import {
    validatePlateForFleetImportOrExplain,
    normalizePlateCompact,
    shouldNormalizePlateCompact,
} from './turkishPlate';

const HEADER_ALIASES = {
    plate: ['plate', 'plaka', 'license plate', 'license', 'plate number'],
    make: ['make', 'marka', 'brand'],
    model: ['model'],
    category: ['category', 'kategori', 'vehicle category', 'cat'],
    carGroup: ['car group', 'cargroup', 'car_group', 'group'],
};

function normalizeHeaderCell(v) {
    return String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

function resolveHeaderIndices(headerRow) {
    const idx = { plate: -1, make: -1, model: -1, category: -1, carGroup: -1 };
    if (!Array.isArray(headerRow)) return idx;
    headerRow.forEach((raw, i) => {
        const h = normalizeHeaderCell(raw);
        if (idx.plate < 0 && HEADER_ALIASES.plate.some((a) => h === a)) idx.plate = i;
        if (idx.make < 0 && HEADER_ALIASES.make.some((a) => h === a)) idx.make = i;
        if (idx.model < 0 && HEADER_ALIASES.model.some((a) => h === a)) idx.model = i;
        if (idx.category < 0 && HEADER_ALIASES.category.some((a) => h === a)) idx.category = i;
        if (idx.carGroup < 0 && HEADER_ALIASES.carGroup.some((a) => h === a)) idx.carGroup = i;
    });
    return idx;
}

/** Normalize category like iOS `VehicleCategory.normalizeName` / web `normalizeVehicleCategoryName`. */
export function normalizeFleetCategoryName(raw) {
    return String(raw ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

export function normalizeImportedPlateForFranchise(franchiseId, rawPlate) {
    const full = String(rawPlate ?? '').trim();
    if (!full) return { ok: false, plate: '', message: 'Empty plate' };
    const fid = String(franchiseId ?? '').toUpperCase();
    if (shouldNormalizePlateCompact(franchiseId)) {
        const v = validatePlateForFleetImportOrExplain(franchiseId, full);
        if (!v.ok) return { ok: false, plate: '', message: v.message };
        return { ok: true, plate: normalizePlateCompact(full) };
    }
    if (fid.startsWith('DE')) {
        return { ok: true, plate: normalizeGermanPlateStored(full) };
    }
    const collapsed = full.replace(/\s+/g, ' ').trim();
    const stored = collapsed.replace(/\s+/g, '').toUpperCase();
    return { ok: true, plate: stored };
}

export function plateDedupeKeyForFranchise(franchiseId, storedPlate) {
    const fid = String(franchiseId ?? '').toUpperCase();
    if (shouldNormalizePlateCompact(franchiseId)) return normalizePlateCompact(storedPlate);
    if (fid.startsWith('DE')) {
        return String(storedPlate ?? '')
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '');
    }
    return String(storedPlate ?? '')
        .replace(/\s+/g, '')
        .toUpperCase();
}

function normalizeGermanPlateStored(rawPlate) {
    const up = String(rawPlate || '').toUpperCase().trim();
    const cleaned = up.replace(/[^A-Z0-9\s-]/g, '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return '';

    // If XLSX style exists (e.g. D-ER 138), keep hyphen style normalized.
    if (cleaned.includes('-')) {
        const parts = cleaned.split('-');
        const city = (parts.shift() || '').replace(/[^A-Z]/g, '');
        const rest = parts.join('-').replace(/[^A-Z0-9]/g, '');
        const m = rest.match(/^([A-Z]{1,2})([0-9][A-Z0-9]*)$/);
        if (city && m) return `${city}-${m[1]} ${m[2]}`;
        return cleaned;
    }

    // Existing app style (e.g. DER 138 / BMGM905) -> normalize to `LETTERS DIGITS`.
    const compact = cleaned.replace(/[^A-Z0-9]/g, '');
    const digitStart = compact.search(/[0-9]/);
    if (digitStart > 0) {
        const letters = compact.slice(0, digitStart);
        const digits = compact.slice(digitStart);
        if (letters && digits) return `${letters} ${digits}`;
    }
    return compact;
}

/**
 * RFC4180-ish CSV parser (quoted fields, commas inside quotes).
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCSVTextToMatrix(text) {
    const rows = [];
    let row = [];
    let cur = '';
    let inQuotes = false;
    const s = String(text ?? '').replace(/^\uFEFF/, '');
    for (let i = 0; i < s.length; i += 1) {
        const c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') {
                    cur += '"';
                    i += 1;
                } else {
                    inQuotes = false;
                }
            } else {
                cur += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(cur);
            cur = '';
        } else if (c === '\n') {
            row.push(cur);
            cur = '';
            if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
            row = [];
        } else if (c === '\r') {
            /* ignore CR; handle CRLF on \n */
        } else {
            cur += c;
        }
    }
    row.push(cur);
    if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
    return rows;
}

function matrixToFleetRows(matrix, franchiseId) {
    const issues = [];
    if (!matrix.length) {
        issues.push('File is empty.');
        return { rows: [], issues };
    }
    const headerIdx = resolveHeaderIndices(matrix[0]);
    const hasCategoryColumn = headerIdx.category >= 0 || headerIdx.carGroup >= 0;
    if (headerIdx.plate < 0 || headerIdx.make < 0 || headerIdx.model < 0 || !hasCategoryColumn) {
        issues.push(
            'Missing required columns. Expected header row with: Plate, Make, Model, and Category or Car group.',
        );
        return { rows: [], issues };
    }
    const out = [];
    for (let r = 1; r < matrix.length; r += 1) {
        const line = matrix[r];
        if (!Array.isArray(line)) continue;
        const rawPlate = line[headerIdx.plate];
        const make = String(line[headerIdx.make] ?? '').trim();
        const model = String(line[headerIdx.model] ?? '').trim();
        const catRaw =
            String(line[headerIdx.category] ?? '').trim() ||
            (headerIdx.carGroup >= 0 ? String(line[headerIdx.carGroup] ?? '').trim() : '');
        const plateNorm = normalizeImportedPlateForFranchise(franchiseId, rawPlate);
        if (!plateNorm.ok) {
            issues.push(`Row ${r + 1}: ${plateNorm.message || 'Invalid plate'}`);
            continue;
        }
        if (!make || !model || !catRaw) {
            issues.push(`Row ${r + 1}: missing make, model, or category.`);
            continue;
        }
        const kategori = normalizeFleetCategoryName(catRaw);
        out.push({
            sourceRow: r + 1,
            plate: plateNorm.plate,
            marka: make,
            model,
            kategori,
        });
    }
    return { rows: out, issues };
}

export function parseFleetXLSXArrayBuffer(arrayBuffer, franchiseId) {
    const wb = XLSX.read(arrayBuffer, { type: 'array' });
    const name = wb.SheetNames[0];
    if (!name) return { rows: [], issues: ['Workbook has no sheets.'] };
    const ws = wb.Sheets[name];
    const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
    return matrixToFleetRows(matrix, franchiseId);
}

export function parseFleetCSVText(text, franchiseId) {
    const matrix = parseCSVTextToMatrix(text);
    return matrixToFleetRows(matrix, franchiseId);
}

export function groupFleetRowsByCategory(rows) {
    const map = new Map();
    for (const row of rows) {
        const k = row.kategori || 'UNKNOWN';
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(row);
    }
    return Array.from(map.entries())
        .map(([category, items]) => ({ category, items }))
        .sort((a, b) => a.category.localeCompare(b.category));
}

/** First occurrence wins; uses same plate key as duplicate detection. */
export function dedupeFleetRowsByPlate(franchiseId, rows) {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
        const k = plateDedupeKeyForFranchise(franchiseId, r.plate);
        if (!k || seen.has(k)) continue;
        seen.add(k);
        out.push(r);
    }
    return out;
}

export function prepareFleetImportForUI(rows, franchiseId, existingCars) {
    const fid = String(franchiseId ?? '').toUpperCase();
    const deduped = dedupeFleetRowsByPlate(fid, rows);
    const existingKeys = new Set(
        (existingCars || []).map((c) => plateDedupeKeyForFranchise(fid, c.plaka))
    );
    const willImport = [];
    const skippedExisting = [];
    for (const r of deduped) {
        const k = plateDedupeKeyForFranchise(fid, r.plate);
        if (existingKeys.has(k)) skippedExisting.push(r);
        else willImport.push(r);
    }
    return {
        willImport,
        skippedExisting,
        skippedDuplicateInFile: rows.length - deduped.length,
    };
}
