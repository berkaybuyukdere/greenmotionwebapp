/**
 * Switzerland (CH) PDFs — pixel-faithful reproduction of the official HTML
 * templates (checkout = blue, return = orange, damage = red).
 *
 * Renders the *actual* template HTML/CSS (IBM Plex fonts, exact layout, photo
 * card headers, footer page numbers) with live data, then rasterises each A4
 * page with html2canvas into a jsPDF document. Branch name is dynamic.
 *
 * Photo pagination mirrors the supplied templates exactly:
 *   cover → photos 1–6, then continuation pages of 6 + 6 (so 30 photos → 3 pages).
 */
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import { format } from 'date-fns';
import { loadImageUrl, tsToDate } from './iosPdfTemplate';
import { preloadPhotosForPdfParallel } from './pdfImageLoader';
import { PDF_PHOTO_FRAME_H, PDF_PHOTO_FRAME_H_FOUR } from './pdfPhotoQuality';
import {
    PDF_ADD_IMAGE_COMPRESSION,
    PDF_HTML2CANVAS_SCALE,
    PDF_PAGE_RASTER_FORMAT,
} from './pdfPhotoQuality';
import { throwIfAborted } from './pdfDownloadFlow';
import { germanyPdfDisplayName, isGermanyFranchiseId, isUKFranchiseId, ukPdfDisplayName } from './franchiseHelpers';
import {
    formatDisplayDate,
    formatPDFTime,
    stamp,
    stampProcessPhoto,
} from './processPhotoStampLabels';

const A4_W_PX = 794; // 210mm @ 96dpi
const A4_H_PX = 1123; // 297mm @ 96dpi

const FONT_LINK_ID = 'gm-ibm-plex-font-link';

function ensureFonts() {
    if (typeof document === 'undefined') return Promise.resolve();
    if (!document.getElementById(FONT_LINK_ID)) {
        const link = document.createElement('link');
        link.id = FONT_LINK_ID;
        link.rel = 'stylesheet';
        link.href =
            'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap';
        document.head.appendChild(link);
    }
    const tries = [
        '300 12px "IBM Plex Sans"',
        '400 12px "IBM Plex Sans"',
        '500 12px "IBM Plex Sans"',
        '600 12px "IBM Plex Sans"',
        '400 12px "IBM Plex Mono"',
        '500 12px "IBM Plex Mono"',
    ];
    const loads = tries.map((t) => {
        try {
            return document.fonts.load(t);
        } catch {
            return Promise.resolve();
        }
    });
    return Promise.all(loads)
        .then(() => (document.fonts.ready ? document.fonts.ready : null))
        .catch(() => null);
}

function safeFmt(date, fmtStr) {
    try {
        if (!date) return 'N/A';
        return format(date, fmtStr);
    } catch {
        return 'N/A';
    }
}

function compactGridDate(date) {
    return safeFmt(date, 'dd.MM.yyyy');
}

function sanitize(s) {
    return String(s || 'unknown').replace(/[^\w-]+/g, '_').slice(0, 80);
}

function esc(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

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
        DE: 'Germany Düsseldorf',
        DE_DUSSELDORF: 'Germany Düsseldorf',
    };
    if (map[id]) return map[id];
    if (id.startsWith('CH_')) {
        const tail = id.slice(3).replace(/_/g, ' ').toLowerCase();
        return tail.replace(/\b\w/g, (m) => m.toUpperCase());
    }
    if (id.startsWith('DE_')) {
        return germanyPdfDisplayName(id);
    }
    return '';
}

function resolveBranchName(opts, record, car) {
    const franchiseId = opts?.franchiseId || record?.franchiseId || car?.franchiseId || '';
    if (isGermanyFranchiseId(franchiseId)) {
        return germanyPdfDisplayName(
            franchiseId,
            opts?.branchName || opts?.franchiseName || record?.bayiAdi || car?.franchiseName
        );
    }
    if (isUKFranchiseId(franchiseId)) {
        return ukPdfDisplayName(
            franchiseId,
            opts?.branchName || opts?.franchiseName || record?.bayiAdi || car?.franchiseName
        );
    }
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
        branchFromFranchiseId(franchiseId) ||
        'Switzerland';
    return String(candidate).trim() || 'Switzerland';
}

/* ── Shared CSS (lifted verbatim from the supplied templates, fixed to px page) ── */
function baseCss(accentVars) {
    return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  .gm-root {
    --white:#FFFFFF;--gray-50:#F8F9FA;--gray-100:#F1F3F5;--gray-200:#E9ECEF;
    --gray-300:#DEE2E6;--gray-400:#ADB5BD;--gray-500:#6C757D;--gray-600:#495057;
    --gray-700:#343A40;--gray-900:#212529;
    --accent:#1C6DEB;--accent-light:#EBF2FF;--accent-dark:#1451B0;
    --green:#2D8B57;--green-light:#E8F5EE;
    --orange:#C0562A;--orange-light:#FEF0E8;
    --red:#C0302B;--red-light:#FEE8E8;
    --border:#DDE1E7;--radius:4px;
    ${accentVars}
    font-family:'IBM Plex Sans',sans-serif; color:var(--gray-900);
    -webkit-font-smoothing:antialiased;
  }
  .gm-page {
    width:${A4_W_PX}px; min-height:${A4_H_PX}px; background:var(--white);
    padding:53px 53px 46px 53px; position:relative; overflow:hidden;
  }
  .gm-page-header {
    display:flex; justify-content:space-between; align-items:flex-start;
    padding-bottom:10px; border-bottom:2px solid var(--rt-accent); margin-bottom:14px;
  }
  .gm-brand-block { display:flex; align-items:center; gap:10px; }
  .gm-damage-icon {
    width:28px; height:28px; border-radius:4px; background:var(--red-light);
    border:1px solid var(--red); display:flex; align-items:center; justify-content:center;
    font-family:'IBM Plex Mono',monospace; font-size:14px; font-weight:700; color:var(--red); flex-shrink:0;
  }
  .gm-brand-sub { font-size:10px; color:var(--gray-500); letter-spacing:1.5px; text-transform:uppercase; margin-top:1px; }
  .gm-title-block { text-align:right; }
  .gm-badge {
    display:inline-block; background:var(--rt-accent-light); color:var(--rt-accent-dark);
    font-size:9px; font-weight:600; letter-spacing:1.8px; text-transform:uppercase;
    padding:3px 8px; border-radius:2px; margin-bottom:4px; font-family:'IBM Plex Mono',monospace;
  }
  .gm-main-title { font-size:25px; font-weight:300; color:var(--gray-900); letter-spacing:-0.5px; line-height:1; }
  .gm-main-title strong { font-weight:600; color:var(--rt-accent); }
  .gm-section { margin-bottom:14px; }
  .gm-section-label {
    font-size:8.5px; font-weight:600; letter-spacing:2px; text-transform:uppercase;
    color:var(--gray-400); font-family:'IBM Plex Mono',monospace; margin-bottom:6px;
    padding-bottom:4px; border-bottom:1px solid var(--gray-200);
  }
  .gm-grid { display:flex; flex-wrap:wrap; gap:1px; background:var(--border);
    border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; }
  .gm-cell { background:var(--white); padding:8px 10px; }
  .gm-cell-label { font-size:8.5px; font-weight:600; letter-spacing:1.2px; text-transform:uppercase;
    color:var(--gray-400); font-family:'IBM Plex Mono',monospace; margin-bottom:4px; }
  .gm-cell-value { font-size:13px; font-weight:500; color:var(--gray-900); letter-spacing:-0.2px; word-break:break-word; }
  .gm-cell-value.accent { color:var(--accent); font-family:'IBM Plex Mono',monospace; font-size:14px; font-weight:600; }
  .gm-cell-value.large { font-size:16px; font-weight:600; }
  .gm-cell-value.damage { color:var(--red); font-family:'IBM Plex Mono',monospace; font-size:14px; font-weight:600; }
  .gm-cell-value.mono { font-family:'IBM Plex Mono',monospace; font-weight:600; }
  .gm-sig-box { border:1px solid var(--border); border-radius:var(--radius); height:80px;
    display:flex; flex-direction:column; align-items:center; justify-content:flex-end;
    padding:8px; background:var(--gray-50); position:relative; }
  .gm-sig-img { position:absolute; top:6px; left:50%; transform:translateX(-50%);
    max-height:46px; max-width:70%; object-fit:contain; }
  .gm-sig-watermark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
    font-size:38px; color:var(--gray-200); font-family:'IBM Plex Mono',monospace; font-weight:700; white-space:nowrap; }
  .gm-sig-line { width:80%; height:1px; background:var(--gray-300); margin-bottom:4px; }
  .gm-sig-label { font-size:8.5px; color:var(--gray-400); font-family:'IBM Plex Mono',monospace; letter-spacing:1px; text-transform:uppercase; }
  .gm-photo-grid { display:flex; flex-wrap:wrap; gap:8px; }
  .gm-photo-grid-four { display:grid; grid-template-columns:1fr 1fr; gap:12px; max-width:100%; }
  .gm-photo-card { width:340px; border:1px solid var(--border); border-radius:var(--radius); overflow:hidden; background:var(--gray-50); }
  .gm-photo-card.gm-photo-card-four { width:100%; max-width:340px; justify-self:stretch; }
  .gm-photo-frame.gm-photo-frame-four { height:200px; }
  .gm-photo-card.dmg { border-color:var(--red); border-width:1.5px; }
  .gm-photo-head { display:flex; justify-content:space-between; align-items:center; padding:4px 8px;
    background:var(--gray-100); border-bottom:1px solid var(--border); }
  .gm-photo-head.dmg { background:var(--red-light); }
  .gm-photo-num { font-size:8px; font-weight:600; font-family:'IBM Plex Mono',monospace; color:var(--gray-500); letter-spacing:0.5px; }
  .gm-photo-num.dmg { color:var(--red); }
  .gm-photo-date { font-size:8px; color:var(--gray-400); font-family:'IBM Plex Mono',monospace; }
  .gm-photo-date-blue { color:var(--accent); }
  .gm-photo-frame { width:100%; height:164px; overflow:hidden; background:var(--gray-100);
    display:flex; align-items:center; justify-content:center; }
  .gm-photo-frame.dmg { background:#FFF5F5; }
  .gm-photo-img { display:block; max-width:100%; max-height:100%; width:auto; height:auto;
    object-fit:contain; object-position:center center; }
  .gm-pair-grid { display:flex; flex-wrap:wrap; gap:8px; }
  .gm-pair { width:340px; }
  .gm-phase { display:inline-block; font-size:8.5px; font-weight:600; font-family:'IBM Plex Mono',monospace;
    letter-spacing:1px; text-transform:uppercase; padding:2px 6px; border-radius:2px; margin-bottom:4px; }
  .gm-phase.handover { background:var(--green-light); color:var(--green); }
  .gm-phase.ret { background:var(--red-light); color:var(--red); }
  .gm-table { width:100%; border-collapse:collapse; border:1px solid var(--border); border-radius:var(--radius);
    overflow:hidden; font-size:11px; }
  .gm-table thead tr { background:var(--gray-100); border-bottom:1px solid var(--border); }
  .gm-table th { padding:6px 10px; text-align:left; font-size:8.5px; font-weight:600; letter-spacing:1.5px;
    text-transform:uppercase; color:var(--gray-500); font-family:'IBM Plex Mono',monospace; }
  .gm-table td { padding:7px 10px; color:var(--gray-700); border-bottom:1px solid var(--gray-100); }
  .gm-table td:first-child { font-family:'IBM Plex Mono',monospace; font-size:10px; font-weight:600; color:var(--gray-500); }
  .gm-badge-dmg { display:inline-block; background:var(--red-light); color:var(--red); border-radius:2px;
    padding:1px 6px; font-size:8.5px; font-weight:600; font-family:'IBM Plex Mono',monospace; }
  .gm-status-dmg { display:inline-flex; align-items:center; gap:4px; background:var(--red-light); color:var(--red);
    border-radius:2px; padding:2px 8px; font-size:9px; font-weight:600; font-family:'IBM Plex Mono',monospace; }
  .gm-ack { border:1px solid var(--border); border-radius:var(--radius); padding:12px 14px; background:var(--gray-50);
    display:flex; gap:24px; }
  .gm-ack > div { flex:1; }
  .gm-ack-label { font-size:8.5px; font-weight:600; letter-spacing:1.2px; text-transform:uppercase;
    color:var(--gray-400); font-family:'IBM Plex Mono',monospace; margin-bottom:8px; }
  .gm-ack-line { height:48px; border-bottom:1px solid var(--gray-300); margin-bottom:4px; }
  .gm-ack-cap { font-size:8.5px; color:var(--gray-400); font-family:'IBM Plex Mono',monospace; letter-spacing:0.5px; text-transform:uppercase; }
  .gm-footer { position:absolute; bottom:30px; left:53px; right:53px; display:flex; justify-content:space-between;
    align-items:center; padding-top:6px; border-top:1px solid var(--gray-200); }
  .gm-footer span { font-size:8px; color:var(--gray-400); font-family:'IBM Plex Mono',monospace; letter-spacing:0.5px; }
  `;
}

const PLACEHOLDER_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="#ADB5BD" stroke-width="1.5" style="width:28px;height:28px;opacity:0.25;margin:auto;display:block;padding-top:60px;"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/></svg>`;

function headerHtml(branch, badge, titleHtml) {
    return `<div class="gm-page-header">
    <div class="gm-brand-block">
      <div class="gm-brand-sub">${esc(branch)}</div>
    </div>
    <div class="gm-title-block">
      <div class="gm-badge">${esc(badge)}</div>
      <div class="gm-main-title">${titleHtml}</div>
    </div>
  </div>`;
}

function damageHeaderHtml(branch, plate, compact) {
    const rightTitle =
        compact && plate
            ? `<div class="gm-main-title"><strong>${esc(plate)}</strong></div>`
            : `<div class="gm-main-title">Damage Report</div>`;
    return `<div class="gm-page-header">
    <div class="gm-brand-block">
      <div class="gm-damage-icon">!</div>
      <div class="gm-brand-sub">${esc(branch)}</div>
    </div>
    <div class="gm-title-block">${rightTitle}</div>
  </div>`;
}

function gridHtml(cells, colWidthPx) {
    const inner = cells
        .map(
            (c) => `<div class="gm-cell" style="width:${colWidthPx}px">
        <div class="gm-cell-label">${esc(c.label)}</div>
        <div class="gm-cell-value ${c.style || ''}">${esc(c.value)}</div>
      </div>`
        )
        .join('');
    return `<div class="gm-grid">${inner}</div>`;
}

function photoCardHtml(num, dateStr, photo, danger, compactFour = false, stampOpts = {}) {
    const cls = danger ? ' dmg' : '';
    const four = compactFour ? ' gm-photo-card-four' : '';
    const fourFrame = compactFour ? ' gm-photo-frame-four' : '';
    const { timeStr = null, blueStamp = false } = stampOpts;
    const dateClass = blueStamp ? ' gm-photo-date-blue' : '';
    const dateContent = blueStamp && timeStr ? `${dateStr} ${timeStr}` : dateStr;
    const src = photo?.src || (typeof photo === 'string' ? photo : null);
    const numLabel = String(num || '').trim();
    const numHtml = numLabel
        ? `<span class="gm-photo-num${cls}">${esc(numLabel)}</span>`
        : '';
    const body =
        src != null
            ? `<div class="gm-photo-frame${cls}${fourFrame}"><img class="gm-photo-img${cls}" src="${esc(src)}" crossorigin="anonymous" alt="" decoding="sync" /></div>`
            : `<div class="gm-photo-frame${cls}${fourFrame}">${PLACEHOLDER_SVG}</div>`;
    return `<div class="gm-photo-card${cls}${four}">
      <div class="gm-photo-head${cls}">
        ${numHtml}
        <span class="gm-photo-date${dateClass}">${esc(dateContent)}</span>
      </div>${body}
    </div>`;
}

function footerHtml(pageIndex, total, generatedNote) {
    return `<div class="gm-footer">
      <span>© Confidential. Unauthorized reproduction prohibited.</span>
      ${generatedNote ? `<span>${esc(generatedNote)}</span>` : ''}
      <span>PAGE ${pageIndex} / ${total}</span>
    </div>`;
}

/** Renders an array of page-inner-HTML strings into a jsPDF (one A4 page each). */
async function renderPagesToPdf(accentVars, pagesInner, opts, fileName) {
    await ensureFonts();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-12000px;top:0;z-index:-1;';
    host.innerHTML = `<style>${baseCss(accentVars)}</style><div class="gm-root"></div>`;
    const root = host.querySelector('.gm-root');
    document.body.appendChild(host);

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
    try {
        for (let i = 0; i < pagesInner.length; i += 1) {
            throwIfAborted(opts.signal);
            opts.setStage?.('generating', {
                progress: 72 + (i / Math.max(pagesInner.length, 1)) * 22,
                microText: `Rendering page ${i + 1} of ${pagesInner.length}`,
            });
            const pageEl = document.createElement('div');
            pageEl.className = 'gm-page';
            pageEl.innerHTML = pagesInner[i];
            root.appendChild(pageEl);
            const imgs = Array.from(pageEl.querySelectorAll('img'));
            await Promise.all(
                imgs.map(
                    (img) =>
                        img.complete && img.naturalWidth > 0
                            ? Promise.resolve()
                            : new Promise((res) => {
                                  img.onload = () => res();
                                  img.onerror = () => res();
                              })
                )
            );
            const canvas = await html2canvas(pageEl, {
                scale: PDF_HTML2CANVAS_SCALE,
                useCORS: true,
                backgroundColor: '#ffffff',
                logging: false,
                width: A4_W_PX,
                windowWidth: A4_W_PX,
                imageTimeout: 0,
                removeContainer: true,
            });
            const imgData = canvas.toDataURL('image/png');
            if (i > 0) pdf.addPage();
            pdf.addImage(imgData, PDF_PAGE_RASTER_FORMAT, 0, 0, 210, 297, undefined, PDF_ADD_IMAGE_COMPRESSION);
            root.removeChild(pageEl);
            opts.onProgress?.(i + 1, pagesInner.length);
        }
        pdf.save(fileName);
    } finally {
        document.body.removeChild(host);
    }
}

/** Chunk array into fixed-size groups (2-col photo pages use 8 = 4 rows × 2 cols). */
function chunkBy(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
}

const PHOTOS_PER_PAGE = 8;

async function loadAll(urls, signal, onProgress, franchiseId) {
    return preloadPhotosForPdfParallel(urls, { signal, onProgress, franchiseId });
}

/* ───────── CHECK OUT / RETURN ───────── */
async function buildHandover(kind, record, car, photosUrls, opts) {
    const isReturn = kind === 'return';
    const accentVars = isReturn
        ? '--rt-accent:var(--orange); --rt-accent-dark:var(--orange); --rt-accent-light:var(--orange-light);'
        : '--rt-accent:var(--accent); --rt-accent-dark:var(--accent-dark); --rt-accent-light:var(--accent-light);';
    const branch = resolveBranchName(opts, record, car);
    const badge = isReturn ? 'Return Report' : 'Check Out Report';
    const titleStrong = isReturn ? 'Return' : 'Check Out';
    const dateRaw = isReturn
        ? record?.iadeTarihi ?? record?.returnDate ?? record?.createdAt
        : record?.exitTarihi ?? record?.checkOutDate ?? record?.createdAt;
    const opDate = tsToDate(dateRaw);
    const franchiseId = opts?.franchiseId || record?.franchiseId || car?.franchiseId || '';
    const deFranchise = isGermanyFranchiseId(franchiseId);
    const handoverDate = isReturn
        ? tsToDate(record?.handoverTarihi ?? record?.exitTarihi ?? record?.checkOutDate) || opDate
        : opDate;
    const returnDate = isReturn
        ? opDate
        : tsToDate(record?.plannedReturnAt ?? record?.plannedCheckinAt) || opDate;
    const dateStr = formatDisplayDate(isReturn ? returnDate : handoverDate, deFranchise);
    const photosOnFirstPage = deFranchise ? 4 : null;
    const embedFrameH = deFranchise ? PDF_PHOTO_FRAME_H_FOUR : PDF_PHOTO_FRAME_H;
    const plate = record?.aracPlaka || car?.plaka || 'N/A';
    const vehicle = `${car?.marka || ''} ${car?.model || ''}`.trim() || 'N/A';
    const custName =
        [record?.customerFirstName, record?.customerLastName].filter(Boolean).join(' ') ||
        record?.customerName ||
        record?.musteriAdi ||
        'Not provided';
    const fuel =
        (record?.yakitSeviyesi != null && record.yakitSeviyesi !== '' && String(record.yakitSeviyesi)) ||
        (record?.km != null && record.km !== '' ? `${record.km} km` : '—');
    const photoSectionTitle = 'Condition Photos';
    const sigCaption = isReturn ? 'Customer Signature · Vehicle Return' : 'Customer Signature · Check Out';
    const dateLabel = 'Date';

    opts.setStage?.('loading-photos', { progress: 18 });
    const photos = await loadAll(photosUrls, opts.signal, opts.onProgress, opts.franchiseId);
    let sigData = null;
    const sigUrl = record?.customerSignatureURL || record?.signatureURL;
    if (sigUrl) sigData = await loadImageUrl(sigUrl);

    const colW5 = Math.floor((A4_W_PX - 106 - 6) / 5) - 1;
    const colW3 = Math.floor((A4_W_PX - 106 - 4) / 3) - 1;

    const vehicleGrid = gridHtml(
        [
            { label: 'License Plate', value: plate, style: 'accent' },
            { label: 'Make & Model', value: vehicle, style: 'large' },
            { label: dateLabel, value: dateStr },
            { label: 'Fuel Level', value: fuel },
            { label: 'Total Photos', value: String(photos.length), style: 'large' },
        ],
        colW5
    );
    const customerGrid = gridHtml(
        [
            { label: 'Customer Name', value: custName, style: 'large' },
            { label: 'Email Address', value: record?.customerEmail || 'Not provided' },
            { label: 'License Plate', value: plate, style: 'accent' },
        ],
        colW3
    );
    const sigBlock = sigData
        ? `<div class="gm-section">
      <div class="gm-section-label">Customer Signature</div>
      <div class="gm-sig-box"><img class="gm-sig-img" src="${sigData}" /><div class="gm-sig-line"></div><div class="gm-sig-label">${esc(sigCaption)}</div></div>
    </div>`
        : '';

    const renderPhotoBatch = (batch, globalOffset, useFourGrid = false) => {
        const from = globalOffset + 1;
        const to = globalOffset + batch.length;
        const title =
            photos.length <= PHOTOS_PER_PAGE && !useFourGrid
                ? photoSectionTitle
                : `${photoSectionTitle} (${from}–${to})`;
        const cards = batch
            .map((src, batchIdx) => {
                const eventDate = isReturn ? returnDate : handoverDate;
                const info = stampProcessPhoto(eventDate, { deFranchise: deFranchise });
                const stampOpts = deFranchise
                    ? { timeStr: info.time, blueStamp: true }
                    : {};
                return photoCardHtml(
                    info.label,
                    formatDisplayDate(info.date, false),
                    src,
                    false,
                    useFourGrid,
                    stampOpts
                );
            })
            .join('');
        const gridCls = useFourGrid ? 'gm-photo-grid-four' : 'gm-photo-grid';
        return `<div class="gm-section"><div class="gm-section-label">${esc(title)}</div><div class="${gridCls}">${cards}</div></div>`;
    };

    let coverPhotos = [];
    let continuationBatches = [];
    if (photosOnFirstPage === 4 && photos.length > 0) {
        coverPhotos = photos.slice(0, 4);
        continuationBatches = chunkBy(photos.slice(4), PHOTOS_PER_PAGE);
    } else {
        const photoBatches = chunkBy(photos, PHOTOS_PER_PAGE);
        coverPhotos = photoBatches[0] || [];
        continuationBatches = photoBatches.slice(1);
    }

    const pages = [];
    const coverHeader = headerHtml(branch, badge, `Vehicle <strong>${titleStrong}</strong>`);
    let coverBody =
        `<div class="gm-section"><div class="gm-section-label">Vehicle Details</div>${vehicleGrid}</div>` +
        `<div class="gm-section"><div class="gm-section-label">Customer Information</div>${customerGrid}</div>` +
        sigBlock;
    if (coverPhotos.length) {
        coverBody += renderPhotoBatch(
            coverPhotos,
            0,
            photosOnFirstPage === 4
        );
    }
    pages.push({ header: coverHeader, body: coverBody });

    continuationBatches.forEach((batch, bi) => {
        const offset =
            photosOnFirstPage === 4
                ? 4 + bi * PHOTOS_PER_PAGE
                : (bi + 1) * PHOTOS_PER_PAGE;
        const compactHeader = headerHtml(branch, badge, `${esc(plate)} <strong>${titleStrong}</strong>`);
        pages.push({
            header: compactHeader,
            body: renderPhotoBatch(batch, offset, false),
        });
    });

    const total = pages.length;
    const pagesInner = pages.map((p, idx) => p.header + p.body + footerHtml(idx + 1, total, null));
    const fnDate = opDate ? format(opDate, 'yyyy-MM-dd') : 'nodate';
    const fileName = `${isReturn ? 'Return' : 'Checkout'}_Report_${sanitize(plate)}_${fnDate}.pdf`;
    await renderPagesToPdf(accentVars, pagesInner, opts, fileName);
}

export async function generateSwissCheckoutHTMLPDF(exit, car, opts = {}) {
    const photos = exit?.fotograflar || [];
    return buildHandover('checkout', exit, car, photos, opts);
}

export async function generateSwissReturnHTMLPDF(ret, car, returnPhotos, opts = {}) {
    const photos = returnPhotos || ret?.fotograflar || [];
    return buildHandover('return', ret, car, photos, opts);
}

/* ───────── DAMAGE ───────── */
export async function generateSwissDamageHTMLPDF(damage, car, opts = {}) {
    const damages = damage?.hasarKayitlari
        ? damage.hasarKayitlari.filter((h) => !h?.isDeleted)
        : damage && !damage.hasarKayitlari
          ? [damage]
          : [];
    const primary = damages[0] || damage;
    if (!primary) return;

    const accentVars =
        '--rt-accent:var(--red); --rt-accent-dark:var(--red); --rt-accent-light:var(--red-light);';
    const branch = resolveBranchName(opts, primary, car);
    const damageDate = tsToDate(primary.tarih || primary.createdAt);
    const handoverDate = tsToDate(primary.handoverTarihi || primary.handoverDate);
    const returnDate = damageDate;
    const resLabel = opts.resLabel || 'RES Code';
    const resCode = primary.resKodu || primary.navKodu || '—';
    const generatedNote = `Generated · ${safeFmt(new Date(), 'dd.MM.yyyy')}`;

    const photoUrls = primary.fotograflar || [];
    const photoFranchiseId =
        opts.franchiseId || primary?.franchiseId || car?.franchiseId || 'CH';
    opts.setStage?.('loading-photos', { progress: 18 });
    const photos = await loadAll(photoUrls, opts.signal, opts.onProgress, photoFranchiseId);

    const colW6 = Math.floor((A4_W_PX - 106 - 6) / 6) - 1;
    const colW2 = Math.floor((A4_W_PX - 106 - 2) / 2) - 1;

    const vehicleGrid = gridHtml(
        [
            { label: 'Make', value: car?.marka || '—', style: 'large' },
            { label: 'Model', value: car?.model || '—', style: 'large' },
            { label: 'Plate', value: car?.plaka || '—', style: 'accent' },
            { label: resLabel, value: resCode, style: 'mono' },
            { label: 'Handover Date', value: compactGridDate(handoverDate) },
            { label: 'Date', value: compactGridDate(damageDate), style: 'damage' },
        ],
        colW6
    );
    const reportGrid = gridHtml(
        [
            { label: 'Location', value: branch, style: 'large' },
            { label: 'Report Status', value: 'Damage Detected', style: 'damage' },
        ],
        colW2
    );

    const photoBatches = chunkBy(photos, PHOTOS_PER_PAGE);
    const renderDamagePhotos = (batch, offset) => {
        const from = offset + 1;
        const to = offset + batch.length;
        const title =
            photos.length <= PHOTOS_PER_PAGE
                ? 'Damage Photographs'
                : `Damage Photographs (${from}–${to})`;
        const deDamage = isGermanyFranchiseId(photoFranchiseId);
        const cards = batch
            .map((src, j) => {
                const globalIndex = offset + j;
                const info = stamp(globalIndex, handoverDate, returnDate);
                const stampOpts = deDamage
                    ? { timeStr: formatPDFTime(info.date), blueStamp: true }
                    : {};
                return photoCardHtml(
                    info.label,
                    formatDisplayDate(info.date, false),
                    src,
                    true,
                    false,
                    stampOpts
                );
            })
            .join('');
        return `<div class="gm-section" style="margin-top:${offset > 0 ? 8 : 0}px"><div class="gm-section-label">${esc(title)}</div><div class="gm-photo-grid">${cards}</div></div>`;
    };

    const page1Header = damageHeaderHtml(branch, car?.plaka, false);
    let page1Body =
        `<div class="gm-section"><div class="gm-section-label">Vehicle Details</div>${vehicleGrid}</div>` +
        `<div class="gm-section"><div class="gm-section-label">Report Details</div>${reportGrid}</div>`;
    if (photoBatches[0]) {
        page1Body += renderDamagePhotos(photoBatches[0], 0);
    }

    const pages = [{ header: page1Header, body: page1Body }];

    for (let bi = 1; bi < photoBatches.length; bi += 1) {
        const batch = photoBatches[bi];
        const offset = bi * PHOTOS_PER_PAGE;
        const header = damageHeaderHtml(branch, car?.plaka, true);
        pages.push({
            header,
            body: renderDamagePhotos(batch, offset),
        });
    }

    const total = pages.length;
    const pagesInner = pages.map((p, idx) => p.header + p.body + footerHtml(idx + 1, total, generatedNote));
    const fnDate = damageDate ? format(damageDate, 'yyyy-MM-dd') : 'nodate';
    const fileName = `Damage_Report_${sanitize(car?.plaka)}_${fnDate}.pdf`;
    await renderPagesToPdf(accentVars, pagesInner, opts, fileName);
}
