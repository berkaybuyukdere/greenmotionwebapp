/**
 * Staff web front-desk customer create (Admin SDK) — same data path as kiosk intake, authenticated staff only.
 */
const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeFranchiseId(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 80 || s === '.' || s === '..' || s.includes('/')) {
    throw new HttpsError('invalid-argument', 'Invalid franchiseId');
  }
  return s.toUpperCase();
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

async function assertStaffForFranchise(request, franchiseId) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const snap = await admin.firestore().collection('users').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile not found');
  }
  const p = snap.data() || {};
  if (p.isActive === false) {
    throw new HttpsError('permission-denied', 'Account inactive');
  }
  const role = String(p.role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');
  const allowed = ['staff', 'shuttle', 'manager', 'admin', 'viewer', 'superadmin', 'globaladmin'];
  if (!allowed.includes(role)) {
    throw new HttpsError('permission-denied', 'Insufficient role');
  }
  const isPlatformAdmin =
    role === 'globaladmin' || (role === 'superadmin' && p.isGlobalAdmin === true);
  if (!isPlatformAdmin && !profileAllowsFranchiseHint(p, franchiseId)) {
    throw new HttpsError('permission-denied', 'No access to this franchise');
  }
  return { uid: request.auth.uid, profile: p };
}

function validateEmail(email) {
  const s = String(email || '').trim();
  return s.length >= 5 && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function dedupeKey(franchiseId, phone, submittedAtMillis) {
  const day = new Date(submittedAtMillis).toISOString().slice(0, 10);
  return `${franchiseId}|${normalizePhoneDigits(phone)}|${day}`;
}

function isSwissFrontDeskFranchise(franchiseId) {
  return /^CH/i.test(String(franchiseId || '').trim());
}

const SWISS_FD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function toFirestoreTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof admin.firestore.Timestamp) return value;
  if (typeof value === 'object' && value.seconds != null) {
    return new admin.firestore.Timestamp(Number(value.seconds), Number(value.nanoseconds || 0));
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return admin.firestore.Timestamp.fromDate(d);
}

async function runStaffCreateFrontDeskCustomer(request) {
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  await assertStaffForFranchise(request, franchiseId);

  const docId = String(request.data?.docId || request.data?.clientSubmissionId || '').trim();
  if (!UUID_RE.test(docId)) {
    throw new HttpsError('invalid-argument', 'Invalid docId');
  }

  const phone = String(request.data?.phone || '').trim();
  const email = String(request.data?.email || '').trim().toLowerCase();
  const addressLine = String(request.data?.addressLine || '').trim();
  const city = String(request.data?.city || '').trim();
  const postalCode = String(request.data?.postalCode || '').trim();
  const country = String(request.data?.country || '').trim();
  const status = request.data?.status === 'completed' ? 'completed' : 'awaiting_staff';

  if (normalizePhoneDigits(phone).length < 6) {
    throw new HttpsError('invalid-argument', 'Invalid telephone');
  }
  if (!validateEmail(email)) {
    throw new HttpsError('invalid-argument', 'Invalid email');
  }
  if (addressLine.length < 2 || city.length < 1 || postalCode.length < 2 || country.length < 2) {
    throw new HttpsError('invalid-argument', 'Invalid address');
  }

  const now = Date.now();
  const db = admin.firestore();
  const ref = db.collection('franchises').doc(franchiseId).collection('frontDeskCustomers').doc(docId);
  const existing = await ref.get();
  if (existing.exists) {
    throw new HttpsError('already-exists', 'Customer record already exists');
  }

  const firstName = String(request.data?.firstName || '').trim();
  const familyName = String(request.data?.familyName || request.data?.lastName || '').trim();
  const fullName =
    [firstName, familyName].filter(Boolean).join(' ').trim() || String(request.data?.fullName || '').trim() || 'Pending customer';

  const payload = {
    franchiseId,
    clientSubmissionId: docId,
    dedupeKey: dedupeKey(franchiseId, phone, now),
    entrySource: 'staff_web',
    createdByUid: request.auth.uid,
    fullName,
    firstName: firstName || null,
    lastName: familyName || null,
    familyName: familyName || null,
    phone,
    email,
    addressLine,
    city,
    postalCode,
    country,
    status,
    completedAt: status === 'completed' ? admin.firestore.FieldValue.serverTimestamp() : null,
    submittedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    customerNationalId: (() => {
      const direct = String(request.data?.customerNationalId || request.data?.nationalId || '').trim();
      if (direct) return direct.slice(0, 64);
      const tc = request.data?.tcKimlikNo ? String(request.data.tcKimlikNo).replace(/\D/g, '').slice(0, 11) : '';
      if (tc) return tc;
      const pass = request.data?.passportNumber ? String(request.data.passportNumber).trim().slice(0, 64) : '';
      return pass || null;
    })(),
    vehicleDepositAmount:
      request.data?.vehicleDepositAmount != null && request.data?.vehicleDepositAmount !== ''
        ? Number(request.data.vehicleDepositAmount)
        : null,
    resCode: request.data?.resCode ?? null,
    vehiclePlate: request.data?.vehiclePlate ?? null,
    linkedExitId: request.data?.linkedExitId ?? null,
    linkedIadeId: request.data?.linkedIadeId ?? null,
    iosPrefillStatus: request.data?.iosPrefillStatus ?? 'none',
    handoverAracId: request.data?.handoverAracId ?? null,
    handoverPlaka: request.data?.handoverPlaka ?? null,
    handoverKategori: request.data?.handoverKategori ?? null,
    handoverMarka: request.data?.handoverMarka ?? null,
    handoverModel: request.data?.handoverModel ?? null,
    handoverKm: request.data?.handoverKm ?? null,
    handoverFuelEighths: request.data?.handoverFuelEighths ?? null,
    handoverPickupBranch: request.data?.handoverPickupBranch ?? null,
    handoverDropoffBranch: request.data?.handoverDropoffBranch ?? null,
    handoverExitBranch: request.data?.handoverExitBranch ?? null,
    handoverNavKodu: request.data?.handoverNavKodu ?? null,
    plannedCheckoutAt: toFirestoreTimestamp(request.data?.plannedCheckoutAt),
    plannedCheckinAt: toFirestoreTimestamp(request.data?.plannedCheckinAt),
  };

  if (request.data?.customerDocuments && typeof request.data.customerDocuments === 'object') {
    payload.customerDocuments = request.data.customerDocuments;
  }

  if (isSwissFrontDeskFranchise(franchiseId)) {
    payload.retentionExpiresAt = admin.firestore.Timestamp.fromMillis(now + SWISS_FD_RETENTION_MS);
    payload.swissFrontDeskRetentionPolicy = 'CH-FADP-INTAKE-7D';
  }

  await ref.set(payload);

  if (request.data?.rememberCustomer !== false && validateEmail(email)) {
    const rememberId = email
      .replace(/\//g, '_')
      .replace(/#/g, '_')
      .replace(/\?/g, '_');
    const rememberRef = db
      .collection('franchises')
      .doc(franchiseId)
      .collection('customerContactRemember')
      .doc(rememberId);
    const rememberPayload = {
      franchiseId,
      email,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSource: 'staff_web',
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
      'customerNationalId',
      'nationalId',
      'tcKimlikNo',
      'passportNumber',
    ];
    for (const k of optionalKeys) {
      if (request.data[k] != null && String(request.data[k]).trim() !== '') {
        rememberPayload[k] = request.data[k];
      }
    }
    await rememberRef.set(rememberPayload, { merge: true });
  }

  return { success: true, id: docId };
}

module.exports = { runStaffCreateFrontDeskCustomer };
