/**
 * Front-desk kiosk: unauthenticated callable writes to franchises/{franchiseId}/frontDeskCustomers
 * via Admin SDK (no external address API).
 */
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

setGlobalOptions({ region: 'us-central1', maxInstances: 20, memory: '512MiB' });

if (!admin.apps.length) {
  admin.initializeApp();
}

const { buildKioskRentalTermsPdfForIntake, loadBundledLegalText } = require('./kioskRentalTermsPdf');
const { resolveOperationalFranchiseId } = require('./franchiseIdResolve');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeFranchiseId(raw) {
  const s = String(raw || '').trim();
  // Keep validation permissive: existing franchise IDs may include longer or mixed tokens.
  // Firestore doc IDs must not contain '/'.
  if (!s || s.length > 80 || s === '.' || s === '..' || s.includes('/')) {
    throw new HttpsError('invalid-argument', 'Invalid franchiseId');
  }
  return resolveOperationalFranchiseId(s);
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function dedupeKey(franchiseId, phone, submittedAtMillis) {
  const day = new Date(submittedAtMillis).toISOString().slice(0, 10);
  return `${franchiseId}|${normalizePhoneDigits(phone)}|${day}`;
}

const rateBucket = new Map();
function rateLimit(key, maxPerWindow, windowMs) {
  const now = Date.now();
  let b = rateBucket.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, n: 0 };
    rateBucket.set(key, b);
  }
  b.n += 1;
  if (b.n > maxPerWindow) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Try again shortly.');
  }
}

function validateEmail(email) {
  const s = String(email || '').trim();
  if (s.length < 5 || s.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// =====================================================================
// Kiosk upload token (HMAC) — binds saveKioskRentalTerms to a specific
// franchiseId + customerDocId issued during submitFrontDeskIntake so the
// unauthenticated kiosk page cannot fabricate uploads for unrelated rows.
//
// Stateless: secret in env (preferred) or Functions config; no Firestore
// state per-token.  Token TTL = 1 hour from issuance.
//
// To rotate the secret without redeploy, run:
//   firebase functions:secrets:set KIOSK_UPLOAD_SECRET    (firebase functions v2)
//   # or use env: firebase functions:config:set kiosk.upload_secret="..."  (legacy)
//   # then redeploy the kiosk callables.
// =====================================================================
const KIOSK_UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

function getKioskUploadSecret() {
  const raw =
    process.env.KIOSK_UPLOAD_SECRET ||
    process.env.GM_KIOSK_UPLOAD_SECRET ||
    '';
  return String(raw || '').trim();
}

function issueKioskUploadToken(franchiseId, customerDocId) {
  const secret = getKioskUploadSecret();
  if (!secret) return null;
  const fid = String(franchiseId || '').trim().toUpperCase();
  const cid = String(customerDocId || '').trim();
  const issuedAt = Date.now();
  const payload = `${fid}|${cid}|${issuedAt}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${issuedAt}.${sig}`;
}

function verifyKioskUploadToken(token, franchiseId, customerDocId) {
  const secret = getKioskUploadSecret();
  if (!secret) return { ok: false, reason: 'no_secret_configured' };
  const raw = String(token || '').trim();
  if (!raw || !raw.includes('.')) return { ok: false, reason: 'malformed' };
  const [issuedAtStr, sig] = raw.split('.', 2);
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt) || issuedAt <= 0) return { ok: false, reason: 'malformed' };
  if (Date.now() - issuedAt > KIOSK_UPLOAD_TOKEN_TTL_MS) return { ok: false, reason: 'expired' };
  const fid = String(franchiseId || '').trim().toUpperCase();
  const cid = String(customerDocId || '').trim();
  const payload = `${fid}|${cid}|${issuedAt}`;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return { ok: false, reason: 'signature_mismatch' };
    if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'signature_mismatch' };
  } catch {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}

/** Doc id for `franchises/{fid}/customerContactRemember/{id}` — keep in sync with web + iOS. */
function customerRememberDocIdFromEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
    .replace(/\//g, '_')
    .replace(/#/g, '_')
    .replace(/\?/g, '_');
}

async function upsertCustomerContactRememberMerge(db, franchiseId, fields) {
  const email = String(fields.email || '').trim().toLowerCase();
  if (!validateEmail(email)) return;
  const docId = customerRememberDocIdFromEmail(email);
  const ref = db.collection('franchises').doc(franchiseId).collection('customerContactRemember').doc(docId);
  const payload = {
    franchiseId,
    email,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const optionalKeys = [
    'firstName',
    'familyName',
    'lastName',
    'phone',
    'phoneDialCca2',
    'phoneNationalDigits',
    'addressLine',
    'city',
    'postalCode',
    'country',
    'tcKimlikNo',
    'passportNumber',
    'lastSource',
  ];
  for (const k of optionalKeys) {
    const v = fields[k];
    if (v == null) continue;
    const s = typeof v === 'string' ? v.trim() : v;
    if (s !== '' && s != null) payload[k] = s;
  }
  if (!payload.familyName && fields.lastName) {
    payload.familyName = String(fields.lastName).trim();
  }
  await ref.set(payload, { merge: true });
}

function normalizeLegalText(value) {
  const txt = String(value || '').trim();
  return txt.length ? txt : null;
}

/** Switzerland kiosk franchises in this project (ISO country-style id). */
function isTurkeyFranchiseId(franchiseId) {
  return String(franchiseId || '').trim().toUpperCase().startsWith('TR');
}

function isSwissFrontDeskFranchise(franchiseId) {
  return /^CH/i.test(String(franchiseId || '').trim());
}

const SWISS_FD_LEGAL_MARKER = '[[gm-swiss-frontdesk-retention-v1]]';
const SWISS_FD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const SWISS_TERMS_APPENDIX_EN = `${SWISS_FD_LEGAL_MARKER}
(Front-desk kiosk — Switzerland) Under applicable Swiss data protection law (FADP) and our internal data-minimisation policy, the personal data you enter on this kiosk screen is kept in the intake queue for seven (7) days from the moment you submit the form. After that period it is permanently deleted from this intake list. Rental operations that staff record separately in the ERP (for example vehicle checkout, return, damage, or contract-related entries) are not deleted by this step and continue to be processed under the rental agreement and applicable law.`;

const SWISS_TERMS_APPENDIX_DE = `${SWISS_FD_LEGAL_MARKER}
(Frontdesk-Kiosk — Schweiz) Gemäss dem revidierten Datenschutzgesetz (revDSG / FADP) und unserer internen Datenminimierung werden die auf diesem Kiosk erfassten Personendaten höchstens sieben (7) Tage ab Absenden des Formulars in der Intake-Warteschlange aufbewahrt und anschliessend dort endgültig gelöscht. Separat im ERP erfasste Vorgänge (z. B. Fahrzeugausgabe, Rücknahme, Schaden oder Vertragsdaten) werden durch diesen Schritt nicht entfernt und weiterhin gemäss Mietvertrag und anwendbarem Recht verarbeitet.`;

const SWISS_PRIVACY_APPENDIX_EN = `${SWISS_FD_LEGAL_MARKER}
(Front-desk kiosk — Switzerland) Privacy: Your kiosk intake data (name, contact, address) is stored only so that branch staff can complete your reservation. It is retained for seven (7) days from submission and then erased from the kiosk intake system. Further personal data processed later in checkout, return, damage, or billing flows is governed by the rental contract and separate privacy notices for those processes; erasing the kiosk intake row does not remove those operational records.`;

const SWISS_PRIVACY_APPENDIX_DE = `${SWISS_FD_LEGAL_MARKER}
(Frontdesk-Kiosk — Schweiz) Datenschutz: Ihre Kiosk-Intake-Daten (Name, Kontakt, Adresse) werden nur gespeichert, damit das Filialpersonal Ihre Reservation abschliessen kann. Sie werden sieben (7) Tage ab Absenden aufbewahrt und anschliessend im Kiosk-Intake-System gelöscht. Später in Ausgabe-, Rücknahme-, Schaden- oder Rechnungsprozessen verarbeitete Personendaten richten sich nach dem Mietvertrag und separaten Hinweisen für diese Vorgänge; das Löschen der Intake-Zeile entfernt diese operativen Einträge nicht.`;

function appendSwissKioskClauseIfNeeded(baseText, appendix) {
  const b = String(baseText || '').trim();
  const a = String(appendix || '').trim();
  if (!a) return b || null;
  if (b.includes(SWISS_FD_LEGAL_MARKER)) return b || null;
  if (!b) return a;
  return `${b}\n\n${a}`;
}

function applySwissFrontDeskLegalAppendices(franchiseId, data) {
  const base = {
    termsConditionsTr: normalizeLegalText(data.termsConditionsTr),
    termsConditionsEn: normalizeLegalText(data.termsConditionsEn),
    termsConditionsDe: normalizeLegalText(data.termsConditionsDe),
    privacyPolicyTr: normalizeLegalText(data.privacyPolicyTr),
    privacyPolicyEn: normalizeLegalText(data.privacyPolicyEn),
    privacyPolicyDe: normalizeLegalText(data.privacyPolicyDe),
  };
  if (!isSwissFrontDeskFranchise(franchiseId) || data.disableSwissFrontDeskLegalAppendix === true) {
    return base;
  }
  return {
    ...base,
    termsConditionsEn: appendSwissKioskClauseIfNeeded(data.termsConditionsEn, SWISS_TERMS_APPENDIX_EN),
    termsConditionsDe: appendSwissKioskClauseIfNeeded(data.termsConditionsDe, SWISS_TERMS_APPENDIX_DE),
    privacyPolicyEn: appendSwissKioskClauseIfNeeded(data.privacyPolicyEn, SWISS_PRIVACY_APPENDIX_EN),
    privacyPolicyDe: appendSwissKioskClauseIfNeeded(data.privacyPolicyDe, SWISS_PRIVACY_APPENDIX_DE),
  };
}

function submittedMillisFromDoc(data) {
  const ts = data?.submittedAt || data?.createdAt;
  if (ts && typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts?.seconds != null) return ts.seconds * 1000;
  return null;
}

function retentionExpiryMillisForFrontDeskDoc(franchiseId, data) {
  if (!isSwissFrontDeskFranchise(franchiseId)) return null;
  if (data?.retentionExpiresAt && typeof data.retentionExpiresAt.toMillis === 'function') {
    return data.retentionExpiresAt.toMillis();
  }
  const submitted = submittedMillisFromDoc(data);
  if (submitted == null) return null;
  return submitted + SWISS_FD_RETENTION_MS;
}

async function clearLinkedFrontDeskRefsForFranchise(db, franchiseId, fdDocId) {
  const fid = String(franchiseId || '').trim();
  const id = String(fdDocId || '').trim();
  if (!fid || !id) return 0;
  const snap = await db
    .collection('franchises')
    .doc(fid)
    .collection('iadeIslemleri')
    .where('linkedFrontDeskCustomerId', '==', id)
    .limit(50)
    .get();
  if (snap.empty) return 0;
  let batch = db.batch();
  let ops = 0;
  let cleared = 0;
  for (const d of snap.docs) {
    batch.update(d.ref, {
      linkedFrontDeskCustomerId: admin.firestore.FieldValue.delete(),
      linkedFrontDeskCustomerPurgedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    ops += 1;
    cleared += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return cleared;
}

async function deleteFrontDeskCustomerStoragePrefix(franchiseId, fdDocId) {
  const fid = String(franchiseId || '').trim();
  const id = String(fdDocId || '').trim();
  if (!fid || !id) return;
  const bucket = admin.storage().bucket();
  const prefix = `franchises/${fid}/frontDeskCustomers/${id}/`;
  let files = [];
  try {
    [files] = await bucket.getFiles({ prefix, maxResults: 500 });
  } catch (e) {
    console.warn('[purgeFrontDesk] listFiles failed', prefix, e?.message || e);
    return;
  }
  if (!files || !files.length) return;
  await Promise.all(
    files.map((f) =>
      f.delete().catch((err) => {
        console.warn('[purgeFrontDesk] storage delete failed', f.name, err?.message || err);
      })
    )
  );
}

async function purgeOneFrontDeskCustomerDoc(db, docSnap) {
  const data = docSnap.data() || {};
  const franchiseId = String(data.franchiseId || docSnap.ref.parent?.parent?.id || '').trim();
  const fdDocId = docSnap.id;
  await clearLinkedFrontDeskRefsForFranchise(db, franchiseId, fdDocId);
  await deleteFrontDeskCustomerStoragePrefix(franchiseId, fdDocId);
  await docSnap.ref.delete();
}

async function runGetFrontDeskLegalDocs(request) {
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const db = admin.firestore();
  const snap = await db.collection('franchises').doc(franchiseId).get();
  if (!snap.exists) {
    // Do not block kiosk flow when legal text was not configured yet.
    const empty = {
      termsConditionsTr: null,
      termsConditionsEn: null,
      termsConditionsDe: null,
      privacyPolicyTr: null,
      privacyPolicyEn: null,
      privacyPolicyDe: null,
    };
    const legalEmpty = applySwissFrontDeskLegalAppendices(franchiseId, empty);
    return {
      franchiseId,
      termsConditionsTr: legalEmpty.termsConditionsTr,
      termsConditionsEn: legalEmpty.termsConditionsEn,
      termsConditionsDe: legalEmpty.termsConditionsDe,
      privacyPolicyTr: legalEmpty.privacyPolicyTr,
      privacyPolicyEn: legalEmpty.privacyPolicyEn,
      privacyPolicyDe: legalEmpty.privacyPolicyDe,
      pdfLegalTextTr: null,
      pdfLegalTextEn: null,
    };
  }
  const data = snap.data() || {};
  const legal = applySwissFrontDeskLegalAppendices(franchiseId, data);
  const turkeyKiosk = isTurkeyFranchiseId(franchiseId);
  const bundledTr = turkeyKiosk ? loadBundledLegalText('tr') : '';
  const bundledEn = turkeyKiosk ? loadBundledLegalText('en') : '';
  return {
    franchiseId,
    termsConditionsTr: turkeyKiosk ? bundledTr || legal.termsConditionsTr : null,
    termsConditionsEn: turkeyKiosk ? bundledEn || legal.termsConditionsEn : null,
    termsConditionsDe: legal.termsConditionsDe,
    privacyPolicyTr: legal.privacyPolicyTr,
    privacyPolicyEn: legal.privacyPolicyEn,
    privacyPolicyDe: legal.privacyPolicyDe,
    pdfLegalTextTr: turkeyKiosk ? bundledTr || normalizeLegalText(data.pdfLegalTextTr) : null,
    pdfLegalTextEn: turkeyKiosk ? bundledEn || normalizeLegalText(data.pdfLegalTextEn) : null,
  };
}

const FRONT_DESK_DOC_CATEGORIES = ['drivingLicense', 'nationalId', 'passport'];

function extFromKioskMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m === 'image/png') return 'png';
  if (m === 'image/webp') return 'webp';
  return 'jpg';
}

function sanitizedCustomerDocumentsForIntake(franchiseId, clientSubmissionId, raw) {
  const fid = String(franchiseId || '').trim().toUpperCase();
  const docId = String(clientSubmissionId || '').trim();
  if (!fid || !docId || !raw || typeof raw !== 'object') return null;
  const out = {};
  for (const cat of FRONT_DESK_DOC_CATEGORIES) {
    const arr = raw[cat];
    if (!Array.isArray(arr)) continue;
    const list = [];
    for (const item of arr.slice(0, 8)) {
      if (!item || typeof item !== 'object') continue;
      const url = String(item.url || '').trim();
      const fileName = String(item.fileName || 'document').slice(0, 200);
      const contentType = String(item.contentType || '').slice(0, 120);
      if (!url.startsWith('https://firebasestorage.googleapis.com/')) continue;
      const marker = `frontDeskCustomers%2F${encodeURIComponent(docId)}%2F${encodeURIComponent(cat)}`;
      if (!url.includes(marker)) continue;
      list.push({
        url,
        fileName,
        contentType,
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    if (list.length) out[cat] = list;
  }
  return Object.keys(out).length ? out : null;
}

async function runUploadFrontDeskKioskDocument(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`kup:${ip}`, 40, 3600_000);

  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const clientSubmissionId = String(request.data?.clientSubmissionId || '').trim();
  if (!UUID_RE.test(clientSubmissionId)) {
    throw new HttpsError('invalid-argument', 'Invalid clientSubmissionId');
  }
  const category = String(request.data?.category || '').trim();
  if (!FRONT_DESK_DOC_CATEGORIES.includes(category)) {
    throw new HttpsError('invalid-argument', 'Invalid category');
  }
  const contentTypeIn = String(request.data?.contentType || '').trim().toLowerCase();
  const normalizedMime = contentTypeIn === 'image/jpg' ? 'image/jpeg' : contentTypeIn;
  const allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedMime.includes(normalizedMime)) {
    throw new HttpsError('invalid-argument', 'Unsupported file type');
  }
  const b64 = String(request.data?.fileBase64 || '').trim();
  if (b64.length < 24 || b64.length > 3_600_000) {
    throw new HttpsError('invalid-argument', 'Invalid file payload');
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch {
    throw new HttpsError('invalid-argument', 'Invalid base64');
  }
  if (buffer.length < 24 || buffer.length > 2_600_000) {
    throw new HttpsError('invalid-argument', 'File too large');
  }
  const ext = extFromKioskMime(normalizedMime);
  const fileNameSafe = String(request.data?.fileName || `upload.${ext}`)
    .replace(/[^\w.\-()+ ]/g, '')
    .slice(0, 120);
  const objectPath = `franchises/${franchiseId}/frontDeskCustomers/${clientSubmissionId}/${category}/${crypto.randomUUID()}.${ext}`;
  const bucket = admin.storage().bucket();
  const token = crypto.randomUUID();
  const file = bucket.file(objectPath);
  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: normalizedMime,
      cacheControl: 'private, max-age=0',
      metadata: { firebaseStorageDownloadTokens: token },
    },
  });
  const enc = encodeURIComponent(objectPath);
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${enc}?alt=media&token=${token}`;
  return {
    url,
    fileName: fileNameSafe || `upload.${ext}`,
    contentType: normalizedMime,
    storagePath: objectPath,
  };
}

/** Shared handler: kiosk + hosted bundles may call `submitFrontDeskIntake` or legacy `frontDeskIntake`. */
async function runSubmitFrontDeskIntake(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`sub:${ip}`, 25, 3600_000);

  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const clientSubmissionId = String(request.data?.clientSubmissionId || '').trim();
  if (!UUID_RE.test(clientSubmissionId)) {
    throw new HttpsError('invalid-argument', 'Invalid clientSubmissionId');
  }

  const firstNameIn = String(request.data?.firstName || '').trim();
  const lastNameIn = String(request.data?.lastName || '').trim();
  let fullName = String(request.data?.fullName || '').trim();
  if (firstNameIn.length >= 1 && lastNameIn.length >= 1) {
    fullName = `${firstNameIn} ${lastNameIn}`.trim();
  }
  if (fullName.length < 2) {
    fullName = 'Pending customer';
  }
  const phone = String(request.data?.phone || '').trim();
  const email = String(request.data?.email || '').trim().toLowerCase();
  const addressLine = String(request.data?.addressLine || '').trim();
  const city = String(request.data?.city || '').trim();
  const postalCode = String(request.data?.postalCode || '').trim();
  const country = String(request.data?.country || '').trim();
  const termsAccepted = request.data?.termsAccepted === true;
  const privacyAccepted = request.data?.privacyAccepted === true;

  if (fullName.length > 120) {
    throw new HttpsError('invalid-argument', 'Invalid full name');
  }
  if (normalizePhoneDigits(phone).length < 6) {
    throw new HttpsError('invalid-argument', 'Invalid telephone');
  }
  if (!validateEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  if (addressLine.length < 2 || addressLine.length > 200) {
    throw new HttpsError('invalid-argument', 'Invalid street / number');
  }
  if (city.length < 1 || city.length > 100) {
    throw new HttpsError('invalid-argument', 'Invalid city');
  }
  if (postalCode.length < 2 || postalCode.length > 20) {
    throw new HttpsError('invalid-argument', 'Invalid postal code');
  }
  if (country.length < 2 || country.length > 80) {
    throw new HttpsError('invalid-argument', 'Invalid country');
  }
  if (!termsAccepted || !privacyAccepted) {
    throw new HttpsError('invalid-argument', 'Terms and Privacy Policy must be accepted');
  }

  const now = Date.now();
  const key = dedupeKey(franchiseId, phone, now);
  const db = admin.firestore();
  const col = db.collection('franchises').doc(franchiseId).collection('frontDeskCustomers');
  const docRef = col.doc(clientSubmissionId);
  const turkeyKioskIntake = isTurkeyFranchiseId(franchiseId);
  const rentalTermsPdfBase64Early = turkeyKioskIntake
    ? String(request.data?.rentalTermsPdfBase64 || request.data?.pdfBase64 || '').trim()
    : '';
  const rentalTermsLangEarly = turkeyKioskIntake
    ? request.data?.rentalTermsLanguageCode || request.data?.languageCode
    : null;
  const rentalTermsSignaturesEarly =
    turkeyKioskIntake && Array.isArray(request.data?.rentalTermsSignatures)
      ? request.data.rentalTermsSignatures
          .map((s) => String(s || '').trim())
          .filter((s) => s.length > 40)
      : [];

  const existing = await docRef.get();
  if (existing.exists) {
    // Never block the kiosk UI on GRT PDF rebuild for idempotent retries.
    const existingPdf =
      String(existing.data()?.kioskRentalTermsPdfUrl || '').trim() || null;
    if (rentalTermsSignaturesEarly.length > 0 && !existingPdf) {
      Promise.resolve()
        .then(async () => {
          const pdfBuffer = await buildKioskRentalTermsPdfForIntake(db, franchiseId, {
            signatures: rentalTermsSignaturesEarly,
            languageCode: rentalTermsLangEarly,
            firstName: firstNameIn,
            lastName: lastNameIn,
            email,
            callOk: request.data?.callOk === true,
            emailOk: request.data?.emailOk === true,
            smsOk: request.data?.smsOk === true,
          });
          await persistKioskRentalTermsPdf(
            franchiseId,
            clientSubmissionId,
            pdfBuffer.toString('base64'),
            rentalTermsLangEarly,
            { allowOverwrite: true }
          );
        })
        .catch((e) => {
          console.error(
            '[submitFrontDeskIntake] duplicate retry deferred PDF failed:',
            e?.message || e
          );
        });
    }
    return {
      success: true,
      id: clientSubmissionId,
      duplicate: true,
      kioskRentalTermsPdfUrl: existingPdf,
      kioskUploadToken: issueKioskUploadToken(franchiseId, clientSubmissionId),
      rentalTermsPdfPending: Boolean(rentalTermsSignaturesEarly.length > 0 && !existingPdf),
    };
  }

  try {
    const dupSnap = await col
      .where('dedupeKey', '==', key)
      .where('submittedAt', '>', admin.firestore.Timestamp.fromMillis(now - 120_000))
      .limit(1)
      .get();

    if (!dupSnap.empty) {
      throw new HttpsError(
        'already-exists',
        'A submission was just received from this number. Please wait before trying again.'
      );
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[submitFrontDeskIntake] duplicate query failed:', e?.message || e);
    throw new HttpsError('unavailable', 'Could not verify duplicate status. Please retry.');
  }

  const customerDocuments = sanitizedCustomerDocumentsForIntake(
    franchiseId,
    clientSubmissionId,
    request.data?.customerDocuments
  );

  const payload = {
    franchiseId,
    fullName,
    firstName: firstNameIn.length ? firstNameIn : null,
    lastName: lastNameIn.length ? lastNameIn : null,
    phone,
    email,
    addressLine,
    city,
    postalCode,
    country,
    clientSubmissionId,
    dedupeKey: key,
    status: 'awaiting_staff',
    resCode: null,
    vehiclePlate: null,
    completedAt: null,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    termsAccepted: true,
    privacyAccepted: true,
    legalAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
    callOk: request.data?.callOk === true,
    emailOk: request.data?.emailOk === true,
    smsOk: request.data?.smsOk === true,
  };
  if (customerDocuments) {
    payload.customerDocuments = customerDocuments;
  }
  if (isSwissFrontDeskFranchise(franchiseId)) {
    payload.retentionExpiresAt = admin.firestore.Timestamp.fromMillis(now + SWISS_FD_RETENTION_MS);
    payload.swissFrontDeskRetentionPolicy = 'CH-FADP-INTAKE-7D';
  }

  const rentalTermsPdfBase64 = turkeyKioskIntake
    ? String(request.data?.rentalTermsPdfBase64 || request.data?.pdfBase64 || '').trim()
    : '';
  const rentalTermsLang = turkeyKioskIntake
    ? request.data?.rentalTermsLanguageCode || request.data?.languageCode
    : null;
  const rentalTermsSignatures =
    turkeyKioskIntake && Array.isArray(request.data?.rentalTermsSignatures)
      ? request.data.rentalTermsSignatures
          .map((s) => String(s || '').trim())
          .filter((s) => s.length > 40)
      : [];
  let kioskRentalTermsPdfUrl = null;
  // Persist intake first so the kiosk UI is not blocked on heavy GRT PDF work.
  // PDF is built/uploaded after success and patched onto the customer doc.
  await docRef.set(payload);

  try {
    await upsertCustomerContactRememberMerge(db, franchiseId, {
      email,
      firstName: firstNameIn || null,
      lastName: lastNameIn || null,
      phone,
      addressLine,
      city,
      postalCode,
      country,
      lastSource: 'kiosk',
    });
  } catch (e) {
    console.warn('[submitFrontDeskIntake] customerContactRemember', e?.message || e);
  }

  const uploadToken = issueKioskUploadToken(franchiseId, clientSubmissionId);

  if (rentalTermsSignatures.length > 0 || rentalTermsPdfBase64.length >= 100) {
    // Soft-await PDF briefly so most submits get a stored GRT URL; never fail intake.
    const pdfWork = (async () => {
      let pdfBase64ToStore = '';
      if (rentalTermsSignatures.length > 0) {
        const pdfBuffer = await buildKioskRentalTermsPdfForIntake(db, franchiseId, {
          signatures: rentalTermsSignatures,
          languageCode: rentalTermsLang,
          firstName: firstNameIn,
          lastName: lastNameIn,
          email,
          callOk: request.data?.callOk === true,
          emailOk: request.data?.emailOk === true,
          smsOk: request.data?.smsOk === true,
        });
        pdfBase64ToStore = pdfBuffer.toString('base64');
      } else if (rentalTermsPdfBase64.length >= 100) {
        pdfBase64ToStore = rentalTermsPdfBase64;
      }
      if (pdfBase64ToStore.length < 100) return null;
      const pdfBuffer = Buffer.from(pdfBase64ToStore, 'base64');
      const { pdfUrl, storagePath } = await uploadKioskRentalTermsPdfBuffer(
        franchiseId,
        clientSubmissionId,
        pdfBuffer
      );
      const grtFields = kioskRentalTermsFirestoreFields(pdfUrl, storagePath, rentalTermsLang);
      delete grtFields.languageCode;
      await docRef.set(grtFields, { merge: true });
      return pdfUrl;
    })();
    try {
      kioskRentalTermsPdfUrl = await Promise.race([
        pdfWork,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('grt-pdf-timeout')), 18000)
        ),
      ]);
    } catch (e) {
      console.error('[submitFrontDeskIntake] GRT PDF deferred/failed:', e?.message || e);
      pdfWork
        .then((pdfUrl) => {
          if (pdfUrl) {
            console.log('[submitFrontDeskIntake] background GRT PDF saved', clientSubmissionId);
          }
        })
        .catch((err) => {
          console.error('[submitFrontDeskIntake] background GRT PDF failed:', err?.message || err);
        });
    }
  }

  return {
    success: true,
    id: clientSubmissionId,
    duplicate: false,
    kioskRentalTermsPdfUrl,
    kioskUploadToken: uploadToken,
    rentalTermsPdfPending:
      (rentalTermsSignatures.length > 0 || rentalTermsPdfBase64.length >= 100) &&
      !kioskRentalTermsPdfUrl,
  };
}

async function runLookupCustomerContactRemember(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`reml:${ip}`, 80, 3600_000);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!validateEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  const docId = customerRememberDocIdFromEmail(email);
  const snap = await admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('customerContactRemember')
    .doc(docId)
    .get();
  if (!snap.exists) {
    return { found: false };
  }
  const d = snap.data() || {};
  // SECURITY: the kiosk lookup is unauthenticated; never expose
  // national-identifier PII (tcKimlikNo, passportNumber, customerNationalId).
  // Front-desk staff (web/iOS) read those fields directly via authenticated
  // Firestore listeners on `franchises/{fid}/frontDeskCustomers`.
  return {
    found: true,
    firstName: d.firstName || '',
    familyName: d.familyName || d.lastName || '',
    phone: d.phone || '',
    phoneDialCca2: d.phoneDialCca2 || '',
    phoneNationalDigits: d.phoneNationalDigits || '',
    addressLine: d.addressLine || '',
    city: d.city || '',
    postalCode: d.postalCode || '',
    country: d.country || '',
  };
}

/** Firebase-style download URL (no IAM signBlob required). */
function buildFirebaseStorageDownloadUrl(bucketName, objectPath, token) {
  const endpoint =
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ||
    process.env.STORAGE_EMULATOR_HOST ||
    'https://firebasestorage.googleapis.com';
  const base = String(endpoint).replace(/\/$/, '');
  return `${base}/v0/b/${bucketName}/o/${encodeURIComponent(objectPath)}?alt=media&token=${token}`;
}

/** Ensure object has a firebaseStorageDownloadTokens metadata entry. */
async function ensureStorageDownloadToken(file) {
  const [meta] = await file.getMetadata();
  const raw = meta?.metadata?.firebaseStorageDownloadTokens;
  const existing = String(raw || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)[0];
  if (existing) return existing;
  const token = crypto.randomUUID();
  await file.setMetadata({
    metadata: {
      ...(meta.metadata || {}),
      firebaseStorageDownloadTokens: token,
    },
  });
  return token;
}

/** Upload kiosk GRT bytes to Storage; returns HTTPS download URL + path. */
async function uploadKioskRentalTermsPdfBuffer(franchiseId, customerDocId, pdfBuffer) {
  const storagePath = `franchises/${franchiseId}/kiosk-rental-terms/${customerDocId}.pdf`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const downloadToken = crypto.randomUUID();
  await file.save(pdfBuffer, {
    metadata: {
      contentType: 'application/pdf',
      metadata: {
        firebaseStorageDownloadTokens: downloadToken,
      },
    },
    resumable: false,
  });
  const pdfUrl = buildFirebaseStorageDownloadUrl(bucket.name, storagePath, downloadToken);
  return { pdfUrl, storagePath, downloadToken };
}

function kioskRentalTermsFirestoreFields(pdfUrl, storagePath, languageCodeRaw) {
  const languageCode =
    String(languageCodeRaw || 'tr').trim().toLowerCase() === 'en' ? 'en' : 'tr';
  // Firestore rejects FieldValue.serverTimestamp() inside arrayUnion elements.
  const docEntry = {
    url: pdfUrl,
    storagePath,
    source: 'kiosk',
    uploadedAt: admin.firestore.Timestamp.now(),
  };
  return {
    kioskRentalTermsPdfUrl: pdfUrl,
    kioskRentalTermsPdfStoragePath: storagePath,
    kioskRentalTermsSignedAt: admin.firestore.FieldValue.serverTimestamp(),
    kioskRentalTermsLanguage: languageCode,
    'customerDocuments.generalRentalTerms': admin.firestore.FieldValue.arrayUnion(docEntry),
    languageCode,
  };
}

async function syncLinkedExitRentalTerms(db, franchiseId, linkedExitId, pdfUrl, languageCode) {
  if (!isTurkeyFranchiseId(franchiseId)) return;
  const exitId = String(linkedExitId || '').trim();
  if (!exitId) return;
  const exitRef = db
    .collection('franchises')
    .doc(franchiseId)
    .collection('exitIslemleri')
    .doc(exitId);
  try {
    const exitSnap = await exitRef.get();
    if (exitSnap.exists) {
      await exitRef.update({
        trRentalTermsSignatureURL: pdfUrl,
        trRentalTermsLanguage: languageCode,
        trRentalTermsAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (e) {
    console.warn('[kioskGRT] linked exit sync failed:', e?.message || e);
  }
}

/**
 * Persist kiosk-signed GRT PDF (Storage + frontDeskCustomers fields).
 * Used by `saveKioskRentalTerms` and optionally bundled into `submitFrontDeskIntake`.
 */
async function persistKioskRentalTermsPdf(
  franchiseId,
  customerDocId,
  pdfBase64,
  languageCodeRaw,
  options = {}
) {
  const allowOverwrite = options.allowOverwrite === true;
  const pdf = String(pdfBase64 || '').trim();
  if (!pdf || pdf.length < 100) {
    throw new HttpsError('invalid-argument', 'Empty PDF data');
  }
  if (pdf.length > 4_200_000) {
    throw new HttpsError('invalid-argument', 'PDF too large');
  }
  if (!UUID_RE.test(customerDocId)) {
    throw new HttpsError('invalid-argument', 'Invalid customerDocId');
  }

  const db = admin.firestore();
  const docRef = db
    .collection('franchises')
    .doc(franchiseId)
    .collection('frontDeskCustomers')
    .doc(customerDocId);

  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Customer record not found');
  }
  const existing = snap.data() || {};
  if (existing.kioskRentalTermsPdfUrl && !allowOverwrite) {
    return { pdfUrl: existing.kioskRentalTermsPdfUrl, duplicate: true };
  }

  const pdfBuffer = Buffer.from(pdf, 'base64');
  const { pdfUrl, storagePath } = await uploadKioskRentalTermsPdfBuffer(
    franchiseId,
    customerDocId,
    pdfBuffer
  );
  const fields = kioskRentalTermsFirestoreFields(pdfUrl, storagePath, languageCodeRaw);
  const languageCode = fields.languageCode;
  delete fields.languageCode;
  await docRef.update(fields);

  await syncLinkedExitRentalTerms(
    db,
    franchiseId,
    existing.linkedExitId,
    pdfUrl,
    languageCode
  );

  return { pdfUrl, duplicate: false };
}

/**
 * Authenticated callable that returns a short-lived signed URL for a kiosk GRT PDF.
 * Caller must have access to the franchise (legacy `franchiseId` match or
 * `franchiseMemberships[fid] === true` or country_all scope).
 */
async function runGetKioskRentalTermsSignedUrl(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const customerDocId = String(request.data?.customerDocId || '').trim();
  if (!UUID_RE.test(customerDocId)) {
    throw new HttpsError('invalid-argument', 'Invalid customerDocId');
  }

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const profile = userSnap.data() || {};
  if (profile.isActive === false) {
    throw new HttpsError('permission-denied', 'Account inactive');
  }
  const role = String(profile.role || '').toLowerCase().trim().replace(/[\s_-]+/g, '');
  const isPlatformAdmin =
    role === 'globaladmin' || (role === 'superadmin' && profile.isGlobalAdmin === true);

  const allowed = (() => {
    if (isPlatformAdmin) return true;
    const fidUpper = String(franchiseId || '').trim().toUpperCase();
    const rs = profile.roleScope;
    if (rs && typeof rs === 'object' && !Array.isArray(rs)) {
      const level = String(rs.level || '').toLowerCase().trim();
      if (level === 'global') return true;
      const ids = Array.isArray(rs.franchiseIds)
        ? rs.franchiseIds.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)
        : [];
      if (level === 'franchise' || level === 'country') {
        if (ids.length === 0 && level === 'country') return true;
        if (ids.includes(fidUpper)) return true;
      }
    }
    const scope = String(profile.scopeLevel || 'single').toLowerCase().trim();
    if (scope === 'country_all' || scope === 'global') return true;
    const primary = String(profile.franchiseId || '').trim().toUpperCase();
    if (primary === fidUpper) return true;
    const mem = profile.franchiseMemberships;
    if (mem && typeof mem === 'object') {
      for (const [k, v] of Object.entries(mem)) {
        if (v === true && String(k).trim().toUpperCase() === fidUpper) return true;
      }
    }
    return false;
  })();
  if (!allowed) {
    throw new HttpsError('permission-denied', 'No access to this franchise');
  }

  const docRef = db
    .collection('franchises')
    .doc(franchiseId)
    .collection('frontDeskCustomers')
    .doc(customerDocId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Front desk record not found');
  }
  const fdData = docSnap.data() || {};
  const storedUrl = String(fdData.kioskRentalTermsPdfUrl || '').trim();
  const storedPath = String(fdData.kioskRentalTermsPdfStoragePath || '').trim();
  const fallbackPath = `franchises/${franchiseId}/kiosk-rental-terms/${customerDocId}.pdf`;

  // Resolve storage object path (path field > gs:// > legacy https url > default).
  let objectPath = storedPath;
  if (!objectPath && storedUrl.startsWith('gs://')) {
    const rest = storedUrl.slice('gs://'.length);
    const slash = rest.indexOf('/');
    if (slash > 0) {
      objectPath = rest.slice(slash + 1);
    }
  }
  if (!objectPath && storedUrl.startsWith('https://storage.googleapis.com/')) {
    const noScheme = storedUrl.replace(/^https:\/\/storage\.googleapis\.com\//, '');
    const slash = noScheme.indexOf('/');
    if (slash > 0) {
      objectPath = noScheme.slice(slash + 1).split('?')[0];
    }
  }
  if (!objectPath && storedUrl.startsWith('https://firebasestorage.googleapis.com/')) {
    const marker = '/o/';
    const idx = storedUrl.indexOf(marker);
    if (idx > 0) {
      const encoded = storedUrl.slice(idx + marker.length).split('?')[0];
      try {
        objectPath = decodeURIComponent(encoded);
      } catch {
        objectPath = encoded;
      }
    }
  }
  if (!objectPath) {
    objectPath = fallbackPath;
  }

  const bucket = admin.storage().bucket();
  const file = bucket.file(objectPath);
  try {
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', 'Kiosk GRT PDF not found in storage');
    }
    const languageCode =
      String(fdData.kioskRentalTermsLanguage || 'tr').toLowerCase() === 'en' ? 'en' : 'tr';
    const bucketName = bucket.name;
    const gsUrl = `gs://${bucketName}/${objectPath}`;
    if (!storedUrl) {
      try {
        const repairFields = kioskRentalTermsFirestoreFields(gsUrl, objectPath, languageCode);
        delete repairFields.languageCode;
        await docRef.update(repairFields);
      } catch (repairErr) {
        console.warn('[getKioskRentalTermsSignedUrl] firestore repair skipped:', repairErr?.message || repairErr);
      }
      const linkedExitId = String(fdData.linkedExitId || '').trim();
      if (linkedExitId) {
        await syncLinkedExitRentalTerms(db, franchiseId, linkedExitId, gsUrl, languageCode);
      }
    }
    const token = await ensureStorageDownloadToken(file);
    const signedUrl = buildFirebaseStorageDownloadUrl(bucket.name, objectPath, token);
    const expires = Date.now() + 60 * 60 * 1000;
    return {
      signedUrl,
      expiresAt: expires,
      storagePath: objectPath,
      languageCode,
    };
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[getKioskRentalTermsSignedUrl] download URL failed', e?.message || e);
    throw new HttpsError('internal', 'Could not produce signed URL');
  }
}

/**
 * Saves kiosk-signed rental terms PDF to Storage and records the URL on
 * the frontDeskCustomers document. Callable by the unauthenticated kiosk page.
 *
 * SECURITY: when a kiosk upload secret is configured we require the
 * `kioskUploadToken` issued by `submitFrontDeskIntake` (bound to
 * franchiseId + customerDocId, 1h TTL). This prevents arbitrary callers
 * from binding a PDF to an unrelated intake row.
 */
async function runSaveKioskRentalTerms(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`krt:${ip}`, 20, 3600_000);

  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  if (!isTurkeyFranchiseId(franchiseId)) {
    throw new HttpsError(
      'failed-precondition',
      'General Rental Terms signing is only available for Turkey franchises.'
    );
  }
  const customerDocId = String(request.data?.customerDocId || '').trim();
  const pdfBase64 = String(request.data?.pdfBase64 || '').trim();
  const languageCode = request.data?.languageCode;
  const uploadToken = String(request.data?.kioskUploadToken || '').trim();

  if (getKioskUploadSecret()) {
    const v = verifyKioskUploadToken(uploadToken, franchiseId, customerDocId);
    if (!v.ok) {
      throw new HttpsError(
        'permission-denied',
        `Invalid or expired kiosk upload token (${v.reason})`
      );
    }
  } else {
    console.warn(
      '[saveKioskRentalTerms] KIOSK_UPLOAD_SECRET not configured; token check skipped. ' +
        'Run `firebase functions:secrets:set KIOSK_UPLOAD_SECRET` to enforce.'
    );
  }

  const { pdfUrl, duplicate } = await persistKioskRentalTermsPdf(
    franchiseId,
    customerDocId,
    pdfBase64,
    languageCode
  );
  return { success: true, pdfUrl, duplicate: !!duplicate };
}

const frontDeskIntakeOpts = {
  cors: true,
  invoker: 'public',
  memory: '1GiB',
  timeoutSeconds: 120,
};
exports.submitFrontDeskIntake = onCall(frontDeskIntakeOpts, runSubmitFrontDeskIntake);
/** Legacy name used by some hosting builds — same implementation. */
exports.frontDeskIntake = onCall(frontDeskIntakeOpts, runSubmitFrontDeskIntake);
exports.getFrontDeskLegalDocs = onCall(frontDeskIntakeOpts, runGetFrontDeskLegalDocs);
exports.uploadFrontDeskKioskDocument = onCall(frontDeskIntakeOpts, runUploadFrontDeskKioskDocument);
exports.lookupCustomerContactRemember = onCall(frontDeskIntakeOpts, runLookupCustomerContactRemember);
exports.saveKioskRentalTerms = onCall(frontDeskIntakeOpts, runSaveKioskRentalTerms);
// Authenticated only — no `invoker: 'public'`.
exports.getKioskRentalTermsSignedUrl = onCall({ cors: true }, runGetKioskRentalTermsSignedUrl);

/** Staff: rebuild kiosk GRT PDF with server typography (Noto Sans). Overwrites broken client PDFs. */
async function runStaffRebuildKioskGrtPdf(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const customerDocId = String(request.data?.customerDocId || '').trim();
  if (!UUID_RE.test(customerDocId)) {
    throw new HttpsError('invalid-argument', 'Invalid customerDocId');
  }

  const db = admin.firestore();
  const userSnap = await db.collection('users').doc(request.auth.uid).get();
  if (!userSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const profile = userSnap.data() || {};
  const role = String(profile.role || '').toLowerCase().trim().replace(/[\s_-]+/g, '');
  const isPlatformAdmin =
    role === 'globaladmin' || (role === 'superadmin' && profile.isGlobalAdmin === true);
  if (!isPlatformAdmin && profile.isActive === false) {
    throw new HttpsError('permission-denied', 'Account inactive');
  }
  const fidUpper = String(franchiseId || '').trim().toUpperCase();
  if (!isPlatformAdmin) {
    const rs = profile.roleScope;
    let allowed = false;
    if (rs && typeof rs === 'object' && !Array.isArray(rs)) {
      const level = String(rs.level || '').toLowerCase().trim();
      if (level === 'global') allowed = true;
      const ids = Array.isArray(rs.franchiseIds)
        ? rs.franchiseIds.map((x) => String(x || '').trim().toUpperCase()).filter(Boolean)
        : [];
      if ((level === 'franchise' || level === 'country') && ids.includes(fidUpper)) allowed = true;
      if (level === 'country' && ids.length === 0) allowed = true;
    }
    if (!allowed && String(profile.franchiseId || '').trim().toUpperCase() === fidUpper) {
      allowed = true;
    }
    if (!allowed) {
      throw new HttpsError('permission-denied', 'No access to this franchise');
    }
  }

  const docRef = db
    .collection('franchises')
    .doc(franchiseId)
    .collection('frontDeskCustomers')
    .doc(customerDocId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Front desk record not found');
  }
  const row = docSnap.data() || {};
  const lang = String(row.kioskRentalTermsLanguage || 'tr').trim().toLowerCase() === 'en' ? 'en' : 'tr';
  const pdfBuffer = await buildKioskRentalTermsPdfForIntake(db, franchiseId, {
    signatures: [],
    languageCode: lang,
    firstName: row.firstName || '',
    lastName: row.familyName || row.lastName || '',
    email: row.email || '',
    callOk: row.callOk !== false,
    emailOk: row.emailOk !== false,
    smsOk: row.smsOk !== false,
  });
  const { pdfUrl } = await persistKioskRentalTermsPdf(
    franchiseId,
    customerDocId,
    pdfBuffer.toString('base64'),
    lang,
    { allowOverwrite: true }
  );
  const linkedExitId = String(row.linkedExitId || '').trim();
  if (linkedExitId) {
    await syncLinkedExitRentalTerms(db, franchiseId, linkedExitId, pdfUrl, lang);
  }
  return { success: true, pdfUrl };
}

exports.staffRebuildKioskGrtPdf = onCall({ cors: true }, runStaffRebuildKioskGrtPdf);

/**
 * Swiss (CH*) kiosk intakes: delete PII from frontDeskCustomers after 7 days.
 * Clears linkedFrontDeskCustomerId on expected-return rows and removes Storage uploads
 * under franchises/{fid}/frontDeskCustomers/{id}/ so exits/returns are not left with broken file paths.
 */
exports.purgeSwissFrontDeskCustomerIntakes = onSchedule(
  {
    schedule: 'every day 03:15',
    timeZone: 'Europe/Zurich',
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  async () => {
    const db = admin.firestore();
    const now = Date.now();
    const ts = admin.firestore.Timestamp.fromMillis(now);
    let deleted = 0;
    let legacyCandidates = 0;

    const q1 = await db
      .collectionGroup('frontDeskCustomers')
      .where('retentionExpiresAt', '<=', ts)
      .limit(40)
      .get();

    for (const doc of q1.docs) {
      try {
        await purgeOneFrontDeskCustomerDoc(db, doc);
        deleted += 1;
      } catch (e) {
        console.error('[purgeSwissFrontDesk] primary', doc.ref.path, e?.message || e);
      }
    }

    const cutoff = admin.firestore.Timestamp.fromMillis(now - SWISS_FD_RETENTION_MS);
    const frSnap = await db.collection('franchises').get();
    for (const fdoc of frSnap.docs) {
      const fid = String(fdoc.id || '');
      if (!isSwissFrontDeskFranchise(fid)) continue;
      const col = db.collection('franchises').doc(fid).collection('frontDeskCustomers');
      const leg = await col.where('submittedAt', '<=', cutoff).limit(20).get();
      for (const doc of leg.docs) {
        const d = doc.data() || {};
        if (d.retentionExpiresAt) continue;
        const exp = retentionExpiryMillisForFrontDeskDoc(fid, d);
        if (exp == null || exp > now) continue;
        legacyCandidates += 1;
        try {
          await purgeOneFrontDeskCustomerDoc(db, doc);
          deleted += 1;
        } catch (e) {
          console.error('[purgeSwissFrontDesk] legacy', doc.ref.path, e?.message || e);
        }
      }
    }

    console.log('[purgeSwissFrontDesk] finished', { deleted, legacyCandidates, retentionQueryHits: q1.size });
  }
);

/**
 * Admin-only hard shutdown for protocol reminders:
 * - Forces smtpConfigurations/{franchiseId}.reminderEnabled=false
 * - Converts protocols reminderStatus planned/due states to disabled_no_email
 * - Clears reminderNextPlannedAt to prevent any future reminder pipeline
 *
 * SECURITY: `invoker:public` is kept for legacy admin tooling endpoints that
 * still hit the unauthenticated callable URL, but the handler immediately
 * asserts globaladmin via Firestore (assertGlobalAdminCallable below).
 */
exports.disableAllProtocolReminders = onCall(
  { cors: true, invoker: 'public' },
  async (request) => {
    await assertGlobalAdminCallable(request);
    const db = admin.firestore();
    const updatedBy = 'system:disableAllProtocolReminders';
    const result = {
      franchisesUpdated: 0,
      smtpConfigsUpdated: 0,
      protocolsUpdated: 0,
    };

    const franchisesSnap = await db.collection('franchises').get();
    for (const franchiseDoc of franchisesSnap.docs) {
      const franchiseId = String(franchiseDoc.id || '').toUpperCase();
      if (!franchiseId) continue;
      result.franchisesUpdated += 1;

      const smtpRef = db.collection('smtpConfigurations').doc(franchiseId);
      await smtpRef.set(
        {
          reminderEnabled: false,
          protocolReminderHardDisabled: true,
          updatedAt: new Date().toISOString(),
          updatedBy,
        },
        { merge: true }
      );
      result.smtpConfigsUpdated += 1;

      const protocolsRef = db.collection('franchises').doc(franchiseId).collection('protocols');
      const protocolsSnap = await protocolsRef.get();
      let batch = db.batch();
      let ops = 0;
      for (const protocolDoc of protocolsSnap.docs) {
        const p = protocolDoc.data() || {};
        const financialOutstanding = Math.max(
          Number(p.requiredAmount || 0) - Number(p.paidAmount || 0),
          0
        );
        const isPaid = financialOutstanding <= 0.000001;
        const currentStatus = String(p.reminderStatus || '');
        const shouldDisable =
          !isPaid &&
          (currentStatus === '' ||
            currentStatus === 'planned' ||
            currentStatus === 'due_now' ||
            currentStatus === 'overdue' ||
            currentStatus === 'scheduled' ||
            currentStatus === 'pending');
        const shouldClearDate = p.reminderNextPlannedAt != null;

        if (!shouldDisable && !shouldClearDate) continue;

        const updatePayload = {
          reminderNextPlannedAt: null,
          updatedAt: new Date().toISOString(),
          updatedBy,
        };
        if (shouldDisable) {
          updatePayload.reminderStatus = 'disabled_no_email';
        }

        batch.update(protocolDoc.ref, updatePayload);
        ops += 1;
        result.protocolsUpdated += 1;

        if (ops >= 400) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) {
        await batch.commit();
      }
    }

    return {
      ok: true,
      ...result,
    };
  }
);

/**
 * Find an active planned return for a completed checkout (canonical doc id = exit id).
 */
async function findActiveReturnForCheckout(db, franchiseId, exitId) {
    const coll = db.collection('franchises').doc(franchiseId).collection('iadeIslemleri');
    const canonicalRef = coll.doc(String(exitId));
    const canonical = await canonicalRef.get();
    if (canonical.exists && canonical.data()?.isDeleted !== true) {
        console.info(`[findActiveReturn] found canonical docId=${exitId} status=${canonical.data()?.status}`);
        return { ref: canonicalRef, id: String(exitId) };
    }
    if (canonical.exists) {
        console.info(`[findActiveReturn] canonical docId=${exitId} is soft-deleted, searching by linkedExitId`);
    }
    const q = await coll.where('linkedExitId', '==', String(exitId)).limit(20).get();
    console.info(`[findActiveReturn] linkedExitId query for ${exitId}: ${q.docs.length} docs`);
    let best = null;
    let bestMs = -1;
    for (const d of q.docs) {
        const data = d.data() || {};
        if (data.isDeleted === true) {
            console.info(`[findActiveReturn]   skip docId=${d.id} isDeleted=true`);
            continue;
        }
        console.info(`[findActiveReturn]   candidate docId=${d.id} status=${data.status}`);
        const created = data.createdAt;
        const ms =
            created && typeof created.toMillis === 'function'
                ? created.toMillis()
                : created?.seconds != null
                  ? created.seconds * 1000
                  : 0;
        if (ms >= bestMs) {
            bestMs = ms;
            best = { ref: d.ref, id: d.id };
        }
    }
    return best;
}

/**
 * Soft-delete ALL active (non-deleted) planned return rows for a checkout that was dismissed.
 * Called when `expectedReturnDismissedAt` is set on an exit.
 */
async function softDeleteAllPlannedReturnsForCheckout(db, franchiseId, exitId) {
    const coll = db.collection('franchises').doc(franchiseId).collection('iadeIslemleri');
    // Canonical doc (same ID as exit)
    const canonicalRef = coll.doc(String(exitId));
    const canonical = await canonicalRef.get();
    const batch = db.batch();
    let count = 0;
    if (canonical.exists && canonical.data()?.isDeleted !== true) {
        batch.update(canonicalRef, {
            isDeleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedBy: 'system:dismiss-expected-return',
        });
        count++;
    }
    const q = await coll.where('linkedExitId', '==', String(exitId)).limit(30).get();
    for (const d of q.docs) {
        if (d.id === String(exitId)) continue; // Already handled above
        const data = d.data() || {};
        if (data.isDeleted === true) continue;
        batch.update(d.ref, {
            isDeleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedBy: 'system:dismiss-expected-return',
        });
        count++;
    }
    if (count > 0) {
        await batch.commit();
        console.info(`[dismissReturns] soft-deleted ${count} return(s) for exit ${exitId}`);
    }
    return count;
}

/**
 * Soft-delete duplicate return rows for the same checkout (keep `keepDocId`).
 */
async function softDeleteDuplicateReturnsForCheckout(db, franchiseId, exitId, keepDocId) {
    const coll = db.collection('franchises').doc(franchiseId).collection('iadeIslemleri');
    const keep = String(keepDocId || '').trim();
    const exitKey = String(exitId || '').trim();
    if (!keep || !exitKey) return;
    const snap = await coll.where('linkedExitId', '==', exitKey).limit(30).get();
    const batch = db.batch();
    let ops = 0;
    for (const d of snap.docs) {
        if (d.id === keep) continue;
        const data = d.data() || {};
        if (data.isDeleted === true) continue;
        batch.update(d.ref, {
            isDeleted: true,
            deletedAt: admin.firestore.FieldValue.serverTimestamp(),
            deletedBy: 'system:dedupe-planned-return',
        });
        ops += 1;
        if (ops >= 400) break;
    }
    if (ops > 0) await batch.commit();
}

/**
 * When a checkout is completed, ensure a pending return row exists on the planned check-in date
 * (front desk handover) so Operations / web calendar show the expected return.
 */
exports.onExitCompletedEnsureExpectedReturn = onDocumentWritten(
    {
        document: 'franchises/{franchiseId}/exitIslemleri/{exitId}',
        region: 'us-central1',
    },
    async (event) => {
        const exitId = event.params.exitId;
        const franchiseId = event.params.franchiseId;
        const before = event.data.before.exists ? event.data.before.data() : null;
        const after = event.data.after.exists ? event.data.after.data() : null;

        console.info(`[onExitCompleted] fired exitId=${exitId} fid=${franchiseId} beforeStatus=${before?.status} afterStatus=${after?.status} afterDeleted=${after?.isDeleted} afterDismissed=${!!after?.expectedReturnDismissedAt}`);

        // Only act on the transition to Completed (not subsequent edits).
        if (!after || String(after.status || '') !== 'Completed') {
            console.info(`[onExitCompleted] skip – status not Completed`);
            return;
        }
        if (before && String(before.status || '') === 'Completed') {
            console.info(`[onExitCompleted] skip – already Completed before`);
            return;
        }
        // If the exit was explicitly dismissed (user deleted the planned return), don't re-create.
        if (after.expectedReturnDismissedAt) {
            console.info(`[onExitCompleted] skip – expectedReturnDismissedAt already set`);
            return;
        }
        // If the exit itself was soft-deleted, don't create returns.
        if (after.isDeleted === true) {
            console.info(`[onExitCompleted] skip – exit is deleted`);
            return;
        }

        const db = admin.firestore();
        const fdSnap = await db
            .collection('franchises')
            .doc(franchiseId)
            .collection('frontDeskCustomers')
            .where('linkedExitId', '==', exitId)
            .limit(10)
            .get();

        let plannedCheckinAt = null;
        let fdDocId = null;
        let handoverDropoffBranch = null;
        let latestMs = -1;
        for (const doc of fdSnap.docs) {
            const d = doc.data() || {};
            const submittedAt = d.submittedAt;
            const ms = submittedAt && typeof submittedAt.toMillis === 'function'
                ? submittedAt.toMillis()
                : submittedAt?.seconds != null
                    ? submittedAt.seconds * 1000
                    : 0;
            if (d.plannedCheckinAt && ms >= latestMs) {
                latestMs = ms;
                plannedCheckinAt = d.plannedCheckinAt;
                fdDocId = doc.id;
                handoverDropoffBranch = d.handoverDropoffBranch || null;
            }
        }

        if (!plannedCheckinAt && after.plannedCheckinAt) {
            plannedCheckinAt = after.plannedCheckinAt;
        }

        const existingReturn = await findActiveReturnForCheckout(db, franchiseId, exitId);
        console.info(`[onExitCompleted] existingReturn=${existingReturn ? existingReturn.id : 'none'} plannedCheckinAt=${plannedCheckinAt ? 'set' : 'missing'}`);
        const iadeId = existingReturn?.id || String(exitId);
        const iadeRef = existingReturn?.ref
            || db.collection('franchises').doc(franchiseId).collection('iadeIslemleri').doc(iadeId);

        const fid = String(franchiseId || 'CH').toUpperCase();
        const trRentalTermsSignatureURL =
            (after && typeof after.trRentalTermsSignatureURL === 'string'
                ? after.trRentalTermsSignatureURL.trim()
                : '') || null;
        const trRentalTermsLanguage =
            (after && typeof after.trRentalTermsLanguage === 'string'
                ? after.trRentalTermsLanguage.trim()
                : '') || null;
        let createdIadeId = null;

        if (plannedCheckinAt) {
        await iadeRef.set(
            {
                id: iadeId,
                documentId: iadeId,
                aracId: after.aracId != null ? String(after.aracId) : null,
                aracPlaka: after.aracPlaka || null,
                iadeTarihi: plannedCheckinAt,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'In Progress',
                fotograflar: [],
                notlar: 'Expected return (planned)',
                franchiseId: fid,
                linkedExitId: exitId,
                linkedFrontDeskCustomerId: fdDocId,
                expectedReturnPlanned: true,
                customerFirstName: after.customerFirstName || null,
                customerLastName: after.customerLastName || null,
                customerEmail: after.customerEmail || null,
                    customerNationalId: after.customerNationalId || null,
                    pickUpBranch: after.pickUpBranch || null,
                    dropOffBranch: after.dropOffBranch || handoverDropoffBranch,
                    navKodu: after.navKodu || null,
                bayiAdi: handoverDropoffBranch,
                hasarSayisi: 0,
                fotografSayisi: 0,
                    ...(trRentalTermsSignatureURL
                        ? {
                            trRentalTermsSignatureURL,
                            ...(trRentalTermsLanguage
                                ? { trRentalTermsLanguage }
                                : {}),
                        }
                        : {}),
            },
            { merge: true }
        );
            createdIadeId = iadeId;
            await softDeleteDuplicateReturnsForCheckout(db, franchiseId, exitId, iadeId);
        } else if (existingReturn) {
            createdIadeId = iadeId;
            await softDeleteDuplicateReturnsForCheckout(db, franchiseId, exitId, iadeId);
        }

        // Even when no planned check-in date exists, push the FD doc into return_ready so
        // iOS Operations / Front Desk see the completed handover state. This lifecycle write
        // is also done iOS-side, but we keep it CF-side so web checkouts behave consistently.
        if (fdDocId) {
            try {
                await db
                    .collection('franchises')
                    .doc(franchiseId)
                    .collection('frontDeskCustomers')
                    .doc(fdDocId)
                    .update({
                        iosPrefillStatus: 'return_ready',
                        linkedExitId: exitId,
                        ...(createdIadeId ? { linkedIadeId: createdIadeId } : {}),
                        lastHandoverUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
            } catch (e) {
                console.warn(
                    '[onExitCompletedEnsureExpectedReturn] frontDeskCustomers lifecycle update failed:',
                    e?.message || e
                );
            }
        }
    }
);

/**
 * When an exit has `expectedReturnDismissedAt` newly set, soft-delete all linked
 * pending (In Progress) returns so they don't re-appear on iOS / web Operations.
 */
exports.onExitDismissedCleanupReturns = onDocumentWritten(
    {
        document: 'franchises/{franchiseId}/exitIslemleri/{exitId}',
        region: 'us-central1',
    },
    async (event) => {
        const exitId = event.params.exitId;
        const franchiseId = event.params.franchiseId;
        const before = event.data.before.exists ? event.data.before.data() : null;
        const after = event.data.after.exists ? event.data.after.data() : null;

        // Only act when expectedReturnDismissedAt is newly set (was absent, now present).
        const hadDismissed = !!before?.expectedReturnDismissedAt;
        const hasDismissed = !!after?.expectedReturnDismissedAt;
        if (!hasDismissed || hadDismissed) return;

        console.info(`[onExitDismissed] expectedReturnDismissedAt newly set for exit ${exitId} fid=${franchiseId}`);

        const db = admin.firestore();
        try {
            await softDeleteAllPlannedReturnsForCheckout(db, franchiseId, exitId);
        } catch (err) {
            console.warn(`[onExitDismissed] error cleaning returns: ${err?.message || err}`);
        }
    }
);

// --- Login + account recovery (public callables; rate-limited) ---

function normalizeCountryCode(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (s === 'GB') s = 'UK';
  if (s.length < 2 || s.length > 8) {
    throw new HttpsError('invalid-argument', 'Invalid countryCode');
  }
  return s;
}

const FRANCHISE_ID_RE = /^[A-Z0-9][A-Z0-9_-]{0,62}[A-Z0-9]$/;

function normalizeFranchiseIdForReadiness(raw) {
  return String(raw || '').trim().toUpperCase();
}

function isValidFranchiseIdFormat(franchiseId) {
  const id = normalizeFranchiseIdForReadiness(franchiseId);
  return id.length >= 2 && id.length <= 64 && FRANCHISE_ID_RE.test(id);
}

function customerSelfFillQrEnabledForFranchise(franchiseId) {
  return isValidFranchiseIdFormat(franchiseId);
}

function swissStyleReportPdfEnabledForFranchise(franchiseId) {
  const id = normalizeFranchiseIdForReadiness(franchiseId);
  return id.startsWith('CH') || id.startsWith('DE') || id.startsWith('UK') || id.startsWith('GB');
}

function normalizeCountryCodeSafe(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (s === 'GB') s = 'UK';
  return s;
}

function buildFranchiseReadinessChecks(franchiseId, data) {
  const fid = normalizeFranchiseIdForReadiness(franchiseId);
  const cc = normalizeCountryCodeSafe(data?.countryCode);
  const tr = cc === 'TR';
  return [
    { id: 'franchise_active', ok: data?.isActive !== false, label: 'Franchise is active' },
    { id: 'franchise_id', ok: isValidFranchiseIdFormat(fid), label: `Valid franchise ID (${fid || 'missing'})` },
    { id: 'country_code', ok: cc.length >= 2, label: `Country code set (${cc || 'missing'})` },
    {
      id: 'customer_qr_return',
      ok: customerSelfFillQrEnabledForFranchise(fid),
      label: 'Customer return QR (return.html)',
    },
    {
      id: 'customer_qr_checkout',
      ok: customerSelfFillQrEnabledForFranchise(fid),
      label: 'Customer checkout QR (checkout.html)',
    },
    {
      id: 'swiss_pdf',
      ok: tr || swissStyleReportPdfEnabledForFranchise(fid),
      label: tr ? 'Turkey dual-language PDF' : 'Swiss-style PDF reports',
    },
  ];
}

function profileAllowsFranchiseHint(profile, franchiseHint) {
  const hint = String(franchiseHint || '').trim().toUpperCase();
  if (!hint) return true;
  const scope = String(profile.scopeLevel || 'single').toLowerCase().trim();
  if (scope === 'country_all') return true;
  const mem = profile.franchiseMemberships;
  if (mem && typeof mem === 'object') {
    for (const [k, v] of Object.entries(mem)) {
      if (v === true && String(k).trim().toUpperCase() === hint) return true;
    }
  }
  const primary = String(profile.franchiseId || '').trim().toUpperCase();
  return primary === hint;
}

async function auditSecurityEvent(db, type, payload) {
  try {
    await db.collection('securityAuditLogs').add({
      type,
      ...payload,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[auditSecurityEvent]', e?.message || e);
  }
}

function smtpHostConfigured() {
  return Boolean(
    process.env.RECOVERY_SMTP_HOST || process.env.SMTP_HOST || process.env.MAIL_HOST || ''
  );
}

function createSmtpTransporter() {
  const host =
    process.env.RECOVERY_SMTP_HOST || process.env.SMTP_HOST || process.env.MAIL_HOST || '';
  if (!host) return null;
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    return null;
  }
  const port = Number(process.env.RECOVERY_SMTP_PORT || process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.RECOVERY_SMTP_SECURE || process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const user = process.env.RECOVERY_SMTP_USER || process.env.SMTP_USER || '';
  const pass = process.env.RECOVERY_SMTP_PASS || process.env.SMTP_PASS || '';
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass } : undefined,
  });
}

function smtpFromAddress() {
  return (
    process.env.RECOVERY_SMTP_FROM ||
    process.env.SMTP_FROM ||
    process.env.RECOVERY_SMTP_USER ||
    process.env.SMTP_USER ||
    'no-reply@greenmotion.local'
  );
}

function buildUsernameReminderHtml(bodyLines) {
  const bodyHtml = bodyLines
    .map((line) =>
      line.trim() === ''
        ? '<br/>'
        : `<p style="margin:0 0 8px 0;font-size:15px;color:#334155;line-height:1.6;">${String(line)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')}</p>`
    )
    .join('');
  const spamTip =
    'If this message is in Spam or Junk, move it to your inbox and mark it as “Not junk” so future ERPX mail is delivered reliably.';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;"><tr><td align="center">
    <table role="presentation" style="max-width:560px;width:100%;background:#fff;border-radius:16px;box-shadow:0 8px 32px rgba(15,23,42,0.08);">
      <tr><td style="padding:28px 32px 8px 32px;">
        <p style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">ERPX</p>
        <p style="margin:8px 0 0 0;font-size:14px;color:#64748b;">Account reminder</p>
      </td></tr>
      <tr><td style="padding:8px 32px 24px 32px;">${bodyHtml}</td></tr>
      <tr><td style="padding:16px 32px 28px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#64748b;line-height:1.55;">${spamTip}</p>
        <p style="margin:12px 0 0 0;font-size:12px;color:#94a3b8;">— The <strong style="color:#0f172a;">ERPX</strong> team</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

async function sendUsernameRecoveryMail(toEmail, lines) {
  const transporter = createSmtpTransporter();
  if (!transporter) {
    console.warn('[sendUsernameRecoveryMail] No SMTP host; set RECOVERY_SMTP_HOST (or SMTP_HOST)');
    return false;
  }
  const text = lines.join('\n');
  const html = buildUsernameReminderHtml(lines);
  await transporter.sendMail({
    from: smtpFromAddress(),
    to: toEmail,
    subject: 'ERPX — Account reminder',
    text,
    html,
  });
  return true;
}

/** After reset, user lands on app (optional). */
function passwordResetContinueUrl() {
  const u = String(process.env.PASSWORD_RESET_CONTINUE_URL || '').trim();
  if (u) return u.replace(/\/+$/, '');
  return 'https://vehiclesentinel.com';
}

function passwordResetContinueUrlCandidates() {
  const fromEnv = [
    process.env.PASSWORD_RESET_CONTINUE_URL,
    process.env.APP_LOGIN_URL,
  ]
    .map((u) => String(u || '').trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const defaults = [
    'https://vehiclesentinel.com',
    'https://www.vehiclesentinel.com',
    'https://greenmotionapp-33413.web.app',
    'https://greenmotionapp-33413.firebaseapp.com',
  ];
  return [...new Set([...fromEnv, ...defaults])];
}

function isRetriablePasswordLinkError(err) {
  const code = String(err?.code || err?.errorInfo?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'auth/invalid-continue-uri' ||
    code === 'auth/unauthorized-continue-uri' ||
    msg.includes('continue') ||
    msg.includes('domain') ||
    msg.includes('authorized')
  );
}

async function generateChangePasswordLink(email) {
  const normalized = String(email).trim().toLowerCase();
  let lastError = null;

  for (const continueUrl of passwordResetContinueUrlCandidates()) {
    try {
      return await admin.auth().generatePasswordResetLink(normalized, {
        url: continueUrl,
        handleCodeInApp: false,
      });
    } catch (e) {
      lastError = e;
      console.warn(
        '[generateChangePasswordLink]',
        continueUrl,
        e?.code || e?.errorInfo?.code || '',
        e?.message || e,
      );
      if (!isRetriablePasswordLinkError(e)) {
        throw e;
      }
    }
  }

  try {
    // Firebase-hosted reset page — no custom continue URL required.
    return await admin.auth().generatePasswordResetLink(normalized);
  } catch (e) {
    console.error('[generateChangePasswordLink] fallback', e?.message || e);
    throw lastError || e;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildPasswordResetEmailHtml(resetLink, recipientEmail) {
  const safeEmail = escapeHtml(recipientEmail);
  const safeLinkAttr = escapeHtmlAttr(resetLink);
  const safeLinkText = escapeHtml(resetLink);
  const preheader =
    'Use the secure link below to set a new ERPX password. If you did not request this, ignore this email.';
  const spamTip =
    'If you do not see further emails from us, please check your Spam or Junk folder and mark the message as “Not junk” so future ERPX mail arrives in your inbox.';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef1f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:16px;box-shadow:0 8px 32px rgba(15,23,42,0.08);overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 8px 32px;text-align:left;">
              <p style="margin:0;font-size:22px;font-weight:700;letter-spacing:-0.02em;color:#0f172a;">ERPX</p>
              <p style="margin:8px 0 0 0;font-size:15px;color:#64748b;line-height:1.5;">Franchise management platform</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px 32px;">
              <p style="margin:0 0 16px 0;font-size:16px;color:#0f172a;line-height:1.55;">Hello,</p>
              <p style="margin:0 0 20px 0;font-size:15px;color:#334155;line-height:1.6;">We received a request to reset the password for <strong style="color:#0f172a;">${safeEmail}</strong> on <strong style="color:#0f172a;">ERPX</strong>.</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="border-radius:12px;background:#2563eb;">
                    <a href="${safeLinkAttr}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">Reset your password</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px 0;font-size:13px;color:#64748b;line-height:1.55;">This link expires for security reasons. If the button does not work, copy and paste this URL into your browser:</p>
              <p style="margin:0 0 24px 0;font-size:12px;word-break:break-all;color:#2563eb;line-height:1.5;">${safeLinkText}</p>
              <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.55;">If you did not request a password reset, you can safely ignore this message. Your password will stay the same.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 28px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 10px 0;font-size:12px;color:#64748b;line-height:1.55;">${spamTip}</p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">— The <strong style="color:#0f172a;">ERPX</strong> team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPasswordResetEmailText(resetLink, recipientEmail) {
  return [
    'ERPX — Password reset',
    '',
    `We received a request to reset the password for ${recipientEmail} on ERPX.`,
    '',
    'Open this link to choose a new password:',
    resetLink,
    '',
    'If you did not request this, ignore this email.',
    '',
    'If messages from us land in Spam or Junk, mark them as Not junk so future ERPX mail reaches your inbox.',
    '',
    '— The ERPX team',
  ].join('\n');
}

async function sendPasswordResetBrandedMail(toEmail, resetLink, franchiseHints) {
  const subject = 'ERPX — Reset your password';
  const text = buildPasswordResetEmailText(resetLink, toEmail);
  const html = buildPasswordResetEmailHtml(resetLink, toEmail);
  return sendErpSystemMail({
    toEmail,
    subject,
    text,
    html,
    franchiseHints,
  });
}

function appLoginUrl() {
  const u = String(
    process.env.APP_LOGIN_URL || process.env.PASSWORD_RESET_CONTINUE_URL || ''
  ).trim();
  if (u) return u.replace(/\/+$/, '');
  return 'https://vehiclesentinel.com';
}

function generateAutoTempPassword() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16) + '!Aa1';
}

const WELCOME_EMAIL_TESTFLIGHT_APP_URL =
  'https://apps.apple.com/ch/app/testflight/id899247664?l=en-GB';
const WELCOME_EMAIL_TESTFLIGHT_BETA_URL = 'https://testflight.apple.com/join/jf9Zp95N';

function welcomeEmailMicroLabel(text) {
  return `<p style="margin:0 0 6px 0;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;line-height:1.4;">${text}</p>`;
}

function welcomeEmailPrimaryButton(href, label) {
  const safeHref = escapeHtmlAttr(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 8px 0;">
    <tr>
      <td style="border-radius:8px;background:#1e293b;">
        <a href="${safeHref}" style="display:inline-block;padding:11px 18px;font-size:13px;font-weight:600;letter-spacing:0.01em;color:#ffffff;text-decoration:none;border-radius:8px;">${safeLabel}</a>
      </td>
    </tr>
  </table>`;
}

function welcomeEmailSecondaryButton(href, label) {
  const safeHref = escapeHtmlAttr(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 8px 0;">
    <tr>
      <td style="border-radius:8px;border:1px solid #cbd5e1;background:#ffffff;">
        <a href="${safeHref}" style="display:inline-block;padding:10px 17px;font-size:13px;font-weight:600;letter-spacing:0.01em;color:#0f172a;text-decoration:none;border-radius:8px;">${safeLabel}</a>
      </td>
    </tr>
  </table>`;
}

function buildWelcomeCredentialsEmailHtml({
  displayName,
  email,
  temporaryPassword,
  loginUrl,
  changePasswordUrl,
}) {
  const greeting = displayName
    ? `Hello ${escapeHtml(displayName)},`
    : 'Hello,';
  const safeEmail = escapeHtml(email);
  const safePassword = escapeHtml(temporaryPassword);
  const safeLoginUrl = escapeHtmlAttr(loginUrl);
  const safeLoginText = escapeHtml(loginUrl);
  const safeChangeUrl = escapeHtmlAttr(changePasswordUrl || loginUrl);
  const safeTfAppUrl = escapeHtmlAttr(WELCOME_EMAIL_TESTFLIGHT_APP_URL);
  const safeTfBetaUrl = escapeHtmlAttr(WELCOME_EMAIL_TESTFLIGHT_BETA_URL);
  const preheader =
    'Your ERPX account is ready — web and iOS share one login. Install TestFlight, join the beta, and sign in.';
  const spamTip =
    'If you do not see further emails from us, check Spam or Junk and mark as “Not junk” so future ERPX mail reaches your inbox.';
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#e8ecf1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8ecf1;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:600px;background:#ffffff;border:1px solid #d8dee8;border-radius:4px;overflow:hidden;">
          <tr>
            <td style="padding:22px 28px 14px 28px;border-bottom:1px solid #e8ecf1;">
              <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">Green Motion · ERPX</p>
              <p style="margin:6px 0 0 0;font-size:20px;font-weight:700;letter-spacing:-0.03em;color:#0f172a;line-height:1.25;">Account provisioned</p>
              <p style="margin:6px 0 0 0;font-size:13px;color:#64748b;line-height:1.5;">Synchronized franchise ERP — web &amp; iOS</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 28px 8px 28px;">
              <p style="margin:0 0 14px 0;font-size:14px;color:#0f172a;line-height:1.55;">${greeting}</p>
              <p style="margin:0 0 18px 0;font-size:13px;color:#475569;line-height:1.65;">An administrator created your <strong style="color:#0f172a;font-weight:600;">ERPX</strong> account. Use the same email and password on the web portal and the iOS app — data, vehicles, and operations stay in sync across both.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px 0;border:1px solid #e2e8f0;border-radius:4px;background:#f8fafc;">
                <tr>
                  <td style="padding:14px 16px;border-bottom:1px solid #e8ecf1;">
                    ${welcomeEmailMicroLabel('Sign-in email')}
                    <p style="margin:0;font-size:14px;font-weight:600;color:#0f172a;line-height:1.4;">${safeEmail}</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 16px;">
                    ${welcomeEmailMicroLabel('Temporary password')}
                    <p style="margin:0;font-size:15px;font-weight:700;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:#0f172a;letter-spacing:0.06em;line-height:1.4;">${safePassword}</p>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px 0;border:1px solid #dbeafe;border-radius:4px;background:#f0f7ff;">
                <tr>
                  <td style="padding:14px 16px;">
                    ${welcomeEmailMicroLabel('Synchronized access')}
                    <p style="margin:0;font-size:12px;color:#334155;line-height:1.6;">One identity for ERPX web and mobile. Changes on either platform appear in the same franchise workspace — this is a live, synchronized ERP system, not separate logins.</p>
                  </td>
                </tr>
              </table>
              ${welcomeEmailMicroLabel('Web portal')}
              ${welcomeEmailPrimaryButton(loginUrl, 'Open ERPX web')}
              <p style="margin:0 0 16px 0;font-size:11px;color:#94a3b8;line-height:1.5;word-break:break-all;"><a href="${safeLoginUrl}" style="color:#64748b;text-decoration:none;">${safeLoginText}</a></p>
              ${welcomeEmailMicroLabel('Password')}
              ${welcomeEmailSecondaryButton(changePasswordUrl || loginUrl, 'Set your password')}
              <p style="margin:0 0 22px 0;font-size:11px;color:#94a3b8;line-height:1.55;">Secure one-time link — same flow as <em>Forgot password</em> on the login page.</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 12px 0;border:1px solid #e2e8f0;border-radius:4px;">
                <tr>
                  <td style="padding:14px 16px 10px 16px;border-bottom:1px solid #e8ecf1;">
                    ${welcomeEmailMicroLabel('iOS app · TestFlight beta')}
                    <p style="margin:0;font-size:12px;color:#475569;line-height:1.6;">Install TestFlight first, then open the beta invite. Your ERPX credentials work immediately in the app.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 16px 14px 16px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:2px;">
                          <p style="margin:0;font-size:11px;font-weight:700;color:#64748b;">01</p>
                        </td>
                        <td style="vertical-align:top;padding-bottom:12px;">
                          <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#0f172a;">Install TestFlight from the App Store</p>
                          ${welcomeEmailSecondaryButton(WELCOME_EMAIL_TESTFLIGHT_APP_URL, 'Get TestFlight')}
                        </td>
                      </tr>
                      <tr>
                        <td style="width:28px;vertical-align:top;padding-top:2px;">
                          <p style="margin:0;font-size:11px;font-weight:700;color:#64748b;">02</p>
                        </td>
                        <td style="vertical-align:top;">
                          <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#0f172a;">Accept the ERPX beta invite</p>
                          ${welcomeEmailPrimaryButton(WELCOME_EMAIL_TESTFLIGHT_BETA_URL, 'Join ERPX beta')}
                          <p style="margin:4px 0 0 0;font-size:10px;color:#94a3b8;line-height:1.5;">Opens in TestFlight after step 01 is complete.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:11px;color:#94a3b8;line-height:1.55;">Keep this message confidential. Do not forward your temporary password.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 22px 28px;background:#f8fafc;border-top:1px solid #e8ecf1;">
              <p style="margin:0 0 8px 0;font-size:11px;color:#64748b;line-height:1.55;">${spamTip}</p>
              <p style="margin:0;font-size:11px;color:#94a3b8;">— ERPX Operations</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildWelcomeCredentialsEmailText({
  displayName,
  email,
  temporaryPassword,
  loginUrl,
  changePasswordUrl,
}) {
  const greeting = displayName ? `Hello ${displayName},` : 'Hello,';
  return [
    'ERPX — Account provisioned',
    '',
    greeting,
    '',
    'An administrator created your ERPX account.',
    'Use the same email and password on the web portal and iOS app — synchronized franchise ERP.',
    '',
    'SIGN-IN EMAIL',
    email,
    '',
    'TEMPORARY PASSWORD',
    temporaryPassword,
    '',
    'WEB PORTAL',
    loginUrl,
    '',
    'SET YOUR PASSWORD (one-time secure link)',
    changePasswordUrl || loginUrl,
    '',
    'iOS — TESTFLIGHT BETA',
    'Step 1 — Install TestFlight:',
    WELCOME_EMAIL_TESTFLIGHT_APP_URL,
    'Step 2 — Join ERPX beta (after TestFlight is installed):',
    WELCOME_EMAIL_TESTFLIGHT_BETA_URL,
    '',
    'Your web and mobile sessions share one account and stay in sync.',
    '',
    'If messages from us land in Spam or Junk, mark them as Not junk.',
    '',
    '— ERPX Operations',
  ].join('\n');
}

async function sendWelcomeCredentialsMail({
  toEmail,
  displayName,
  temporaryPassword,
  franchiseHints,
  changePasswordUrl,
}) {
  const loginUrl = appLoginUrl();
  let resetUrl = changePasswordUrl;
  if (!resetUrl) {
    try {
      resetUrl = await generateChangePasswordLink(toEmail);
    } catch (e) {
      console.error('[sendWelcomeCredentialsMail] reset link', e?.message || e);
      resetUrl = loginUrl;
    }
  }
  const payload = {
    displayName: displayName || '',
    email: toEmail,
    temporaryPassword,
    loginUrl,
    changePasswordUrl: resetUrl,
  };
  return sendErpSystemMail({
    toEmail,
    subject: 'ERPX — Your account login details',
    text: buildWelcomeCredentialsEmailText(payload),
    html: buildWelcomeCredentialsEmailHtml(payload),
    franchiseHints,
  });
}

/** Welcome email is required — throws only if SMTP send fails (not on link fallback). */
async function sendMandatoryWelcomeCredentialsMail({
  toEmail,
  displayName,
  temporaryPassword,
  franchiseHints,
}) {
  let changePasswordUrl;
  try {
    changePasswordUrl = await generateChangePasswordLink(toEmail);
  } catch (e) {
    console.error('[sendMandatoryWelcomeCredentialsMail] reset link', e?.message || e);
    changePasswordUrl = appLoginUrl();
  }
  const sent = await sendWelcomeCredentialsMail({
    toEmail,
    displayName,
    temporaryPassword,
    franchiseHints,
    changePasswordUrl,
  });
  if (!sent) {
    throw new HttpsError('failed-precondition', 'welcome_email_failed');
  }
  return true;
}

async function runSendCustomPasswordResetEmail(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`pwd:ip:${ip}`, 10, 3600_000);
  const emailIn = String(request.data?.email || '').trim().toLowerCase();
  if (!validateEmail(emailIn)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  rateLimit(`pwd:em:${emailIn.slice(0, 64)}`, 5, 3600_000);

  if (!smtpHostConfigured()) {
    const hintProbe = smtpHintCandidatesFromValue('');
    let firestoreSmtpReady = false;
    for (const hint of hintProbe) {
      const smtp = await readFranchiseSmtpConfigDoc(hint);
      if (smtp && resolveFranchiseSmtpPassword(smtp, hint) && String(smtp.senderEmail || '').trim()) {
        firestoreSmtpReady = true;
        break;
      }
    }
    if (!firestoreSmtpReady) {
      throw new HttpsError('failed-precondition', 'smtp_not_configured');
    }
  }

  const db = admin.firestore();
  const generic = { ok: true, message: 'If this email is registered, a reset message was sent.' };

  let userRecord;
  try {
    userRecord = await admin.auth().getUserByEmail(emailIn);
  } catch {
    await auditSecurityEvent(db, 'password_reset_miss', {
      emailHash: crypto.createHash('sha256').update(emailIn).digest('hex').slice(0, 16),
    });
    return generic;
  }

  const snap = await db.collection('users').doc(userRecord.uid).get();
  const profile = snap.exists ? (snap.data() || {}) : {};
  if (snap.exists) {
    const active =
      profile.isActive !== false &&
      profile.isActive !== 0 &&
      String(profile.isActive).toLowerCase() !== 'false';
    if (!active) {
      await auditSecurityEvent(db, 'password_reset_inactive', { uid: userRecord.uid });
      return generic;
    }
  }

  let resetLink;
  try {
    resetLink = await generateChangePasswordLink(emailIn);
  } catch (e) {
    console.error('[sendCustomPasswordResetEmail] generatePasswordResetLink', e?.message || e);
    throw new HttpsError('internal', 'Could not create reset link.');
  }

  try {
    const franchiseHint = String(profile.franchiseId || profile.defaultFranchiseId || '').trim();
    const sent = await sendPasswordResetBrandedMail(
      emailIn,
      resetLink,
      smtpHintCandidatesFromValue(franchiseHint)
    );
    if (!sent) {
      throw new HttpsError('internal', 'Could not send email.');
    }
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    console.error('[sendCustomPasswordResetEmail] send mail', e?.message || e);
    throw new HttpsError('internal', 'Could not send email.');
  }

  await auditSecurityEvent(db, 'password_reset_sent', { uid: userRecord.uid, via: 'smtp' });
  return generic;
}

async function runListFranchisesForLogin(request) {
  const code = normalizeCountryCode(request.data?.countryCode);
  const db = admin.firestore();
  let docs = [];
  try {
    let snap = await db.collection('franchises').where('countryCode', '==', code).limit(200).get();
    if (snap.empty) {
      snap = await db.collection('franchises').where('countryCode', '==', code.toLowerCase()).limit(200).get();
    }
    docs = snap.docs;
  } catch (e) {
    console.warn('[listFranchisesForLogin] query', e?.message || e);
  }
  if (!docs.length) {
    const all = await db.collection('franchises').limit(400).get();
    docs = all.docs.filter((d) => {
      const x = d.data() || {};
      const cc = String(x.countryCode || '').toUpperCase();
      return cc === code;
    });
  }

  const franchises = [];
  for (const doc of docs) {
    const d = doc.data() || {};
    if (d.isActive === false) continue;
    const fid = String(d.franchiseId || doc.id || '').toUpperCase();
    if (!fid || fid.includes('/')) continue;
    franchises.push({
      id: doc.id,
      franchiseId: fid,
      name: d.name || d.country || fid,
      flag: d.flag || '',
      country: d.country || null,
      currency: d.currency || null,
    });
  }
  franchises.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { franchises };
}

async function runStartUsernameRecovery(request) {
  const ip = String(
    request.rawRequest?.headers?.['x-forwarded-for']?.split(',')[0] ||
      request.rawRequest?.socket?.remoteAddress ||
      'na'
  );
  rateLimit(`urec:ip:${ip}`, 15, 3600_000);
  const emailIn = String(request.data?.email || '').trim().toLowerCase();
  if (!validateEmail(emailIn)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  rateLimit(`urec:em:${emailIn.slice(0, 64)}`, 5, 3600_000);

  const countryCode = normalizeCountryCode(request.data?.countryCode);
  const franchiseHintRaw = request.data?.franchiseHint;
  const franchiseHint =
    franchiseHintRaw != null && String(franchiseHintRaw).trim() !== ''
      ? normalizeFranchiseId(franchiseHintRaw)
      : '';

  const db = admin.firestore();
  const generic = { ok: true, message: 'If an account matches, a message was sent.' };

  let authUser;
  try {
    authUser = await admin.auth().getUserByEmail(emailIn);
  } catch {
    await auditSecurityEvent(db, 'username_recovery_miss', { emailHash: crypto.createHash('sha256').update(emailIn).digest('hex').slice(0, 16), countryCode, franchiseHint });
    return generic;
  }

  const uid = authUser.uid;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) {
    await auditSecurityEvent(db, 'username_recovery_no_profile', { uid, countryCode });
    return generic;
  }

  const profile = snap.data() || {};
  const active =
    profile.isActive !== false &&
    profile.isActive !== 0 &&
    String(profile.isActive).toLowerCase() !== 'false';

  if (!active) {
    await auditSecurityEvent(db, 'username_recovery_inactive', { uid, countryCode });
    return generic;
  }

  const pCountry = String(profile.countryCode || '').toUpperCase();
  if (pCountry !== countryCode) {
    await auditSecurityEvent(db, 'username_recovery_country_mismatch', { uid, countryCode });
    return generic;
  }

  if (franchiseHint && !profileAllowsFranchiseHint(profile, franchiseHint)) {
    await auditSecurityEvent(db, 'username_recovery_franchise_mismatch', { uid, franchiseHint });
    return generic;
  }

  const displayUsername =
    (profile.username && String(profile.username).trim()) ||
    (profile.firstName && String(profile.firstName).trim()) ||
    (profile.nickname && String(profile.nickname).trim()) ||
    '';
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();
  const lines = [
    'You requested a reminder for your ERPX account.',
    '',
    `Sign-in email: ${emailIn}`,
    displayUsername ? `Username: ${displayUsername}` : name ? `Name on file: ${name}` : '',
    franchiseHint ? `Location context: ${franchiseHint}` : '',
    '',
    'If you did not request this, you can ignore this message.',
  ].filter((x) => x !== '');

  let sent = false;
  try {
    sent = await sendUsernameRecoveryMail(emailIn, lines);
  } catch (e) {
    console.error('[startUsernameRecovery] mail error', e?.message || e);
  }
  await auditSecurityEvent(db, 'username_recovery_sent', { uid, countryCode, franchiseHint, sent });
  return generic;
}

async function runResolveUserFranchiseAccess(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const db = admin.firestore();
  const snap = await db.collection('users').doc(request.auth.uid).get();
  if (!snap.exists) {
    return { allowed: false, reason: 'no_profile' };
  }
  const p = snap.data() || {};
  if (p.isActive === false) {
    return { allowed: false, reason: 'inactive' };
  }
  const role = String(p.role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');
  if (role === 'globaladmin') {
    return { allowed: true };
  }
  if (!profileAllowsFranchiseHint(p, franchiseId)) {
    return { allowed: false, reason: 'franchise_not_allowed' };
  }
  return { allowed: true };
}

const loginCallableOpts = { cors: true, invoker: 'public' };
exports.listFranchisesForLogin = onCall(loginCallableOpts, runListFranchisesForLogin);
exports.startUsernameRecovery = onCall(loginCallableOpts, runStartUsernameRecovery);
exports.sendCustomPasswordResetEmail = onCall(loginCallableOpts, runSendCustomPasswordResetEmail);
exports.resolveUserFranchiseAccess = onCall({ cors: true }, runResolveUserFranchiseAccess);

const WELCOME_MAIL_ROLES = ['admin', 'superadmin', 'manager', 'globaladmin'];

async function runSendUserWelcomeCredentialsEmail(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const email = String(request.data?.email || '').trim().toLowerCase();
  const temporaryPassword = String(
    request.data?.temporaryPassword || request.data?.password || ''
  ).trim();
  const displayName = String(request.data?.displayName || '').trim();
  const franchiseId = String(request.data?.franchiseId || '').trim().toUpperCase();
  if (!validateEmail(email) || temporaryPassword.length < 8) {
    throw new HttpsError('invalid-argument', 'Valid email and password (min 8 chars) required');
  }
  if (!franchiseId) {
    throw new HttpsError('invalid-argument', 'franchiseId is required');
  }

  const callerSnap = await admin.firestore().collection('users').doc(request.auth.uid).get();
  if (!callerSnap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const caller = callerSnap.data() || {};
  const callerRole = normalizeRoleKey(caller.role);
  const isPlatform =
    callerRole === 'globaladmin' || (callerRole === 'superadmin' && caller.isGlobalAdmin === true);
  if (!isPlatform) {
    if (!WELCOME_MAIL_ROLES.includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Insufficient role to send welcome email');
    }
    if (!profileAllowsFranchiseHint(caller, franchiseId)) {
      throw new HttpsError('permission-denied', 'Franchise not allowed for this admin');
    }
  }

  await sendMandatoryWelcomeCredentialsMail({
    toEmail: email,
    displayName,
    temporaryPassword,
    franchiseHints: smtpHintCandidatesFromValue(franchiseId),
  });
  return { ok: true, welcomeEmailSent: true };
}

exports.sendUserWelcomeCredentialsEmail = onCall({ cors: true }, runSendUserWelcomeCredentialsEmail);

// --- Garage portal: plain-text pickup emails (franchise SMTP doc, same family as iOS return queue) ---

function resolveFranchiseSmtpPassword(smtp, franchiseId) {
  const normalized = String(franchiseId || 'CH').toUpperCase();
  const envCandidates = [`SMTP_PASSWORD_${normalized}`];
  if (normalized.startsWith('CH_')) envCandidates.push('SMTP_PASSWORD_CH');
  if (normalized.startsWith('TR_')) envCandidates.push('SMTP_PASSWORD_TR');
  for (const name of envCandidates) {
    const scoped = process.env[name];
    if (scoped && String(scoped).trim()) return String(scoped).trim();
  }
  if (process.env.SMTP_PASSWORD && String(process.env.SMTP_PASSWORD).trim()) {
    return String(process.env.SMTP_PASSWORD).trim();
  }
  return String(smtp?.password || '');
}

function mergeFranchiseSmtpDoc(franchiseId, smtpFromDoc) {
  const fromDoc = smtpFromDoc && typeof smtpFromDoc === 'object' ? smtpFromDoc : {};
  if (!String(fromDoc.host || '').trim()) return null;
  if (!String(fromDoc.username || '').trim()) return null;
  return fromDoc;
}

async function readFranchiseSmtpConfigDoc(docId) {
  const db = admin.firestore();
  const id = String(docId || '').trim();
  if (!id) return null;
  const normalizedId = id.toUpperCase();
  const candidates = [normalizedId];
  if (normalizedId.startsWith('CH_')) candidates.push('CH');
  if (normalizedId.startsWith('TR_')) candidates.push('TR');
  for (const candidateId of candidates) {
    const snap = await db.collection('smtpConfigurations').doc(candidateId).get();
    if (snap.exists) {
      return mergeFranchiseSmtpDoc(candidateId, snap.data() || {});
    }
  }
  return null;
}

function garageNodemailerTransportOptions(smtp, smtpPassword) {
  const portRaw = Number(smtp.port || 587);
  const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 587;
  const implicitTls = port === 465 || port === 443;
  return {
    host: String(smtp.host || '').trim(),
    port,
    secure: implicitTls,
    requireTLS: smtp.useTLS === true && !implicitTls,
    auth: { user: smtp.username, pass: smtpPassword },
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
  };
}

function escapeHtmlGarage(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function garagePlainToHtml(text) {
  const lines = String(text || '').split('\n');
  return lines
    .map((line) =>
      line.trim() === ''
        ? '<br/>'
        : `<p style="margin:0 0 8px 0;font-size:14px;color:#111;line-height:1.55;">${escapeHtmlGarage(line)}</p>`
    )
    .join('');
}

function garagePurposeLabel(raw) {
  const key = String(raw || '').trim();
  if (!key) return '—';
  const map = {
    routineMaintenance: 'Routine maintenance',
    repair: 'Repair',
    tireService: 'Tire',
    bodywork: 'Bodywork',
    inspection: 'Inspection',
    glass: 'Glass',
    other: 'Other',
  };
  if (map[key]) return map[key];
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

function fmtIsoDate(s) {
  if (!s) return '—';
  const d = new Date(String(s));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function garageDetailsHtml(data) {
  const plate = String(data.vehiclePlate || '').trim() || '—';
  const purpose = garagePurposeLabel(data.purposeLabel || data.purpose || data.servicePurpose || data.serviceReason);
  const company = String(data.serviceCompanyLabel || '').trim() || '—';
  const sentDate = fmtIsoDate(data.sentDateISO);
  const completedDate = fmtIsoDate(data.completedDateISO);
  const completionNote = String(data.completionNotes || '').trim();
  const rows = [
    ['Plate', plate],
    ['Purpose', purpose],
    ['Service company', company],
    ['Sent date', sentDate],
    ['Completed date', completedDate],
  ];
  if (completionNote) rows.push(['Completion note', completionNote]);
  return rows
    .map(([k, v]) => `<p style="margin:0 0 8px 0;font-size:14px;color:#111;line-height:1.55;"><strong>${escapeHtmlGarage(k)}:</strong> ${escapeHtmlGarage(v)}</p>`)
    .join('');
}

function garageDetailsText(data) {
  const plate = String(data.vehiclePlate || '').trim() || '—';
  const purpose = garagePurposeLabel(data.purposeLabel || data.purpose || data.servicePurpose || data.serviceReason);
  const company = String(data.serviceCompanyLabel || '').trim() || '—';
  const sentDate = fmtIsoDate(data.sentDateISO);
  const completedDate = fmtIsoDate(data.completedDateISO);
  const completionNote = String(data.completionNotes || '').trim();
  const lines = [
    `Plate: ${plate}`,
    `Purpose: ${purpose}`,
    `Service company: ${company}`,
    `Sent date: ${sentDate}`,
    `Completed date: ${completedDate}`,
  ];
  if (completionNote) lines.push(`Completion note: ${completionNote}`);
  return lines.join('\n');
}

async function buildGaragePhotoPdfBuffer(title, urls) {
  let PDFDocument;
  try {
    // eslint-disable-next-line global-require
    PDFDocument = require('pdfkit');
  } catch {
    return null;
  }
  const doc = new PDFDocument({ autoFirstPage: true, margin: 40, size: 'A4' });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.fontSize(18).text(title, { underline: true });
  doc.moveDown();
  if (!Array.isArray(urls) || urls.length === 0) {
    doc.fontSize(12).text('No photos.');
    doc.end();
    return done;
  }
  for (let i = 0; i < urls.length; i += 1) {
    const url = String(urls[i] || '').trim();
    if (!url) continue;
    if (i > 0) doc.addPage();
    doc.fontSize(11).text(`Photo ${i + 1}`);
    doc.moveDown(0.5);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arr = await res.arrayBuffer();
      const img = Buffer.from(arr);
      doc.image(img, {
        fit: [510, 700],
        align: 'center',
        valign: 'center',
      });
    } catch {
      doc.fontSize(12).fillColor('#b91c1c').text('Photo could not be loaded for PDF.');
      doc.fillColor('#111').moveDown().fontSize(9).text(url);
    }
  }
  doc.end();
  return done;
}

async function sendGarageSmtpMail(smtp, smtpPassword, mailOptions) {
  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    throw new Error('nodemailer_unavailable');
  }
  const primary = garageNodemailerTransportOptions(smtp, smtpPassword);
  const candidates = [primary];
  const useTls = smtp.useTLS === true;
  const pushUnique = (p, sec) => {
    if (!candidates.some((x) => x.port === p && x.secure === sec)) {
      candidates.push({ ...primary, port: p, secure: sec, requireTLS: useTls && !sec });
    }
  };
  if (primary.port === 443) {
    pushUnique(465, true);
    pushUnique(587, false);
  } else if (primary.port === 465) {
    pushUnique(443, true);
    pushUnique(587, false);
  } else if (primary.port === 587) {
    pushUnique(465, true);
    pushUnique(443, true);
  }

  let lastErr = null;
  for (const opts of candidates) {
    const transporter = nodemailer.createTransport(opts);
    try {
      await transporter.sendMail(mailOptions);
      console.log(`[garageOutgoingEmail] sent via ${opts.host}:${opts.port}`);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('smtp_send_failed');
}

function smtpHintCandidatesFromScope(scope) {
  const hints = [];
  if (scope && typeof scope === 'object') {
    const ids = Array.isArray(scope.franchiseIds) ? scope.franchiseIds : [];
    for (const id of ids) {
      const v = String(id || '').trim().toUpperCase();
      if (v) hints.push(v);
    }
    const cc = String(scope.countryCode || '').trim().toUpperCase();
    if (cc && cc.length === 2) hints.push(cc);
  }
  if (!hints.includes('CH')) hints.push('CH');
  return [...new Set(hints)];
}

function smtpHintCandidatesFromValue(value) {
  const hints = [];
  const raw = String(value || '').trim().toUpperCase();
  if (raw) hints.push(raw);
  if (raw.startsWith('CH_')) hints.push('CH');
  if (raw.startsWith('TR_')) hints.push('TR');
  if (!hints.includes('CH')) hints.push('CH');
  return [...new Set(hints)];
}

/** ERP system mail: env SMTP first, then Firestore smtpConfigurations/{franchise}. */
async function sendErpSystemMail({ toEmail, subject, text, html, franchiseHints = [] }) {
  const hints = Array.isArray(franchiseHints) ? franchiseHints : [franchiseHints];
  const normalizedHints = [
    ...new Set(
      hints.map((h) => String(h || '').trim().toUpperCase()).filter(Boolean)
    ),
  ];
  if (!normalizedHints.includes('CH')) normalizedHints.push('CH');

  const envTransport = createSmtpTransporter();
  if (envTransport) {
    await envTransport.sendMail({
      from: smtpFromAddress(),
      to: toEmail,
      subject,
      text,
      html,
    });
    console.log('[sendErpSystemMail] sent via env SMTP');
    return true;
  }

  for (const hint of normalizedHints) {
    try {
      const smtp = await readFranchiseSmtpConfigDoc(hint);
      if (!smtp) continue;
      const smtpPassword = resolveFranchiseSmtpPassword(smtp, hint);
      if (!smtpPassword) {
        console.warn('[sendErpSystemMail] missing SMTP password for', hint);
        continue;
      }
      const fromAddr = String(smtp.senderEmail || '').trim();
      if (!fromAddr) continue;
      const senderDisplay = String(smtp.senderName || '').trim() || 'ERPX';
      await sendGarageSmtpMail(smtp, smtpPassword, {
        from: `"${senderDisplay.replace(/"/g, '')}" <${fromAddr}>`,
        to: toEmail,
        subject,
        text,
        html,
      });
      console.log('[sendErpSystemMail] sent via Firestore SMTP', hint);
      return true;
    } catch (e) {
      console.error('[sendErpSystemMail] franchise SMTP failed', hint, e?.message || e);
    }
  }

  console.warn('[sendErpSystemMail] no SMTP route available');
  return false;
}

async function processGarageOutgoingEmail(event) {
  const snap = event.data;
  if (!snap) return;
  const data = snap.data() || {};
  if (data.type !== 'garage_service_ready' || data.status !== 'queued') return;

  const franchiseId = String(event.params.franchiseId || data.franchiseId || '').toUpperCase();
  const ref = snap.ref;

  const smtp = await readFranchiseSmtpConfigDoc(franchiseId);
  if (!smtp) {
    await ref.update({
      status: 'failed',
      error: 'Missing SMTP configuration',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }
  const smtpPassword = resolveFranchiseSmtpPassword(smtp, franchiseId);
  const to = String(data.to || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    await ref.update({
      status: 'failed',
      error: 'Invalid recipient',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const senderDisplay = String(smtp.senderName || '').trim() || 'Green Motion';
  const fromAddr = String(smtp.senderEmail || '').trim();
  if (!fromAddr) {
    await ref.update({
      status: 'failed',
      error: 'Missing senderEmail in smtpConfigurations',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return;
  }

  const subject = String(data.subject || 'Vehicle ready for pickup').trim();
  const body = String(data.body || '').trim();
  const beforePhotoURLs = Array.isArray(data.beforePhotoURLs) ? data.beforePhotoURLs : [];
  const afterPhotoURLs = Array.isArray(data.afterPhotoURLs) ? data.afterPhotoURLs : [];
  const noReply = '\n\n[No-Reply] Automated message from ERPX Garage portal.';
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111">${garageDetailsHtml(
    data
  )}${body && !String(body).startsWith('Completion note:') ? `<hr style="border:none;border-top:1px solid #e5e7eb;margin:14px 0;" />${garagePlainToHtml(body)}` : ''}<p style="margin:16px 0 0 0;color:#6b7280;font-size:12px;">Before/After photos are attached as PDF.</p><p style="margin:8px 0 0 0;color:#6b7280;font-size:12px;">This is an automated no-reply email.</p></div>`;

  const attachments = [];
  const beforePdf = await buildGaragePhotoPdfBuffer('Before Photos', beforePhotoURLs);
  if (beforePdf) attachments.push({ filename: 'before-photos.pdf', content: beforePdf, contentType: 'application/pdf' });
  const afterPdf = await buildGaragePhotoPdfBuffer('After Photos', afterPhotoURLs);
  if (afterPdf) attachments.push({ filename: 'after-photos.pdf', content: afterPdf, contentType: 'application/pdf' });

  const plainDetails = garageDetailsText(data);
  const plainExtra = body && !String(body).startsWith('Completion note:') ? `\n\n${body}` : '';
  try {
    await sendGarageSmtpMail(smtp, smtpPassword, {
      from: `"${senderDisplay}" <${fromAddr}>`,
      to,
      subject,
      text: `${plainDetails}${plainExtra}${noReply}`,
      html,
      attachments,
    });
    await ref.update({
      status: 'sent',
      error: admin.firestore.FieldValue.delete(),
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('[garageOutgoingEmail]', e?.message || e);
    await ref.update({
      status: 'failed',
      error: String(e?.message || e || 'send_failed').slice(0, 500),
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
}

exports.onGarageOutgoingEmailCreated = onDocumentCreated(
  {
    document: 'franchises/{franchiseId}/garageOutgoingEmails/{emailId}',
    region: 'us-central1',
  },
  async (event) => {
    await processGarageOutgoingEmail(event);
  }
);

// --- Platform admin callables (globaladmin only) ---

function normalizeRoleKey(role) {
  return String(role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');
}

async function assertGlobalAdminCallable(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const snap = await admin.firestore().collection('users').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const p = snap.data() || {};
  const role = normalizeRoleKey(p.role);
  const isPlatform =
    role === 'globaladmin' || (role === 'superadmin' && p.isGlobalAdmin === true);
  if (!isPlatform) {
    throw new HttpsError('permission-denied', 'Only globaladmin can perform this action');
  }
  return { uid: request.auth.uid, profile: p };
}

const FRANCHISE_USER_ADMIN_ROLES = ['admin', 'superadmin', 'manager', 'globaladmin'];
const FRANCHISE_ASSIGNABLE_ROLES = ['admin', 'manager', 'staff', 'shuttle', 'viewer', 'garage', 'finance_cashier'];

async function assertFranchiseUserAdminCallable(request, franchiseId) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const fid = normalizeUpperFid(franchiseId);
  if (!fid) {
    throw new HttpsError('invalid-argument', 'franchiseId is required');
  }
  const snap = await admin.firestore().collection('users').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const p = snap.data() || {};
  const role = normalizeRoleKey(p.role);
  const isPlatform =
    role === 'globaladmin' || (role === 'superadmin' && p.isGlobalAdmin === true);
  if (!isPlatform) {
    if (!FRANCHISE_USER_ADMIN_ROLES.includes(role)) {
      throw new HttpsError('permission-denied', 'Insufficient role to create users');
    }
    if (!profileAllowsFranchiseHint(p, fid)) {
      throw new HttpsError('permission-denied', 'Franchise not allowed for this admin');
    }
  }
  return { uid: request.auth.uid, profile: p, franchiseId: fid };
}

function normalizeProfileUsername(username, firstName) {
  const raw = String(username || '').trim();
  if (raw) {
    const normalized = raw.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return {
      username: raw.slice(0, 40),
      usernameNormalized: normalized || undefined,
      clearAll: false,
    };
  }
  const fn = String(firstName || '').trim();
  if (fn) {
    const normalized = fn.toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return {
      username: fn.slice(0, 40),
      usernameNormalized: normalized || undefined,
      clearAll: false,
    };
  }
  return { clearAll: true };
}

// --- roleScope helpers (server-side, mirrors src/utilities/roleScope.js) ---

const ROLE_SCOPE_LEVELS_SRV = ['global', 'country', 'franchise'];
const ROLE_KEYS_SRV = ['admin', 'manager', 'staff', 'shuttle', 'viewer', 'garage', 'finance_cashier', 'globaladmin', 'superadmin'];

function normalizeUpperFid(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeUpperCC(value) {
  return String(value ?? '').trim().toUpperCase();
}

async function validateRoleScopeInputServer(input, db) {
  if (!input || typeof input !== 'object') {
    throw new HttpsError('invalid-argument', 'roleScope must be an object');
  }
  const level = String(input.level || '').toLowerCase().trim();
  if (!ROLE_SCOPE_LEVELS_SRV.includes(level)) {
    throw new HttpsError('invalid-argument', `roleScope.level must be one of ${ROLE_SCOPE_LEVELS_SRV.join('/')}`);
  }
  if (level === 'global') {
    return { level: 'global', countryCode: '', franchiseIds: [] };
  }
  const countryCode = normalizeUpperCC(input.countryCode);
  if (!countryCode || countryCode.length < 2 || countryCode.length > 8) {
    throw new HttpsError('invalid-argument', 'roleScope.countryCode required for country/franchise level');
  }
  const rawIds = Array.isArray(input.franchiseIds) ? input.franchiseIds : [];
  const franchiseIds = Array.from(new Set(rawIds.map(normalizeUpperFid).filter(Boolean)));
  if (level === 'franchise' && franchiseIds.length === 0) {
    throw new HttpsError('invalid-argument', 'roleScope.franchiseIds required for level=franchise');
  }
  // Validate each franchise exists and belongs to the country.
  if (franchiseIds.length) {
    const snaps = await Promise.all(
      franchiseIds.map((fid) => db.collection('franchises').doc(fid).get())
    );
    for (let i = 0; i < snaps.length; i += 1) {
      const fid = franchiseIds[i];
      const s = snaps[i];
      if (!s.exists) {
        throw new HttpsError('not-found', `franchiseId ${fid} not found`);
      }
      const fc = normalizeUpperCC(s.data().countryCode || '');
      if (fc && fc !== countryCode) {
        throw new HttpsError(
          'invalid-argument',
          `franchiseId ${fid} belongs to ${fc}, expected ${countryCode}`
        );
      }
    }
  }
  return { level, countryCode, franchiseIds };
}

function defaultFranchiseIdFromScope(scope) {
  if (!scope) return '';
  if (scope.level === 'global') return '';
  if (Array.isArray(scope.franchiseIds) && scope.franchiseIds.length) {
    return normalizeUpperFid(scope.franchiseIds[0]);
  }
  return normalizeUpperCC(scope.countryCode);
}

function legacyScopeLevelFromScopeServer(scope) {
  if (!scope) return 'single';
  if (scope.level === 'global') return 'country_all';
  if (scope.level === 'country' && (!scope.franchiseIds || scope.franchiseIds.length === 0)) {
    return 'country_all';
  }
  if (scope.level === 'country') return 'selected';
  return (scope.franchiseIds && scope.franchiseIds.length > 1) ? 'selected' : 'single';
}

function franchiseMembershipsMapFromScopeServer(scope) {
  if (!scope) return null;
  if (scope.level === 'global') return null;
  if (scope.level === 'country' && (!scope.franchiseIds || scope.franchiseIds.length === 0)) return null;
  if (!Array.isArray(scope.franchiseIds) || scope.franchiseIds.length <= 1) return null;
  const map = {};
  for (const fid of scope.franchiseIds) map[normalizeUpperFid(fid)] = true;
  return map;
}

/** Set Auth custom claim with the resolved scope (for Storage rules + edge gating). */
async function applyAuthCustomClaimsForUser(uid, role, scope) {
  const lvl = scope?.level || 'franchise';
  // Stay well below the 1 KB token claim limit: cap to ≤ 32 franchise ids.
  const franchiseIds = Array.isArray(scope?.franchiseIds)
    ? scope.franchiseIds.slice(0, 32)
    : [];
  const claim = {
    role: String(role || 'staff').toLowerCase(),
    franchiseScope: {
      level: lvl,
      countryCode: lvl === 'global' ? '' : (scope?.countryCode || ''),
      franchiseIds,
      allowAllInCountry: lvl === 'country' && franchiseIds.length === 0
        ? (scope?.countryCode || '')
        : '',
    },
  };
  try {
    await admin.auth().setCustomUserClaims(uid, claim);
  } catch (e) {
    console.warn('[applyAuthCustomClaimsForUser]', uid, e?.message || e);
  }
}

async function runAdminCloseFranchise(request) {
  await assertGlobalAdminCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  const db = admin.firestore();
  const franchiseRef = db.collection('franchises').doc(franchiseId);
  const franchiseSnap = await franchiseRef.get();
  if (!franchiseSnap.exists) {
    throw new HttpsError('not-found', 'Franchise not found');
  }

  // SOFT-CLOSE: keep Auth users + Firestore profiles, only disable.
  // Hard-delete is reserved for `adminDeleteUserScope` per-user with explicit confirm.
  const usersSnap = await db.collection('users').where('franchiseId', '==', franchiseId).get();
  let usersDeactivated = 0;
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    try {
      await admin.auth().updateUser(uid, { disabled: true });
    } catch (e) {
      console.warn('[adminCloseFranchise] auth disable skipped', uid, e?.message || e);
    }
    try {
      await userDoc.ref.update({
        isActive: false,
        deactivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        deactivatedReason: 'franchise_closed',
        deactivatedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      usersDeactivated += 1;
    } catch (e) {
      console.warn('[adminCloseFranchise] firestore update failed', uid, e?.message || e);
    }
  }

  await franchiseRef.update({
    status: 'closed',
    isActive: false,
    closedAt: admin.firestore.FieldValue.serverTimestamp(),
    closedBy: request.auth.uid,
  });

  return { franchiseId, usersDeactivated };
}

async function runAdminDeleteUserCompletely(request) {
  await assertGlobalAdminCallable(request);
  const uid = String(request.data?.uid || '').trim();
  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid is required');
  }
  // Guard: don't allow deleting another globaladmin without explicit confirm flag.
  const targetSnap = await admin.firestore().collection('users').doc(uid).get();
  if (targetSnap.exists) {
    const tdata = targetSnap.data() || {};
    const targetRole = normalizeRoleKey(tdata.role);
    const targetLvl = String(tdata.roleScope?.level || '').toLowerCase();
    const targetIsGlobal = targetRole === 'globaladmin' || targetLvl === 'global';
    if (targetIsGlobal && request.data?.confirmGlobalAdminDelete !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Target is a global admin. Pass confirmGlobalAdminDelete=true to proceed.'
      );
    }
  }
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', e?.message || 'Auth delete failed');
    }
  }
  await admin.firestore().collection('users').doc(uid).delete();
  return { uid, email: email || null };
}

/** Alias kept for legacy callers; mirrors runAdminDeleteUserCompletely. */
const runAdminDeleteUserScope = runAdminDeleteUserCompletely;

async function runAdminCreateUserWithScope(request) {
  await assertGlobalAdminCallable(request);
  const db = admin.firestore();

  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!validateEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  const displayName = String(request.data?.displayName || '').trim().slice(0, 120);
  const role = normalizeRoleKey(request.data?.role || 'staff');
  if (!ROLE_KEYS_SRV.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${ROLE_KEYS_SRV.join('/')}`);
  }
  const scope = await validateRoleScopeInputServer(request.data?.roleScope, db);

  // Idempotency: reject duplicates from Auth.
  try {
    await admin.auth().getUserByEmail(email);
    throw new HttpsError('already-exists', `User with email ${email} already exists`);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e?.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', e?.message || 'Auth lookup failed');
    }
  }

  const password = generateAutoTempPassword();

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      emailVerified: false,
      password,
      displayName: displayName || undefined,
      disabled: false,
    });
  } catch (e) {
    throw new HttpsError('internal', e?.message || 'Auth create failed');
  }
  const uid = userRecord.uid;
  const firstName = displayName.split(/\s+/, 1)[0] || '';
  const lastName = displayName.includes(' ')
    ? displayName.split(/\s+/).slice(1).join(' ').slice(0, 80)
    : '';

  const userData = {
    uid,
    email,
    firstName,
    lastName,
    role,
    roleScope: scope,
    franchiseId: defaultFranchiseIdFromScope(scope),
    defaultFranchiseId: defaultFranchiseIdFromScope(scope),
    countryCode: scope.level === 'global' ? '' : scope.countryCode,
    scopeLevel: legacyScopeLevelFromScopeServer(scope),
    isActive: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: request.auth.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };
  const memMap = franchiseMembershipsMapFromScopeServer(scope);
  if (memMap) userData.franchiseMemberships = memMap;

  try {
    await db.collection('users').doc(uid).set(userData);
  } catch (e) {
    // Rollback Auth user to avoid orphan.
    try { await admin.auth().deleteUser(uid); } catch { /* swallow */ }
    throw new HttpsError('internal', e?.message || 'Firestore write failed');
  }

  await applyAuthCustomClaimsForUser(uid, role, scope);

  try {
    await sendMandatoryWelcomeCredentialsMail({
      toEmail: email,
      displayName: displayName || firstName,
      temporaryPassword: password,
      franchiseHints: smtpHintCandidatesFromScope(scope),
    });
  } catch (e) {
    try { await admin.auth().deleteUser(uid); } catch { /* swallow */ }
    try { await db.collection('users').doc(uid).delete(); } catch { /* swallow */ }
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', 'welcome_email_failed');
  }

  return {
    uid,
    email,
    role,
    roleScope: scope,
    welcomeEmailSent: true,
  };
}

async function runFranchiseCreateUser(request) {
  const franchiseId = normalizeUpperFid(request.data?.franchiseId);
  const { uid: callerUid, profile: caller } = await assertFranchiseUserAdminCallable(
    request,
    franchiseId
  );
  const db = admin.firestore();

  const email = String(request.data?.email || '').trim().toLowerCase();
  if (!validateEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  const firstName = String(request.data?.firstName || '').trim().slice(0, 80);
  const lastName = String(request.data?.lastName || '').trim().slice(0, 80);
  const role = normalizeRoleKey(request.data?.role || 'staff');
  if (!FRANCHISE_ASSIGNABLE_ROLES.includes(role)) {
    throw new HttpsError('invalid-argument', `role must be one of ${FRANCHISE_ASSIGNABLE_ROLES.join('/')}`);
  }
  const callerRole = normalizeRoleKey(caller.role);
  const isPlatform =
    callerRole === 'globaladmin' || (callerRole === 'superadmin' && caller.isGlobalAdmin === true);
  if (!isPlatform && role === 'admin' && callerRole !== 'admin' && callerRole !== 'globaladmin') {
    throw new HttpsError('permission-denied', 'Only franchise admins can assign the Admin role');
  }

  const franchiseRef = db.collection('franchises').doc(franchiseId);
  const franchiseSnap = await franchiseRef.get();
  if (!franchiseSnap.exists) {
    throw new HttpsError('not-found', 'Franchise not found');
  }
  const franchise = franchiseSnap.data() || {};
  if (franchise.isActive === false) {
    throw new HttpsError('failed-precondition', 'Franchise is not active');
  }
  const activeCount = Number(franchise.currentUserCount || 0);
  const maxUsers = Number(franchise.maxUsers || 0);
  if (maxUsers > 0 && activeCount >= maxUsers) {
    throw new HttpsError(
      'resource-exhausted',
      `User limit reached (${activeCount}/${maxUsers})`
    );
  }

  const serviceCompanyId = String(request.data?.serviceCompanyId || '').trim();
  if (role === 'garage' && !serviceCompanyId) {
    throw new HttpsError('invalid-argument', 'serviceCompanyId required for Garage role');
  }

  const countryCode = String(
    franchise.countryCode || request.data?.countryCode || 'CH'
  ).trim().toUpperCase();
  const scopeLevel = String(request.data?.scopeLevel || 'single').toLowerCase();
  const membershipIds = Array.isArray(request.data?.membershipIds)
    ? request.data.membershipIds.map((x) => normalizeUpperFid(x)).filter(Boolean)
    : [];
  const scopeFranchiseIds = (() => {
    if (scopeLevel === 'country_all') return [];
    if (scopeLevel === 'selected') {
      return membershipIds.length ? membershipIds : [franchiseId];
    }
    return [franchiseId];
  })();
  const roleScope = scopeLevel === 'country_all'
    ? { level: 'country', countryCode, franchiseIds: [] }
    : scopeLevel === 'selected'
      ? { level: 'country', countryCode, franchiseIds: scopeFranchiseIds }
      : { level: 'franchise', countryCode, franchiseIds: scopeFranchiseIds };

  try {
    await admin.auth().getUserByEmail(email);
    throw new HttpsError('already-exists', `User with email ${email} already exists`);
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    if (e?.code !== 'auth/user-not-found') {
      throw new HttpsError('internal', e?.message || 'Auth lookup failed');
    }
  }

  const password = generateAutoTempPassword();
  const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();

  let userRecord;
  try {
    userRecord = await admin.auth().createUser({
      email,
      emailVerified: false,
      password,
      displayName: displayName || undefined,
      disabled: false,
    });
  } catch (e) {
    throw new HttpsError('internal', e?.message || 'Auth create failed');
  }
  const uid = userRecord.uid;
  const isDemo = request.data?.isDemo === true || franchise.isDemo === true;
  const usernameParts = normalizeProfileUsername(request.data?.username, firstName);

  const userData = {
    uid,
    email,
    firstName,
    lastName,
    franchiseId,
    defaultFranchiseId: franchiseId,
    countryCode,
    role,
    roleScope,
    isDemo,
    isDemoAccount: isDemo,
    demoExpiresAt: isDemo
      ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      : null,
    isActive: true,
    scopeLevel: scopeLevel === 'country_all'
      ? 'country_all'
      : scopeLevel === 'selected'
        ? 'selected'
        : 'single',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: callerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: callerUid,
  };
  if (!usernameParts.clearAll) {
    userData.username = usernameParts.username;
    if (usernameParts.usernameNormalized) {
      userData.usernameNormalized = usernameParts.usernameNormalized;
    }
  }
  const memMap = franchiseMembershipsMapFromScopeServer(roleScope);
  if (memMap) userData.franchiseMemberships = memMap;
  if (role === 'garage') {
    userData.garageId = serviceCompanyId;
    userData.linkedGarageId = serviceCompanyId;
  }

  try {
    await db.collection('users').doc(uid).set(userData);
  } catch (e) {
    try { await admin.auth().deleteUser(uid); } catch { /* swallow */ }
    throw new HttpsError('internal', e?.message || 'Firestore write failed');
  }

  await applyAuthCustomClaimsForUser(uid, role, roleScope);

  try {
    await sendMandatoryWelcomeCredentialsMail({
      toEmail: email,
      displayName: displayName || firstName,
      temporaryPassword: password,
      franchiseHints: smtpHintCandidatesFromValue(franchiseId),
    });
  } catch (e) {
    try { await admin.auth().deleteUser(uid); } catch { /* swallow */ }
    try { await db.collection('users').doc(uid).delete(); } catch { /* swallow */ }
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('failed-precondition', 'welcome_email_failed');
  }

  try {
    await franchiseRef.update({
      currentUserCount: admin.firestore.FieldValue.increment(1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn('[franchiseCreateUser] user count increment skipped', e?.message || e);
  }

  return { uid, email, role, franchiseId, welcomeEmailSent: true };
}

async function runAdminUpdateUserScope(request) {
  await assertGlobalAdminCallable(request);
  const db = admin.firestore();
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid required');
  }

  const targetRef = db.collection('users').doc(uid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  const target = targetSnap.data() || {};
  const targetRoleNow = normalizeRoleKey(target.role);
  const targetLvlNow = String(target.roleScope?.level || '').toLowerCase();
  const targetIsGlobal = targetRoleNow === 'globaladmin' || targetLvlNow === 'global';

  const update = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: request.auth.uid,
  };

  let newRole = targetRoleNow || 'staff';
  if (request.data?.role != null) {
    newRole = normalizeRoleKey(request.data.role);
    if (!ROLE_KEYS_SRV.includes(newRole)) {
      throw new HttpsError('invalid-argument', `role must be one of ${ROLE_KEYS_SRV.join('/')}`);
    }
    update.role = newRole;
  }

  let newScope = null;
  if (request.data?.roleScope != null) {
    newScope = await validateRoleScopeInputServer(request.data.roleScope, db);
    // Downgrading another global admin must be explicit.
    if (targetIsGlobal && newScope.level !== 'global' && request.data?.confirmGlobalAdminDowngrade !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Target is a global admin. Pass confirmGlobalAdminDowngrade=true to demote.'
      );
    }
    update.roleScope = newScope;
    update.franchiseId = defaultFranchiseIdFromScope(newScope);
    update.defaultFranchiseId = defaultFranchiseIdFromScope(newScope);
    update.countryCode = newScope.level === 'global' ? '' : newScope.countryCode;
    update.scopeLevel = legacyScopeLevelFromScopeServer(newScope);
    const memMap = franchiseMembershipsMapFromScopeServer(newScope);
    update.franchiseMemberships = memMap ?? admin.firestore.FieldValue.delete();
  }

  if (request.data?.isActive === true || request.data?.isActive === false) {
    update.isActive = request.data.isActive === true;
    try {
      await admin.auth().updateUser(uid, { disabled: !update.isActive });
    } catch (e) {
      console.warn('[adminUpdateUserScope] auth toggle skipped', uid, e?.message || e);
    }
  }

  if (typeof request.data?.displayName === 'string') {
    const displayName = request.data.displayName.trim().slice(0, 120);
    try {
      await admin.auth().updateUser(uid, { displayName: displayName || null });
    } catch (e) {
      console.warn('[adminUpdateUserScope] auth displayName skipped', uid, e?.message || e);
    }
  }

  await targetRef.update(update);

  // Refresh custom claims after any role/scope change.
  if (newScope || update.role) {
    const effectiveScope = newScope || target.roleScope || {
      level: 'franchise',
      countryCode: target.countryCode || '',
      franchiseIds: target.franchiseId ? [target.franchiseId] : [],
    };
    await applyAuthCustomClaimsForUser(uid, update.role || target.role || 'staff', effectiveScope);
  }

  return { uid, role: update.role || target.role || null, roleScope: newScope || target.roleScope || null };
}

function validateAdminPasswordInput(password) {
  const p = String(password || '').trim();
  if (p.length < 8) {
    throw new HttpsError('invalid-argument', 'Password must be at least 8 characters');
  }
  return p;
}

async function runAdminSetUserPassword(request) {
  const { uid: callerUid } = await assertGlobalAdminCallable(request);
  const db = admin.firestore();
  const uid = String(request.data?.uid || '').trim();
  if (!uid) {
    throw new HttpsError('invalid-argument', 'uid required');
  }
  const newPassword = validateAdminPasswordInput(request.data?.newPassword);

  const targetRef = db.collection('users').doc(uid);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found');
  }
  const target = targetSnap.data() || {};
  const targetRole = normalizeRoleKey(target.role);
  const targetLvl = String(target.roleScope?.level || '').toLowerCase();
  const targetIsGlobal = targetRole === 'globaladmin' || targetLvl === 'global';
  if (targetIsGlobal && request.data?.confirmGlobalAdminPasswordChange !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Target is a global admin. Pass confirmGlobalAdminPasswordChange=true.'
    );
  }

  try {
    await admin.auth().updateUser(uid, { password: newPassword });
  } catch (e) {
    throw new HttpsError('internal', e?.message || 'Failed to update password');
  }

  await targetRef.update({
    passwordChangedAt: admin.firestore.FieldValue.serverTimestamp(),
    passwordChangedBy: callerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: callerUid,
  });

  await auditSecurityEvent(db, 'admin_password_set', {
    targetUid: uid,
    targetEmail: target.email || null,
    byUid: callerUid,
  });

  return { uid, email: target.email || null, passwordUpdated: true };
}

async function runAdminGetFranchiseReadiness(request) {
  await assertGlobalAdminCallable(request);
  const franchiseId = normalizeFranchiseIdForReadiness(request.data?.franchiseId);
  if (!franchiseId) {
    throw new HttpsError('invalid-argument', 'franchiseId is required');
  }
  const snap = await db.collection('franchises').doc(franchiseId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', `Franchise not found: ${franchiseId}`);
  }
  const data = snap.data() || {};
  const checks = buildFranchiseReadinessChecks(franchiseId, data);
  const base = 'https://vehiclesentinel.com';
  const sampleToken = '00000000-0000-4000-8000-000000000000';
  return {
    franchiseId,
    ready: checks.every((c) => c.ok),
    checks,
    sampleUrls: {
      return: `${base}/return.html?token=${sampleToken}&franchise=${franchiseId}`,
      checkout: `${base}/checkout.html?token=${sampleToken}&franchise=${franchiseId}`,
    },
    capabilities: data.capabilities || null,
  };
}

const adminCallableOpts = { cors: true };
exports.adminCloseFranchise = onCall(adminCallableOpts, runAdminCloseFranchise);
exports.adminDeleteUserCompletely = onCall(adminCallableOpts, runAdminDeleteUserCompletely);
exports.adminDeleteUserScope = onCall(adminCallableOpts, runAdminDeleteUserScope);
exports.adminCreateUserWithScope = onCall(adminCallableOpts, runAdminCreateUserWithScope);
exports.franchiseCreateUser = onCall(adminCallableOpts, runFranchiseCreateUser);
exports.adminUpdateUserScope = onCall(adminCallableOpts, runAdminUpdateUserScope);
exports.adminSetUserPassword = onCall(adminCallableOpts, runAdminSetUserPassword);
exports.adminGetFranchiseReadiness = onCall(adminCallableOpts, runAdminGetFranchiseReadiness);

// --- Staff front desk customer create (Admin SDK) ---
const staffFrontDesk = require('./staffFrontDesk');
const staffCallableOpts = { cors: true };
exports.staffCreateFrontDeskCustomer = onCall(staffCallableOpts, staffFrontDesk.runStaffCreateFrontDeskCustomer);

// --- Stripe Financial (chargebacks + mail-order products) — secret key on server only ---
const stripeFinancial = require('./stripeFinancial');
const stripeFinancialOpts = stripeFinancial.callableOpts;
exports.stripeFinancialGetConfig = onCall(stripeFinancialOpts, stripeFinancial.runGetConfig);
exports.stripeFinancialListDisputes = onCall(stripeFinancialOpts, stripeFinancial.runListDisputes);
exports.stripeFinancialGetDispute = onCall(stripeFinancialOpts, stripeFinancial.runGetDispute);
exports.stripeFinancialListProducts = onCall(stripeFinancialOpts, stripeFinancial.runListProducts);
exports.stripeFinancialGetProduct = onCall(stripeFinancialOpts, stripeFinancial.runGetProduct);
exports.stripeFinancialCreateProduct = onCall(stripeFinancialOpts, stripeFinancial.runCreateProduct);
exports.stripeFinancialUpdateProduct = onCall(stripeFinancialOpts, stripeFinancial.runUpdateProduct);
exports.stripeFinancialArchiveProduct = onCall(stripeFinancialOpts, stripeFinancial.runArchiveProduct);
exports.stripeFinancialDeleteProduct = onCall(stripeFinancialOpts, stripeFinancial.runDeleteProduct);
exports.stripeFinancialCreateMailOrderPaymentLink = onCall(
  stripeFinancialOpts,
  stripeFinancial.runCreateMailOrderPaymentLink
);
exports.stripeFinancialCreateMailOrderPayment = onCall(
  stripeFinancialOpts,
  stripeFinancial.runCreateMailOrderPayment
);
exports.stripeFinancialCreateDirectCardOperation = onCall(
  stripeFinancialOpts,
  stripeFinancial.runCreateDirectCardOperation
);
exports.stripeFinancialFinalizeDirectCardOperation = onCall(
  stripeFinancialOpts,
  stripeFinancial.runFinalizeDirectCardOperation
);
exports.stripeFinancialRefundPayment = onCall(
  stripeFinancialOpts,
  stripeFinancial.runRefundPayment
);
exports.stripeFinancialPersistDirectCardSnapshot = onCall(
  stripeFinancialOpts,
  stripeFinancial.runPersistDirectCardSnapshot
);
exports.stripeFinancialRetryDirectCardOperation = onCall(
  stripeFinancialOpts,
  stripeFinancial.runRetryDirectCardOperation
);
exports.stripeFinancialRetryDirectCardSavedPayment = onCall(
  stripeFinancialOpts,
  stripeFinancial.runRetryDirectCardSavedPayment
);
exports.stripeFinancialSendMailOrderEmail = onCall(
  stripeFinancialOpts,
  stripeFinancial.runSendMailOrderEmail
);
exports.stripeFinancialAttachMailOrderDocuments = onCall(
  stripeFinancialOpts,
  stripeFinancial.runAttachMailOrderDocuments
);
exports.stripeFinancialListMailOrders = onCall(stripeFinancialOpts, stripeFinancial.runListMailOrders);
exports.stripeFinancialMailOrderCheckout = onRequest(
  stripeFinancial.httpOpts,
  stripeFinancial.runMailOrderCheckoutRedirect,
);
exports.stripeFinancialListPayments = onCall(stripeFinancialOpts, stripeFinancial.runListPayments);
exports.stripeFinancialListAudit = onCall(stripeFinancialOpts, stripeFinancial.runListAudit);
exports.stripeFinancialLogStaffAction = onCall(stripeFinancialOpts, stripeFinancial.runLogStaffAction);

const stripeTerminalDeposits = require('./stripeTerminalDeposits');
const stripeTerminalOpts = stripeTerminalDeposits.callableOpts;
exports.stripeFinancialGetTerminalConfig = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runGetTerminalConfig,
);
exports.stripeFinancialSaveTerminalConfig = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runSaveTerminalConfig,
);
exports.stripeFinancialTestTerminalConnection = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runTestTerminalConnection,
);
exports.stripeFinancialCreateTerminalConnectionToken = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCreateTerminalConnectionToken,
);
exports.stripeFinancialCreateDeposit = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCreateDeposit,
);
exports.stripeFinancialListDeposits = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runListDeposits,
);
exports.stripeFinancialIncrementDeposit = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runIncrementDeposit,
);
exports.stripeFinancialCaptureDeposit = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCaptureDeposit,
);
exports.stripeFinancialCancelDeposit = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCancelDeposit,
);
exports.stripeFinancialChargeSavedPaymentMethod = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runChargeSavedPaymentMethod,
);
exports.stripeFinancialCancelTerminalAction = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCancelTerminalAction,
);
exports.stripeFinancialCancelPaymentHold = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runCancelPaymentHold,
);
exports.stripeFinancialConfirmDepositCollection = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runConfirmDepositCollection,
);
exports.stripeFinancialGetDepositStatus = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runGetDepositStatus,
);
exports.stripeFinancialProcessDepositOnTerminal = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runProcessDepositOnTerminal,
);
exports.stripeFinancialStartDepositCollectInputsTest = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runStartDepositCollectInputsTest,
);
exports.stripeFinancialPollDepositCollectInputsTest = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runPollDepositCollectInputsTest,
);
exports.stripeFinancialListTerminals = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runListTerminals,
);
exports.stripeFinancialUpsertTerminal = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runUpsertTerminal,
);
exports.stripeFinancialDeleteTerminal = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runDeleteTerminal,
);
exports.stripeFinancialListDepositEmailTemplates = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runListDepositEmailTemplates,
);
exports.stripeFinancialSaveDepositEmailTemplate = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runSaveDepositEmailTemplate,
);
exports.stripeFinancialDeleteDepositEmailTemplate = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runDeleteDepositEmailTemplate,
);
exports.stripeFinancialAttachDepositDocuments = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runAttachDepositDocuments,
);
exports.stripeFinancialSendDepositEmail = onCall(
  stripeTerminalOpts,
  stripeTerminalDeposits.runSendDepositEmail,
);

// Stripe webhook — PaymentIntent / charge lifecycle → Firestore (deposits,
// mail orders). Signature-verified via STRIPE_CH_WEBHOOK_SECRET env; answers
// 503 (and changes nothing) until that secret is configured.
const stripeWebhook = require('./stripeWebhook');
exports.stripeFinancialWebhook = onRequest(
  { cors: false, secrets: stripeTerminalOpts.secrets },
  stripeWebhook.handleStripeWebhookRequest,
);

// Daily safety net: sync open deposit holds from Stripe so expired
// authorizations surface even if no webhook fired and nobody opened the list.
exports.stripeDepositDailySync = onSchedule(
  {
    schedule: 'every day 06:30',
    timeZone: 'Europe/Zurich',
    secrets: stripeTerminalOpts.secrets,
    timeoutSeconds: 540,
  },
  async () => {
    await stripeTerminalDeposits.syncOpenDepositsSweep();
  },
);
