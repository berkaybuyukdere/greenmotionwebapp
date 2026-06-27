import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import {
    composeInternationalPhone,
    countryNameFromCca2,
    fetchCountryRows,
    getBundledCountryRows,
    guessCca2FromCountryName,
    loadCountryRowsCached,
    saveCountryRowsCache,
    splitInternationalPhone,
} from '../utilities/restCountries';

const FD_FORM_FIELD =
    'w-full px-3 py-2.5 rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)] text-[15px] text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)] focus:outline-none focus:border-[var(--erpx-brand)]';
const FD_FORM_LABEL = 'block text-[13px] font-medium text-[var(--erpx-ink-secondary)]';

function resolveInitialCountryRows() {
    const cached = loadCountryRowsCached();
    if (cached && cached.length > 10) return cached;
    return getBundledCountryRows();
}

export function useCountryRows() {
    const [rows, setRows] = useState(resolveInitialCountryRows);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const r = await fetchCountryRows();
                if (cancelled) return;
                const safe = r.length > 10 ? r : getBundledCountryRows();
                saveCountryRowsCache(safe);
                setRows(safe);
            } catch {
                if (!cancelled) setRows(getBundledCountryRows());
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const safeRows = rows.length > 10 ? rows : getBundledCountryRows();
    return { rows: safeRows, loading, err: null };
}

function dialRowLabel(c) {
    return `${c.name} (${c.dial})`;
}

/** Phone: dial country (cca2) + national digits; shows +prefix from RestCountries. */
export function IntlPhoneFields({
    countries,
    loading,
    dialCca2,
    nationalDigits,
    onChangeDialCca2,
    onChangeNationalDigits,
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const wrapRef = useRef(null);

    const selected = useMemo(
        () => countries.find((c) => c.cca2 === String(dialCca2 || '').toUpperCase()) || countries[0],
        [countries, dialCca2]
    );

    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return countries;
        return countries.filter(
            (c) =>
                c.name.toLowerCase().includes(s) ||
                c.dial.replace(/\D/g, '').includes(s.replace(/\D/g, '')) ||
                c.cca2.toLowerCase().includes(s)
        );
    }, [countries, q]);

    useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    return (
        <div className="space-y-1.5">
            <label className={FD_FORM_LABEL}>
                Telephone *
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative sm:w-[min(100%,280px)] shrink-0" ref={wrapRef}>
                    <button
                        type="button"
                        disabled={disabled || loading || !selected}
                        onClick={() => setOpen((o) => !o)}
                        className={`${FD_FORM_FIELD} flex items-center gap-2 text-left`}
                    >
                        {selected?.flagUrl ? (
                            <img src={selected.flagUrl} alt="" className="w-7 h-5 object-cover rounded-sm shrink-0 border border-black/10" />
                        ) : null}
                        <span className="flex-1 min-w-0 truncate text-[14px] text-[var(--erpx-ink)]">
                            {selected ? dialRowLabel(selected) : '…'}
                        </span>
                        <ChevronDown size={16} className="shrink-0 text-[var(--erpx-ink-muted)]" />
                    </button>
                    {open && (
                        <div className="absolute z-[120] mt-1 w-full min-w-[260px] max-h-64 overflow-hidden rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-[var(--erpx-shadow-sm)] flex flex-col">
                            <div className="p-2 border-b border-[var(--erpx-border)] flex items-center gap-2">
                                <Search size={14} className="text-[var(--erpx-ink-muted)] shrink-0" />
                                <input
                                    value={q}
                                    onChange={(e) => setQ(e.target.value)}
                                    placeholder="Search country or +code…"
                                    className="flex-1 min-w-0 bg-transparent text-[13px] outline-none text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)]"
                                />
                            </div>
                            <div className="overflow-y-auto max-h-52">
                                {filtered.map((c) => (
                                    <button
                                        key={c.cca2}
                                        type="button"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                        }}
                                        onClick={() => {
                                            onChangeDialCca2(c.cca2);
                                            setOpen(false);
                                            setQ('');
                                        }}
                                        className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--erpx-ink)] hover:bg-[var(--erpx-row-hover)] ${
                                            c.cca2 === selected?.cca2 ? 'bg-[var(--erpx-brand-light)]' : ''
                                        }`}
                                    >
                                        <img src={c.flagUrl} alt="" className="w-7 h-5 object-cover rounded-sm border border-black/10 shrink-0" />
                                        <span className="truncate">{dialRowLabel(c)}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex-1 flex items-stretch gap-2 min-w-0">
                    <span className="inline-flex items-center px-2 rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-subtle)] text-[14px] tabular-nums text-[var(--erpx-ink-muted)] shrink-0">
                        {selected?.dial || '+'}
                    </span>
                    <input
                        type="tel"
                        inputMode="numeric"
                        autoComplete="tel-national"
                        disabled={disabled}
                        value={nationalDigits}
                        onChange={(e) => onChangeNationalDigits(e.target.value.replace(/\D/g, ''))}
                        placeholder="National number"
                        className={FD_FORM_FIELD}
                    />
                </div>
            </div>
            {loading ? (
                <p className="text-[12px] text-[var(--erpx-ink-muted)]">Loading country calling codes…</p>
            ) : null}
        </div>
    );
}

/** Full country list with flags (RestCountries names). */
export function CountryScrollSelect({
    countries,
    loading,
    valueName,
    onSelectName,
    disabled = false,
    label = 'Country *',
}) {
    const [q, setQ] = useState('');
    const [collapsed, setCollapsed] = useState(false);
    const filtered = useMemo(() => {
        const s = q.trim().toLowerCase();
        if (!s) return countries;
        return countries.filter(
            (c) => c.name.toLowerCase().includes(s) || c.cca2.toLowerCase().includes(s)
        );
    }, [countries, q]);

    const selected = useMemo(() => {
        const raw = String(valueName || '').trim();
        if (!raw) return null;
        const byExact = countries.find((c) => c.name === raw);
        if (byExact) return byExact;
        const upper = raw.toUpperCase();
        const byCca = countries.find((c) => c.cca2 === upper);
        if (byCca) return byCca;
        const rl = raw.toLowerCase();
        return countries.find((c) => c.name.toLowerCase() === rl) || null;
    }, [countries, valueName]);

    useEffect(() => {
        if (!valueName) setCollapsed(false);
    }, [valueName]);

    return (
        <div className="relative">
            <label className={`${FD_FORM_LABEL} mb-1`}>{label}</label>
            <div className="rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-[var(--erpx-shadow-sm)] overflow-hidden">
                <div className="p-2 border-b border-[var(--erpx-border)] flex items-center gap-2">
                    <Search size={14} className="text-[var(--erpx-ink-muted)] shrink-0" />
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Type to filter countries…"
                        disabled={disabled}
                        className="flex-1 min-w-0 bg-transparent text-[13px] outline-none text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)]"
                    />
                </div>
                {valueName && !selected ? (
                    <div className="px-3 py-2 text-[11px] border-b border-amber-400/40 bg-amber-500/10 text-amber-200">
                        Saved value not in list: <span className="font-semibold">{valueName}</span>. Pick a country below to align with the directory.
                    </div>
                ) : null}
                {selected ? (
                    <div className="px-3 py-2 text-[11px] border-b border-[var(--erpx-border)] bg-[var(--erpx-brand-light)] text-[var(--erpx-ink)] flex items-center gap-2">
                        <img src={selected.flagUrl} alt="" className="w-6 h-4 object-cover rounded-sm border border-black/10" />
                        <span className="font-medium truncate">{selected.name}</span>
                        <button
                            type="button"
                            onClick={() => setCollapsed((v) => !v)}
                            className="ml-auto text-[10px] font-semibold px-2 py-1 rounded border border-[var(--erpx-border)] text-[var(--erpx-ink-secondary)]"
                        >
                            {collapsed ? 'Change' : 'Hide list'}
                        </button>
                    </div>
                ) : null}
                <div className={`max-h-48 overflow-y-auto ${collapsed ? 'hidden' : ''}`}>
                    {loading && !countries.length ? (
                        <p className="p-3 text-[13px] text-[var(--erpx-ink-muted)]">Loading…</p>
                    ) : (
                        filtered.map((c) => (
                            <button
                                key={c.cca2}
                                type="button"
                                disabled={disabled}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                }}
                                onClick={() => {
                                    onSelectName(c.name);
                                    setQ('');
                                    setCollapsed(true);
                                }}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--erpx-ink)] hover:bg-[var(--erpx-row-hover)] ${
                                    (selected && selected.cca2 === c.cca2) || c.name === valueName ? 'bg-[var(--erpx-brand-light)]' : ''
                                }`}
                            >
                                <img src={c.flagUrl} alt="" className="w-6 h-4 object-cover rounded-sm border border-black/10 shrink-0" />
                                <span className="truncate">{c.name}</span>
                            </button>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

export function hydratePhoneFieldsFromRow(row, countries, isTurkeyHandover) {
    const phone = String(row?.phone || '').trim();
    if (!countries.length) {
        return {
            phoneDialCca2: isTurkeyHandover ? 'TR' : 'CH',
            phoneNationalDigits: phone.replace(/\D/g, ''),
        };
    }
    const split = splitInternationalPhone(phone, countries);
    if (split) {
        return { phoneDialCca2: split.cca2, phoneNationalDigits: split.nationalDigits };
    }
    const guess = guessCca2FromCountryName(row?.country, countries);
    return {
        phoneDialCca2: guess || (isTurkeyHandover ? 'TR' : 'CH'),
        phoneNationalDigits: phone.replace(/\D/g, ''),
    };
}

export function buildPhoneForSave(phoneDialCca2, phoneNationalDigits, countries) {
    if (!countries.length) {
        const d = String(phoneNationalDigits || '').replace(/\D/g, '');
        return d ? `+${d}` : '';
    }
    return composeInternationalPhone(phoneDialCca2, phoneNationalDigits, countries);
}

export { countryNameFromCca2, guessCca2FromCountryName, splitInternationalPhone };
