import { sanitizeFilenamePart } from './dateFormatters';
import { getExitBookingCode } from './franchiseHelpers';

/** Human-readable filename for Palantir PDF overlay + success toast (all franchises). */
export function checkoutPdfFileLabel(exit, car) {
    const plate = sanitizeFilenamePart(exit?.aracPlaka || car?.plaka || 'vehicle');
    const booking = sanitizeFilenamePart(getExitBookingCode(exit) || '');
    return booking ? `CHECKOUT-${booking}-${plate}.pdf` : `CHECKOUT-${plate}.pdf`;
}

export function returnPdfFileLabel(ret, car) {
    const plate = sanitizeFilenamePart(ret?.aracPlaka || car?.plaka || 'vehicle');
    const booking = sanitizeFilenamePart(ret?.navKodu || ret?.resKodu || '');
    return booking ? `RETURN-${booking}-${plate}.pdf` : `RETURN-${plate}.pdf`;
}

/** Shared Palantir-style PDF download / generate UX */
export const PDF_STAGE_META = {
    preparing: {
        title: 'Preparing report',
        subtitle: 'Reading vehicle and operation data…',
    },
    'loading-photos': {
        title: 'Loading photos',
        subtitle: 'Embedding inspection images…',
    },
    generating: {
        title: 'Generating PDF',
        subtitle: 'Building franchise template…',
    },
    downloading: {
        title: 'Starting download',
        subtitle: 'Your browser will save the file momentarily',
    },
    completed: {
        title: 'PDF ready',
        subtitle: 'Saved to your downloads folder',
    },
    cancelled: {
        title: 'Export cancelled',
        subtitle: 'Photo embedding and PDF build stopped',
    },
    error: {
        title: 'Could not create PDF',
        subtitle: 'Try again or use fewer photos',
    },
};

export class PdfFlowCancelledError extends Error {
    constructor() {
        super('PDF export cancelled');
        this.name = 'PdfFlowCancelledError';
    }
}

export function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new PdfFlowCancelledError();
    }
}

export function waitMs(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new PdfFlowCancelledError());
            return;
        }
        const timer = setTimeout(() => {
            cleanup();
            if (signal?.aborted) reject(new PdfFlowCancelledError());
            else resolve();
        }, ms);
        const onAbort = () => {
            cleanup();
            reject(new PdfFlowCancelledError());
        };
        const cleanup = () => {
            clearTimeout(timer);
            signal?.removeEventListener?.('abort', onAbort);
        };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}

/**
 * Run a PDF task with overlay stages. `task` receives `{ setStage, signal }`.
 * `options.toast` may provide exportSuccess / info for Palantir notifications.
 */
/**
 * Curried PDF runner for views that hold `setPdfOverlay` + `toast` in local state.
 * @param {Function} setOverlay
 * @param {object} toast
 * @returns {(task: Function, options?: object) => Promise<void>}
 */
export function createPdfFlowRunner(setOverlay, toast) {
    return (task, options = {}) => runPalantirPdfFlow(setOverlay, task, { toast, ...options });
}

export async function runPalantirPdfFlow(setOverlay, task, options = {}) {
    const abortController = new AbortController();
    const signal = abortController.signal;
    const { toast, fileLabel } = options;

    const requestCancel = () => {
        if (!signal.aborted) abortController.abort();
    };

    const setStage = (stage, extra = {}) => {
        throwIfAborted(signal);
        const cancelable =
            extra.cancelable ??
            (!['completed', 'error', 'cancelled', 'downloading'].includes(stage));
        setOverlay({
            visible: true,
            stage,
            cancelable,
            onCancel: cancelable ? requestCancel : undefined,
            fileLabel: extra.fileLabel ?? fileLabel,
            ...extra,
        });
    };

    setStage('preparing', { progress: 5 });
    try {
        await task({ setStage, signal });
        throwIfAborted(signal);
        setStage('downloading', { progress: 92, cancelable: false });
        await waitMs(40, signal);
        setStage('completed', { progress: 100, cancelable: false });
        await waitMs(220, signal);
        toast?.exportSuccess?.(
            'Report exported',
            fileLabel || 'Saved to your downloads folder'
        );
    } catch (error) {
        if (error instanceof PdfFlowCancelledError || signal.aborted) {
            setStage('cancelled', { progress: 0, cancelable: false });
            await waitMs(520);
            toast?.info?.('PDF export cancelled', 3200);
            return;
        }
        console.error('[PDF flow]', error);
        setStage('error', {
            message: error?.message || 'PDF generation failed',
            progress: 0,
            cancelable: false,
        });
        await waitMs(2400);
        throw error;
    } finally {
        setOverlay(null);
    }
}

/** Race image load helpers — never block PDF forever */
export function withImageTimeout(promise, ms = 12000) {
    return Promise.race([
        promise,
        new Promise((resolve) => {
            setTimeout(() => resolve(null), ms);
        }),
    ]);
}

/** Photo load progress for Palantir overlay (real bytes, parallel loads). */
export function buildPhotoProgressReporter(setStage, opts = {}) {
    const base = opts.baseProgress ?? 15;
    const span = opts.span ?? 62;
    const signal = opts.signal;
    const startedAt = Date.now();
    let bytesLoaded = 0;

    return (photoIndex, photoTotal, bytesAdded = 0) => {
        throwIfAborted(signal);
        const total = Math.max(photoTotal || 1, 1);
        const idx = Math.min(Math.max(photoIndex || 0, 0), total);
        if (bytesAdded > 0) bytesLoaded += bytesAdded;
        const elapsedSec = Math.max(0.15, (Date.now() - startedAt) / 1000);
        const speedKbps =
            bytesLoaded > 0 ? Math.round(bytesLoaded / 1024 / elapsedSec) : 0;
        const networkLabel =
            speedKbps > 1024
                ? `${(speedKbps / 1024).toFixed(1)} MB/s`
                : speedKbps > 0
                  ? `${speedKbps} KB/s`
                  : null;

        setStage('loading-photos', {
            progress: base + (idx / total) * span,
            photoIndex: idx,
            photoTotal: total,
            speedKbps,
            networkLabel,
            microText:
                idx < total
                    ? `Loading photos ${idx}/${total} (parallel)`
                    : `Photos ready · building PDF`,
        });
    };
}
