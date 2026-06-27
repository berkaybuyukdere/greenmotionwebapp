/**
 * Country list + calling codes for front-desk kiosk.
 * RestCountries API was deprecated — bundled list is always available; JSON is optional refresh.
 */

import { KIOSK_COUNTRY_ROWS } from '../constants/kioskCountryRows';

const CACHE_KEY = 'gm_kiosk_countries_v3';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_CACHE_KEYS = ['gm_restcountries_phone_v2', 'gm_restcountries_phone_v1'];

/** @typedef {{ cca2: string, name: string, dial: string, flagUrl: string }} CountryRow */

function normalizeCountryRows(raw) {
    if (!Array.isArray(raw)) return [];
    /** @type {CountryRow[]} */
    const rows = [];
    for (const c of raw) {
        const cca2 = String(c.cca2 || '').toUpperCase();
        const name = String(c.name || '').trim();
        const dial = String(c.dial || '').trim();
        if (cca2.length !== 2 || !name || !dial.startsWith('+')) continue;
        const low = cca2.toLowerCase();
        rows.push({
            cca2,
            name,
            dial,
            flagUrl: c.flagUrl || `https://flagcdn.com/w40/${low}.png`,
        });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    return rows;
}

/** Synchronous bundled list — kiosk must never wait on network for this. */
export function getBundledCountryRows() {
    return normalizeCountryRows(KIOSK_COUNTRY_ROWS);
}

function clearLegacyCountryCaches() {
    try {
        for (const key of LEGACY_CACHE_KEYS) {
            sessionStorage.removeItem(key);
        }
    } catch {
        /* ignore */
    }
}

/**
 * @returns {Promise<CountryRow[]>}
 */
export async function fetchCountryRows() {
    const bundled = getBundledCountryRows();
    if (!bundled.length) return bundled;

    /** @type {string[]} */
    const urls = [];
    const publicBase = process.env.PUBLIC_URL || '';
    if (publicBase) urls.push(`${publicBase}/kiosk-countries.json`);
    urls.push('/kiosk-countries.json');
    if (typeof window !== 'undefined' && window.location?.origin) {
        urls.push(`${window.location.origin}/kiosk-countries.json`);
    }

    for (const base of [...new Set(urls)]) {
        try {
            const res = await fetch(`${base}?v=3`, { cache: 'no-store' });
            if (!res.ok) continue;
            const json = await res.json();
            if (!Array.isArray(json)) continue;
            const rows = normalizeCountryRows(json);
            if (rows.length > 10) return rows;
        } catch {
            /* try next URL or fall back to bundled */
        }
    }

    return bundled;
}

export function loadCountryRowsCached() {
    clearLegacyCountryCaches();
    try {
        const raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const { t, rows } = JSON.parse(raw);
        if (!t || !Array.isArray(rows)) return null;
        if (Date.now() - t > CACHE_TTL_MS) return null;
        const normalized = normalizeCountryRows(rows);
        return normalized.length > 10 ? normalized : null;
    } catch {
        return null;
    }
}

export function saveCountryRowsCache(rows) {
    try {
        const normalized = normalizeCountryRows(rows);
        if (normalized.length <= 10) return;
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), rows: normalized }));
    } catch {
        /* ignore quota */
    }
}

/**
 * @param {string} phone
 * @param {CountryRow[]} countries sorted arbitrary; longest dial match wins
 * @returns {{ cca2: string, nationalDigits: string, dial: string } | null}
 */
export function splitInternationalPhone(phone, countries) {
    const s = String(phone || '').trim();
    if (!s) return null;
    const normalized = s.startsWith('+') ? s : `+${s.replace(/\D/g, '')}`;
    const digits = normalized.replace(/\D/g, '');
    if (!digits) return null;

    const sorted = [...countries].sort(
        (a, b) => String(b.dial).replace(/\D/g, '').length - String(a.dial).replace(/\D/g, '').length
    );
    for (const c of sorted) {
        const d = String(c.dial).replace(/\D/g, '');
        if (digits.startsWith(d)) {
            return {
                cca2: c.cca2,
                dial: c.dial,
                nationalDigits: digits.slice(d.length),
            };
        }
    }
    return null;
}

/**
 * @param {string} cca2
 * @param {string} nationalDigits
 * @param {CountryRow[]} countries
 */
export function composeInternationalPhone(cca2, nationalDigits, countries) {
    const u = String(cca2 || '').toUpperCase();
    const row = countries.find((c) => c.cca2 === u);
    const dialDigits = String(row?.dial || '').replace(/\D/g, '');
    const nat = String(nationalDigits || '').replace(/\D/g, '');
    if (!dialDigits) return nat ? `+${nat}` : '';
    return `+${dialDigits}${nat}`;
}

/** Map legacy / Turkish UI labels to RestCountries `cca2` when possible */
export function guessCca2FromCountryName(name, countries) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return '';
    const aliases = {
        türkiye: 'TR',
        turkey: 'TR',
        usa: 'US',
        'united states': 'US',
        'united states of america': 'US',
        uk: 'GB',
        'united kingdom': 'GB',
        switzerland: 'CH',
        schweiz: 'CH',
        suisse: 'CH',
        svizzera: 'CH',
    };
    if (aliases[n]) return aliases[n];
    const hit = countries.find((c) => c.name.toLowerCase() === n);
    return hit ? hit.cca2 : '';
}

export function countryNameFromCca2(cca2, countries) {
    const u = String(cca2 || '').toUpperCase();
    return countries.find((c) => c.cca2 === u)?.name || '';
}
