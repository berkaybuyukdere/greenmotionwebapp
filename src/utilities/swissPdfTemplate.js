/**
 * Switzerland (CH) franchise PDFs — Green Motion branded template.
 * Faithful jsPDF reproduction of the official HTML templates
 * (checkout = blue, return = orange, damage = red), with a dynamic
 * branch / franchise name (no hardcoded "Zürich").
 *
 * Mirrors the iOS Swiss layout so web + app produce the same document.
 */
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';
import { loadPhotoForPdfEmbed, loadImageUrl, tsToDate } from './iosPdfTemplate';
import { PDF_ADD_IMAGE_COMPRESSION } from './pdfPhotoQuality';
import { throwIfAborted, PdfFlowCancelledError } from './pdfDownloadFlow';
import { isGermanyFranchiseId } from './franchiseHelpers';
import {
    formatDisplayDate,
    formatPDFTime,
    stamp,
    stampProcessPhoto,
} from './processPhotoStampLabels';
import {
    generateSwissCheckoutHTMLPDF,
    generateSwissReturnHTMLPDF,
    generateSwissDamageHTMLPDF,
} from './swissHtmlPdfTemplate';

/* ── Geometry (mm, A4) ── */
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const FOOTER_COPYRIGHT =
    '© Confidential. Unauthorized reproduction prohibited.';

/* ── Palette (RGB) — matches template CSS variables ── */
const C = {
    white: [255, 255, 255],
    gray50: [248, 249, 250],
    gray100: [241, 243, 245],
    gray200: [233, 236, 239],
    gray300: [222, 226, 230],
    gray400: [173, 181, 189],
    gray500: [108, 117, 125],
    gray700: [52, 58, 64],
    gray900: [33, 37, 41],
    accent: [28, 109, 235],
    accentDark: [20, 81, 176],
    accentLight: [235, 242, 255],
    green: [45, 139, 87],
    greenLight: [232, 245, 238],
    orange: [192, 86, 42],
    orangeLight: [254, 240, 232],
    red: [192, 48, 43],
    redLight: [254, 232, 232],
    border: [221, 225, 231],
};

const SANS = 'helvetica';
const MONO = 'courier';

/* ── Small helpers ── */
function safeFmt(date, fmtStr) {
    try {
        if (!date) return 'N/A';
        return format(date, fmtStr);
    } catch {
        return 'N/A';
    }
}

/** Six-column damage grid — full yyyy (matches iOS). */
function compactGridDate(date) {
    return safeFmt(date, 'dd.MM.yyyy');
}

function sanitize(s) {
    return String(s || 'unknown').replace(/[^\w-]+/g, '_').slice(0, 80);
}

function fill(pdf, rgb) {
    pdf.setFillColor(rgb[0], rgb[1], rgb[2]);
}
function stroke(pdf, rgb) {
    pdf.setDrawColor(rgb[0], rgb[1], rgb[2]);
}
function ink(pdf, rgb) {
    pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
}

// Last-resort city derived from the franchise id so the document is never
// hardcoded to a single branch yet still reads naturally for known locations.
function branchFromFranchiseId(franchiseId) {
    const id = String(franchiseId || '').trim().toUpperCase();
    if (!id) return '';
    const map = {
        CH: 'Zürich',
        CH_ZURICH: 'Zürich',
        CH_ZUERICH: 'Zürich',
        CH_GENEVA: 'Geneva',
        CH_BASEL: 'Basel',
        CH_BERN: 'Bern',
    };
    if (map[id]) return map[id];
    // CH_SOMETHING → Something (title-case)
    if (id.startsWith('CH_')) {
        const tail = id.slice(3).replace(/_/g, ' ').toLowerCase();
        return tail.replace(/\b\w/g, (m) => m.toUpperCase());
    }
    return '';
}

function resolveBranchName(opts, record, car) {
    const candidate =
        opts?.branchName ||
        opts?.franchiseName ||
        record?.pickUpBranch ||
        record?.dropOffBranch ||
        record?.bayiAdi ||
        record?.branchName ||
        record?.location ||
        car?.franchiseName ||
        car?.bayiAdi ||
        branchFromFranchiseId(opts?.franchiseId || record?.franchiseId || car?.franchiseId) ||
        'Switzerland';
    return String(candidate).trim() || 'Switzerland';
}

/* ── Header band ── */
function drawHeader(pdf, { accent, brandSub, badge, titlePre, titleStrong }) {
    const top = MARGIN;
    pdf.setFont(MONO, 'normal');
    pdf.setFontSize(7);
    ink(pdf, C.gray500);
    pdf.text(String(brandSub), MARGIN, top + 5.5);

    // Right: badge + title
    pdf.setFont(MONO, 'bold');
    pdf.setFontSize(7);
    ink(pdf, accent.dark);
    pdf.text(String(badge).toUpperCase(), PAGE_W - MARGIN, top + 2.2, { align: 'right' });

    pdf.setFont(SANS, 'normal');
    pdf.setFontSize(18);
    ink(pdf, C.gray900);
    const preW = pdf.getTextWidth(titlePre + ' ');
    pdf.setFont(SANS, 'bold');
    const strongW = pdf.getTextWidth(titleStrong);
    const titleY = top + 9.5;
    const titleRight = PAGE_W - MARGIN;
    pdf.setFont(SANS, 'normal');
    ink(pdf, C.gray900);
    pdf.text(titlePre, titleRight - strongW - 1, titleY, { align: 'right' });
    pdf.setFont(SANS, 'bold');
    ink(pdf, accent.main);
    pdf.text(titleStrong, titleRight, titleY, { align: 'right' });
    void preW;

    const lineY = top + 13;
    stroke(pdf, accent.main);
    pdf.setLineWidth(0.6);
    pdf.line(MARGIN, lineY, PAGE_W - MARGIN, lineY);
    pdf.setLineWidth(0.2);
    return lineY + 6;
}

function drawCompactHeader(pdf, { accent, brandSub, badge, plate }) {
    const top = MARGIN;
    pdf.setFont(MONO, 'normal');
    pdf.setFontSize(7);
    ink(pdf, C.gray500);
    pdf.text(String(brandSub), MARGIN, top + 5.5);

    pdf.setFont(MONO, 'bold');
    pdf.setFontSize(7);
    ink(pdf, accent.dark);
    pdf.text(String(badge).toUpperCase(), PAGE_W - MARGIN, top + 2.2, { align: 'right' });
    if (plate) {
        pdf.setFont(SANS, 'bold');
        pdf.setFontSize(16);
        ink(pdf, accent.main);
        pdf.text(String(plate), PAGE_W - MARGIN, top + 9.5, { align: 'right' });
    }

    const lineY = top + 13;
    stroke(pdf, accent.main);
    pdf.setLineWidth(0.6);
    pdf.line(MARGIN, lineY, PAGE_W - MARGIN, lineY);
    pdf.setLineWidth(0.2);
    return lineY + 8;
}

function drawPalantirDamageIcon(pdf, x, y) {
    const s = 7;
    fill(pdf, C.redLight);
    stroke(pdf, C.red);
    pdf.setLineWidth(0.35);
    pdf.roundedRect(x, y, s, s, 1.5, 1.5, 'FD');
    pdf.setFont(SANS, 'bold');
    pdf.setFontSize(9);
    ink(pdf, C.red);
    pdf.text('!', x + s / 2, y + s - 1.9, { align: 'center' });
}

function drawDamageHeader(pdf, { accent, brandSub, plate, compact }) {
    const top = MARGIN;
    drawPalantirDamageIcon(pdf, MARGIN, top + 1);
    pdf.setFont(MONO, 'normal');
    pdf.setFontSize(7);
    ink(pdf, C.gray500);
    pdf.text(String(brandSub), MARGIN + 9, top + 5.5);

    pdf.setFont(SANS, 'bold');
    pdf.setFontSize(18);
    if (compact && plate) {
        ink(pdf, accent.main);
        pdf.text(String(plate), PAGE_W - MARGIN, top + 9.5, { align: 'right' });
    } else {
        ink(pdf, C.gray900);
        pdf.text('Damage Report', PAGE_W - MARGIN, top + 9.5, { align: 'right' });
    }

    const lineY = top + 13;
    stroke(pdf, accent.main);
    pdf.setLineWidth(0.6);
    pdf.line(MARGIN, lineY, PAGE_W - MARGIN, lineY);
    pdf.setLineWidth(0.2);
    return lineY + 8;
}

/* ── Section label (mono, uppercase, underlined) ── */
function drawSectionLabel(pdf, x, y, w, text) {
    pdf.setFont(MONO, 'bold');
    pdf.setFontSize(6.8);
    ink(pdf, C.gray400);
    pdf.text(String(text).toUpperCase(), x, y);
    stroke(pdf, C.gray200);
    pdf.setLineWidth(0.2);
    pdf.line(x, y + 1.6, x + w, y + 1.6);
    return y + 5;
}

/* ── Info grid ── cells: [{label, value, style}] style: 'plain'|'accent'|'large'|'damage' */
function drawInfoGrid(pdf, x, y, w, cells, cols) {
    const rows = Math.ceil(cells.length / cols);
    const cellW = w / cols;
    const rowH = 13;
    const gridH = rows * rowH;

    fill(pdf, C.white);
    stroke(pdf, C.border);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, y, w, gridH, 1, 1, 'FD');

    // separators
    for (let c = 1; c < cols; c += 1) {
        const lx = x + c * cellW;
        pdf.line(lx, y, lx, y + gridH);
    }
    for (let r = 1; r < rows; r += 1) {
        const ly = y + r * rowH;
        pdf.line(x, ly, x + w, ly);
    }

    cells.forEach((cell, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const cellX = x + c * cellW + 2.5;
        const cellY = y + r * rowH;
        pdf.setFont(MONO, 'bold');
        pdf.setFontSize(6);
        ink(pdf, C.gray400);
        pdf.text(String(cell.label).toUpperCase(), cellX, cellY + 4.5);

        const style = cell.style || 'plain';
        const value = String(cell.value ?? 'N/A');
        if (style === 'accent') {
            pdf.setFont(MONO, 'bold');
            pdf.setFontSize(10.5);
            ink(pdf, C.accent);
        } else if (style === 'damage') {
            pdf.setFont(MONO, 'bold');
            pdf.setFontSize(10.5);
            ink(pdf, C.red);
        } else if (style === 'large') {
            pdf.setFont(SANS, 'bold');
            pdf.setFontSize(11);
            ink(pdf, C.gray900);
        } else if (style === 'mono') {
            pdf.setFont(MONO, 'bold');
            pdf.setFontSize(9.5);
            ink(pdf, C.gray900);
        } else {
            pdf.setFont(SANS, 'normal');
            pdf.setFontSize(9.5);
            ink(pdf, C.gray900);
        }
        const maxW = cellW - 5;
        const lines = pdf.splitTextToSize(value, maxW);
        pdf.text(lines.slice(0, 2), cellX, cellY + 9.5);
    });

    return y + gridH + 6;
}

/* ── Signature box ── */
async function drawSignatureSection(pdf, x, y, w, sigUrl, label, accent) {
    const url = String(sigUrl || '').trim();
    if (!url) return y;
    const sigData = await loadImageUrl(url);
    if (!sigData) return y;

    y = drawSectionLabel(pdf, x, y, w, 'Customer Signature');
    const boxH = 26;
    fill(pdf, C.gray50);
    stroke(pdf, C.border);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(x, y, w, boxH, 1, 1, 'FD');

    try {
        pdf.addImage(sigData, 'PNG', x + 4, y + 3, w - 8, boxH - 9);
    } catch {
        return y;
    }
    // signature baseline + caption
    stroke(pdf, C.gray300);
    pdf.line(x + w * 0.1, y + boxH - 5, x + w * 0.9, y + boxH - 5);
    pdf.setFont(MONO, 'normal');
    pdf.setFontSize(6.2);
    ink(pdf, C.gray400);
    pdf.text(String(label).toUpperCase(), x + w / 2, y + boxH - 2, { align: 'center' });
    void accent;
    return y + boxH + 6;
}

/* ── Photo grid metrics — mirrors iOS SwissReportPDFTemplate.photoMetrics / photoMetricsFourGrid ── */
const PT_TO_MM = 210 / 595;

function photoGridMetrics(variant = 'standard') {
    const deFour = variant === 'deCover';
    const gap = (deFour ? 12 : 8) * PT_TO_MM;
    const cardW = (CONTENT_W - gap) / 2;
    const headerH = (deFour ? 12 : 16) * PT_TO_MM;
    // Slightly taller image area so portrait handover photos fit without feeling cropped.
    const imgH = cardW * (deFour ? 0.82 : 0.75);
    const imageInset = (deFour ? 5 : 4) * PT_TO_MM;
    const rowGap = 8 * PT_TO_MM;
    return {
        gap,
        cardW,
        headerH,
        imgH,
        cardH: headerH + imgH,
        photosPerPage: 8,
        imageInset,
        rowGap,
    };
}

function drawPhotoCardFrame(pdf, x, y, cardW, headerH, imgH, { number, date, time, dateBlue, danger }) {
    const cardH = headerH + imgH;
    // image bg
    fill(pdf, danger ? [255, 245, 245] : C.gray100);
    stroke(pdf, danger ? C.red : C.border);
    pdf.setLineWidth(danger ? 0.4 : 0.2);
    pdf.roundedRect(x, y, cardW, cardH, 1, 1, 'FD');
    // header bar
    fill(pdf, danger ? C.redLight : C.gray100);
    pdf.rect(x, y, cardW, headerH, 'F');
    stroke(pdf, C.border);
    pdf.setLineWidth(0.2);
    pdf.line(x, y + headerH, x + cardW, y + headerH);
    pdf.setFont(MONO, 'bold');
    pdf.setFontSize(5.4);
    ink(pdf, danger ? C.red : C.gray500);
    const label = String(number || '').trim();
    if (label) {
        pdf.text(label.toUpperCase(), x + 1.6, y + headerH - 1.7);
    }
    pdf.setFont(MONO, 'normal');
    const stampText = dateBlue && time ? `${date} ${time}` : String(date);
    ink(pdf, dateBlue ? C.accent : C.gray400);
    pdf.text(stampText, x + cardW - 1.6, y + headerH - 1.7, { align: 'right' });
}

async function drawPhotoGrid(
    pdf,
    photos,
    stampDateStr,
    accent,
    sectionTitleFn,
    startY,
    ctx,
    {
        danger = false,
        photoLabel = null,
        gridVariant = 'standard',
        stampTimeStr = null,
        dateBlue = false,
        photoStampForIndex = null,
        globalIndexOffset = 0,
    } = {}
) {
    if (!photos?.length) return startY;
    const { gap, cardW, headerH, imgH, cardH, photosPerPage, imageInset, rowGap } =
        photoGridMetrics(gridVariant);
    const total = photos.length;
    let y = startY;
    let printed = 0;

    const ensureSpace = (needed) => {
        if (y + needed > PAGE_H - 18) {
            pdf.addPage();
            y = typeof ctx.pageStart === 'function' ? ctx.pageStart() : MARGIN + 20;
            return true;
        }
        return false;
    };

    let idx = 0;
    while (idx < total) {
        const rowCount = Math.min(2, total - idx);
        if (printed % photosPerPage === 0) {
            ensureSpace(8 + cardH);
            const from = idx + 1;
            const to = Math.min(idx + photosPerPage, total);
            y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, sectionTitleFn(from, to));
        } else {
            ensureSpace(cardH);
        }
        for (let c = 0; c < rowCount; c += 1) {
            throwIfAborted(ctx.signal);
            const i = idx + c;
            ctx.onProgress?.(i + 1, total);
            const x = MARGIN + c * (cardW + gap);
            const globalIndex = globalIndexOffset + i;
            const cardStamp = photoStampForIndex
                ? photoStampForIndex(globalIndex)
                : {
                      label: photoLabel || `PHOTO ${String(globalIndex + 1).padStart(2, '0')}`,
                      date: stampDateStr,
                      time: stampTimeStr,
                  };
            drawPhotoCardFrame(pdf, x, y, cardW, headerH, imgH, {
                number: cardStamp.label,
                date: cardStamp.date,
                time: cardStamp.time,
                dateBlue,
                danger,
            });
            const innerW = cardW - imageInset * 2;
            const innerH = imgH - imageInset * 2;
            const result = await loadPhotoForPdfEmbed(photos[i], innerW, innerH, undefined, {
                franchiseId: ctx.franchiseId,
            });
            if (result) {
                try {
                    pdf.addImage(
                        result.dataUrl,
                        result.format || 'JPEG',
                        x + imageInset + result.ox,
                        y + headerH + imageInset + result.oy,
                        result.pw,
                        result.ph,
                        undefined,
                        PDF_ADD_IMAGE_COMPRESSION
                    );
                } catch {
                    /* skip */
                }
            }
        }
        idx += rowCount;
        printed += rowCount;
        y += cardH + rowGap;
    }
    void accent;
    return y;
}

/* ── Footer pass (page x / total) ── */
function stampFooters(pdf, branchName, generatedNote) {
    const pages = pdf.getNumberOfPages();
    for (let p = 1; p <= pages; p += 1) {
        pdf.setPage(p);
        stroke(pdf, C.gray200);
        pdf.setLineWidth(0.2);
        pdf.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
        pdf.setFont(MONO, 'normal');
        pdf.setFontSize(5.4);
        ink(pdf, C.gray400);
        pdf.text(FOOTER_COPYRIGHT, MARGIN, PAGE_H - 9);
        if (generatedNote) {
            pdf.text(generatedNote, PAGE_W / 2, PAGE_H - 9, { align: 'center' });
        }
        pdf.text(`PAGE ${p} / ${pages}`, PAGE_W - MARGIN, PAGE_H - 9, { align: 'right' });
    }
}

function fuelText(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim();
    return s;
}

/* ───────────────────────── CHECK OUT ───────────────────────── */
async function generateSwissCheckoutPDFVector(exit, car, opts = {}) {
    const accent = { main: C.accent, dark: C.accentDark };
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
    const branch = resolveBranchName(opts, exit, car);
    const handoverDate = tsToDate(exit?.exitTarihi ?? exit?.checkOutDate ?? exit?.createdAt);
    const returnDate =
        tsToDate(exit?.plannedReturnAt ?? exit?.plannedCheckinAt) || handoverDate;
    const franchiseId = opts?.franchiseId || exit?.franchiseId || car?.franchiseId || '';
    const deCoverFour = isGermanyFranchiseId(franchiseId);
    const exitDateStr = formatDisplayDate(handoverDate, deCoverFour);
    const plate = exit?.aracPlaka || car?.plaka || 'N/A';
    const photos = exit?.fotograflar || [];
    const photoStampForIndex = () => {
        const info = stampProcessPhoto(handoverDate, { deFranchise: deCoverFour });
        return {
            label: info.label,
            date: formatDisplayDate(info.date, false),
            time: info.time,
        };
    };
    const photoGridStampOpts = {
        dateBlue: deCoverFour,
        photoStampForIndex,
    };

    let y = drawHeader(pdf, {
        accent,
        brandSub: branch,
        badge: 'Check Out Report',
        titlePre: 'Vehicle',
        titleStrong: 'Check Out',
    });

    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Vehicle Details');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'License Plate', value: plate, style: 'accent' },
            { label: 'Make & Model', value: `${car?.marka || ''} ${car?.model || ''}`.trim() || 'N/A', style: 'large' },
            { label: 'Date', value: exitDateStr },
            { label: 'Fuel Level', value: fuelText(exit?.yakitSeviyesi) || (exit?.km != null && exit.km !== '' ? `${exit.km} km` : '—') },
            { label: 'Total Photos', value: String(photos.length), style: 'large' },
        ],
        5
    );

    const custName =
        [exit?.customerFirstName, exit?.customerLastName].filter(Boolean).join(' ') ||
        exit?.customerName ||
        exit?.musteriAdi ||
        'Not provided';
    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Customer Information');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'Customer Name', value: custName, style: 'large' },
            { label: 'Email Address', value: exit?.customerEmail || 'Not provided' },
            { label: 'License Plate', value: plate, style: 'accent' },
        ],
        3
    );

    y = await drawSignatureSection(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        exit?.customerSignatureURL || exit?.signatureURL,
        'Customer Signature · Check Out',
        accent
    );

    opts.onProgress?.(0, photos.length || 1);
    const ctx = {
        signal: opts.signal,
        onProgress: opts.onProgress,
        franchiseId: opts.franchiseId,
        pageStart: () => drawCompactHeader(pdf, { accent, brandSub: branch, badge: 'Check Out Report', plate }),
    };
    const photoTitle = (from, to, total) =>
        total <= 8 && !deCoverFour ? 'Condition Photos' : `Condition Photos (${from}–${to})`;

    if (deCoverFour && photos.length > 0) {
        const cover = photos.slice(0, 4);
        const rest = photos.slice(4);
        y = await drawPhotoGrid(
            pdf,
            cover,
            '',
            accent,
            () => 'Condition Photos',
            y,
            ctx,
            { gridVariant: 'deCover', ...photoGridStampOpts }
        );
        if (rest.length) {
            y = await drawPhotoGrid(
                pdf,
                rest,
                '',
                accent,
                (from, to) => photoTitle(from + 4, to + 4, photos.length),
                y,
                ctx,
                { globalIndexOffset: 4, ...photoGridStampOpts }
            );
        }
    } else {
        await drawPhotoGrid(
            pdf,
            photos,
            '',
            accent,
            (from, to) => photoTitle(from, to, photos.length),
            y,
            ctx,
            { gridVariant: deCoverFour ? 'deCover' : 'standard', ...photoGridStampOpts }
        );
    }

    stampFooters(pdf, branch, null);
    const fnDate = handoverDate ? format(handoverDate, 'yyyy-MM-dd') : 'nodate';
    pdf.save(`Checkout_Report_${sanitize(plate)}_${fnDate}.pdf`);
}

/* ───────────────────────── RETURN ───────────────────────── */
async function generateSwissReturnPDFVector(ret, car, returnPhotos, opts = {}) {
    const accent = { main: C.orange, dark: C.orange };
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
    const branch = resolveBranchName(opts, ret, car);
    const returnDate = tsToDate(ret?.iadeTarihi ?? ret?.returnDate ?? ret?.createdAt);
    const handoverDate =
        tsToDate(ret?.handoverTarihi ?? ret?.exitTarihi ?? ret?.checkOutDate) || returnDate;
    const franchiseId = opts?.franchiseId || ret?.franchiseId || car?.franchiseId || '';
    const deCoverFour = isGermanyFranchiseId(franchiseId);
    const retDateStr = formatDisplayDate(returnDate, deCoverFour);
    const plate = ret?.aracPlaka || car?.plaka || 'N/A';
    const photos = returnPhotos || ret?.fotograflar || [];
    const photoStampForIndex = () => {
        const info = stampProcessPhoto(returnDate, { deFranchise: deCoverFour });
        return {
            label: info.label,
            date: formatDisplayDate(info.date, false),
            time: info.time,
        };
    };
    const photoGridStampOpts = {
        dateBlue: deCoverFour,
        photoStampForIndex,
    };

    let y = drawHeader(pdf, {
        accent,
        brandSub: branch,
        badge: 'Return Report',
        titlePre: 'Vehicle',
        titleStrong: 'Return',
    });

    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Vehicle Details');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'License Plate', value: plate, style: 'accent' },
            { label: 'Make & Model', value: `${car?.marka || ''} ${car?.model || ''}`.trim() || 'N/A', style: 'large' },
            { label: 'Date', value: retDateStr },
            { label: 'Fuel Level', value: fuelText(ret?.yakitSeviyesi) || (ret?.km != null && ret.km !== '' ? `${ret.km} km` : '—') },
            { label: 'Total Photos', value: String(photos.length), style: 'large' },
        ],
        5
    );

    const custName =
        [ret?.customerFirstName, ret?.customerLastName].filter(Boolean).join(' ') ||
        ret?.customerName ||
        ret?.musteriAdi ||
        'Not provided';
    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Customer Information');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'Customer Name', value: custName, style: 'large' },
            { label: 'Email Address', value: ret?.customerEmail || 'Not provided' },
            { label: 'License Plate', value: plate, style: 'accent' },
        ],
        3
    );

    y = await drawSignatureSection(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        ret?.customerSignatureURL || ret?.signatureURL,
        'Customer Signature · Vehicle Return',
        accent
    );

    opts.onProgress?.(0, photos.length || 1);
    const ctx = {
        signal: opts.signal,
        onProgress: opts.onProgress,
        franchiseId: opts.franchiseId,
        pageStart: () => drawCompactHeader(pdf, { accent, brandSub: branch, badge: 'Return Report', plate }),
    };
    const photoTitle = (from, to, total) =>
        total <= 8 && !deCoverFour ? 'Condition Photos' : `Condition Photos (${from}–${to})`;

    if (deCoverFour && photos.length > 0) {
        const cover = photos.slice(0, 4);
        const rest = photos.slice(4);
        y = await drawPhotoGrid(
            pdf,
            cover,
            '',
            accent,
            () => 'Condition Photos',
            y,
            ctx,
            { gridVariant: 'deCover', ...photoGridStampOpts }
        );
        if (rest.length) {
            y = await drawPhotoGrid(
                pdf,
                rest,
                '',
                accent,
                (from, to) => photoTitle(from + 4, to + 4, photos.length),
                y,
                ctx,
                { globalIndexOffset: 4, ...photoGridStampOpts }
            );
        }
    } else {
        await drawPhotoGrid(
            pdf,
            photos,
            '',
            accent,
            (from, to) => photoTitle(from, to, photos.length),
            y,
            ctx,
            { gridVariant: deCoverFour ? 'deCover' : 'standard', ...photoGridStampOpts }
        );
    }

    stampFooters(pdf, branch, null);
    const fnDate = returnDate ? format(returnDate, 'yyyy-MM-dd') : 'nodate';
    pdf.save(`Return_Report_${sanitize(plate)}_${fnDate}.pdf`);
}

/* ───────────────────────── DAMAGE ───────────────────────── */
async function generateSwissDamagePDFVector(damage, car, opts = {}) {
    const damages = damage?.hasarKayitlari
        ? damage.hasarKayitlari.filter((h) => !h?.isDeleted)
        : damage && !damage.hasarKayitlari
          ? [damage]
          : [];
    const primary = damages[0] || damage;
    if (!primary) return;

    const accent = { main: C.red, dark: C.red };
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
    const branch = resolveBranchName(opts, primary, car);
    const damageDate = tsToDate(primary.tarih || primary.createdAt);
    const handoverDate = tsToDate(primary.handoverTarihi || primary.handoverDate);
    const resLabel = opts.resLabel || 'RES Code';
    const resCode = primary.resKodu || primary.navKodu || '—';
    const generatedNote = `Generated · ${safeFmt(new Date(), 'dd.MM.yyyy')}`;

    let y = drawDamageHeader(pdf, {
        accent,
        brandSub: branch,
        plate: car?.plaka,
        compact: false,
    });

    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Vehicle Details');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'Make', value: car?.marka || '—', style: 'large' },
            { label: 'Model', value: car?.model || '—', style: 'large' },
            { label: 'Plate', value: car?.plaka || '—', style: 'accent' },
            { label: resLabel, value: resCode, style: 'mono' },
            { label: 'Handover Date', value: compactGridDate(handoverDate) },
            { label: 'Date', value: compactGridDate(damageDate), style: 'damage' },
        ],
        6
    );

    y = drawSectionLabel(pdf, MARGIN, y, CONTENT_W, 'Report Details');
    y = drawInfoGrid(
        pdf,
        MARGIN,
        y,
        CONTENT_W,
        [
            { label: 'Location', value: branch, style: 'large' },
            { label: 'Report Status', value: 'Damage Detected', style: 'damage' },
        ],
        2
    );

    const photos = primary.fotograflar || [];
    const photoFranchiseId =
        opts.franchiseId || primary?.franchiseId || car?.franchiseId || 'CH';
    if (photos.length) {
        const deDamage = isGermanyFranchiseId(photoFranchiseId);
        const photoStampForIndex = (globalIndex) => {
            const info = stamp(globalIndex, handoverDate, damageDate);
            return {
                label: info.label,
                date: formatDisplayDate(info.date, false),
                time: deDamage ? formatPDFTime(info.date) : null,
            };
        };
        const ctx = {
            signal: opts.signal,
            onProgress: opts.onProgress,
            franchiseId: photoFranchiseId,
            pageStart: () =>
                drawDamageHeader(pdf, {
                    accent,
                    brandSub: branch,
                    plate: car?.plaka,
                    compact: true,
                }),
        };
        y = await drawPhotoGrid(
            pdf,
            photos,
            '',
            accent,
            (from, to) =>
                photos.length <= 8
                    ? 'Damage Photographs'
                    : `Damage Photographs (${from}–${to})`,
            y,
            ctx,
            { danger: true, dateBlue: deDamage, photoStampForIndex }
        );
    }

    stampFooters(pdf, branch, generatedNote);
    const fnDate = damageDate ? format(damageDate, 'yyyy-MM-dd') : 'nodate';
    pdf.save(`Damage_Report_${sanitize(car?.plaka)}_${fnDate}.pdf`);
}

/* ───────────────────────── PUBLIC WRAPPERS ─────────────────────────
 * Primary: pixel-faithful HTML template (matches the supplied designs).
 * Fallback: vector jsPDF version if HTML rendering ever fails (never breaks export).
 * Cancellation always propagates. */
export async function generateSwissCheckoutPDF(exit, car, opts = {}) {
    try {
        return await generateSwissCheckoutPDFVector(exit, car, opts);
    } catch (err) {
        if (err instanceof PdfFlowCancelledError || opts?.signal?.aborted) throw err;
        console.warn('[swissPdf] vector checkout failed, HTML fallback', err);
        return generateSwissCheckoutHTMLPDF(exit, car, opts);
    }
}

export async function generateSwissReturnPDF(ret, car, returnPhotos, opts = {}) {
    try {
        return await generateSwissReturnPDFVector(ret, car, returnPhotos, opts);
    } catch (err) {
        if (err instanceof PdfFlowCancelledError || opts?.signal?.aborted) throw err;
        console.warn('[swissPdf] vector return failed, HTML fallback', err);
        return generateSwissReturnHTMLPDF(ret, car, returnPhotos, opts);
    }
}

export async function generateSwissDamagePDF(damage, car, opts = {}) {
    try {
        return await generateSwissDamagePDFVector(damage, car, opts);
    } catch (err) {
        if (err instanceof PdfFlowCancelledError || opts?.signal?.aborted) throw err;
        console.warn('[swissPdf] vector damage failed, HTML fallback', err);
        return generateSwissDamageHTMLPDF(damage, car, opts);
    }
}
