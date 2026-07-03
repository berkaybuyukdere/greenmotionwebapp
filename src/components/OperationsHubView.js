import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format, addDays, startOfDay, endOfDay } from 'date-fns';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Car, CheckCircle, FileText, Search, Trash2, X } from 'lucide-react';
import { TurkeyDocumentationButton } from './TurkeyDocumentationPanel';
import { isTurkeyFranchiseIdForDocs } from '../utilities/turkeyFeatureDocumentation';
import { UnifiedDatePicker } from './UnifiedDatePicker';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import { useClientPagination } from './palantir/useClientPagination';
import { PalantirTablePager } from './palantir/PalantirTablePager';
import { useToast } from './ToastNotification';
import ZoomableImageOverlay from './ZoomableImageOverlay';
import {
    dedupePendingExitsByWeakKey,
    dedupePendingReturnsByKey,
    dedupeReturnRowsForOperationsList,
    exitBusinessDedupeKey,
    exitWeakDedupeKey,
    returnBusinessDedupeKey,
} from '../utilities/operationsDedupe';
import { formatProcessDate } from '../utilities/processPhotoStampLabels';

function tsToDate(raw) {
    if (!raw) return null;
    if (raw?.seconds != null) return new Date(raw.seconds * 1000);
    if (raw instanceof Date) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function parseDayInput(value) {
    if (!value) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function inRange(d, start, end) {
    if (!d) return false;
    return d >= start && d <= end;
}

function exitSortKey(ex) {
    const c = tsToDate(ex.createdAt) || tsToDate(ex.exitTarihi);
    return c ? c.getTime() : 0;
}

function returnSortKey(r) {
    const c = tsToDate(r.createdAt) || tsToDate(r.iadeTarihi);
    return c ? c.getTime() : 0;
}

function bookingNavTitle(ex) {
    const raw = String(ex?.navKodu || ex?.resKodu || '').trim();
    return raw || '';
}

function returnNavTitle(r) {
    const raw = String(r?.navKodu || r?.resKodu || '').trim();
    return raw || '';
}

function customerEmailLine(email) {
    const em = email && String(email).trim() ? String(email).trim() : '—';
    return em;
}

function statusTone(status) {
    const s = String(status || '');
    if (s === 'Completed') return { bg: 'bg-[var(--erpx-green-bg)]', text: 'text-[var(--erpx-green)]', label: 'Done' };
    if (s === 'Parked')
        return {
            bg: 'bg-[color-mix(in_srgb,var(--erpx-amber)_16%,var(--erpx-surface))]',
            text: 'text-[var(--erpx-amber)]',
            label: 'Waiting',
        };
    return {
        bg: 'bg-[color-mix(in_srgb,var(--erpx-amber)_16%,var(--erpx-surface))]',
        text: 'text-[var(--erpx-amber)]',
        label: 'Waiting',
    };
}

const OPS_GRID_BG = 'bg-[var(--erpx-surface)]';

/** Category · brand model from fleet record (Firestore: kategori, marka, model). */
function vehicleSummaryLine(car) {
    if (!car) return '—';
    const k = String(car.kategori ?? '').trim();
    const mm = [car.marka, car.model]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean)
        .join(' ');
    const parts = [k, mm].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
}

function OpsPanelSection({ title, count, children }) {
    return (
        <div className="border-b border-[var(--erpx-border)] last:border-b-0">
            <div className="grid grid-cols-[1fr_auto] items-baseline gap-2 px-3 py-2 bg-[var(--erpx-subtle)] border-b border-[var(--erpx-border)]">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--erpx-ink-muted)]">
                    {title}
                </span>
                {typeof count === 'number' ? (
                    <span className="text-[10px] font-semibold tabular-nums text-[var(--erpx-ink-muted)]">{count}</span>
                ) : null}
            </div>
            <div className="divide-y divide-[var(--erpx-border)] bg-[var(--erpx-surface)]">{children}</div>
        </div>
    );
}

function customerNameFromExit(ex) {
    const a = String(ex.customerFirstName || '').trim();
    const b = String(ex.customerLastName || '').trim();
    const joined = [a, b].filter(Boolean).join(' ').trim();
    return joined || String(ex.customerEmail || '').trim();
}

function exitMatchesSearch(ex, plateFn, q) {
    const qq = String(q || '')
        .trim()
        .toLowerCase();
    if (!qq) return true;
    const plate = String(plateFn(ex) || '').toLowerCase();
    const res = String(ex.resKodu || '').toLowerCase();
    const nav = String(ex.navKodu || '').toLowerCase();
    const name = customerNameFromExit(ex).toLowerCase();
    const email = String(ex.customerEmail || '').toLowerCase();
    return plate.includes(qq) || res.includes(qq) || nav.includes(qq) || name.includes(qq) || email.includes(qq);
}

function returnMatchesSearch(r, plateFn, q) {
    const qq = String(q || '')
        .trim()
        .toLowerCase();
    if (!qq) return true;
    const plate = String(plateFn(r) || '').toLowerCase();
    const nav = returnNavTitle(r).toLowerCase();
    const name = [r.customerFirstName, r.customerLastName].filter(Boolean).join(' ').trim().toLowerCase();
    const email = String(r.customerEmail || '').toLowerCase();
    return plate.includes(qq) || nav.includes(qq) || name.includes(qq) || email.includes(qq);
}

/** Include exits whose checkout date (`exitTarihi`) falls on this calendar day.
 *  The planned return date (`plannedCheckinAt`) is intentionally excluded here —
 *  expected returns are shown in the Returns section via their own `iadeTarihi`. */
function exitMatchesCalendarDay(e, sd, ed) {
    const checkout = tsToDate(e.exitTarihi);
    return inRange(checkout, sd, ed);
}

function OpsPdfOverlay({ state }) {
    if (!state?.visible) return null;
    const isCompleted = state.stage === 'completed';
    const title =
        state.stage === 'downloading'
            ? 'Downloading PDF...'
            : state.stage === 'completed'
              ? 'Completed'
              : 'Preparing PDF...';
    const subtitle = state.message || (isCompleted ? 'Your file is ready' : 'Please wait a moment');
    return (
        <div className="pal-wb-overlay fixed inset-0 z-[100] flex items-center justify-center p-4">
            <div className="pal-ops-overlay-card">
                <div className="pal-ops-overlay-icon">
                    {isCompleted ? (
                        <CheckCircle size={28} className="text-[var(--erpx-green)]" />
                    ) : (
                        <motion.div
                            className="w-8 h-8 border-[3px] border-[var(--erpx-brand)]/30 border-t-[var(--erpx-brand)] rounded-full"
                            animate={{ rotate: 360 }}
                            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                        />
                    )}
                </div>
                <p className="text-[16px] font-semibold text-[var(--erpx-ink)]">{title}</p>
                <p className="mt-1 text-[12px] text-[var(--erpx-ink-muted)]">{subtitle}</p>
            </div>
        </div>
    );
}

function ExitOpsRow({ ex, plate, vehicleLine, onClick, done }) {
    const when = tsToDate(ex.exitTarihi);
    const nav = bookingNavTitle(ex) || plate;
    const em = customerEmailLine(ex.customerEmail);
    if (done) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="group w-full text-left px-3 py-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center bg-[var(--erpx-green-bg)] hover:bg-[color-mix(in_srgb,var(--erpx-green)_18%,var(--erpx-surface))] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erpx-green)]/35"
            >
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--erpx-green-border)] bg-[var(--erpx-surface)]">
                    <Car
                        size={17}
                        className="shrink-0 text-[var(--erpx-green)]"
                        strokeWidth={2}
                    />
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--erpx-brand)] truncate leading-tight">{nav}</p>
                    <p className="text-[11px] text-[var(--erpx-ink-secondary)] truncate mt-0.5 leading-snug">{em}</p>
                    <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5 leading-snug">{vehicleLine}</p>
                    <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5">{plate}</p>
                </div>
                {when && (
                    <span className="text-[11px] font-medium text-[var(--erpx-ink-muted)] tabular-nums text-right shrink-0">
                        {format(when, 'HH:mm')}
                    </span>
                )}
            </button>
        );
    }
    const tone = statusTone(ex.status);
    return (
        <button
            type="button"
            onClick={onClick}
            className={`group w-full text-left px-3 py-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center transition-colors hover:bg-[var(--erpx-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erpx-brand)]/40 ${tone.bg}`}
        >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)]">
                <Car size={17} className={`shrink-0 ${tone.text}`} strokeWidth={2} />
            </span>
            <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--erpx-brand)] truncate leading-tight">{nav}</p>
                <p className="text-[11px] text-[var(--erpx-ink-secondary)] truncate mt-0.5 leading-snug">{em}</p>
                <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5 leading-snug">{vehicleLine}</p>
                <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5">{plate}</p>
            </div>
            <div className="text-right shrink-0 min-w-[3.5rem]">
                <span className={`text-[9px] font-bold uppercase tracking-wide block ${tone.text}`}>{tone.label}</span>
                {when && (
                    <span className="text-[11px] font-medium text-[var(--erpx-ink-muted)] tabular-nums">
                        {format(when, 'HH:mm')}
                    </span>
                )}
            </div>
        </button>
    );
}

function ReturnOpsRow({ r, plate, vehicleLine, email, onClick, done }) {
    const when = tsToDate(r.iadeTarihi);
    const nav = returnNavTitle(r) || plate;
    const em = customerEmailLine(email);
    if (done) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="group w-full text-left px-3 py-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center bg-[var(--erpx-green-bg)] hover:bg-[color-mix(in_srgb,var(--erpx-green)_18%,var(--erpx-surface))] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erpx-green)]/35"
            >
                <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--erpx-green-border)] bg-[var(--erpx-surface)] text-[var(--erpx-green)] font-bold text-xs">
                    ↺
                </span>
                <div className="min-w-0">
                    <p className="text-sm font-bold text-[var(--erpx-brand)] truncate leading-tight">{nav}</p>
                    <p className="text-[11px] text-[var(--erpx-ink-secondary)] truncate mt-0.5 leading-snug">{em}</p>
                    <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5 leading-snug">{vehicleLine}</p>
                    <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5">{plate}</p>
                </div>
                {when && (
                    <span className="text-[11px] font-medium text-[var(--erpx-ink-muted)] tabular-nums text-right shrink-0">
                        {format(when, 'HH:mm')}
                    </span>
                )}
            </button>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            className="group w-full text-left px-3 py-2.5 grid grid-cols-[auto_minmax(0,1fr)_auto] gap-3 items-center bg-[color-mix(in_srgb,var(--erpx-amber)_14%,var(--erpx-surface))] hover:bg-[color-mix(in_srgb,var(--erpx-amber)_24%,var(--erpx-surface))] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--erpx-amber)]/35"
        >
            <span className="flex h-9 w-9 items-center justify-center rounded-md border border-[var(--erpx-amber)]/40 bg-[var(--erpx-surface)] text-[var(--erpx-amber)] font-bold text-xs">
                ↺
            </span>
            <div className="min-w-0">
                <p className="text-sm font-bold text-[var(--erpx-brand)] truncate leading-tight">{nav}</p>
                <p className="text-[11px] text-[var(--erpx-ink-secondary)] truncate mt-0.5 leading-snug">{em}</p>
                <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5 leading-snug">{vehicleLine}</p>
                <p className="text-[10px] text-[var(--erpx-ink-muted)] truncate mt-0.5">{plate}</p>
            </div>
            {when && (
                <span className="text-[11px] font-medium text-[var(--erpx-ink-muted)] tabular-nums text-right shrink-0">
                    {format(when, 'HH:mm')}
                </span>
            )}
        </button>
    );
}

/**
 * Full-width day planner with search, centered date + calendar, rich detail modal (Esc / backdrop).
 */
export function OperationsHubView({
    exits = [],
    returns = [],
    cars = [],
    franchiseId = 'CH',
    generateCheckoutPDF,
    generateReturnReportPdfDocument,
    /** Same payload as iOS `FirebaseService.softDeleteDocument` for `exitIslemleri` (isDeleted + deletedAt + deletedBy). */
    onSoftDeleteExit,
    /** Same as web Returns view / iOS `deleteIadeIslemi` — includes `expectedReturnDismissedAt` on linked exit when applicable. */
    onSoftDeleteReturn,
}) {
    const toast = useToast();
    const showTurkeyDocs = isTurkeyFranchiseIdForDocs(franchiseId);
    const [cursor, setCursor] = useState(() => new Date());
    const [searchQuery, setSearchQuery] = useState('');
    const [detailExit, setDetailExit] = useState(null);
    const [detailReturn, setDetailReturn] = useState(null);
    const [removeBusy, setRemoveBusy] = useState(false);
    const [checkoutPdfBusy, setCheckoutPdfBusy] = useState(false);
    const [returnPdfBusy, setReturnPdfBusy] = useState(false);
    const [returnPdfOverlay, setReturnPdfOverlay] = useState(null);
    const [imagePreviewUrl, setImagePreviewUrl] = useState(null);

    const range = useMemo(() => {
        const sd = startOfDay(cursor);
        const ed = endOfDay(cursor);
        return { sd, ed };
    }, [cursor]);

    const plateForExit = useCallback(
        (ex) => {
            const id = ex.aracId;
            const car = (cars || []).find((c) => String(c.id) === String(id) || String(c.documentId) === String(id));
            return car?.plaka || ex.aracPlaka || '—';
        },
        [cars]
    );

    const plateForReturn = useCallback(
        (r) => {
            const id = r.aracId;
            const car = (cars || []).find((c) => String(c.id) === String(id) || String(c.documentId) === String(id));
            return car?.plaka || r.aracPlaka || '—';
        },
        [cars]
    );

    const { pendingExits, doneExits, pendingReturns, doneReturns } = useMemo(() => {
        const { sd, ed } = range;
        const dayStartMs = sd.getTime();
        // First pass: deduplicate by document id before any business-key logic
        const exRaw = (exits || []).filter((e) => exitMatchesCalendarDay(e, sd, ed));
        const idDedupeMap = new Map();
        for (const e of exRaw) {
            const key = e.id || e.documentId;
            if (key) {
                if (idDedupeMap.has(key)) {
                    console.info('[OperationsHubView] Removed duplicate exit id:', key);
                }
                idDedupeMap.set(key, e);
            } else {
                idDedupeMap.set(e, e);
            }
        }
        const ex = Array.from(idDedupeMap.values());

        const completedExitStrong = new Set();
        const completedExitWeak = new Set();
        for (const e of ex) {
            if (String(e.status || '') === 'Completed') {
                completedExitStrong.add(exitBusinessDedupeKey(e, plateForExit(e)));
                const wk = exitWeakDedupeKey(e, plateForExit(e));
                if (wk) completedExitWeak.add(wk);
            }
        }
        const pe = dedupePendingExitsByWeakKey(
            ex
                .filter((e) => e.status !== 'Completed')
                .filter((e) => {
                    if (completedExitStrong.has(exitBusinessDedupeKey(e, plateForExit(e)))) return false;
                    const wk = exitWeakDedupeKey(e, plateForExit(e));
                    return !(wk && completedExitWeak.has(wk));
                })
                .sort((a, b) => exitSortKey(b) - exitSortKey(a)),
            plateForExit
        );

        const deSorted = ex.filter((e) => e.status === 'Completed').sort((a, b) => exitSortKey(b) - exitSortKey(a));
        const seenDoneStrong = new Set();
        const seenDoneWeak = new Set();
        const de = deSorted.filter((e) => {
            const k = exitBusinessDedupeKey(e, plateForExit(e));
            if (seenDoneStrong.has(k)) return false;
            const wk = exitWeakDedupeKey(e, plateForExit(e));
            if (wk && seenDoneWeak.has(wk)) return false;
            seenDoneStrong.add(k);
            if (wk) seenDoneWeak.add(wk);
            return true;
        });

        const ret = dedupeReturnRowsForOperationsList(
            (returns || []).filter((r) => inRange(tsToDate(r.iadeTarihi), sd, ed)),
            plateForReturn
        );

        const completedReturnKeys = new Set();
        const completedLinkedExitIds = new Set();
        for (const r of ret) {
            if (String(r.status || '') === 'Completed') {
                completedReturnKeys.add(returnBusinessDedupeKey(r, plateForReturn(r)));
                if (r.linkedExitId) completedLinkedExitIds.add(String(r.linkedExitId).trim());
            }
        }

        const checkoutDone = (ex) => {
            const st = String(ex?.status || '');
            return st === 'Completed' || st === 'Parked';
        };
        const pr = dedupePendingReturnsByKey(
            ret
                .filter((r) => r.status !== 'Completed')
                .filter((r) => {
                    const linkId = r.linkedExitId ? String(r.linkedExitId).trim() : '';
                    if (!linkId) return true;
                    const linkedExit = (exits || []).find(
                        (e) => String(e.id || e.documentId || '').trim() === linkId
                    );
                    if (linkedExit) return checkoutDone(linkedExit);
                    // Linked checkout not loaded yet — hide auto-planned rows until exit completes.
                    if (r.expectedReturnPlanned) return false;
                    return true;
                })
                .filter((r) => !completedReturnKeys.has(returnBusinessDedupeKey(r, plateForReturn(r))))
                .sort((a, b) => returnSortKey(b) - returnSortKey(a)),
            plateForReturn,
            dayStartMs
        );

        const drSorted = ret.filter((r) => r.status === 'Completed').sort((a, b) => returnSortKey(b) - returnSortKey(a));
        const dr = dedupePendingReturnsByKey(drSorted, plateForReturn, dayStartMs);

        return { pendingExits: pe, doneExits: de, pendingReturns: pr, doneReturns: dr };
    }, [exits, returns, range, plateForExit, plateForReturn]);

    const q = searchQuery.trim().toLowerCase();
    const filterLists = useCallback(
        (list, isExit) =>
            q
                ? list.filter((row) =>
                      isExit ? exitMatchesSearch(row, plateForExit, q) : returnMatchesSearch(row, plateForReturn, q)
                  )
                : list,
        [q, plateForExit, plateForReturn]
    );

    const dayInputValue = format(cursor, 'yyyy-MM-dd');
    const fPendingExits = useMemo(() => filterLists(pendingExits, true), [filterLists, pendingExits]);
    const fDoneExits = useMemo(() => filterLists(doneExits, true), [filterLists, doneExits]);
    const fPendingReturns = useMemo(() => filterLists(pendingReturns, false), [filterLists, pendingReturns]);
    const fDoneReturns = useMemo(() => filterLists(doneReturns, false), [filterLists, doneReturns]);
    const pendingExitsPager = useClientPagination(fPendingExits, {
        pageSize: 25,
        resetKey: `pending-exits-${dayInputValue}-${q}`,
    });
    const pendingReturnsPager = useClientPagination(fPendingReturns, {
        pageSize: 25,
        resetKey: `pending-returns-${dayInputValue}-${q}`,
    });

    const closeDetail = useCallback(() => {
        setDetailExit(null);
        setDetailReturn(null);
    }, []);

    const handleSoftRemoveFromList = useCallback(async () => {
        if (removeBusy) return;
        if (detailExit && onSoftDeleteExit) {
            if (!window.confirm('Remove this checkout from the list? (Soft delete — same as iOS; hidden on all devices.)')) return;
            setRemoveBusy(true);
            try {
                await onSoftDeleteExit(detailExit);
                toast.success('Checkout removed');
                closeDetail();
            } catch (err) {
                console.error(err);
                toast.error(err?.message || 'Could not remove checkout');
            } finally {
                setRemoveBusy(false);
            }
            return;
        }
        if (detailReturn && onSoftDeleteReturn) {
            if (!window.confirm('Remove this return from the list? (Soft delete — same as iOS; hidden on all devices.)')) return;
            setRemoveBusy(true);
            try {
                await onSoftDeleteReturn(detailReturn);
                toast.success('Return removed');
                closeDetail();
            } catch (err) {
                console.error(err);
                toast.error(err?.message || 'Could not remove return');
            } finally {
                setRemoveBusy(false);
            }
        }
    }, [removeBusy, detailExit, detailReturn, onSoftDeleteExit, onSoftDeleteReturn, closeDetail, toast]);

    const carForExit = useCallback(
        (ex) =>
            (cars || []).find((c) => String(c.id) === String(ex?.aracId) || String(c.documentId) === String(ex?.aracId)) ||
            null,
        [cars]
    );

    const carForReturn = useCallback(
        (r) =>
            (cars || []).find((c) => String(c.id) === String(r?.aracId) || String(c.documentId) === String(r?.aracId)) ||
            null,
        [cars]
    );

    const runCheckoutPdf = useCallback(
        async (lang) => {
            if (!detailExit || !generateCheckoutPDF) {
                toast.error('PDF generation is not available.');
                return;
            }
            const car = carForExit(detailExit);
            setCheckoutPdfBusy(true);
            try {
                await generateCheckoutPDF(detailExit, car, { lang });
                toast.success('PDF generated successfully');
            } catch (err) {
                console.error(err);
                toast.error(err?.message || 'Failed to generate PDF');
            } finally {
                setCheckoutPdfBusy(false);
            }
        },
        [detailExit, generateCheckoutPDF, carForExit, toast]
    );

    const runReturnPdf = useCallback(
        async (lang) => {
            if (!detailReturn || !generateReturnReportPdfDocument) {
                toast.error('PDF generation is not available.');
                return;
            }
            const car = carForReturn(detailReturn);
            const returnPhotos = detailReturn.fotograflar || [];
            await generateReturnReportPdfDocument({
                ret: detailReturn,
                car,
                returnPhotos,
                lang,
                toast,
                setPdfOverlay: setReturnPdfOverlay,
                setIsGeneratingPDF: setReturnPdfBusy,
            });
        },
        [detailReturn, generateReturnReportPdfDocument, carForReturn, toast]
    );

    useEffect(() => {
        if (!detailExit && !detailReturn && !imagePreviewUrl) return undefined;
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (imagePreviewUrl) {
                setImagePreviewUrl(null);
                return;
            }
            closeDetail();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [detailExit, detailReturn, imagePreviewUrl, closeDetail]);

    return (
        <div className="w-full min-w-0 flex flex-col px-sap-3 sm:px-sap-4 pb-sap-6">
            <div className={`pal-dash-panel overflow-hidden ${OPS_GRID_BG}`}>
                {/* Title row */}
                <header className="erpx-page-header border-b border-[var(--erpx-border)] bg-[var(--erpx-surface)] px-4 sm:px-6 py-4 sm:py-5 !mb-0">
                    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 sm:gap-4 w-full">
                        <div className="flex items-start gap-3">
                            <PalantirPageIcon navKey="operations" />
                            <div>
                            <h1 className="erpx-page-title">
                                Operations
                            </h1>
                            <p className="erpx-page-subtitle max-w-2xl leading-relaxed">
                                Day planner for <span className="font-semibold text-[var(--erpx-ink)]">{String(franchiseId).toUpperCase()}</span>
                                . Rows show check-outs and returns whose time falls on the selected calendar day.
                            </p>
                        </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {showTurkeyDocs && <TurkeyDocumentationButton topicId="operations_hub" />}
                            <div className="hidden sm:flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--erpx-ink-muted)]">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
                                    Waiting
                                </span>
                                <span className="text-[var(--erpx-border-strong)]">|</span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                                    Done
                                </span>
                            </div>
                        </div>
                    </div>
                </header>

                {/* Search + date — grid cells */}
                <div className="border-b border-[var(--erpx-border)] bg-[var(--erpx-surface)]">
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto] lg:divide-x lg:divide-[var(--erpx-border)]">
                        <div className="p-3 sm:p-4">
                            <label className="sr-only" htmlFor="ops-hub-search">
                                Search
                            </label>
                            <div className="relative max-w-xl">
                                <Search
                                    className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--erpx-ink-muted)] pointer-events-none"
                                    size={16}
                                    strokeWidth={2}
                                />
                                <input
                                    id="ops-hub-search"
                                    type="search"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search plate, NAV / RES, name, email…"
                                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] text-sm text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)] shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] focus:outline-none focus:ring-2 focus:ring-[var(--erpx-brand)]/35 focus:border-[var(--erpx-brand)]/50"
                                />
                            </div>
                        </div>
                        <div className="p-3 sm:p-4 flex flex-wrap items-stretch sm:items-center justify-center gap-3 border-t border-[var(--erpx-border)] lg:border-t-0 min-w-0">
                            <button
                                type="button"
                                onClick={() => setCursor((d) => addDays(d, -1))}
                                className="pal-btn !h-12 !w-12 sm:!h-[52px] sm:!w-[52px] !p-0 shrink-0"
                                aria-label="Previous day"
                            >
                                <ArrowLeft size={20} strokeWidth={2.25} />
                            </button>
                            <div className="min-w-[min(100%,100%)] sm:min-w-[300px] sm:max-w-[420px] flex-1">
                                <UnifiedDatePicker
                                    value={dayInputValue}
                                    onChange={(v) => {
                                        const d = parseDayInput(v);
                                        if (d) setCursor(d);
                                    }}
                                    placement="below"
                                    size="lg"
                                    variant="palantir"
                                    className="w-full"
                                />
                            </div>
                            <button
                                type="button"
                                onClick={() => setCursor((d) => addDays(d, 1))}
                                className="pal-btn !h-12 !w-12 sm:!h-[52px] sm:!w-[52px] !p-0 shrink-0"
                                aria-label="Next day"
                            >
                                <ArrowRight size={20} strokeWidth={2.25} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Stacked layout: below xl breakpoint */}
                <div className="xl:hidden grid grid-cols-1 min-h-0">
                    <section className="flex flex-col min-h-0 bg-[var(--erpx-surface)] border-b border-[var(--erpx-border)]">
                        <div className="shrink-0 px-4 py-3 border-b border-[var(--erpx-border)] bg-[var(--erpx-subtle)] flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                                <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--erpx-ink)] tracking-tight">Check-outs</h3>
                                <p className="text-[10px] text-[var(--erpx-ink-muted)]">Vehicle leaving the branch</p>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                            <OpsPanelSection title="Waiting / in progress" count={fPendingExits.length}>
                                {fPendingExits.length === 0 ? (
                                    <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                        None for this day.
                                    </p>
                                ) : (
                                    pendingExitsPager.paginatedItems.map((ex, idx) => (
                                        <ExitOpsRow
                                            key={`${ex.documentId || ex.id || 'exit'}-${idx}`}
                                            ex={ex}
                                            plate={plateForExit(ex)}
                                            vehicleLine={vehicleSummaryLine(carForExit(ex))}
                                            done={false}
                                            onClick={() => {
                                                setDetailReturn(null);
                                                setDetailExit(ex);
                                            }}
                                        />
                                    ))
                                )}
                            </OpsPanelSection>
                            {fPendingExits.length > pendingExitsPager.pageSize && (
                                <PalantirTablePager
                                    totalItems={pendingExitsPager.totalItems}
                                    rangeFrom={pendingExitsPager.rangeFrom}
                                    rangeTo={pendingExitsPager.rangeTo}
                                    page={pendingExitsPager.page}
                                    totalPages={pendingExitsPager.totalPages}
                                    pageSize={pendingExitsPager.pageSize}
                                    pageSizeOptions={pendingExitsPager.pageSizeOptions}
                                    onPageChange={pendingExitsPager.setPage}
                                    onPageSizeChange={pendingExitsPager.setPageSize}
                                    totalLabel="pending check-outs"
                                />
                            )}
                            <OpsPanelSection title="Completed" count={fDoneExits.length}>
                                {fDoneExits.length === 0 ? (
                                    <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                        None for this day.
                                    </p>
                                ) : (
                                    fDoneExits.map((ex, idx) => (
                                        <ExitOpsRow
                                            key={`${ex.documentId || ex.id || 'exit'}-${idx}`}
                                            ex={ex}
                                            plate={plateForExit(ex)}
                                            vehicleLine={vehicleSummaryLine(carForExit(ex))}
                                            done
                                            onClick={() => {
                                                setDetailReturn(null);
                                                setDetailExit(ex);
                                            }}
                                        />
                                    ))
                                )}
                            </OpsPanelSection>
                        </div>
                    </section>

                    <section className="flex flex-col min-h-0 bg-[var(--erpx-surface)]">
                        <div className="shrink-0 px-4 py-3 border-b border-[var(--erpx-border)] bg-[var(--erpx-subtle)] flex items-center gap-2.5">
                            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
                                <ArrowLeft size={16} strokeWidth={2.5} aria-hidden />
                            </span>
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--erpx-ink)] tracking-tight">Returns</h3>
                                <p className="text-[10px] text-[var(--erpx-ink-muted)]">Vehicle coming back</p>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                            <OpsPanelSection title="Waiting / in progress" count={fPendingReturns.length}>
                                {fPendingReturns.length === 0 ? (
                                    <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                        None for this day.
                                    </p>
                                ) : (
                                    pendingReturnsPager.paginatedItems.map((r, idx) => (
                                        <ReturnOpsRow
                                            key={`${r.documentId || r.id || 'ret'}-${idx}`}
                                            r={r}
                                            plate={plateForReturn(r)}
                                            vehicleLine={vehicleSummaryLine(carForReturn(r))}
                                            email={r.customerEmail}
                                            done={false}
                                            onClick={() => {
                                                setDetailExit(null);
                                                setDetailReturn(r);
                                            }}
                                        />
                                    ))
                                )}
                            </OpsPanelSection>
                            {fPendingReturns.length > pendingReturnsPager.pageSize && (
                                <PalantirTablePager
                                    totalItems={pendingReturnsPager.totalItems}
                                    rangeFrom={pendingReturnsPager.rangeFrom}
                                    rangeTo={pendingReturnsPager.rangeTo}
                                    page={pendingReturnsPager.page}
                                    totalPages={pendingReturnsPager.totalPages}
                                    pageSize={pendingReturnsPager.pageSize}
                                    pageSizeOptions={pendingReturnsPager.pageSizeOptions}
                                    onPageChange={pendingReturnsPager.setPage}
                                    onPageSizeChange={pendingReturnsPager.setPageSize}
                                    totalLabel="pending returns"
                                />
                            )}
                            <OpsPanelSection title="Completed" count={fDoneReturns.length}>
                                {fDoneReturns.length === 0 ? (
                                    <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                        None for this day.
                                    </p>
                                ) : (
                                    fDoneReturns.map((r, idx) => (
                                        <ReturnOpsRow
                                            key={`${r.documentId || r.id || 'ret'}-${idx}`}
                                            r={r}
                                            plate={plateForReturn(r)}
                                            vehicleLine={vehicleSummaryLine(carForReturn(r))}
                                            email={r.customerEmail}
                                            done
                                            onClick={() => {
                                                setDetailExit(null);
                                                setDetailReturn(r);
                                            }}
                                        />
                                    ))
                                )}
                            </OpsPanelSection>
                        </div>
                    </section>
                </div>

                {/* xl+: Waiting / Completed rows aligned across columns */}
                <div className="hidden xl:grid xl:grid-cols-2 xl:grid-rows-[auto_minmax(220px,1fr)_minmax(220px,1fr)] xl:divide-x xl:divide-[var(--erpx-border)] min-h-0">
                    <div className="shrink-0 px-4 py-3 border-b border-[var(--erpx-border)] bg-[var(--erpx-subtle)] flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-sm">
                            <ArrowRight size={16} strokeWidth={2.5} aria-hidden />
                        </span>
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--erpx-ink)] tracking-tight">Check-outs</h3>
                            <p className="text-[10px] text-[var(--erpx-ink-muted)]">Vehicle leaving the branch</p>
                        </div>
                    </div>
                    <div className="shrink-0 px-4 py-3 border-b border-[var(--erpx-border)] bg-[var(--erpx-subtle)] flex items-center gap-2.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-white shadow-sm">
                            <ArrowLeft size={16} strokeWidth={2.5} aria-hidden />
                        </span>
                        <div>
                            <h3 className="text-sm font-semibold text-[var(--erpx-ink)] tracking-tight">Returns</h3>
                            <p className="text-[10px] text-[var(--erpx-ink-muted)]">Vehicle coming back</p>
                        </div>
                    </div>

                    <div className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--erpx-surface)] border-b border-[var(--erpx-border)]">
                        <OpsPanelSection title="Waiting / in progress" count={fPendingExits.length}>
                            {fPendingExits.length === 0 ? (
                                <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                    None for this day.
                                </p>
                            ) : (
                                pendingExitsPager.paginatedItems.map((ex, idx) => (
                                    <ExitOpsRow
                                        key={`${ex.documentId || ex.id || 'exit'}-${idx}`}
                                        ex={ex}
                                        plate={plateForExit(ex)}
                                        vehicleLine={vehicleSummaryLine(carForExit(ex))}
                                        done={false}
                                        onClick={() => {
                                            setDetailReturn(null);
                                            setDetailExit(ex);
                                        }}
                                    />
                                ))
                            )}
                        </OpsPanelSection>
                        {fPendingExits.length > pendingExitsPager.pageSize && (
                            <PalantirTablePager
                                totalItems={pendingExitsPager.totalItems}
                                rangeFrom={pendingExitsPager.rangeFrom}
                                rangeTo={pendingExitsPager.rangeTo}
                                page={pendingExitsPager.page}
                                totalPages={pendingExitsPager.totalPages}
                                pageSize={pendingExitsPager.pageSize}
                                pageSizeOptions={pendingExitsPager.pageSizeOptions}
                                onPageChange={pendingExitsPager.setPage}
                                onPageSizeChange={pendingExitsPager.setPageSize}
                                totalLabel="pending check-outs"
                            />
                        )}
                    </div>
                    <div className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--erpx-surface)] border-b border-[var(--erpx-border)]">
                        <OpsPanelSection title="Waiting / in progress" count={fPendingReturns.length}>
                            {fPendingReturns.length === 0 ? (
                                <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                    None for this day.
                                </p>
                            ) : (
                                pendingReturnsPager.paginatedItems.map((r, idx) => (
                                    <ReturnOpsRow
                                        key={`${r.documentId || r.id || 'ret'}-${idx}`}
                                        r={r}
                                        plate={plateForReturn(r)}
                                        vehicleLine={vehicleSummaryLine(carForReturn(r))}
                                        email={r.customerEmail}
                                        done={false}
                                        onClick={() => {
                                            setDetailExit(null);
                                            setDetailReturn(r);
                                        }}
                                    />
                                ))
                            )}
                        </OpsPanelSection>
                        {fPendingReturns.length > pendingReturnsPager.pageSize && (
                            <PalantirTablePager
                                totalItems={pendingReturnsPager.totalItems}
                                rangeFrom={pendingReturnsPager.rangeFrom}
                                rangeTo={pendingReturnsPager.rangeTo}
                                page={pendingReturnsPager.page}
                                totalPages={pendingReturnsPager.totalPages}
                                pageSize={pendingReturnsPager.pageSize}
                                pageSizeOptions={pendingReturnsPager.pageSizeOptions}
                                onPageChange={pendingReturnsPager.setPage}
                                onPageSizeChange={pendingReturnsPager.setPageSize}
                                totalLabel="pending returns"
                            />
                        )}
                    </div>

                    <div className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--erpx-surface)]">
                        <OpsPanelSection title="Completed" count={fDoneExits.length}>
                            {fDoneExits.length === 0 ? (
                                <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                    None for this day.
                                </p>
                            ) : (
                                fDoneExits.map((ex, idx) => (
                                    <ExitOpsRow
                                        key={`${ex.documentId || ex.id || 'exit'}-${idx}`}
                                        ex={ex}
                                        plate={plateForExit(ex)}
                                        vehicleLine={vehicleSummaryLine(carForExit(ex))}
                                        done
                                        onClick={() => {
                                            setDetailReturn(null);
                                            setDetailExit(ex);
                                        }}
                                    />
                                ))
                            )}
                        </OpsPanelSection>
                    </div>
                    <div className="min-h-0 overflow-y-auto overscroll-contain bg-[var(--erpx-surface)]">
                        <OpsPanelSection title="Completed" count={fDoneReturns.length}>
                            {fDoneReturns.length === 0 ? (
                                <p className="px-3 py-8 text-center text-xs text-[var(--erpx-ink-muted)] border border-dashed border-[var(--erpx-border)] rounded-none bg-[var(--erpx-subtle)] m-2">
                                    None for this day.
                                </p>
                            ) : (
                                fDoneReturns.map((r) => (
                                    <ReturnOpsRow
                                        key={r.id || r.documentId}
                                        r={r}
                                        plate={plateForReturn(r)}
                                        vehicleLine={vehicleSummaryLine(carForReturn(r))}
                                        email={r.customerEmail}
                                        done
                                        onClick={() => {
                                            setDetailExit(null);
                                            setDetailReturn(r);
                                        }}
                                    />
                                ))
                            )}
                        </OpsPanelSection>
                    </div>
                </div>
            </div>

            {(detailExit || detailReturn) && (
                <div
                    className="pal-wb-overlay fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-4"
                    onClick={closeDetail}
                >
                    <div
                        className="pal-modal w-full max-w-3xl max-h-[90vh] overflow-y-auto p-4 sm:p-5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-start justify-between gap-2 mb-3">
                            <h4 className="text-sm font-semibold text-[var(--erpx-ink)]">
                                {detailExit ? 'Check-out detail' : 'Return detail'}
                            </h4>
                            <button
                                type="button"
                                className="pal-btn pal-btn-icon !p-2"
                                onClick={closeDetail}
                                aria-label="Close"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {detailExit && (
                            <ExitDetailBody
                                ex={detailExit}
                                plate={plateForExit(detailExit)}
                                car={carForExit(detailExit)}
                                onOpenPhoto={setImagePreviewUrl}
                                onPdfEnglish={() => runCheckoutPdf('en')}
                                onPdfTurkish={() => runCheckoutPdf('tr')}
                                pdfBusy={checkoutPdfBusy}
                            />
                        )}
                        {detailReturn && (
                            <ReturnDetailBody
                                r={detailReturn}
                                plate={plateForReturn(detailReturn)}
                                car={carForReturn(detailReturn)}
                                exits={exits}
                                onOpenPhoto={setImagePreviewUrl}
                                onPdfEnglish={() => runReturnPdf('en')}
                                onPdfTurkish={() => runReturnPdf('tr')}
                                pdfBusy={returnPdfBusy}
                            />
                        )}

                        {((detailExit && onSoftDeleteExit) || (detailReturn && onSoftDeleteReturn)) && (
                            <div className="mt-4 pt-3 border-t border-[var(--erpx-border)]">
                                <p className="text-xs text-[var(--erpx-ink-muted)] mb-2">
                                    Removes this row from Operations, Returns / Checkout lists, and iOS — document stays in
                                    Firestore with <span className="font-mono text-[11px]">isDeleted: true</span> (no duplicate
                                    re-create).
                                </p>
                                <button
                                    type="button"
                                    disabled={removeBusy || checkoutPdfBusy || returnPdfBusy}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        void handleSoftRemoveFromList();
                                    }}
                                    className="pal-btn pal-btn-danger inline-flex items-center justify-center gap-sap-2 disabled:opacity-50"
                                >
                                    <Trash2 size={16} />
                                    {removeBusy ? 'Removing…' : 'Remove from list (soft delete)'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {imagePreviewUrl && (
                <ZoomableImageOverlay
                    images={imagePreviewUrl.images}
                    startIndex={imagePreviewUrl.startIndex}
                    onClose={() => setImagePreviewUrl(null)}
                />
            )}
            <OpsPdfOverlay state={returnPdfOverlay} />
        </div>
    );
}

function ExitDetailBody({ ex, plate, car, onOpenPhoto, onPdfEnglish, onPdfTurkish, pdfBusy }) {
    const photos = Array.isArray(ex.fotograflar) ? ex.fotograflar.filter(Boolean) : [];
    const pu = String(ex.pickUpBranch || '').trim();
    const dr = String(ex.dropOffBranch || '').trim();
    const bookingCodeLabel = (() => {
        const fid = String(ex?.franchiseId || car?.franchiseId || '').toUpperCase();
        if (fid.startsWith('TR')) return 'NAV Code';
        if (fid.startsWith('DE')) return 'RNT Code';
        return 'RES Code';
    })();
    const bookingCodeValue = ex.navKodu || ex.resKodu || '—';
    return (
        <div className="space-y-sap-4 text-sap-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                <DetailRow label="Plate" value={plate} />
                <DetailRow label={bookingCodeLabel} value={bookingCodeValue} />
                <DetailRow label="Brand" value={car?.marka?.trim() || '—'} />
                <DetailRow label="Model" value={car?.model?.trim() || '—'} />
                <DetailRow label="Category" value={car?.kategori?.trim() || '—'} />
                <DetailRow label="Status" value={ex.status || '—'} />
                <DetailRow
                    label="Checkout"
                    value={formatProcessDate(ex.exitTarihi, ex.franchiseId || car?.franchiseId)}
                />
                <DetailRow
                    label="Expected return"
                    value={formatProcessDate(ex.plannedCheckinAt, ex.franchiseId || car?.franchiseId)}
                />
                <DetailRow label="Customer" value={customerNameFromExit(ex) || '—'} />
                <DetailRow label="Email" value={ex.customerEmail || '—'} />
                <DetailRow label="KM" value={ex.km != null ? String(ex.km) : '—'} />
                <DetailRow label="Fuel" value={ex.yakitSeviyesi || '—'} />
                <DetailRow label="Branch" value={ex.bayiAdi || '—'} />
                {(pu || dr) && (
                    <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {pu ? <DetailRow label="Pick-up" value={pu} /> : null}
                        {dr ? <DetailRow label="Drop-off" value={dr} /> : null}
                    </div>
                )}
            </dl>

            {photos.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erpx-ink-muted)] mb-2">Photos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {photos.map((url, photoIndex) => (
                            <button
                                key={url}
                                type="button"
                                className="block aspect-video rounded-sap-sm overflow-hidden bg-black/5 border border-sap-border-light dark:border-sap-borderDark-light p-0 cursor-zoom-in"
                                onClick={() => onOpenPhoto({ images: photos, startIndex: photoIndex })}
                            >
                                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-sap-border-light/80 dark:border-sap-borderDark-light/80">
                <button
                    type="button"
                    disabled={pdfBusy}
                    onClick={onPdfEnglish}
                    className="pal-btn pal-btn-sm inline-flex items-center gap-1 flex-1 min-w-[140px] justify-center"
                >
                    <FileText size={14} />
                    Generate PDF (English)
                </button>
                <button
                    type="button"
                    disabled={pdfBusy}
                    onClick={onPdfTurkish}
                    className="pal-btn pal-btn-primary pal-btn-sm inline-flex items-center gap-1 flex-1 min-w-[140px] justify-center"
                >
                    <FileText size={14} />
                    Generate PDF (Turkish)
                </button>
            </div>
        </div>
    );
}

function ReturnDetailBody({ r, plate, car, exits = [], onOpenPhoto, onPdfEnglish, onPdfTurkish, pdfBusy }) {
    const photos = Array.isArray(r.fotograflar) ? r.fotograflar.filter(Boolean) : [];

    const linkedExit = useMemo(() => {
        const lid = r.linkedExitId != null ? String(r.linkedExitId).trim() : '';
        if (lid && Array.isArray(exits) && exits.length) {
            const hit = exits.find((e) => String(e.id || e.documentId || '') === lid);
            if (hit) return hit;
        }
        const aid = r.aracId != null ? String(r.aracId) : '';
        if (!aid || !Array.isArray(exits) || !exits.length) return null;
        const completed = exits.filter(
            (e) => String(e.aracId || '') === aid && String(e.status || '') === 'Completed'
        );
        if (completed.length === 0) return null;
        return completed.slice().sort((a, b) => exitSortKey(b) - exitSortKey(a))[0];
    }, [r, exits]);

    const pu = String(r.pickUpBranch || linkedExit?.pickUpBranch || '').trim();
    const dr = String(r.dropOffBranch || linkedExit?.dropOffBranch || '').trim();

    return (
        <div className="space-y-sap-4 text-sap-sm">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                <DetailRow label="Plate" value={plate} />
                <DetailRow label="Status" value={r.status || '—'} />
                <DetailRow label="Brand" value={car?.marka?.trim() || '—'} />
                <DetailRow label="Model" value={car?.model?.trim() || '—'} />
                <DetailRow label="Category" value={car?.kategori?.trim() || '—'} />
                <DetailRow
                    label="Return time"
                    value={formatProcessDate(r.iadeTarihi, r.franchiseId || car?.franchiseId)}
                />
                <DetailRow
                    label="Customer"
                    value={[r.customerFirstName, r.customerLastName].filter(Boolean).join(' ') || '—'}
                />
                <DetailRow label="Email" value={r.customerEmail || '—'} />
                <DetailRow label="KM" value={r.km != null ? String(r.km) : '—'} />
                <DetailRow label="Fuel" value={r.yakitSeviyesi || '—'} />
                <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <DetailRow label="Pick-up branch" value={pu || '—'} />
                    <DetailRow label="Drop-off branch" value={dr || '—'} />
                </div>
            </dl>

            {photos.length > 0 && (
                <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--erpx-ink-muted)] mb-2">Photos</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {photos.map((url, photoIndex) => (
                            <button
                                key={url}
                                type="button"
                                className="block aspect-video rounded-sap-sm overflow-hidden bg-black/5 border border-sap-border-light dark:border-sap-borderDark-light p-0 cursor-zoom-in"
                                onClick={() => onOpenPhoto({ images: photos, startIndex: photoIndex })}
                            >
                                <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2 border-t border-sap-border-light/80 dark:border-sap-borderDark-light/80">
                <button
                    type="button"
                    disabled={pdfBusy}
                    onClick={onPdfEnglish}
                    className="pal-btn pal-btn-sm inline-flex items-center gap-1 flex-1 min-w-[140px] justify-center"
                >
                    <FileText size={14} />
                    Generate PDF (English)
                </button>
                <button
                    type="button"
                    disabled={pdfBusy}
                    onClick={onPdfTurkish}
                    className="pal-btn pal-btn-primary pal-btn-sm inline-flex items-center gap-1 flex-1 min-w-[140px] justify-center"
                >
                    <FileText size={14} />
                    Generate PDF (Turkish)
                </button>
            </div>
        </div>
    );
}

function DetailRow({ label, value }) {
    return (
        <div>
            <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--erpx-ink-muted)]">{label}</dt>
            <dd className="text-sm text-[var(--erpx-ink)] font-medium break-words">{value}</dd>
        </div>
    );
}
