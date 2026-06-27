/**
 * Server-side kiosk General Rental Terms PDF (full TR/EN templates, Noto Sans).
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { resolveOperationalFranchiseId } = require('./franchiseIdResolve');

const FONT_PATH = path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf');
const TEMPLATE_TR = path.join(__dirname, 'legal-templates', 'rental_terms_tr.txt');
const TEMPLATE_EN = path.join(__dirname, 'legal-templates', 'rental_terms_en.txt');
const HAS_NOTO_FONT = fs.existsSync(FONT_PATH);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;
const SIG_BLOCK_H = 118;

function todayTR() {
  return new Date().toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function loadBundledLegalText(languageCode) {
  const lang = String(languageCode || 'tr').trim().toLowerCase() === 'en' ? 'en' : 'tr';
  const file = lang === 'en' ? TEMPLATE_EN : TEMPLATE_TR;
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function fillPlaceholders(text, ctx) {
  const fullName = `${ctx.firstName || ''} ${ctx.lastName || ''}`.trim() || '___';
  const date = todayTR();
  return String(text || '')
    .replace(/\{dateDDMMYYYY\}/g, date)
    .replace(/\{deliveryDriverName\}/g, ctx.firstName || '___')
    .replace(/\{deliveryDriverLastName\}/g, ctx.lastName || '___')
    .replace(/\{tckn\}/g, '_______________')
    .replace(/\{callPermission\}/g, ctx.callOk ? 'Evet / Yes' : 'Hayır / No')
    .replace(/\{emailPermission\}/g, ctx.emailOk ? 'Evet / Yes' : 'Hayır / No')
    .replace(/\{smsPermission\}/g, ctx.smsOk ? 'Evet / Yes' : 'Hayır / No')
    .replace(/\{ \}\s*\{ \}/g, fullName)
    .replace(/\{name\}/gi, fullName)
    .replace(/\{fullname\}/gi, fullName)
    .replace(/\{ \}/g, fullName);
}

function pickLegalText(franchiseData, languageCode) {
  const bundled = loadBundledLegalText(languageCode);
  const lang = String(languageCode || 'tr').trim().toLowerCase() === 'en' ? 'en' : 'tr';
  const data = franchiseData || {};
  const fromFranchise =
    lang === 'en'
      ? String(data.pdfLegalTextEn || data.termsConditionsEn || '').trim()
      : String(data.pdfLegalTextTr || data.termsConditionsTr || '').trim();
  // Kiosk PDF always uses the canonical full template (matches Termsandconditions docx).
  if (bundled.length >= 2000) return bundled;
  return fromFranchise || bundled;
}

function parseSections(raw) {
  const text = String(raw || '');
  if (!text.includes('{signature}')) return [];
  const parts = text.split(/\{signature\}/i);
  return parts
    .map((part, idx) => {
      const body = String(part || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (!body) return null;
      const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
      let title = '';
      for (const l of lines) {
        if (/^(Date|Tarih|Data Subject|Veri Sahibi|MAIL ORDER|AÇIK RIZA|TİCARİ ELEKTRONİK|KİŞİSEL VERİ)/i.test(l)) {
          title = l.slice(0, 140);
          break;
        }
        if (/^[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s\-]{6,}$/.test(l) && l.length < 100) {
          title = l;
          break;
        }
      }
      if (!title) title = lines[0]?.slice(0, 140) || `Section ${idx + 1}`;
      return { idx, title, body };
    })
    .filter(Boolean);
}

function stripSigDataUrl(sig) {
  const s = String(sig || '').trim();
  const idx = s.indexOf('base64,');
  return idx >= 0 ? s.slice(idx + 7) : s;
}

function assertFontAvailable() {
  if (!HAS_NOTO_FONT) {
    throw new Error(
      'NotoSans-Regular.ttf missing in functions/fonts — cannot render Turkish GRT PDF'
    );
  }
}

function ensureSpace(doc, heightNeeded) {
  const y = doc.y || MARGIN;
  if (y + heightNeeded > PAGE_H - MARGIN) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

/** Render one paragraph / line with light hierarchy. */
function renderBodyLine(doc, line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    doc.moveDown(0.35);
    return;
  }
  const isNumbered = /^\d+\.\s/.test(trimmed);
  const isAllCapsTitle =
    trimmed.length >= 10 &&
    trimmed.length < 90 &&
    /^[A-ZÇĞİÖŞÜ0-9\s\-–—/]+$/.test(trimmed) &&
    trimmed === trimmed.toUpperCase();
  if (isAllCapsTitle) {
    ensureSpace(doc, 28);
    doc.moveDown(0.4);
    doc.font('Body').fontSize(10.5).fillColor('#1d1d1f');
    doc.text(trimmed, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2, align: 'left' });
    doc.moveDown(0.25);
    return;
  }
  if (isNumbered) {
    ensureSpace(doc, 20);
    doc.moveDown(0.25);
    doc.font('Body').fontSize(9.5).fillColor('#1d1d1f');
    doc.text(trimmed, MARGIN, doc.y, { width: CONTENT_W, lineGap: 2, align: 'left' });
    return;
  }
  if (/^\t*•\s|^[-–]\s/.test(trimmed)) {
    doc.font('Body').fontSize(8.5).fillColor('#3c3c43');
    doc.text(trimmed.replace(/^\t+/, ''), MARGIN + 8, doc.y, {
      width: CONTENT_W - 8,
      lineGap: 1.5,
      align: 'left',
    });
    return;
  }
  doc.font('Body').fontSize(8.5).fillColor('#3c3c43');
  doc.text(trimmed, MARGIN, doc.y, {
    width: CONTENT_W,
    lineGap: 1.5,
    align: 'justify',
  });
}

function renderBody(doc, bodyText) {
  const lines = String(bodyText || '').split('\n');
  for (const line of lines) {
    ensureSpace(doc, 14);
    renderBodyLine(doc, line);
  }
}

function renderSignatureBlock(doc, sectionIdx, customerName, sigRaw) {
  ensureSpace(doc, SIG_BLOCK_H);
  doc.moveDown(0.6);
  const startY = doc.y;
  doc.font('Body').fontSize(9).fillColor('#3c3c43');
  doc.text(`Tarih / Date: ${todayTR()}`, MARGIN, startY, { lineGap: 2 });
  doc.text(`Ad Soyad / Name: ${customerName || '___'}`, MARGIN, doc.y + 2, { lineGap: 2 });

  let sigY = doc.y + 6;
  if (sigRaw) {
    try {
      const buf = Buffer.from(stripSigDataUrl(sigRaw), 'base64');
      if (buf.length > 0) {
        doc.image(buf, MARGIN, sigY, { width: 160, height: 54 });
        sigY += 58;
      }
    } catch (e) {
      console.warn('[kioskRentalTermsPdf] signature image skipped', e?.message || e);
      sigY += 4;
    }
  } else {
    sigY += 50;
  }
  doc
    .moveTo(MARGIN, sigY + 6)
    .lineTo(MARGIN + 170, sigY + 6)
    .strokeColor('#c8c8cd')
    .lineWidth(0.5)
    .stroke();
  doc.fontSize(8).fillColor('#6e6e73').text('İmza / Signature', MARGIN, sigY + 10);
  doc.y = sigY + 28;
}

/**
 * @param {object} opts
 * @param {string} opts.legalText
 * @param {string[]} opts.signatures
 * @param {string} opts.customerName
 */
function buildKioskRentalTermsPdfBuffer(opts) {
  assertFontAvailable();

  const filled = fillPlaceholders(String(opts.legalText || ''), {
    firstName: opts.firstName,
    lastName: opts.lastName,
    callOk: opts.callOk !== false,
    emailOk: opts.emailOk !== false,
    smsOk: opts.smsOk !== false,
  });
  let sections = parseSections(filled);
  if (!sections.length) {
    const body = filled.trim();
    if (!body) throw new Error('No rental terms text to render');
    sections = [{ idx: 0, title: 'Genel Kiralama Şartları / General Rental Terms', body }];
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, autoFirstPage: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Body', FONT_PATH);
    doc.font('Body').fillColor('#1d1d1f');

    sections.forEach((section, i) => {
      if (i > 0) {
        doc.addPage();
        doc.y = MARGIN;
      } else {
        doc.y = MARGIN;
      }

      doc.fontSize(11).fillColor('#1d1d1f');
      doc.text(section.title, MARGIN, doc.y, { width: CONTENT_W, lineGap: 3 });
      doc.moveDown(0.5);

      renderBody(doc, section.body);
      renderSignatureBlock(doc, i, opts.customerName, opts.signatures?.[i]);
    });

    doc.end();
  });
}

async function buildKioskRentalTermsPdfForIntake(db, franchiseId, intake) {
  const canonicalId = resolveOperationalFranchiseId(franchiseId);
  const snap = await db.collection('franchises').doc(canonicalId).get();
  const franchiseData = snap.exists ? snap.data() : {};
  const rawText = pickLegalText(franchiseData, intake.languageCode);
  const customerName = `${intake.firstName || ''} ${intake.lastName || ''}`.trim() || '___';
  return buildKioskRentalTermsPdfBuffer({
    legalText: rawText,
    signatures: intake.signatures || [],
    customerName,
    firstName: intake.firstName,
    lastName: intake.lastName,
    callOk: intake.callOk,
    emailOk: intake.emailOk,
    smsOk: intake.smsOk,
  });
}

module.exports = {
  buildKioskRentalTermsPdfBuffer,
  buildKioskRentalTermsPdfForIntake,
  fillPlaceholders,
  parseSections,
  pickLegalText,
  loadBundledLegalText,
};
