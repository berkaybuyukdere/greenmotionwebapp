/**
 * iOS-style PDF template for checkout (exit) and return reports.
 * Matches the iOS app's TR_SABIHAGOKCEN franchise template exactly.
 */
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { USAVE_LOGO_B64, VEHICLE_MAP_B64 } from './iosPdfAssets';
import {
    renderParagraphsToImage,
    renderTitleBlockImage,
    renderInfoRowImage,
    renderSmallLabelImage,
} from './pdfCanvasUnicode';
import {
    PDF_ADD_IMAGE_COMPRESSION,
    PDF_PHOTO_EMBED_MAX_LONG_EDGE,
    PDF_PHOTO_JPEG_QUALITY,
    PDF_VECTOR_EMBED_DPI,
} from './pdfPhotoQuality';
import { resolvePdfPhotoUrl, loadPdfPhotoBytes, normalizePhotoRef } from './resolvePdfPhotoUrl';

/** Same coordinate space as iOS `VehicleRef` / condition canvas (ExitPDFGenerator / IadePDFGenerator). */
const VEHICLE_CANVAS_W = 626;
const VEHICLE_CANVAS_H = 408;

// ─── Constants ────────────────────────────────────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const LEFT_COL_W = 120;
const RIGHT_COL_X = 145;
const RIGHT_COL_W = 50;

const LABEL_X = MARGIN;
const LABEL_W = 50;
const VALUE_X = 67;

const ROW_H = 7;
const LABEL_SIZE = 9;
const VALUE_SIZE = 10;

// ─── Legal texts ──────────────────────────────────────────────────────────────
const LEGAL_TR = [
    '1. Kiracı, sözleşmeye konu aracı kullanımına tahsis ettiği üçüncü şahsın; kimlik, ehliyet ve adresine ilişkin bilgileri en geç aracın kendisine teslim anına kadar kiralayana vermek, aksi halde sözleşmeden kaynaklanan haklardan yararlanamayacağını kabul, beyan ve taahhüt eder.',
    '2. Kiracı; aracı tam, eksiksiz ve sağlam olarak teslim almış olup (varsa herhangi bir eksiklik yukarıdaki gibi formda belirtilecektir.) aracın kullanımında gerekli dikkat ve özeni gösterecek, iyi durumda bulunmasını sağlayacaktır. Kullanımı hatasından kaynaklanan, mekanik problemlerde aracın yetkili servisince yapılan tespitte, kullanımdan kaynaklanan bir zarar tespit edilmesi halinde, zararın kendisine rücu edileceğini kabul, beyan ve taahhüt eder.',
    '3. Kiracının araç ile kazaya karışması halinde derhal kiralayanı haberdar etme, kaza tutanaklarını, alkol raporu, ilgili tarafların ehliyet, ruhsatname, trafik sigorta poliçeleri vesair evrakı eksiksiz olarak almak ve kiralayana teslim etmekle yükümlüdür. Aksi halde kiracının tüm haklarından vazgeçeceğini kabul, beyan ve taahhüt eder.',
    '4. Kiracı, yukarıdaki ilk 3 madde ve aracın kullanımından kaynaklanan ücret, kullanım süresi dolmasına rağmen devam eden kullanımdan kaynaklanan ücretler, OGS-HGS, trafik cezaları, İSPARK vesair otopark, gecikmeden kaynaklanan faiz ve kiracıdan kaynaklanan sair tüm ücretlerin yukarıda beyan etmiş olduğu kredi kartı bilgilerinden tahsil edilecek ödenmesini kabul, beyan ve taahhüt eder.',
    'Aracı, iç ve dış temizliği yapılmış ve sorunsuz bir şekilde teslim aldım.',
];

const LEGAL_EN = [
    '1. The tenant declares and undertakes that the identity, driver license and address details of any third party assigned to use the rented vehicle are delivered to the lessor no later than the handover moment; otherwise, rights arising from the contract may not be claimed.',
    '2. The tenant accepts that the vehicle has been received complete and in good condition (any deficiency would be listed in this form), will use it with due care, and agrees that any user-caused mechanical or physical damage identified by authorized service may be recourse-charged to the tenant.',
    '3. In case of an accident, the tenant is obliged to immediately notify the lessor and provide complete documentation including accident report, alcohol report, licenses, registration and insurance documents; otherwise, the tenant waives related rights.',
    '4. The tenant accepts and undertakes that all vehicle-use-related charges, overuse charges after contract period, OGS/HGS, traffic fines, parking fees and delay interests may be collected from the declared credit card details.',
    'I confirm that I received the vehicle in clean and proper condition.',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert various timestamp formats to a JS Date (or null). */
export function tsToDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value.seconds !== undefined) return new Date(value.seconds * 1000);
    if (typeof value === 'number') {
        if (value > 1_000_000_000) return new Date(value * 1000);
        const ref = new Date('2001-01-01T00:00:00Z').getTime();
        return new Date(ref + value * 1000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function safeFmt(date, fmt) {
    try {
        if (!date) return 'N/A';
        return format(date, fmt);
    } catch {
        return 'N/A';
    }
}

function sanitize(s) {
    return String(s || 'unknown').replace(/[^\w-]+/g, '_').slice(0, 80);
}

/**
 * Load an image URL as a data URL, optionally drawing a green date timestamp
 * in the top-left corner of the image.
 */
const IMAGE_LOAD_MS = 12000;

function withImageLoadTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
}

function loadImageFromSrc(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

async function loadImageElementForPdf(url, franchiseId) {
    const raw = normalizePhotoRef(url);
    if (!raw) return null;
    if (raw.startsWith('data:')) {
        return loadImageFromSrc(raw);
    }

    const bytes = await loadPdfPhotoBytes(raw, franchiseId);
    if (bytes) {
        const blob = new Blob([bytes], { type: 'image/jpeg' });
        const objectUrl = URL.createObjectURL(blob);
        try {
            const img = await loadImageFromSrc(objectUrl);
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
            const blob = await response.blob();
            const objectUrl = URL.createObjectURL(blob);
            try {
                const img = await loadImageFromSrc(objectUrl);
                if (img) return img;
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        }
    } catch {
        /* fall through */
    }

    return loadImageFromSrc(resolved);
}

/** Same as iOS SwissReportPDFTemplate.aspectFit(imageSize:in:) — millimetres. */
function aspectFitMm(sw, sh, boxWmm, boxHmm) {
    const ir = sw / sh;
    let pw = boxWmm;
    let ph = boxHmm;
    if (ir > boxWmm / boxHmm) {
        ph = boxWmm / ir;
    } else {
        pw = boxHmm * ir;
    }
    return {
        pw,
        ph,
        ox: (boxWmm - pw) / 2,
        oy: (boxHmm - ph) / 2,
    };
}

/**
 * iOS-style embed: full photo visible (aspect-fit), no stretch/crop, JPEG at print DPI.
 */
export function loadPhotoForPdfEmbed(url, innerWmm, innerHmm, dpi = PDF_VECTOR_EMBED_DPI, opts = {}) {
    const franchiseId = opts?.franchiseId;
    return withImageLoadTimeout(
        (async () => {
            if (!url || (typeof url !== 'string' && typeof url !== 'object')) {
                return null;
            }
            const rawUrl = normalizePhotoRef(url);
            if (!rawUrl) return null;

            const img = await loadImageElementForPdf(rawUrl, franchiseId);
            if (!img) return null;

            try {
                const sw = img.naturalWidth || img.width;
                const sh = img.naturalHeight || img.height;
                if (!sw || !sh) return null;

                const fit = aspectFitMm(sw, sh, innerWmm, innerHmm);
                const maxScale = Math.min(
                    PDF_PHOTO_EMBED_MAX_LONG_EDGE / Math.max(sw, sh),
                    ((fit.pw / 25.4) * dpi) / sw,
                    ((fit.ph / 25.4) * dpi) / sh
                );
                const pxW = Math.max(1, Math.round(sw * maxScale));
                const pxH = Math.max(1, Math.round(sh * maxScale));

                const canvas = document.createElement('canvas');
                canvas.width = pxW;
                canvas.height = pxH;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, sw, sh, 0, 0, pxW, pxH);

                return {
                    dataUrl: canvas.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY),
                    pw: fit.pw,
                    ph: fit.ph,
                    ox: fit.ox,
                    oy: fit.oy,
                    format: 'JPEG',
                };
            } catch {
                return null;
            }
        })(),
        IMAGE_LOAD_MS
    );
}

/** @deprecated Use loadPhotoForPdfEmbed */
export function loadPhotoForPdfCell(url, cellWmm, cellHmm, dpi) {
    const inset = 1.4;
    return loadPhotoForPdfEmbed(url, cellWmm - inset * 2, cellHmm - inset * 2, dpi);
}

export function loadPhotoWithTimestamp(url, dateLabel, opts = {}) {
    const franchiseId = opts?.franchiseId;
    return withImageLoadTimeout(
        (async () => {
            const rawUrl = normalizePhotoRef(url);
            if (!rawUrl) return null;

            const img = await loadImageElementForPdf(rawUrl, franchiseId);
            if (!img) return null;

            try {
                let w = img.naturalWidth || img.width;
                let h = img.naturalHeight || img.height;
                const longEdge = Math.max(w, h);
                if (longEdge > PDF_PHOTO_EMBED_MAX_LONG_EDGE) {
                    const scale = PDF_PHOTO_EMBED_MAX_LONG_EDGE / longEdge;
                    w = Math.floor(w * scale);
                    h = Math.floor(h * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, w, h);
                if (dateLabel) {
                    const fs = Math.max(24, Math.floor(w / 40));
                    ctx.font = `bold ${fs}px Arial`;
                    ctx.textBaseline = 'top';
                    ctx.textAlign = 'left';
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 3;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    ctx.fillStyle = '#22c55e';
                    ctx.fillText(dateLabel, w * 0.01, h * 0.01);
                }
                return {
                    dataUrl: canvas.toDataURL('image/jpeg', PDF_PHOTO_JPEG_QUALITY),
                    width: w,
                    height: h,
                };
            } catch {
                return null;
            }
        })(),
        IMAGE_LOAD_MS
    );
}

/**
 * Load an image URL as a data URL (for signatures — no timestamp).
 */
export function loadImageUrl(url, opts = {}) {
    const franchiseId = opts?.franchiseId;
    return withImageLoadTimeout(
        (async () => {
            const rawUrl = normalizePhotoRef(url);
            if (!rawUrl) return null;
            const img = await loadImageElementForPdf(rawUrl, franchiseId);
            if (!img) return null;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                return canvas.toDataURL('image/png');
            } catch {
                return null;
            }
        })(),
        IMAGE_LOAD_MS
    );
}

// ─── Shared drawing utilities ────────────────────────────────────────────────

/** Draw the page header. Turkish uses canvas so glyphs render correctly in PDF. */
function drawHeader(pdf, title, dateStr, isTR) {
    const usaveLogo = 'data:image/png;base64,' + USAVE_LOGO_B64;
    try {
        pdf.addImage(usaveLogo, 'PNG', PAGE_W - MARGIN - 38, 8, 38, 13);
    } catch { /* logo optional */ }

    if (isTR) {
        const block = renderTitleBlockImage(title, dateStr, { titleSize: 22, subSize: 10, maxWidthMm: 115 });
        pdf.addImage(block.dataUrl, 'PNG', MARGIN, 10, block.widthMm, block.heightMm);
        return 10 + block.heightMm + 4;
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(24);
    pdf.setTextColor(20, 20, 20);
    pdf.text(title, MARGIN, 22);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(120, 120, 120);
    pdf.text(dateStr, MARGIN, 30);
    return 38;
}

/**
 * Draw a single info row: bold label on left, value on right.
 * Turkish rows use canvas (Unicode); English uses core fonts.
 */
function drawInfoRow(pdf, label, value, y, isTR) {
    if (y > PAGE_H - 20) { pdf.addPage(); y = MARGIN; }
    if (isTR) {
        const row = renderInfoRowImage(String(label), String(value ?? 'N/A'), {
            maxWidthMm: RIGHT_COL_X - MARGIN - 2,
            labelWidthMm: 50,
        });
        pdf.addImage(row.dataUrl, 'PNG', MARGIN, y, row.widthMm, row.heightMm);
        return y + row.heightMm + 1.5;
    }
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(LABEL_SIZE);
    pdf.setTextColor(80, 80, 80);
    pdf.text(String(label), LABEL_X, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(VALUE_SIZE);
    pdf.setTextColor(40, 40, 40);
    const maxW = RIGHT_COL_X - VALUE_X - 4;
    const lines = pdf.splitTextToSize(String(value ?? 'N/A'), maxW);
    pdf.text(lines, VALUE_X, y);
    return y + Math.max(ROW_H, lines.length * 5.5);
}

/** Draw the vehicle condition map in the right column with damage markers (matches iOS math). */
function drawVehicleMap(pdf, car, mapTopY) {
    const vehicleMap = 'data:image/png;base64,' + VEHICLE_MAP_B64;
    const mapH = 42;
    const mapW = 67;
    try {
        pdf.addImage(vehicleMap, 'PNG', RIGHT_COL_X, mapTopY, mapW, mapH);
    } catch { /* map optional */ }
    const damages = (car?.hasarKayitlari || []).filter(
        (h) => !h.isDeleted && h.conditionPointX != null && h.conditionPointY != null
    );
    damages.forEach((h, idx) => {
        const x = Number(h.conditionPointX);
        const y = Number(h.conditionPointY);
        const px = RIGHT_COL_X + (x / VEHICLE_CANVAS_W) * mapW;
        const py = mapTopY + (y / VEHICLE_CANVAS_H) * mapH;
        const markerNum = h.markerNumber != null && h.markerNumber !== '' ? String(h.markerNumber) : String(idx + 1);
        pdf.setFillColor(220, 38, 38);
        pdf.circle(px, py, 2, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(220, 38, 38);
        pdf.text(markerNum, px + 2.5, py - 1.2);
    });
    return mapTopY + mapH;
}

/**
 * Draw legal paragraphs in the selected language only (matches iOS behaviour).
 * Turkish: rasterized Unicode block. English: Helvetica.
 */
function drawLegalParagraphs(pdf, y, paragraphs) {
    if (y > PAGE_H - 40) { pdf.addPage(); y = MARGIN; }
    pdf.setDrawColor(200, 200, 200);
    pdf.setLineWidth(0.3);
    pdf.line(MARGIN, y, PAGE_W - MARGIN, y);
    y += 4;

    const paras = Array.isArray(paragraphs) ? paragraphs.filter(Boolean) : [];
    const img = renderParagraphsToImage(paras, {
        maxWidthMm: PAGE_W - 2 * MARGIN,
        fontSizePx: 10,
        lineHeightPx: 14,
        paragraphGapPx: 6,
        font: '400 9px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    if (y + img.heightMm > PAGE_H - 12) {
        pdf.addPage();
        y = MARGIN;
    }
    pdf.addImage(img.dataUrl, 'PNG', MARGIN, y, img.widthMm, img.heightMm);
    return y + img.heightMm + 4;
}

function resolvePdfLegalPair(legalBundle, kind) {
    const legacyTr = String(legalBundle?.pdfLegalTextTr || '').trim();
    const legacyEn = String(legalBundle?.pdfLegalTextEn || '').trim();
    let tr = '';
    let en = '';
    if (kind === 'checkout') {
        tr = String(legalBundle?.pdfLegalTextCheckoutTr || '').trim() || legacyTr;
        en = String(legalBundle?.pdfLegalTextCheckoutEn || '').trim() || legacyEn;
    } else if (kind === 'return') {
        tr = String(legalBundle?.pdfLegalTextReturnTr || '').trim() || legacyTr;
        en = String(legalBundle?.pdfLegalTextReturnEn || '').trim() || legacyEn;
    } else {
        tr = legacyTr;
        en = legacyEn;
    }
    return { tr, en };
}

function buildBilingualLegalParagraphs(legalBundle, kind) {
    const { tr: trRaw, en: enRaw } = resolvePdfLegalPair(legalBundle, kind);
    const trItems = (trRaw || LEGAL_TR.join('\n')).split('\n').map((x) => x.trim()).filter(Boolean);
    const enItems = (enRaw || LEGAL_EN.join('\n')).split('\n').map((x) => x.trim()).filter(Boolean);
    const maxLen = Math.max(trItems.length, enItems.length);
    const out = [];
    for (let i = 0; i < maxLen; i += 1) {
        const tr = trItems[i] || '';
        const en = enItems[i] || '';
        if (!tr && !en) continue;
        out.push(`${tr || '-'} / ${en || '-'}`);
    }
    return out;
}

/**
 * Draw a customer signature block.
 * Returns the next Y position.
 */
async function drawSignatureBlock(pdf, signatureDataUrl, customerName, customerEmail, plate, labelText, y, isTR) {
    if (y > PAGE_H - 50) { pdf.addPage(); y = MARGIN; }
    if (isTR && /[^\x00-\x7F]/.test(labelText)) {
        const lt = renderSmallLabelImage(labelText, { maxWidthMm: 100, fontPx: 9 });
        pdf.addImage(lt.dataUrl, 'PNG', MARGIN, y, lt.widthMm, lt.heightMm);
        y += lt.heightMm + 2;
    } else {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(40, 40, 40);
        pdf.text(labelText, MARGIN, y);
        y += 4;
    }

    const boxW = 85;
    const boxH = 35;
    pdf.setDrawColor(80, 80, 80);
    pdf.setLineWidth(0.5);
    pdf.roundedRect(MARGIN, y, boxW, boxH, 2, 2, 'S');

    if (signatureDataUrl) {
        try {
            pdf.addImage(signatureDataUrl, 'PNG', MARGIN + 3, y + 3, boxW - 6, boxH - 6);
        } catch { /* signature optional */ }
    }

    y += boxH + 3;
    if (isTR) {
        if (customerName) {
            const r1 = renderInfoRowImage('Ad Soyad', customerName, { maxWidthMm: 100, labelWidthMm: 28 });
            pdf.addImage(r1.dataUrl, 'PNG', MARGIN, y, r1.widthMm, r1.heightMm);
            y += r1.heightMm + 1;
        }
        if (customerEmail) {
            const r2 = renderInfoRowImage('E-posta', customerEmail, { maxWidthMm: 100, labelWidthMm: 28 });
            pdf.addImage(r2.dataUrl, 'PNG', MARGIN, y, r2.widthMm, r2.heightMm);
            y += r2.heightMm + 1;
        }
        if (plate) {
            const r3 = renderInfoRowImage('Plaka', plate, { maxWidthMm: 100, labelWidthMm: 28 });
            pdf.addImage(r3.dataUrl, 'PNG', MARGIN, y, r3.widthMm, r3.heightMm);
            y += r3.heightMm + 1;
        }
        return y + 2;
    }
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(60, 60, 60);
    if (customerName) { pdf.text(`Name: ${customerName}`, MARGIN, y); y += 4.5; }
    if (customerEmail) { pdf.text(`Email: ${customerEmail}`, MARGIN, y); y += 4.5; }
    if (plate) { pdf.text(`Plate: ${plate}`, MARGIN, y); y += 4.5; }
    return y + 2;
}

/** Draw photos section (2 per row). Returns next Y. */
async function drawPhotos(pdf, photos, dateLabel, y, isTR) {
    if (!photos?.length) return y;

    if (y > PAGE_H - 20) { pdf.addPage(); y = MARGIN; }
    if (isTR) {
        const ph = renderSmallLabelImage(`Toplam Fotoğraflar: ${photos.length}`, { maxWidthMm: 80, fontPx: 9 });
        pdf.addImage(ph.dataUrl, 'PNG', MARGIN, y, ph.widthMm, ph.heightMm);
        y += ph.heightMm + 4;
    } else {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(40, 40, 40);
        pdf.text(`TOTAL PHOTOS: ${photos.length}`, MARGIN, y);
        y += 6;
    }

    const gutter = 6;
    const photoW = (PAGE_W - 2 * MARGIN - gutter) / 2;
    let col = 0;
    let rowMaxH = 0;

    for (const url of photos) {
        const result = await loadPhotoWithTimestamp(url, dateLabel);
        if (!result) continue;
        const aspect = result.width / result.height;
        let pw = photoW;
        let ph = pw / aspect;
        const maxPh = 55;
        if (ph > maxPh) { ph = maxPh; pw = ph * aspect; }
        if (pw > photoW) { pw = photoW; ph = pw / aspect; }

        const xPos = MARGIN + col * (photoW + gutter);
        if (y + ph > PAGE_H - 10) { pdf.addPage(); y = MARGIN; col = 0; rowMaxH = 0; }
        try {
            pdf.addImage(result.dataUrl, 'JPEG', xPos, y, pw, ph, undefined, PDF_ADD_IMAGE_COMPRESSION);
        } catch { /* skip */ }
        rowMaxH = Math.max(rowMaxH, ph);
        col++;
        if (col === 2) {
            y += rowMaxH + gutter;
            col = 0;
            rowMaxH = 0;
        }
    }
    if (col > 0) y += rowMaxH + gutter;
    return y;
}

// ─── Checkout PDF ─────────────────────────────────────────────────────────────

/**
 * Generates a checkout (exit) PDF in iOS style.
 * Saves the file and resolves when done.
 */
export async function generateIosStyleCheckoutPDF(exit, car, lang = 'en', legalBundle = null) {
    // TR → bilingual TR/EN form; all other franchises (e.g. DE) → English-only.
    const isTR = String(lang).toLowerCase() === 'tr';
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    // ── Dates ──────────────────────────────────────────────────────
    const rawDate = exit?.exitTarihi ?? exit?.checkOutDate ?? exit?.checkoutDate ?? exit?.createdAt ?? null;
    const exitDate = tsToDate(rawDate);
    const exitDateStr = safeFmt(exitDate, 'dd.MM.yyyy');

    // ── Header ─────────────────────────────────────────────────────
    let y = drawHeader(pdf,
        'Araç Teslim Formu / Check Out Report',
        exitDateStr,
        isTR
    );

    // ── Right column: map label (Unicode-safe for Turkish) ─────────
    let mapLabelH = 4;
    if (isTR) {
        const ml = renderSmallLabelImage('Teslim Hasar Detayı / Handover Damage Detail', { maxWidthMm: 52, fontPx: 8 });
        pdf.addImage(ml.dataUrl, 'PNG', RIGHT_COL_X, y, ml.widthMm, ml.heightMm);
        mapLabelH = ml.heightMm;
    } else {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(60, 60, 60);
        pdf.text('Handover Damage Detail', RIGHT_COL_X, y + 2);
    }
    const mapY = y + mapLabelH + 2;
    drawVehicleMap(pdf, car, mapY);

    // ── Left column: info rows ─────────────────────────────────────
    y = drawInfoRow(pdf, 'Araç Plakası / Plate', exit.aracPlaka || car?.plaka || 'N/A', y, isTR);
    y = drawInfoRow(pdf, 'Araç Markası / Modeli / Vehicle',
        `${car?.marka || ''} ${car?.model || ''}`.trim() || 'N/A', y, isTR);
    y = drawInfoRow(pdf, 'Kira Başlangıç Tarihi ve Saati / Check Out Date', exitDateStr, y, isTR);

    if (exit.km != null && exit.km !== '') {
        y = drawInfoRow(pdf, 'KM', String(exit.km), y, isTR);
    }
    if (exit.yakitSeviyesi != null && exit.yakitSeviyesi !== '') {
        y = drawInfoRow(pdf, 'Teslim Yakıtı / Fuel', String(exit.yakitSeviyesi), y, isTR);
    }
    const pickUp = String(exit.pickUpBranch || exit.bayiAdi || '').trim();
    if (pickUp) {
        y = drawInfoRow(pdf, 'Alış şubesi / Pick-up branch', pickUp, y, isTR);
    }
    const dropOff = String(exit.dropOffBranch || '').trim();
    if (dropOff) {
        y = drawInfoRow(pdf, 'Bırakış şubesi / Drop-off branch', dropOff, y, isTR);
    }
    const photoCount = (exit.fotograflar || []).length;
    y = drawInfoRow(pdf, 'Toplam Fotoğraflar / Total Photos', String(photoCount), y, isTR);

    if (exit.notlar) {
        y = drawInfoRow(pdf, 'Notlar / Notes', exit.notlar, y, isTR);
    }

    // Ensure we're below the map before continuing
    const mapBottom = mapY + 42 + 6;
    if (y < mapBottom) y = mapBottom;

    // ── Legal paragraphs ───────────────────────────────────────────
    y = drawLegalParagraphs(pdf, y, buildBilingualLegalParagraphs(legalBundle, 'checkout'));

    // ── Customer signature ─────────────────────────────────────────
    if (exit.customerSignatureURL) {
        const sigDataUrl = await loadImageUrl(exit.customerSignatureURL);
        const cName = [exit.customerFirstName, exit.customerLastName].filter(Boolean).join(' ') || exit.musteriAdi || '';
        const sigTitle = 'MÜŞTERİ BİLGİSİ VE İMZASI / CUSTOMER INFORMATION & SIGNATURE';
        y = await drawSignatureBlock(pdf, sigDataUrl, cName, exit.customerEmail, exit.aracPlaka,
            sigTitle, y, isTR);
    }

    // ── Photos ─────────────────────────────────────────────────────
    if (photoCount > 0) {
        if (y > PAGE_H - 30) { pdf.addPage(); y = MARGIN; }
        y = await drawPhotos(pdf, exit.fotograflar, exitDateStr, y, isTR);
    }

    // ── Save ───────────────────────────────────────────────────────
    const plate = sanitize(exit.aracPlaka || exit.resKodu || 'Unknown');
    const fnDate = exitDate ? format(exitDate, 'yyyy-MM-dd') : 'nodate';
    pdf.save(`Checkout_Report_${plate}_${fnDate}.pdf`);
}

// ─── Return PDF ───────────────────────────────────────────────────────────────

/**
 * Generates a return (iade) PDF in iOS style.
 * Saves the file and resolves when done.
 */
export async function generateIosStyleReturnPDF(ret, car, returnPhotos, lang = 'en', legalBundle = null) {
    // TR → bilingual TR/EN form; all other franchises (e.g. DE) → English-only.
    const isTR = String(lang).toLowerCase() === 'tr';
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    // ── Dates ──────────────────────────────────────────────────────
    const rawDate = ret?.iadeTarihi ?? ret?.returnDate ?? ret?.createdAt ?? null;
    const retDate = tsToDate(rawDate);
    const retDateStr = safeFmt(retDate, 'dd.MM.yyyy HH:mm');
    const retDateOnlyStr = safeFmt(retDate, 'dd.MM.yyyy');

    // ── Header ─────────────────────────────────────────────────────
    let y = drawHeader(pdf,
        'Araç İade Formu / Return',
        retDateStr,
        isTR
    );

    // ── Right column: map label ────────────────────────────────────
    let mapLabelH2 = 4;
    if (isTR) {
        const ml2 = renderSmallLabelImage('İade Hasar Detayı / Return Damage Detail', { maxWidthMm: 52, fontPx: 8 });
        pdf.addImage(ml2.dataUrl, 'PNG', RIGHT_COL_X, y, ml2.widthMm, ml2.heightMm);
        mapLabelH2 = ml2.heightMm;
    } else {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(60, 60, 60);
        pdf.text('Return Damage Detail', RIGHT_COL_X, y + 2);
    }
    const mapY = y + mapLabelH2 + 2;
    drawVehicleMap(pdf, car, mapY);

    // ── Left column: info rows ─────────────────────────────────────
    y = drawInfoRow(pdf, 'Araç Plakası / Plate', ret.aracPlaka || car?.plaka || 'N/A', y, isTR);
    y = drawInfoRow(pdf, 'Araç Markası / Modeli / Vehicle',
        `${car?.marka || ''} ${car?.model || ''}`.trim() || 'N/A', y, isTR);
    y = drawInfoRow(pdf, 'Kira Bitiş Tarihi ve Saati / Return Date', retDateStr, y, isTR);

    if (ret.km != null && ret.km !== '') {
        y = drawInfoRow(pdf, 'KM', String(ret.km), y, isTR);
    }
    if (ret.yakitSeviyesi != null && ret.yakitSeviyesi !== '') {
        y = drawInfoRow(pdf, 'İade Yakıtı / Fuel', String(ret.yakitSeviyesi), y, isTR);
    }
    const retBranch = String(ret.bayiAdi || ret.pickUpBranch || '').trim();
    if (retBranch) {
        y = drawInfoRow(pdf, 'İade Şubesi / Entry Branch', retBranch, y, isTR);
    }
    const photoCount = (returnPhotos || []).length;
    y = drawInfoRow(pdf, 'Toplam Fotoğraflar / Total Photos', String(photoCount), y, isTR);

    if (ret.notlar) {
        y = drawInfoRow(pdf, 'Notlar / Notes', ret.notlar, y, isTR);
    }

    // Ensure we're below the map before continuing
    const mapBottom = mapY + 42 + 6;
    if (y < mapBottom) y = mapBottom;

    // ── NOTE header ────────────────────────────────────────────────
    if (isTR) {
        const nh = renderSmallLabelImage('NOT / NOTE', { maxWidthMm: 40, fontPx: 10 });
        pdf.addImage(nh.dataUrl, 'PNG', MARGIN, y, nh.widthMm, nh.heightMm);
        y += nh.heightMm + 3;
    } else {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(40, 40, 40);
        pdf.text('NOTE', MARGIN, y);
        y += 5;
    }

    // ── Legal paragraphs ───────────────────────────────────────────
    y = drawLegalParagraphs(pdf, y, buildBilingualLegalParagraphs(legalBundle, 'return'));

    // ── Customer signature ─────────────────────────────────────────
    const sigUrl = ret.customerSignatureURL || ret.signatureURL;
    if (sigUrl) {
        const sigDataUrl = await loadImageUrl(sigUrl);
        const cName = [ret.customerFirstName, ret.customerLastName].filter(Boolean).join(' ') || '';
        const sigLbl = 'MÜŞTERİ İMZASI / CUSTOMER SIGNATURE';
        y = await drawSignatureBlock(pdf, sigDataUrl, cName, ret.customerEmail, ret.aracPlaka,
            sigLbl, y, isTR);
    }

    // ── Photos ─────────────────────────────────────────────────────
    if (photoCount > 0) {
        if (y > PAGE_H - 30) { pdf.addPage(); y = MARGIN; }
        y = await drawPhotos(pdf, returnPhotos, retDateOnlyStr, y, isTR);
    }

    // ── Save ───────────────────────────────────────────────────────
    const plate = sanitize(ret.aracPlaka || car?.plaka || 'Unknown');
    const fnDate = retDate ? format(retDate, 'yyyy-MM-dd') : 'nodate';
    pdf.save(`Return_Report_${plate}_${fnDate}.pdf`);
}
