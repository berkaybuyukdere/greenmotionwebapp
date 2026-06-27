/**
 * High-fidelity photo prep for HTML PDF template (preview-matching sharpness).
 */
import { throwIfAborted, withImageTimeout } from './pdfDownloadFlow';
import {
    loadPdfPhotoBytes,
    loadPdfPhotoDataUrl,
    normalizePhotoRef,
    resolvePdfPhotoUrl,
} from './resolvePdfPhotoUrl';
import {
    PDF_PHOTO_EMBED_MAX_LONG_EDGE,
    PDF_PHOTO_JPEG_QUALITY,
    PDF_PHOTO_LOAD_CONCURRENCY,
    PDF_PHOTO_FRAME_H,
    pdfPhotoRasterPixels,
} from './pdfPhotoQuality';

const IMAGE_LOAD_MS = 20000;

/** Center-crop draw (object-fit: cover) into exact raster cell size. */
function drawImageCover(ctx, img, targetW, targetH) {
    const sw = img.naturalWidth || img.width;
    const sh = img.naturalHeight || img.height;
    if (!sw || !sh) return;
    const ir = sw / sh;
    const tr = targetW / targetH;
    let dw;
    let dh;
    let dx;
    let dy;
    if (ir > tr) {
        dh = targetH;
        dw = Math.ceil(targetH * ir);
        dx = Math.floor((targetW - dw) / 2);
        dy = 0;
    } else {
        dw = targetW;
        dh = Math.ceil(targetW / ir);
        dx = 0;
        dy = Math.floor((targetH - dh) / 2);
    }
    ctx.drawImage(img, dx, dy, dw, dh);
}

async function loadImageElementFromPhotoRef(input, franchiseId) {
    const raw = normalizePhotoRef(input);
    if (!raw) return null;

    const bytes = await loadPdfPhotoBytes(raw, franchiseId);
    if (bytes) {
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        try {
            const img = await new Promise((resolve) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = objectUrl;
            });
            if (img) return img;
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    const resolved = await resolvePdfPhotoUrl(raw, franchiseId);
    if (!resolved) return null;

    try {
        const response = await fetch(resolved, { mode: 'cors', credentials: 'omit' });
        if (response.ok) {
            const objectUrl = URL.createObjectURL(await response.blob());
            try {
                const img = await new Promise((resolve) => {
                    const el = new Image();
                    el.onload = () => resolve(el);
                    el.onerror = () => resolve(null);
                    el.src = objectUrl;
                });
                if (img) return img;
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        }
    } catch {
        /* fall through */
    }

    return new Promise((resolve) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => resolve(null);
        el.src = resolved;
    });
}

/**
 * Encode one photo at html2canvas resolution (layout 340×164/200 → × scale pixels).
 */
export function loadPhotoForPdfEmbed(url, frameHeightPx = PDF_PHOTO_FRAME_H, opts = {}) {
    const franchiseId = opts?.franchiseId;
    const { w: targetW, h: targetH } = pdfPhotoRasterPixels(frameHeightPx);

    return withImageTimeout(
        (async () => {
            const rawUrl = normalizePhotoRef(url);
            if (!rawUrl) return null;

            const img = await loadImageElementFromPhotoRef(rawUrl, franchiseId);
            if (!img) return null;

            try {
                let sw = img.naturalWidth || img.width;
                let sh = img.naturalHeight || img.height;
                const long = Math.max(sw, sh);
                if (long > PDF_PHOTO_EMBED_MAX_LONG_EDGE) {
                    const s = PDF_PHOTO_EMBED_MAX_LONG_EDGE / long;
                    sw = Math.floor(sw * s);
                    sh = Math.floor(sh * s);
                }

                const work = document.createElement('canvas');
                work.width = sw;
                work.height = sh;
                const wctx = work.getContext('2d');
                wctx.imageSmoothingEnabled = true;
                wctx.imageSmoothingQuality = 'high';
                wctx.drawImage(img, 0, 0, sw, sh);

                const canvas = document.createElement('canvas');
                canvas.width = targetW;
                canvas.height = targetH;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                drawImageCover(ctx, work, targetW, targetH);

                const src = canvas.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY);
                return {
                    src,
                    rw: targetW,
                    rh: targetH,
                    bytes: Math.round((src.length * 3) / 4),
                };
            } catch {
                return null;
            }
        })(),
        IMAGE_LOAD_MS
    );
}

export async function loadPhotosForPdfParallel(
    urls,
    { signal, onProgress, concurrency = PDF_PHOTO_LOAD_CONCURRENCY, frameHeightPx = PDF_PHOTO_FRAME_H, franchiseId } = {}
) {
    const list = Array.isArray(urls) ? urls : [];
    const total = list.length;
    if (total === 0) return [];

    const results = new Array(total).fill(null);
    let completed = 0;
    let index = 0;
    const workers = Math.min(Math.max(1, concurrency), total);

    const runWorker = async () => {
        for (;;) {
            if (index >= total) break;
            const i = index;
            index += 1;
            throwIfAborted(signal);
            // eslint-disable-next-line no-await-in-loop
            const item = await loadPhotoForPdfEmbed(list[i], frameHeightPx, { franchiseId });
            results[i] = item
                ? { src: item.src, rw: item.rw, rh: item.rh }
                : null;
            completed += 1;
            onProgress?.(completed, total, item?.bytes ?? 0);
        }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));
    return results;
}

/** Preload photos for HTML PDF — embeds as data URLs so html2canvas is CORS-safe. */
export function preloadPhotoUrlForPdf(url, franchiseId) {
    return withImageTimeout(
        (async () => {
            const dataUrl = await loadPdfPhotoDataUrl(url, franchiseId);
            if (!dataUrl) return null;
            return { src: dataUrl };
        })(),
        IMAGE_LOAD_MS
    );
}

export async function preloadPhotosForPdfParallel(
    urls,
    { signal, onProgress, concurrency = PDF_PHOTO_LOAD_CONCURRENCY, franchiseId } = {}
) {
    const list = Array.isArray(urls) ? urls : [];
    const total = list.length;
    if (total === 0) return [];

    const results = new Array(total).fill(null);
    let completed = 0;
    let index = 0;
    const workers = Math.min(Math.max(1, concurrency), total);

    const runWorker = async () => {
        for (;;) {
            if (index >= total) break;
            const i = index;
            index += 1;
            throwIfAborted(signal);
            // eslint-disable-next-line no-await-in-loop
            const item = await preloadPhotoUrlForPdf(list[i], franchiseId);
            results[i] = item;
            completed += 1;
            onProgress?.(completed, total, 0);
        }
    };

    await Promise.all(Array.from({ length: workers }, () => runWorker()));
    return results;
}
