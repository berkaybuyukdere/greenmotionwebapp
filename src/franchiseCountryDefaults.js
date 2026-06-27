/**
 * Default currency + timezone per country id (aligned with iOS Country.swift).
 * Used when creating a franchise and as the initial currency picker value.
 *
 * Operations (web Operations hub + checkout/return day planner): enabled for all
 * franchises by default. Optional future field on `franchises/{id}`:
 * `operationsHubEnabled` (boolean) — iOS can mirror when reading franchise config.
 */
export const FRANCHISE_DEFAULTS_BY_COUNTRY_ID = {
    at: { currency: 'EUR', timezone: 'Europe/Vienna' },
    be: { currency: 'EUR', timezone: 'Europe/Brussels' },
    bg: { currency: 'BGN', timezone: 'Europe/Sofia' },
    hr: { currency: 'EUR', timezone: 'Europe/Zagreb' },
    cz: { currency: 'CZK', timezone: 'Europe/Prague' },
    dk: { currency: 'DKK', timezone: 'Europe/Copenhagen' },
    fi: { currency: 'EUR', timezone: 'Europe/Helsinki' },
    fr: { currency: 'EUR', timezone: 'Europe/Paris' },
    de: { currency: 'EUR', timezone: 'Europe/Berlin' },
    gr: { currency: 'EUR', timezone: 'Europe/Athens' },
    hu: { currency: 'HUF', timezone: 'Europe/Budapest' },
    ie: { currency: 'EUR', timezone: 'Europe/Dublin' },
    it: { currency: 'EUR', timezone: 'Europe/Rome' },
    lu: { currency: 'EUR', timezone: 'Europe/Luxembourg' },
    nl: { currency: 'EUR', timezone: 'Europe/Amsterdam' },
    no: { currency: 'NOK', timezone: 'Europe/Oslo' },
    pl: { currency: 'PLN', timezone: 'Europe/Warsaw' },
    pt: { currency: 'EUR', timezone: 'Europe/Lisbon' },
    ro: { currency: 'RON', timezone: 'Europe/Bucharest' },
    sk: { currency: 'EUR', timezone: 'Europe/Bratislava' },
    si: { currency: 'EUR', timezone: 'Europe/Ljubljana' },
    es: { currency: 'EUR', timezone: 'Europe/Madrid' },
    se: { currency: 'SEK', timezone: 'Europe/Stockholm' },
    ch: { currency: 'CHF', timezone: 'Europe/Zurich' },
    tr: { currency: 'TRY', timezone: 'Europe/Istanbul' },
    uk: { currency: 'GBP', timezone: 'Europe/London' },
};

export const ISO_CURRENCY_OPTIONS = [
    'CHF', 'EUR', 'USD', 'GBP', 'TRY', 'PLN', 'CZK', 'HUF', 'RON', 'BGN',
    'DKK', 'NOK', 'SEK',
];
