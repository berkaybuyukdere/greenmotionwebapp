import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, CheckCircle, AlertCircle, Image as ImageIcon, FileText, X } from 'lucide-react';
import { PDF_STAGE_META } from '../../utilities/pdfDownloadFlow';

/**
 * Palantir-style PDF export overlay: photo → arrow → PDF transfer animation + throughput micro-text.
 */
export default function PalantirPdfTransferOverlay({ state }) {
    if (!state?.visible) return null;

    const stage = state.stage || 'preparing';
    const meta = PDF_STAGE_META[stage] || PDF_STAGE_META.preparing;
    const isCompleted = stage === 'completed';
    const isError = stage === 'error';
    const isCancelled = stage === 'cancelled';
    const canCancel = Boolean(state.cancelable && state.onCancel && !isCompleted && !isError && !isCancelled);
    const photoIndex = Number(state.photoIndex) || 0;
    const photoTotal = Number(state.photoTotal) || 0;
    const isPhotoStage = stage === 'loading-photos' && photoTotal > 0;
    const progress = Math.min(100, Math.max(0, Number(state.progress) || 0));

    const [tick, setTick] = useState(0);
    useEffect(() => {
        if (isCompleted || isError) return undefined;
        const id = window.setInterval(() => setTick((t) => t + 1), 900);
        return () => window.clearInterval(id);
    }, [isCompleted, isError, stage]);

    let subtitle = state.message || meta.subtitle;
    if (isPhotoStage) {
        subtitle = state.microText || `Photo ${photoIndex} of ${photoTotal}`;
    }

    const networkLabel =
        state.networkLabel ||
        (state.speedKbps > 0
            ? state.speedKbps > 1024
                ? `${(state.speedKbps / 1024).toFixed(1)} MB/s`
                : `${state.speedKbps} KB/s`
            : null);

    const microLines = [];
    if (networkLabel && isPhotoStage && !isCompleted && !isError) {
        microLines.push(`Prepared ${networkLabel}`);
    }
    if (isPhotoStage) {
        microLines.push(`Photo ${photoIndex}/${photoTotal} · embedding for PDF`);
    } else if (stage === 'generating') {
        microLines.push('Layout · fonts · franchise template');
    } else if (stage === 'preparing') {
        microLines.push('Reading operation record');
    }

    const activeMicro = microLines.length ? microLines[tick % microLines.length] : null;
    const arrowProgress = Math.min(1, Math.max(0.06, progress / 100));

    return (
        <div className="pal-pdf-overlay fixed inset-0 z-[140] flex items-center justify-center p-4">
            <div
                className={`pal-pdf-panel pal-pdf-transfer-panel w-full max-w-[400px] rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] px-6 py-6 shadow-[0_24px_64px_rgba(0,0,0,0.45)]${isCancelled ? ' pal-pdf-panel--cancelled' : ''}`}
            >
                <div className="mb-4 flex items-center gap-3">
                    {isCompleted ? (
                        <CheckCircle size={26} className="shrink-0 text-[var(--erpx-green)]" />
                    ) : isError ? (
                        <AlertCircle size={26} className="shrink-0 text-[var(--erpx-red)]" />
                    ) : isCancelled ? (
                        <X size={22} className="shrink-0 text-[var(--erpx-ink-muted)]" />
                    ) : (
                        <FileText size={22} className="shrink-0 text-[var(--erpx-brand)]" />
                    )}
                    <div className="min-w-0 text-left">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--erpx-ink-muted)]">
                            PDF export
                        </p>
                        <p className="text-[15px] font-semibold text-[var(--erpx-ink)]">{meta.title}</p>
                    </div>
                </div>

                {!isCompleted && !isError && !isCancelled && (
                    <>
                        <div className="pal-pdf-transfer-track" aria-hidden="true">
                            <div className="pal-pdf-transfer-node pal-pdf-transfer-node--source">
                                <ImageIcon size={18} />
                            </div>
                            <div className="pal-pdf-transfer-rail">
                                <div
                                    className="pal-pdf-transfer-rail-fill"
                                    style={{ width: `${arrowProgress * 100}%` }}
                                />
                                <motion.div
                                    className="pal-pdf-transfer-arrow"
                                    animate={{ left: `${Math.max(4, Math.min(92, arrowProgress * 100))}%` }}
                                    transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                                >
                                    <ArrowRight size={14} strokeWidth={2.5} />
                                </motion.div>
                            </div>
                            <div
                                className={`pal-pdf-transfer-node pal-pdf-transfer-node--dest${arrowProgress > 0.55 ? ' is-active' : ''}`}
                            >
                                <FileText size={18} />
                            </div>
                        </div>

                        <div className="mb-3 mt-4 h-1.5 overflow-hidden rounded-full bg-[var(--erpx-muted)]">
                            <motion.div
                                className="pal-pdf-transfer-bar h-full rounded-full"
                                animate={{ width: `${progress || 8}%` }}
                                transition={{ duration: 0.35, ease: 'easeOut' }}
                            />
                        </div>

                        <div className="pal-pdf-micro-wrap min-h-[18px]">
                            <AnimatePresence mode="wait">
                                {activeMicro ? (
                                    <motion.p
                                        key={activeMicro}
                                        className="pal-pdf-micro-text"
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        transition={{ duration: 0.28 }}
                                    >
                                        {activeMicro}
                                    </motion.p>
                                ) : null}
                            </AnimatePresence>
                        </div>
                    </>
                )}

                <p className="text-[13px] leading-snug text-[var(--erpx-ink-secondary)]">
                    {isCompleted && state.fileLabel
                        ? `Saved · ${state.fileLabel}`
                        : subtitle}
                </p>

                {canCancel && (
                    <div className="pal-pdf-cancel-row">
                        <button
                            type="button"
                            className="pal-pdf-cancel-btn"
                            onClick={() => state.onCancel?.()}
                        >
                            <X size={13} strokeWidth={2.5} />
                            Cancel export
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
