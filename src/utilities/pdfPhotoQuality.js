/**
 * PDF export fidelity — aligned with iOS SwissReportPDFTemplate + PdfEmailImageCompressor bounds.
 */

/** Per-photo JPEG — high quality (~8–12 MB for ~25 condition photos). */
export const PDF_PHOTO_JPEG_QUALITY = 0.96;

/** Max long edge — sharp embed without 45 MB full PNG cells. */
export const PDF_PHOTO_EMBED_MAX_LONG_EDGE = 2400;

/** Embed DPI for fitted photo bitmap in each card. */
export const PDF_VECTOR_EMBED_DPI = 340;

/** Full A4 page raster (html2canvas fallback only). */
export const PDF_PAGE_RASTER_FORMAT = 'PNG';

/** @deprecated */
export const PDF_PAGE_JPEG_QUALITY = 1;

export const PDF_HTML2CANVAS_SCALE = 2;

export const PDF_PHOTO_BOX_CSS_W = 340;
export const PDF_PHOTO_FRAME_H = 164;
export const PDF_PHOTO_FRAME_H_FOUR = 200;
export const PDF_PHOTO_FRAME_H_DE = 200;

export function pdfPhotoRasterPixels(frameHeightPx = PDF_PHOTO_FRAME_H) {
    return {
        w: Math.ceil(PDF_PHOTO_BOX_CSS_W * PDF_HTML2CANVAS_SCALE),
        h: Math.ceil(frameHeightPx * PDF_HTML2CANVAS_SCALE),
    };
}

export const PDF_PHOTO_LOAD_CONCURRENCY = 8;

/** @deprecated Use PDF_PHOTO_EMBED_MAX_LONG_EDGE */
export const PDF_PHOTO_VECTOR_MAX_LONG_EDGE = PDF_PHOTO_EMBED_MAX_LONG_EDGE;

export const PDF_PHOTO_MAX_LONG_EDGE = PDF_PHOTO_EMBED_MAX_LONG_EDGE;

/** Avoid re-compressing already-encoded JPEGs inside jsPDF. */
export const PDF_ADD_IMAGE_COMPRESSION = 'NONE';
