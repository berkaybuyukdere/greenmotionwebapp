import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { motion, AnimatePresence } from 'framer-motion';
import { Car, CheckCircle2, ChevronLeft, ChevronRight, Globe, MapPin, PenLine, RotateCcw, FileText } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { useToast } from './ToastNotification';
import { buildPhoneForSave, CountryScrollSelect, IntlPhoneFields, useCountryRows } from './FrontDeskIntlFields';

const KIOSK_FORM_FIELD =
    'w-full px-3 py-2.5 rounded-md border border-[var(--erpx-border)] bg-[var(--erpx-surface)] text-[15px] text-[var(--erpx-ink)] placeholder:text-[var(--erpx-ink-muted)] focus:outline-none focus:border-[var(--erpx-brand)]';
const KIOSK_LABEL = 'block text-[12px] font-medium mb-1 text-[var(--erpx-ink-secondary)]';

function collapseSpacesWhileTyping(value) {
    return String(value || '').replace(/ {2,}/g, ' ');
}

function titleCaseField(value) {
    const s = String(value || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (/^[a-zA-Z]{2}$/.test(s)) return s.toUpperCase();
    return s
        .split(' ')
        .map((word) => {
            if (!word) return word;
            if (/^\d+$/.test(word)) return word;
            return word.charAt(0).toLocaleUpperCase() + word.slice(1).toLocaleLowerCase();
        })
        .join(' ');
}

/** Downscale signature PNGs before callable payload — large canvases stall submit. */
function compressSignatureForUpload(dataUrl, maxWidth = 640) {
    return new Promise((resolve) => {
        try {
            const raw = String(dataUrl || '').trim();
            if (!raw) {
                resolve('');
                return;
            }
            const src = raw.includes('base64,') ? raw : `data:image/png;base64,${raw}`;
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(1, maxWidth / Math.max(img.width, 1));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, w, h);
                ctx.drawImage(img, 0, 0, w, h);
                const out = canvas.toDataURL('image/jpeg', 0.72);
                const idx = out.indexOf('base64,');
                resolve(idx >= 0 ? out.slice(idx + 7) : out);
            };
            img.onerror = () => {
                const idx = raw.indexOf('base64,');
                resolve(idx >= 0 ? raw.slice(idx + 7) : raw);
            };
            img.src = src;
        } catch {
            resolve('');
        }
    });
}

function cleanLegalText(raw) {
    const text = String(raw || '').trim();
    if (!text) return '';
    return text
        .replace(/\[\[gm-swiss-frontdesk-retention-v1\]\]/g, '')
        .replace(/^\(Front[^)]*\)\s*/gm, '')
        .replace(/^\(Frontdesk[^)]*\)\s*/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function randomUUIDCompat() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x9;
        return v.toString(16);
    });
}

/** Today as DD.MM.YYYY */
function todayTR() {
    return new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Replace all template placeholders with real customer values.
 * Remaining `{signature}` markers are intentionally left for section splitting.
 */
function fillPlaceholders(text, { firstName, lastName, email, callOk, emailOk, smsOk }) {
    const fullName = `${firstName || ''} ${lastName || ''}`.trim() || '___';
    const date = todayTR();
    return text
        .replace(/\{dateDDMMYYYY\}/g, date)
        .replace(/\{deliveryDriverName\}/g, firstName || '___')
        .replace(/\{deliveryDriverLastName\}/g, lastName || '___')
        .replace(/\{ \}\s*\{ \}/g, fullName)
        .replace(/\{ \}/g, fullName)
        .replace(/\{tckn\}/g, '_______________')
        .replace(/\{callPermission\}/g, callOk ? 'Evet / Yes' : 'Hayır / No')
        .replace(/\{emailPermission\}/g, emailOk ? 'Evet / Yes' : 'Hayır / No')
        .replace(/\{smsPermission\}/g, smsOk ? 'Evet / Yes' : 'Hayır / No');
}

/**
 * Split filled text by {signature} markers.
 * Returns array of { idx, title, body }.
 */
function parseSections(raw) {
    if (!raw || !raw.includes('{signature}')) return [];
    const parts = raw.split('{signature}');
    return parts
        .map((part, idx) => {
            if (idx === parts.length - 1 && part.trim() === '') return null;
            const lines = part.split('\n').map((l) => l.trim()).filter(Boolean);
            let title = '';
            for (let i = lines.length - 1; i >= 0; i--) {
                const l = lines[i];
                if (/^(Date|Tarih|Data Subject|Veri Sahibi|Name Surname|Ad Soyad|Signature|İmza|Via |Identity)/i.test(l)) continue;
                if (l.length >= 8) { title = l.slice(0, 90); break; }
            }
            if (!title && lines.length > 0) title = lines[0].slice(0, 90);
            return { idx, title: title || `Bölüm ${idx + 1}`, body: part };
        })
        .filter(Boolean);
}

/* ─── Signature Canvas ──────────────────────────────────────────────────── */
function SignatureCanvas({ onSign, onClear, height = 160 }) {
    const canvasRef = useRef(null);
    const drawing = useRef(false);
    const lastPos = useRef({ x: 0, y: 0 });

    const getPos = (e, canvas) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        if (e.touches) {
            return {
                x: (e.touches[0].clientX - rect.left) * scaleX,
                y: (e.touches[0].clientY - rect.top) * scaleY,
            };
        }
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    };

    const start = useCallback((e) => {
        e.preventDefault();
        const canvas = canvasRef.current;
        if (!canvas) return;
        drawing.current = true;
        lastPos.current = getPos(e, canvas);
    }, []);

    const move = useCallback((e) => {
        e.preventDefault();
        if (!drawing.current) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const pos = getPos(e, canvas);
        ctx.beginPath();
        ctx.moveTo(lastPos.current.x, lastPos.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.strokeStyle = '#1d1d1f';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
        lastPos.current = pos;
    }, []);

    const end = useCallback(
        (e) => {
            e.preventDefault();
            if (!drawing.current) return;
            drawing.current = false;
            const canvas = canvasRef.current;
            if (!canvas) return;
            onSign(canvas.toDataURL('image/png'));
        },
        [onSign]
    );

    const handleClear = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onClear();
    }, [onClear]);

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                width={800}
                height={height * 2}
                style={{ width: '100%', height: `${height}px`, touchAction: 'none' }}
                className="border-2 border-dashed border-[var(--erpx-brand)] rounded-xl bg-[var(--erpx-subtle)] cursor-crosshair"
                onMouseDown={start}
                onMouseMove={move}
                onMouseUp={end}
                onMouseLeave={end}
                onTouchStart={start}
                onTouchMove={move}
                onTouchEnd={end}
            />
            <button
                type="button"
                onClick={handleClear}
                className="absolute top-2 right-2 p-1.5 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] text-[var(--erpx-ink-secondary)] hover:bg-[var(--erpx-subtle)]"
                title="Clear"
            >
                <RotateCcw size={14} />
            </button>
            <p className="text-center text-[11px] text-[var(--erpx-ink-muted)] mt-1">Yukarıya imzanızı çizin / Draw your signature above</p>
        </div>
    );
}

/* ─── Rental Terms Signing Modal ───────────────────────────────────────── */
function RentalTermsModal({
    legalDocs,
    firstName, lastName, email,
    callOk, emailOk, smsOk,
    onComplete,
    onClose,
}) {
    const [lang, setLang] = useState('tr'); // 'tr' | 'en'
    const [slotIdx, setSlotIdx] = useState(0);
    const [signatures, setSignatures] = useState([]);

    const rawText = lang === 'tr'
        ? (legalDocs?.pdfLegalTextTr || legalDocs?.termsConditionsTr || '')
        : (legalDocs?.pdfLegalTextEn || legalDocs?.termsConditionsEn || '');

    const filledText = useMemo(
        () => fillPlaceholders(rawText, { firstName, lastName, email, callOk, emailOk, smsOk }),
        [rawText, firstName, lastName, email, callOk, emailOk, smsOk]
    );

    const sections = useMemo(() => parseSections(filledText), [filledText]);
    const hasSections = sections.length >= 1;

    // Reset to first slot and clear sigs when language changes
    useEffect(() => {
        setSlotIdx(0);
        setSignatures([]);
    }, [lang]);

    const currentSection = sections[slotIdx];
    const currentSig = signatures[slotIdx] || null;
    const allSigned = hasSections && sections.every((_, i) => !!signatures[i]);

    const handleSign = useCallback(
        (dataUrl) => {
            setSignatures((prev) => {
                const next = [...prev];
                next[slotIdx] = dataUrl;
                return next;
            });
        },
        [slotIdx]
    );

    const handleClear = useCallback(() => {
        setSignatures((prev) => {
            const next = [...prev];
            next[slotIdx] = null;
            return next;
        });
    }, [slotIdx]);

    if (!hasSections) {
        return (
            <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
                <div className="bg-[var(--erpx-surface)] border border-[var(--erpx-border)] rounded-2xl p-8 max-w-sm w-full text-center">
                    <p className="text-[14px] text-[var(--erpx-ink-secondary)] mb-4">
                        Rental terms not configured for this branch yet. Please contact support.
                    </p>
                    <button onClick={onClose} className="pal-btn pal-btn-primary">
                        Close
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black/60 z-[80] flex flex-col">
            {/* Modal container — full screen on mobile, constrained on desktop */}
            <div className="flex-1 flex flex-col bg-[var(--erpx-panel)] sm:m-4 sm:rounded-2xl border border-[var(--erpx-border)] overflow-hidden">

                {/* ── Header ── */}
                <div className="bg-[var(--erpx-subtle)] px-4 py-3 border-b border-[var(--erpx-border)] flex-shrink-0">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <FileText size={16} className="text-[var(--erpx-brand)]" />
                            <span className="text-[14px] font-semibold text-[var(--erpx-ink)]">General Rental Terms</span>
                        </div>
                        {/* Language toggle */}
                        <div className="flex items-center gap-1 bg-[var(--erpx-surface)] rounded-lg border border-[var(--erpx-border)] p-0.5">
                            <button
                                type="button"
                                onClick={() => setLang('tr')}
                                className={`pal-btn pal-btn-sm !min-h-[30px] !py-1 !px-2.5 ${
                                    lang === 'tr' ? 'pal-btn-primary' : ''
                                }`}
                            >
                                🇹🇷 Türkçe
                            </button>
                            <button
                                type="button"
                                onClick={() => setLang('en')}
                                className={`pal-btn pal-btn-sm !min-h-[30px] !py-1 !px-2.5 ${
                                    lang === 'en' ? 'pal-btn-primary' : ''
                                }`}
                            >
                                🇬🇧 English
                            </button>
                        </div>
                    </div>

                    {/* Progress */}
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-[var(--erpx-ink-secondary)]">
                            <PenLine size={11} className="inline mr-0.5 text-[var(--erpx-brand)]" />
                            Signature {slotIdx + 1} / {sections.length}
                        </span>
                        <span className="text-[11px] text-[var(--erpx-ink-muted)]">
                            {signatures.filter(Boolean).length} / {sections.length} signed
                        </span>
                    </div>
                    <div className="flex gap-1">
                        {sections.map((_, i) => (
                            <button
                                key={i}
                                type="button"
                                onClick={() => setSlotIdx(i)}
                                className={`h-2 flex-1 rounded-full transition-colors ${
                                    signatures[i]
                                        ? 'bg-[#34C759]'
                                        : i === slotIdx
                                        ? 'bg-[var(--erpx-brand)]'
                                        : 'bg-[var(--erpx-border)]'
                                }`}
                            />
                        ))}
                    </div>
                </div>

                {/* ── Section title ── */}
                {currentSection && (
                    <div className="px-4 py-2 bg-[var(--erpx-surface)] border-b border-[var(--erpx-border)] flex-shrink-0">
                        <p className="text-[13px] font-semibold text-[var(--erpx-ink)] line-clamp-2">{currentSection.title}</p>
                    </div>
                )}

                {/* ── Section text (scrollable) ── */}
                {currentSection && (
                    <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                        <p className="text-[11px] text-[var(--erpx-ink-secondary)] leading-relaxed whitespace-pre-wrap">
                            {currentSection.body.trim()}
                        </p>
                    </div>
                )}

                {/* ── Signature area ── */}
                <div className="px-4 pb-2 pt-3 border-t border-[var(--erpx-border)] flex-shrink-0">
                    <p className="text-[12px] font-medium text-[var(--erpx-ink)] mb-2">
                        {lang === 'tr' ? 'Bu bölümü imzalayın:' : 'Sign this section:'}
                    </p>
                    <SignatureCanvas
                        key={`canvas-${slotIdx}-${lang}`}
                        onSign={handleSign}
                        onClear={handleClear}
                        height={130}
                    />
                    {currentSig && (
                        <p className="text-[11px] text-[var(--erpx-green)] font-medium mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} />
                            {lang === 'tr' ? 'İmzalandı' : 'Signed'}
                        </p>
                    )}
                </div>

                {/* ── Navigation ── */}
                <div className="px-4 pb-4 pt-2 flex gap-2 flex-shrink-0">
                    {slotIdx > 0 && (
                        <button
                            type="button"
                            onClick={() => setSlotIdx((s) => s - 1)}
                            className="pal-btn"
                        >
                            <ChevronLeft size={16} /> {lang === 'tr' ? 'Geri' : 'Back'}
                        </button>
                    )}

                    {slotIdx < sections.length - 1 ? (
                        <button
                            type="button"
                            onClick={() => setSlotIdx((s) => s + 1)}
                            disabled={!currentSig}
                            className="pal-btn pal-btn-primary flex-1 inline-flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {lang === 'tr' ? 'İleri' : 'Next'} <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={() => onComplete(signatures, lang)}
                            disabled={!allSigned}
                            className="pal-btn pal-btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {lang === 'tr' ? 'Tamamla' : 'Complete'} ✓
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ─── Main Kiosk View ───────────────────────────────────────────────────── */
export function FrontDeskKioskView({ franchiseId, functionsApp }) {
    const { error: toastError } = useToast();
    const { rows: countryRows, loading: countriesLoading } = useCountryRows();
    const [step, setStep] = useState('idle'); // 'idle' | 'form' | 'done'
    const [countdown, setCountdown] = useState(30);
    const [submitting, setSubmitting] = useState(false);
    const [clientSubmissionId, setClientSubmissionId] = useState(null);

    // Customer form fields
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [phoneDialCca2, setPhoneDialCca2] = useState('CH');
    const [phoneNationalDigits, setPhoneNationalDigits] = useState('');
    const [email, setEmail] = useState('');
    const [addressLine, setAddressLine] = useState('');
    const [city, setCity] = useState('');
    const [postalCode, setPostalCode] = useState('');
    const [country, setCountry] = useState('');

    // Legal docs & permissions
    const [legalDocs, setLegalDocs] = useState(null);
    const [legalLoading, setLegalLoading] = useState(false);
    const [privacyAccepted, setPrivacyAccepted] = useState(false);
    const [activeLegalModal, setActiveLegalModal] = useState(null); // 'privacy' | null

    // Rental terms signing state
    const [rentalTermsModalOpen, setRentalTermsModalOpen] = useState(false);
    const [rentalTermsSigned, setRentalTermsSigned] = useState(false); // true after Complete
    const [rentalTermsSignatures, setRentalTermsSignatures] = useState([]); // base64 PNGs
    const [rentalTermsLang, setRentalTermsLang] = useState('tr');

    // SMS / Email / Call permission toggles (used in 5th section auto-fill)
    const [callOk, setCallOk] = useState(true);
    const [emailOk, setEmailOk] = useState(true);
    const [smsOk, setSmsOk] = useState(true);

    const submitFn = useRef(httpsCallable(functionsApp, 'submitFrontDeskIntake'));
    const legalDocsFn = useRef(httpsCallable(functionsApp, 'getFrontDeskLegalDocs'));
    const lookupRememberFn = useRef(httpsCallable(functionsApp, 'lookupCustomerContactRemember'));
    const successTimerRef = useRef(null);
    const latestPhoneNationalRef = useRef('');

    const isTurkeyKiosk = useMemo(
        () => String(franchiseId || '').trim().toUpperCase().startsWith('TR'),
        [franchiseId]
    );
    const hasRentalTermsText =
        isTurkeyKiosk && !!(legalDocs?.pdfLegalTextTr || legalDocs?.pdfLegalTextEn);

    const defaultDialCca2 = useMemo(() => {
        const fid = String(franchiseId || '').trim();
        if (/^CH/i.test(fid)) return countryRows.find((c) => c.cca2 === 'CH')?.cca2 || 'CH';
        if (/^TR/i.test(fid)) return countryRows.find((c) => c.cca2 === 'TR')?.cca2 || 'TR';
        return countryRows[0]?.cca2 || 'CH';
    }, [countryRows, franchiseId]);

    const defaultCountryName = useMemo(() => {
        const fid = String(franchiseId || '').trim();
        if (/^CH/i.test(fid)) return countryRows.find((c) => c.cca2 === 'CH')?.name || '';
        if (/^TR/i.test(fid)) return countryRows.find((c) => c.cca2 === 'TR')?.name || '';
        return '';
    }, [countryRows, franchiseId]);

    useEffect(() => { latestPhoneNationalRef.current = phoneNationalDigits; }, [phoneNationalDigits]);

    // Auto-fill returning customer
    useEffect(() => {
        if (step !== 'form') return undefined;
        const em = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return undefined;
        const fid = String(franchiseId || '').trim().toUpperCase();
        if (!fid) return undefined;
        const t = window.setTimeout(() => {
            (async () => {
                try {
                    const res = await lookupRememberFn.current({ franchiseId: fid, email: em });
                    const d = res?.data;
                    if (!d?.found) return;
                    setFirstName((v) => (String(v || '').trim() ? v : d.firstName || ''));
                    setLastName((v) => (String(v || '').trim() ? v : d.familyName || ''));
                    const natNow = String(latestPhoneNationalRef.current || '').replace(/\D/g, '');
                    if (!natNow) {
                        if (d.phoneNationalDigits) setPhoneNationalDigits(String(d.phoneNationalDigits).replace(/\D/g, ''));
                        if (d.phoneDialCca2) setPhoneDialCca2(String(d.phoneDialCca2).trim().toUpperCase());
                    }
                    setAddressLine((v) => (String(v || '').trim() ? v : d.addressLine || ''));
                    setCity((v) => (String(v || '').trim() ? v : d.city || ''));
                    setPostalCode((v) => (String(v || '').trim() ? v : d.postalCode || ''));
                    setCountry((v) => (String(v || '').trim() ? v : d.country || ''));
                } catch { /* ignore */ }
            })();
        }, 700);
        return () => window.clearTimeout(t);
    }, [email, step, franchiseId]);

    // Load legal docs
    useEffect(() => {
        let cancelled = false;
        if (!franchiseId) return;
        setLegalLoading(true);
        (async () => {
            try {
                const res = await legalDocsFn.current({ franchiseId });
                if (!cancelled) setLegalDocs(res?.data || null);
            } catch {
                if (!cancelled) setLegalDocs(null);
            } finally {
                if (!cancelled) setLegalLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [franchiseId]);

    const resetFormState = () => {
        setFirstName(''); setLastName('');
        setPhoneDialCca2(defaultDialCca2); setPhoneNationalDigits('');
        setEmail(''); setAddressLine(''); setCity(''); setPostalCode('');
        setCountry(defaultCountryName);
        setPrivacyAccepted(false);
        setActiveLegalModal(null);
        setClientSubmissionId(null);
        setRentalTermsModalOpen(false);
        setRentalTermsSigned(false);
        setRentalTermsSignatures([]);
    };

    const returnToIdle = () => {
        if (successTimerRef.current) { clearInterval(successTimerRef.current); successTimerRef.current = null; }
        resetFormState();
        setStep('idle');
    };

    // Countdown timer when done
    useEffect(() => {
        if (step !== 'done') return undefined;
        setCountdown(30);
        let remaining = 30;
        successTimerRef.current = setInterval(() => {
            remaining -= 1;
            setCountdown(remaining);
            if (remaining <= 0) {
                if (successTimerRef.current) { clearInterval(successTimerRef.current); successTimerRef.current = null; }
                resetFormState();
                setStep('idle');
            }
        }, 1000);
        return () => { if (successTimerRef.current) { clearInterval(successTimerRef.current); successTimerRef.current = null; } };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    const goForm = () => {
        setClientSubmissionId(randomUUIDCompat());
        setPhoneDialCca2(defaultDialCca2);
        setPhoneNationalDigits('');
        setCountry(defaultCountryName);
        setStep('form');
    };

    /** Called when customer completes all 5 rental terms signatures */
    const handleRentalTermsComplete = useCallback((sigs, lang) => {
        setRentalTermsSignatures(sigs);
        setRentalTermsLang(lang);
        setRentalTermsSigned(true);
        setRentalTermsModalOpen(false);
    }, []);

    /** Build PDF from rental terms text + signatures and upload */
    const buildAndUploadPdf = useCallback(async (sigs, lang) => {
        const rawText = lang === 'tr'
            ? (legalDocs?.pdfLegalTextTr || legalDocs?.termsConditionsTr || '')
            : (legalDocs?.pdfLegalTextEn || legalDocs?.termsConditionsEn || '');
        const filled = fillPlaceholders(rawText, { firstName, lastName, email, callOk, emailOk, smsOk });
        const sections = parseSections(filled);
        if (!sections.length) return null;

        const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentW = pageW - 2 * margin;
        const fullName = `${firstName || ''} ${lastName || ''}`.trim();

        sections.forEach((section, i) => {
            if (i > 0) doc.addPage();
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.setTextColor(29, 29, 31);
            const titleLines = doc.splitTextToSize(section.title, contentW);
            doc.text(titleLines, margin, margin + 6);

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(60, 60, 67);
            const bodyText = section.body.trim();
            const bodyLines = doc.splitTextToSize(bodyText, contentW);
            const textY = margin + 10 + titleLines.length * 5;
            const maxTextH = pageH - margin * 3 - 45;
            let y = textY;
            for (const line of bodyLines) {
                if (y > textY + maxTextH) { doc.addPage(); y = margin + 6; }
                doc.text(line, margin, y);
                y += 3.8;
            }

            const metaY = pageH - margin - 40;
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(60, 60, 67);
            doc.text(`Tarih / Date: ${todayTR()}`, margin, metaY);
            doc.text(`Ad Soyad / Name: ${fullName}`, margin, metaY + 5);

            const sigDataUrl = sigs[i];
            if (sigDataUrl) {
                try { doc.addImage(sigDataUrl, 'PNG', margin, metaY + 9, 60, 22); } catch { /* skip */ }
            }
            doc.setDrawColor(200, 200, 205);
            doc.line(margin, metaY + 34, margin + 70, metaY + 34);
            doc.setFontSize(7);
            doc.setTextColor(130, 130, 140);
            doc.text('İmza / Signature', margin, metaY + 38);
        });

        return doc.output('datauristring').split(',')[1];
    }, [legalDocs, firstName, lastName, email, callOk, emailOk, smsOk]);

    const submit = async (e) => {
        e.preventDefault();
        if (isTurkeyKiosk && hasRentalTermsText && !rentalTermsSigned) {
            toastError('Please sign the General Rental Terms before submitting.');
            return;
        }
        if (!String(country || '').trim()) {
            toastError('Please select your country from the list.');
            return;
        }
        const phone = buildPhoneForSave(phoneDialCca2, phoneNationalDigits, countryRows).trim();
        if (phone.replace(/\D/g, '').length < 6) {
            toastError('Please enter a valid telephone number.');
            return;
        }
        setSubmitting(true);
        const submitTimeout = setTimeout(() => {
            setSubmitting(false);
            toastError('Submission timed out. Check your connection and try again.');
        }, 40_000);
        try {
            // PDF is built on the server with Noto Sans (Turkish-safe). Client jsPDF/Helvetica
            // corrupts ş, ğ, ı, etc. — only send compressed signature images.
            let rentalTermsSigPayload = {};
            if (isTurkeyKiosk && rentalTermsSigned && rentalTermsSignatures.length > 0) {
                const compressed = (
                    await Promise.all(rentalTermsSignatures.map((s) => compressSignatureForUpload(s)))
                ).filter((s) => s.length > 40);
                if (compressed.length === 0) {
                    toastError('Could not prepare signatures. Please sign again.');
                    return;
                }
                rentalTermsSigPayload = {
                    rentalTermsSignatures: compressed,
                    rentalTermsLanguageCode: rentalTermsLang === 'en' ? 'en' : 'tr',
                };
            }

            await submitFn.current({
                franchiseId,
                clientSubmissionId,
                firstName: String(firstName || '').replace(/\s+/g, ' ').trim(),
                lastName: String(lastName || '').replace(/\s+/g, ' ').trim(),
                fullName: `${String(firstName || '').trim()} ${String(lastName || '').trim()}`.trim(),
                phone: String(phone || '').trim(),
                email: String(email || '').trim().toLocaleLowerCase(),
                addressLine: String(addressLine || '').replace(/\s+/g, ' ').trim(),
                city: String(city || '').replace(/\s+/g, ' ').trim(),
                postalCode: String(postalCode || '').replace(/\s+/g, ' ').trim(),
                country: String(country || '').replace(/\s+/g, ' ').trim(),
                termsAccepted: true,
                privacyAccepted: true,
                callOk,
                emailOk,
                smsOk,
                ...rentalTermsSigPayload,
            });
            setStep('done');
        } catch (err) {
            const code = err?.code;
            const msg = err?.message || 'Submission failed';
            toastError(`${code === 'functions/already-exists' ? 'Please wait — ' : ''}${msg}`);
        } finally {
            clearTimeout(submitTimeout);
            setSubmitting(false);
        }
    };

    const canSubmit = privacyAccepted && (rentalTermsSigned || !hasRentalTermsText) && !submitting;

    return (
        <div className="min-h-screen bg-[var(--erpx-canvas)] flex flex-col items-center justify-start sm:justify-center p-3 sm:p-4">
            <div className="w-full max-w-3xl">

                {/* ── Header ── */}
                <div className="text-center mb-4 sm:mb-6">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 bg-[var(--erpx-brand)] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-md">
                        <Car className="text-white" size={30} />
                    </div>
                    <h1 className="text-[22px] font-bold text-[var(--erpx-ink)] mb-0.5">Kiosk</h1>
                    <p className="text-[13px] text-[var(--erpx-ink-muted)] flex items-center justify-center gap-1.5">
                        <MapPin size={13} />
                        Reservation information · {franchiseId}
                    </p>
                </div>

                {/* ── IDLE ── */}
                {step === 'idle' && (
                    <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-[var(--erpx-surface)] rounded-2xl shadow-[var(--erpx-shadow-sm)] border border-[var(--erpx-border)] p-8 sm:p-10 flex flex-col items-center"
                    >
                        <p className="text-[14px] text-center text-[var(--erpx-ink-secondary)] mb-8 max-w-sm leading-relaxed">
                            Tap the button below to enter your details for your vehicle rental.
                        </p>
                        <button
                            type="button"
                            onClick={goForm}
                            className="pal-btn pal-btn-primary w-full max-w-sm !min-h-[60px] !text-[17px]"
                        >
                            Create reservation information
                        </button>
                    </motion.div>
                )}

                {/* ── FORM ── */}
                {step === 'form' && (
                    <motion.form
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        onSubmit={submit}
                        className="bg-[var(--erpx-surface)] rounded-2xl shadow-[var(--erpx-shadow-sm)] border border-[var(--erpx-border)] p-4 sm:p-6 space-y-4"
                    >
                        <p className="text-[13px] text-[var(--erpx-ink-muted)]">
                            Enter your name, contact and address details.
                        </p>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <label className={KIOSK_LABEL}>First name <span className="text-red-500">*</span></label>
                                <input required type="text" value={firstName}
                                    onChange={(e) => setFirstName(collapseSpacesWhileTyping(e.target.value))}
                                    onBlur={() => setFirstName((v) => titleCaseField(v))}
                                    className={KIOSK_FORM_FIELD}
                                    autoComplete="given-name" />
                            </div>
                            <div>
                                <label className={KIOSK_LABEL}>Last name <span className="text-red-500">*</span></label>
                                <input required type="text" value={lastName}
                                    onChange={(e) => setLastName(collapseSpacesWhileTyping(e.target.value))}
                                    onBlur={() => setLastName((v) => titleCaseField(v))}
                                    className={KIOSK_FORM_FIELD}
                                    autoComplete="family-name" />
                            </div>
                            <div className="md:col-span-2">
                                <IntlPhoneFields
                                    countries={countryRows} loading={countriesLoading}
                                    dialCca2={phoneDialCca2} nationalDigits={phoneNationalDigits}
                                    onChangeDialCca2={setPhoneDialCca2}
                                    onChangeNationalDigits={setPhoneNationalDigits}
                                    disabled={submitting} />
                            </div>
                            <div className="md:col-span-2">
                                <label className={KIOSK_LABEL}>Email <span className="text-red-500">*</span></label>
                                <input required type="email" value={email}
                                    onChange={(e) => setEmail(e.target.value.toLowerCase())}
                                    className={KIOSK_FORM_FIELD} />
                            </div>
                            <div className="md:col-span-2">
                                <label className={KIOSK_LABEL}>Street / number <span className="text-red-500">*</span></label>
                                <input required value={addressLine}
                                    onChange={(e) => setAddressLine(collapseSpacesWhileTyping(e.target.value))}
                                    onBlur={() => setAddressLine((v) => titleCaseField(v))}
                                    className={KIOSK_FORM_FIELD}
                                    autoComplete="street-address" inputMode="text" />
                            </div>
                            <div>
                                <label className={KIOSK_LABEL}>City <span className="text-red-500">*</span></label>
                                <input required value={city}
                                    onChange={(e) => setCity(collapseSpacesWhileTyping(e.target.value))}
                                    onBlur={() => setCity((v) => titleCaseField(v))}
                                    className={KIOSK_FORM_FIELD}
                                    autoComplete="address-level2" />
                            </div>
                            <div>
                                <label className={KIOSK_LABEL}>Postal code <span className="text-red-500">*</span></label>
                                <input required value={postalCode}
                                    onChange={(e) => setPostalCode(collapseSpacesWhileTyping(e.target.value))}
                                    onBlur={() => setPostalCode((v) => String(v || '').replace(/\s+/g, ' ').trim())}
                                    className={KIOSK_FORM_FIELD}
                                    autoComplete="postal-code" inputMode="text" />
                            </div>
                            <div className="md:col-span-2">
                                <CountryScrollSelect
                                    countries={countryRows} loading={countriesLoading}
                                    valueName={country} onSelectName={(name) => setCountry(name)}
                                    disabled={submitting} label="Country *" />
                            </div>
                        </div>

                        {/* ── Legal section ── */}
                        <div className="rounded-xl border border-[var(--erpx-border)] bg-[var(--erpx-subtle)] p-3 space-y-3">

                            {/* Rental Terms button */}
                            {legalLoading ? (
                                <p className="text-[11px] text-[var(--erpx-ink-muted)]">Loading legal documents…</p>
                            ) : isTurkeyKiosk && hasRentalTermsText ? (
                                rentalTermsSigned ? (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 text-[#34C759]">
                                            <CheckCircle2 size={18} />
                                            <span className="text-[13px] font-semibold">General Rental Terms — Signed</span>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setRentalTermsSigned(false); setRentalTermsSignatures([]); setRentalTermsModalOpen(true); }}
                                            className="text-[11px] text-[var(--erpx-ink-muted)] hover:text-[var(--erpx-ink)] underline"
                                        >
                                            Re-sign
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setRentalTermsModalOpen(true)}
                                        className="pal-btn pal-btn-primary w-full inline-flex items-center justify-center gap-2"
                                    >
                                        <FileText size={16} />
                                        General Rental Terms &amp; Conditions
                                    </button>
                                )
                            ) : null}

                            {/* Privacy Policy */}
                            <label className="flex items-start gap-2 text-[12px] text-[var(--erpx-ink)]">
                                <input type="checkbox" checked={privacyAccepted}
                                    onChange={(e) => setPrivacyAccepted(e.target.checked)}
                                    className="mt-0.5" required />
                                <span>
                                    I accept{' '}
                                    <button type="button"
                                        onClick={() => setActiveLegalModal('privacy')}
                                        className="text-[var(--erpx-brand)] hover:underline">
                                        Privacy Policy
                                    </button>.
                                </span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            disabled={!canSubmit}
                            className="pal-btn pal-btn-primary w-full !min-h-[56px] !text-[16px] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {submitting ? 'Submitting…' : 'Submit'}
                        </button>
                    </motion.form>
                )}

                {/* ── DONE ── */}
                {step === 'done' && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.98 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="bg-[var(--erpx-surface)] rounded-2xl shadow-[var(--erpx-shadow-sm)] border border-[var(--erpx-border)] p-8 sm:p-10 text-center"
                    >
                        <div className="w-16 h-16 bg-[#34C759]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                            <CheckCircle2 size={36} className="text-[#34C759]" />
                        </div>
                        <p className="text-[20px] font-semibold text-[var(--erpx-ink)] mb-2">Thank you</p>
                        <p className="text-[14px] text-[var(--erpx-ink-muted)] mb-6 leading-relaxed max-w-sm mx-auto">
                            {isTurkeyKiosk
                                ? 'Your information and signed documents were received. A colleague will complete your reservation shortly.'
                                : 'Your information was received. A colleague will complete your reservation shortly.'}
                        </p>
                        <div className="text-5xl font-bold tabular-nums text-[var(--erpx-brand)] mb-2">{countdown}</div>
                        <p className="text-[12px] text-[var(--erpx-ink-muted)] mb-6">This screen will reset automatically.</p>
                        <button type="button" onClick={returnToIdle}
                            className="pal-btn w-full max-w-sm mx-auto !min-h-[56px] !text-[16px]">
                            Return to home
                        </button>
                    </motion.div>
                )}
            </div>

            {/* ── Privacy Modal ── */}
            {activeLegalModal === 'privacy' && (
                <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-3"
                    onClick={() => setActiveLegalModal(null)}>
                    <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-[var(--erpx-surface)] rounded-2xl border border-[var(--erpx-border)] p-4"
                        onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className="text-[15px] font-semibold text-[var(--erpx-ink)]">Privacy Policy</h3>
                            <button type="button" onClick={() => setActiveLegalModal(null)}
                                className="pal-btn pal-btn-sm">Close</button>
                        </div>
                        <p className="whitespace-pre-wrap text-[12px] text-[var(--erpx-ink)] leading-relaxed">
                            {cleanLegalText(legalDocs?.privacyPolicyEn) || 'No privacy policy configured for this franchise.'}
                        </p>
                    </div>
                </div>
            )}

            {/* ── Rental Terms Signing Modal ── */}
            <AnimatePresence>
                {isTurkeyKiosk && rentalTermsModalOpen && (
                    <motion.div
                        key="rental-terms-modal"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    >
                        <RentalTermsModal
                            legalDocs={legalDocs}
                            firstName={firstName}
                            lastName={lastName}
                            email={email}
                            callOk={callOk}
                            emailOk={emailOk}
                            smsOk={smsOk}
                            onComplete={handleRentalTermsComplete}
                            onClose={() => setRentalTermsModalOpen(false)}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
