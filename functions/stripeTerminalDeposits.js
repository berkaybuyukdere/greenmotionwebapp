/**
 * Stripe Terminal deposits — manual capture + incremental authorization (CH car rental).
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { sendDepositConfirmationEmail } = require('./stripeDepositMail');

const stripeCHSecretKey = defineSecret('STRIPE_CH_SECRET_KEY');

const STRIPE_FINANCE_ROLES = new Set([
  'globaladmin',
  'superadmin',
  'admin',
  'manager',
  'staff',
  'shuttle',
  'viewer',
  'finance_cashier',
]);
// Roles allowed to move funds (create/increment/capture/cancel holds,
// off-session charges). 'viewer' is read-only by definition.
const STRIPE_MONEY_ROLES = new Set(
  [...STRIPE_FINANCE_ROLES].filter((role) => role !== 'viewer'),
);
/** Optional API version pin, e.g. 2025-02-24.acacia — unset keeps account default. */
const STRIPE_API_VERSION = String(process.env.STRIPE_API_VERSION || '').trim();
const CH_TIMEZONE = 'Europe/Zurich';
const MAX_DEPOSIT_CHF = 5000;
const MAX_INCREMENT_CHF = 10000;
const DEFAULT_MAX_AUTH_CHF = 3000;
/** Required when saving card on Terminal with setup_future_usage (Stripe API). */
const TERMINAL_ALLOW_REDISPLAY = 'always';

function getStripeSecretKey() {
  let key = '';
  try {
    key = String(stripeCHSecretKey.value() || '').trim();
  } catch (_) {
    key = '';
  }
  if (!key) {
    key = String(process.env.STRIPE_CH_SECRET_KEY || process.env.STRIPE_SECRET_KEY || '').trim();
  }
  if (!key) {
    throw new HttpsError('failed-precondition', 'Stripe CH secret missing.');
  }
  return key;
}

function encodeForm(params, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const formKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const itemKey = `${formKey}[${index}]`;
        if (item !== null && typeof item === 'object') {
          parts.push(encodeForm(item, itemKey));
        } else {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof value === 'object') {
      parts.push(encodeForm(value, formKey));
    } else {
      parts.push(`${encodeURIComponent(formKey)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeRequestOnce(method, path, params = null, opts = {}) {
  const secret = getStripeSecretKey();
  const url = `https://api.stripe.com/v1${path}`;
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(STRIPE_API_VERSION ? { 'Stripe-Version': STRIPE_API_VERSION } : {}),
      ...(opts.idempotencyKey
        ? { 'Idempotency-Key': String(opts.idempotencyKey).slice(0, 255) }
        : {}),
    },
  };
  if (method === 'GET' && params) {
    const qs = encodeForm(params);
    const full = qs ? `${url}?${qs}` : url;
    const res = await fetch(full, init);
    return parseStripeResponse(res);
  }
  if (params && method === 'POST') {
    init.body = encodeForm(params);
  }
  const res = await fetch(url, init);
  return parseStripeResponse(res);
}

function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStripeTransientError(httpStatus, stripeCode) {
  if (httpStatus === 429) return true;
  if (stripeCode === 'lock_timeout') return true;
  return false;
}

async function stripeRequest(method, path, params = null, opts = {}) {
  const maxAttempts = Number(opts.maxAttempts) || 4;
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await stripeRequestOnce(method, path, params, opts);
    } catch (e) {
      lastErr = e;
      const httpStatus = Number(e?.details?.httpStatus || 0);
      const stripeCode = String(e?.details?.stripeCode || '');
      if (!isStripeTransientError(httpStatus, stripeCode) || attempt >= maxAttempts - 1) {
        throw e;
      }
      const delay = Math.min(8000, 350 * (2 ** attempt)) + Math.floor(Math.random() * 250);
      console.warn('[stripeRequest] retry', method, path, attempt + 1, httpStatus, stripeCode);
      await sleepMs(delay);
    }
  }
  throw lastErr;
}

async function parseStripeResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpsError('internal', `Stripe invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const err = data?.error || {};
    throw new HttpsError('failed-precondition', err.message || `Stripe ${res.status}`, {
      stripeCode: err.code || null,
      declineCode: err.decline_code || null,
      stripeType: err.type || null,
      paymentIntentId: err.payment_intent?.id || null,
      paymentIntentClientSecret: err.payment_intent?.client_secret || null,
      requiresAuthentication: err.code === 'authentication_required',
      httpStatus: res.status,
    });
  }
  return data;
}

function normalizeRoleKey(role) {
  return String(role || '').toLowerCase().trim().replace(/[\s_-]+/g, '');
}

// Per-instance profile cache: a warm Functions instance serves many calls in a
// row from the same staff member; re-reading users/{uid} on each adds latency.
const PROFILE_CACHE_TTL_MS = 60 * 1000;
const profileCache = new Map();

async function assertFinancialCallable(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const uid = request.auth.uid;
  const cached = profileCache.get(uid);
  let profile;
  if (cached && cached.expiresAt > Date.now()) {
    profile = cached.profile;
  } else {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    if (!snap.exists) {
      throw new HttpsError('permission-denied', 'User profile missing');
    }
    profile = snap.data() || {};
    profileCache.set(uid, { profile, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
  }
  const role = normalizeRoleKey(profile.role);
  if (!STRIPE_FINANCE_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Stripe finance access required.');
  }
  return { uid, profile };
}

/** Same as assertFinancialCallable but blocks read-only roles from moving funds. */
async function assertMoneyCallable(request) {
  const ctx = await assertFinancialCallable(request);
  if (!STRIPE_MONEY_ROLES.has(normalizeRoleKey(ctx.profile.role))) {
    throw new HttpsError('permission-denied', 'Read-only role cannot create, capture or cancel payments.');
  }
  return ctx;
}

const STRIPE_FINANCE_ADMIN_ROLES = new Set(['globaladmin', 'superadmin', 'admin']);

function canViewStripeFinancialTotals(profile) {
  return STRIPE_FINANCE_ADMIN_ROLES.has(normalizeRoleKey(profile?.role));
}

function localDayKeyInTimezone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isoDayKeyFromIso(iso, timeZone = 'Europe/Zurich') {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function buildDailyFinancialSummary(rows, { amountField = 'amount', dayKey, timeZone = 'Europe/Zurich' } = {}) {
  const today = dayKey || localDayKeyInTimezone(timeZone);
  let count = 0;
  let volume = 0;
  for (const row of rows || []) {
    const ts = row.createdAt || row.paidAt || row.linkSentAt || null;
    if (isoDayKeyFromIso(ts, timeZone) !== today) continue;
    count += 1;
    volume += Number(row[amountField]) || 0;
  }
  return { dayKey: today, count, volume };
}

async function assertFinancialAdminCallable(request) {
  const ctx = await assertFinancialCallable(request);
  const role = normalizeRoleKey(ctx.profile.role);
  if (!STRIPE_FINANCE_ADMIN_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Stripe finance admin access required.');
  }
  return ctx;
}

function normalizeFranchiseId(raw) {
  const fid = String(raw || '').trim().toUpperCase();
  if (!fid || fid.length > 80 || fid.includes('/')) {
    throw new HttpsError('invalid-argument', 'Invalid franchiseId');
  }
  return fid;
}

function assertSwitzerlandFranchise(franchiseId) {
  if (!/^CH/i.test(String(franchiseId || '').trim())) {
    throw new HttpsError('permission-denied', 'Switzerland franchise only.');
  }
}

function depositsCol(franchiseId) {
  return admin.firestore().collection('franchises').doc(franchiseId).collection('stripeDeposits');
}

function terminalConfigRef(franchiseId) {
  return admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('stripeConfig')
    .doc('terminal');
}

function terminalsCol(franchiseId) {
  return admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('stripeTerminals');
}

function depositEmailTemplatesCol(franchiseId) {
  return admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('depositEmailTemplates');
}

function normalizeResCode(raw) {
  let s = String(raw || '').trim().toUpperCase();
  if (s.startsWith('RES-')) s = s.slice(4);
  else if (s.startsWith('RES')) s = s.slice(3).replace(/^[-_\s]+/, '');
  const digits = s.replace(/\D/g, '');
  return digits ? `RES-${digits}` : String(raw || '').trim();
}

/** Only rows that may still change on Stripe need live sync (rate-limit friendly). */
function depositNeedsStripeSync(row = {}) {
  const status = String(row.status || '').toLowerCase();
  const stripeStatus = String(row.stripeStatus || '').toLowerCase();
  if (['pending_collection', 'authorized'].includes(status)) return true;
  if (
    ['requires_payment_method', 'requires_confirmation', 'requires_capture', 'processing'].includes(
      stripeStatus,
    )
  ) {
    return true;
  }
  if (!row.tokenSaved && !row.stripePaymentMethodId && ['authorized', 'captured'].includes(status)) {
    return true;
  }
  if (
    status === 'cancelled' &&
    !String(row.cancelReason || '').toLowerCase().includes('expired') &&
    row.paymentIntentId
  ) {
    return true;
  }
  return false;
}

async function loadReadersForFranchise(franchiseId) {
  const [terminalSnap, terminalsSnap] = await Promise.all([
    terminalConfigRef(franchiseId).get(),
    terminalsCol(franchiseId).orderBy('createdAt', 'asc').get().catch(() => ({ docs: [] })),
  ]);

  const readers = [];
  for (const docSnap of terminalsSnap.docs || []) {
    const row = docSnap.data() || {};
    const readerId = String(row.readerId || '').trim();
    if (!readerId) continue;
    readers.push({
      id: docSnap.id,
      readerId,
      readerLabel: String(row.readerLabel || row.label || '').trim(),
      locationId: String(row.locationId || '').trim(),
      isDefault: row.isDefault === true,
      lastTestAt: row.lastTestAt?.toDate?.()?.toISOString?.() || null,
      lastTestOk: row.lastTestOk === true,
      lastTestMessage: String(row.lastTestMessage || ''),
    });
  }

  const legacy = terminalSnap.exists ? terminalSnap.data() || {} : {};
  const legacyReaderId = String(legacy.readerId || '').trim();
  if (legacyReaderId && !readers.some((r) => r.readerId === legacyReaderId)) {
    readers.unshift({
      id: 'legacy',
      readerId: legacyReaderId,
      readerLabel: String(legacy.readerLabel || 'Default POS').trim(),
      locationId: String(legacy.locationId || '').trim(),
      isDefault: readers.length === 0,
      lastTestAt: legacy.lastTestAt?.toDate?.()?.toISOString?.() || null,
      lastTestOk: legacy.lastTestOk === true,
      lastTestMessage: String(legacy.lastTestMessage || ''),
    });
  }

  if (readers.length && !readers.some((r) => r.isDefault)) {
    readers[0].isDefault = true;
  }
  return readers;
}

async function resolveReaderForDeposit(franchiseId, readerIdHint) {
  const readers = await loadReadersForFranchise(franchiseId);
  const hint = String(readerIdHint || '').trim();
  if (hint) {
    const match = readers.find((r) => r.readerId === hint || r.id === hint);
    if (match) return match;
  }
  return readers.find((r) => r.isDefault) || readers[0] || null;
}

function parseChfToCents(amountChf) {
  const n = Number(amountChf);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpsError('invalid-argument', 'Invalid amount');
  }
  return Math.round(n * 100);
}

function extractCardholderName(charge, pi) {
  const fromCharge = charge?.billing_details?.name || '';
  const cardPresent = charge?.payment_method_details?.card_present;
  const fromPresent = cardPresent?.cardholder_name || '';
  const fromPi = pi?.metadata?.customerName || '';
  return String(fromCharge || fromPresent || fromPi || '').trim();
}

async function writeAudit(franchiseId, uid, action, detail = {}, profile = null) {
  try {
    const actor = profile
      ? actorFromProfile(profile, uid)
      : { actorName: await resolveUserDisplayName(uid), actorEmail: null };
    await admin
      .firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeFinancialAudit')
      .add({
        action,
        detail: { ...detail, actorName: actor.actorName, actorEmail: actor.actorEmail },
        uid,
        actorName: actor.actorName,
        actorEmail: actor.actorEmail || null,
        franchiseId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[stripeTerminalDeposits] audit', e?.message);
  }
}

function actorFromProfile(profile, uid) {
  if (!profile) {
    return { actorName: uid ? String(uid).slice(0, 8) : 'Staff', actorEmail: null };
  }
  return {
    actorName: String(profile.displayName || profile.email || uid || 'Staff').slice(0, 120),
    actorEmail: profile.email || null,
  };
}

function depositAuditContext(row, overrides = {}) {
  return {
    depositId: overrides.depositId ?? null,
    paymentIntentId: row?.paymentIntentId || overrides.paymentIntentId || null,
    resCode: row?.resCode || row?.reference || overrides.resCode || null,
    customerName: row?.customerName || overrides.customerName || null,
    customerEmail: row?.customerEmail || overrides.customerEmail || null,
    plate: row?.plate || overrides.plate || null,
  };
}

const auditNameCache = new Map();

async function resolveUserDisplayName(uid) {
  if (!uid) return 'Staff';
  const cached = auditNameCache.get(uid);
  if (cached && cached.expiresAt > Date.now()) return cached.name;
  try {
    const snap = await admin.firestore().collection('users').doc(uid).get();
    const name = snap.exists
      ? String((snap.data() || {}).displayName || (snap.data() || {}).email || uid).slice(0, 120)
      : String(uid).slice(0, 8);
    auditNameCache.set(uid, { name, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });
    return name;
  } catch {
    return String(uid).slice(0, 8);
  }
}

async function resolveUserDisplayNames(uids) {
  const unique = [...new Set((uids || []).filter(Boolean))];
  const map = new Map();
  await Promise.all(
    unique.map(async (uid) => {
      map.set(uid, await resolveUserDisplayName(uid));
    }),
  );
  return map;
}

function enrichDepositActorNames(mapped, nameByUid) {
  const pick = (uid, stored) => stored || (uid ? nameByUid.get(uid) : null) || null;
  return {
    ...mapped,
    createdByName: pick(mapped.createdBy, mapped.createdByName),
    cancelledByName: pick(mapped.cancelledBy, mapped.cancelledByName),
    capturedByName: pick(mapped.capturedBy, mapped.capturedByName),
  };
}

function captureBeforeFromCharge(charge) {
  if (!charge) return null;
  const unix =
    Number(charge.payment_method_details?.card_present?.capture_before) ||
    Number(charge.capture_before) ||
    0;
  if (!unix) return null;
  return new Date(unix * 1000).toISOString();
}

function extendedAuthAppliedFromCharge(charge) {
  // Stripe reports "enabled" or "disabled" here. "requested" is NOT a grant —
  // treating it as applied showed 30-day windows on holds that die in 5-7 days.
  const status = String(
    charge?.payment_method_details?.card_present?.extended_authorization?.status || '',
  ).toLowerCase();
  return status === 'enabled';
}

/** Days remaining / total window from now to captureBefore ISO. */
function captureWindowDays(captureBeforeIso) {
  if (!captureBeforeIso) return null;
  const ms = new Date(captureBeforeIso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Days remaining until captureBefore. No synthetic fallback: Stripe's
 * capture_before is the only source of truth for the hold window — assuming
 * 30 days when extended auth was merely *requested* hid real 5-7 day expiries.
 */
function depositCaptureWindowDays(row, captureBeforeIso) {
  return captureWindowDays(captureBeforeIso);
}

/** ISO capture deadline — Stripe capture_before only, never a computed guess. */
function depositCaptureBeforeIso(row, fromChargeIso) {
  return fromChargeIso || null;
}

/** Stripe PI has extended authorization requested (car rental ~30d hold window). */
function cardPresentExtendedAuthRequested(pi) {
  return pi?.payment_method_options?.card_present?.request_extended_authorization === true;
}

function depositCardPresentPaymentOptions() {
  return {
    card_present: {
      request_extended_authorization: true,
      request_incremental_authorization_support: true,
    },
  };
}

/**
 * Ensure PI requests extended authorization before card is presented on Terminal.
 * https://docs.stripe.com/terminal/features/extended-authorizations
 */
async function ensurePaymentIntentExtendedAuthorization(paymentIntentId, piPrefetched = null) {
  let pi =
    piPrefetched ||
    (await stripeRequest('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, null));
  if (cardPresentExtendedAuthRequested(pi)) {
    return pi;
  }
  if (!['requires_payment_method', 'requires_confirmation'].includes(pi.status)) {
    console.warn('[ensureExtendedAuth] cannot patch PI', paymentIntentId, 'status', pi.status);
    return pi;
  }
  return stripeRequest('POST', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
    payment_method_options: depositCardPresentPaymentOptions(),
  });
}

/** Persist reusable card token + display fields on deposit doc. */
async function snapshotDepositTokenFields(franchiseId, row, paymentIntentId, pi, charge = null) {
  const effectiveCharge =
    charge || (typeof pi?.latest_charge === 'object' ? pi.latest_charge : null);
  const resolved = await resolveDepositCardForReuse(franchiseId, row, paymentIntentId, pi);
  const pmd = effectiveCharge?.payment_method_details || {};
  const cardPresent = pmd.card_present || {};
  const card = pmd.card || {};
  return {
    stripeCustomerId: resolved.customerId,
    stripePaymentMethodId: resolved.paymentMethodId,
    tokenSaved: true,
    cardBrand: cardPresent.brand || card.brand || row.cardBrand || null,
    cardLast4: cardPresent.last4 || card.last4 || row.cardLast4 || null,
    cardholderName: extractCardholderName(effectiveCharge, pi) || row.cardholderName || null,
  };
}

function mapDepositDoc(id, row) {
  const captureBefore = depositCaptureBeforeIso(row, row.captureBefore || null);
  return {
    id,
    paymentIntentId: row.paymentIntentId || null,
    initialAmount: row.initialAmount || 0,
    maxAuthAmount: row.maxAuthAmount || 0,
    currentHoldAmount: row.currentHoldAmount || row.initialAmount || 0,
    currency: row.currency || 'chf',
    plate: row.plate || '',
    customerName: row.customerName || '',
    customerEmail: row.customerEmail || '',
    reference: row.reference || '',
    resCode: row.resCode || row.reference || '',
    source: row.source || 'terminal',
    status: row.status || 'pending_collection',
    readerId: row.readerId || '',
    readerLabel: row.readerLabel || '',
    emailSubject: row.emailSubject || '',
    emailBodyHtml: row.emailBodyHtml || '',
    emailTemplateId: row.emailTemplateId || '',
    sendEmailAfterAuth: row.sendEmailAfterAuth === true,
    emailSentAt: row.emailSentAt?.toDate?.()?.toISOString?.() || null,
    emailSentOk: row.emailSentOk === true,
    emailSentMessage: row.emailSentMessage || '',
    documents: Array.isArray(row.documents) ? row.documents : [],
    tokenSaved: row.tokenSaved === true || Boolean(row.stripePaymentMethodId),
    stripeCustomerId: row.stripeCustomerId || null,
    stripePaymentMethodId: row.stripePaymentMethodId || null,
    createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toDate?.()?.toISOString?.() || null,
    createdBy: row.createdBy || null,
    createdByName: row.createdByName || null,
    cancelledBy: row.cancelledBy || null,
    cancelledByName: row.cancelledByName || null,
    cancelledAt: row.cancelledAt?.toDate?.()?.toISOString?.() || null,
    cancelReason: row.cancelReason || '',
    capturedBy: row.capturedBy || null,
    capturedByName: row.capturedByName || null,
    capturedAt: row.capturedAt?.toDate?.()?.toISOString?.() || null,
    capturedAmount: row.capturedAmount || null,
    stripeStatus: row.stripeStatus || null,
    cardBrand: row.cardBrand || null,
    cardLast4: row.cardLast4 || null,
    captureBefore,
    extendedAuthorizationRequested: row.extendedAuthorizationRequested === true,
    extendedAuthorizationApplied: row.extendedAuthorizationApplied === true,
    captureWindowDays: depositCaptureWindowDays(row, captureBefore),
  };
}

async function runGetTerminalConfig(request) {
  await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const [terminalSnap, publicSnap] = await Promise.all([
    terminalConfigRef(franchiseId).get(),
    admin
      .firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeConfig')
      .doc('public')
      .get(),
  ]);

  const terminal = terminalSnap.exists ? terminalSnap.data() || {} : {};
  const publicCfg = publicSnap.exists ? publicSnap.data() || {} : {};
  const publishableKey = String(publicCfg.publishableKey || '').trim();
  const mode = publishableKey.startsWith('pk_live') ? 'live' : publishableKey ? 'test' : 'unset';
  const readers = await loadReadersForFranchise(franchiseId);

  return {
    franchiseId,
    publishableKey,
    mode,
    secretConfigured: Boolean(getStripeSecretKey()),
    readerId: String(terminal.readerId || readers.find((r) => r.isDefault)?.readerId || '').trim(),
    locationId: String(terminal.locationId || readers.find((r) => r.isDefault)?.locationId || '').trim(),
    readerLabel: String(terminal.readerLabel || readers.find((r) => r.isDefault)?.readerLabel || '').trim(),
    readers,
    lastTestAt: terminal.lastTestAt?.toDate?.()?.toISOString?.() || null,
    lastTestOk: terminal.lastTestOk === true,
    lastTestMessage: String(terminal.lastTestMessage || ''),
  };
}

async function runSaveTerminalConfig(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const readerId = String(data.readerId || '').trim();
  const locationId = String(data.locationId || '').trim();
  const readerLabel = String(data.readerLabel || '').trim();

  if (readerId && !readerId.startsWith('tmr_')) {
    throw new HttpsError('invalid-argument', 'Reader ID must start with tmr_');
  }
  if (locationId && !locationId.startsWith('tml_')) {
    throw new HttpsError('invalid-argument', 'Location ID must start with tml_');
  }

  await terminalConfigRef(franchiseId).set(
    {
      readerId,
      locationId,
      readerLabel,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'terminal_config_saved', { readerId, locationId });
  return { ok: true };
}

async function runTestTerminalConnection(request) {
  const { uid } = await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const snap = await terminalConfigRef(franchiseId).get();
  const cfg = snap.exists ? snap.data() || {} : {};
  const readerId = String(request.data?.readerId || cfg.readerId || '').trim();
  if (!readerId) {
    throw new HttpsError('failed-precondition', 'Add a reader ID (tmr_…) first.');
  }

  let ok = false;
  let message = '';
  try {
    const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
    ok = reader.status === 'online';
    message = `Reader "${reader.label || readerId}" — status: ${reader.status || 'unknown'}`;
    if (reader.status !== 'online') {
      message += '. Power on the POS and wait until Stripe Dashboard shows Online.';
    } else {
      message += '. Ready for server-driven payments.';
    }
  } catch (e) {
    message = e?.message || 'Could not reach reader';
  }

  await terminalConfigRef(franchiseId).set(
    {
      lastTestAt: admin.firestore.FieldValue.serverTimestamp(),
      lastTestOk: ok,
      lastTestMessage: message,
      lastTestBy: uid,
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'terminal_test', { readerId, ok, message });
  return { ok, message, readerId };
}

async function runCreateTerminalConnectionToken(request) {
  await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const snap = await terminalConfigRef(franchiseId).get();
  const locationId = String(snap.data()?.locationId || '').trim();
  const params = locationId ? { location: locationId } : {};
  const token = await stripeRequest('POST', '/terminal/connection_tokens', params);
  return { secret: token.secret };
}

async function runCreateDeposit(request) {
  const { uid, profile } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const initialCents = parseChfToCents(data.initialAmountChf);
  const maxCents = data.maxAuthAmountChf != null && data.maxAuthAmountChf !== ''
    ? parseChfToCents(data.maxAuthAmountChf)
    : initialCents;
  if (initialCents > parseChfToCents(MAX_DEPOSIT_CHF)) {
    throw new HttpsError('invalid-argument', `Initial deposit max ${MAX_DEPOSIT_CHF} CHF`);
  }
  if (maxCents > parseChfToCents(MAX_INCREMENT_CHF)) {
    throw new HttpsError('invalid-argument', `Max authorization max ${MAX_INCREMENT_CHF} CHF`);
  }
  if (maxCents < initialCents) {
    throw new HttpsError('invalid-argument', 'Max authorization must be ≥ initial deposit');
  }

  const plate = String(data.plate || '').trim().toUpperCase();
  const customerName = String(data.customerName || '').trim();
  const customerEmail = String(data.customerEmail || '').trim();
  const referenceRaw = String(data.reference || data.resCode || '').trim();
  const reference = normalizeResCode(referenceRaw) || referenceRaw;
  const resCode = reference;
  const readerIdHint = String(data.readerId || data.terminalId || '').trim();
  const source = String(data.source || 'terminal').trim().toLowerCase();
  const emailSubject = String(data.emailSubject || '').trim();
  const emailBodyHtml = String(data.emailBodyHtml || data.emailBody || '').trim();
  const emailTemplateId = String(data.emailTemplateId || '').trim();
  const sendEmailAfterAuth = data.sendEmailAfterAuth !== false && Boolean(customerEmail);
  const documents = Array.isArray(data.documents) ? data.documents.slice(0, 50) : [];

  if (!customerName) {
    throw new HttpsError('invalid-argument', 'Customer name is required');
  }

  const resolvedReader = await resolveReaderForDeposit(franchiseId, readerIdHint);
  const effectiveReaderId = String(resolvedReader?.readerId || readerIdHint || '').trim();
  const effectiveReaderLabel = String(resolvedReader?.readerLabel || '').trim();

  const amountLabel = (initialCents / 100).toFixed(2);
  const depositDescription = `DEPOSIT · CHF ${amountLabel}${resCode ? ` · ${resCode}` : ''}`;

  const piParams = {
    amount: initialCents,
    currency: 'chf',
    capture_method: 'manual',
    payment_method_types: ['card_present'],
    description: depositDescription,
    statement_descriptor_suffix: 'DEPOSIT',
    setup_future_usage: 'off_session',
    payment_method_options: depositCardPresentPaymentOptions(),
    'metadata[franchiseId]': franchiseId,
    'metadata[flow]': 'deposit',
    'metadata[plate]': plate,
    'metadata[customerName]': customerName,
    'metadata[customerReference]': reference,
    'metadata[resCode]': resCode,
    'metadata[resNo]': resCode,
    ...(customerEmail ? { 'metadata[customerEmail]': customerEmail } : {}),
    'metadata[maxAuthAmount]': String(maxCents),
    'metadata[source]': source === 'wheelsys' ? 'wheelsys' : 'terminal',
  };

  // Doc id first: it seeds Stripe idempotency keys so a retried request
  // cannot create a second customer or a second uncollected hold.
  const docRef = depositsCol(franchiseId).doc();

  const customerParams = {
    name: customerName,
    'metadata[franchiseId]': franchiseId,
    'metadata[resCode]': resCode,
  };
  if (customerEmail) customerParams.email = customerEmail;
  const customer = await stripeRequest('POST', '/customers', customerParams, {
    idempotencyKey: `dep-cust-${docRef.id}`,
  });
  const stripeCustomerId = customer.id;
  piParams.customer = stripeCustomerId;

  let pi = await stripeRequest('POST', '/payment_intents', piParams, {
    idempotencyKey: `dep-pi-${docRef.id}`,
  });
  pi = await ensurePaymentIntentExtendedAuthorization(pi.id, pi);
  const extendedAuthOnPi = cardPresentExtendedAuthRequested(pi);
  if (!extendedAuthOnPi) {
    console.error('[runCreateDeposit] extended authorization not set on PI', pi.id);
    await writeAudit(
      franchiseId,
      uid,
      'deposit_extended_auth_missing',
      {
        paymentIntentId: pi.id,
        resCode,
        customerName,
        stripeStatus: pi.status,
      },
      profile,
    );
  }

  await docRef.set({
    paymentIntentId: pi.id,
    stripeCustomerId,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
    currentHoldAmount: initialCents,
    currency: 'chf',
    plate,
    customerName,
    customerEmail,
    reference,
    resCode,
    readerId: effectiveReaderId,
    readerLabel: effectiveReaderLabel,
    source: source === 'wheelsys' ? 'wheelsys' : 'terminal',
    status: 'pending_collection',
    // Honest value: display code must never infer a 30-day window from a
    // request that Stripe did not actually accept onto the PI.
    extendedAuthorizationRequested: extendedAuthOnPi,
    extendedAuthorizationOnPi: extendedAuthOnPi,
    emailSubject,
    emailBodyHtml,
    emailTemplateId,
    sendEmailAfterAuth,
    documents,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await writeAudit(
    franchiseId,
    uid,
    'deposit_created',
    {
      ...depositAuditContext({ resCode, customerName, customerEmail, plate, paymentIntentId: pi.id }, { depositId: docRef.id }),
      initialAmount: initialCents,
      maxAuthAmount: maxCents,
      readerId: effectiveReaderId,
      documentCount: documents.length,
    },
    profile,
  );

  return {
    depositId: docRef.id,
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
    currency: 'chf',
    readerId: effectiveReaderId,
    extendedAuthorizationRequested: extendedAuthOnPi,
    extendedAuthorizationOnPi: extendedAuthOnPi,
  };
}

async function runListDeposits(request) {
  const { profile } = await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 300);
  const syncStripe = request.data?.syncStripe === true;

  const snap = await depositsCol(franchiseId).orderBy('createdAt', 'desc').limit(limit).get();

  const baseRows = snap.docs.map((docSnap) => ({
    docRef: docSnap.ref,
    row: docSnap.data() || {},
    mapped: mapDepositDoc(docSnap.id, docSnap.data() || {}),
  }));

  // Stripe sync runs in bounded parallel batches instead of one request per
  // row in series — 100 rows used to mean 100 sequential round-trips.
  if (syncStripe) {
    const SYNC_CONCURRENCY = 4;
    const syncRows = baseRows.filter((entry) => depositNeedsStripeSync(entry.row));
    for (let i = 0; i < syncRows.length; i += SYNC_CONCURRENCY) {
      const batch = syncRows.slice(i, i + SYNC_CONCURRENCY);
      await Promise.all(batch.map(async (entry) => {
        if (!entry.row.paymentIntentId) return;
        try {
          const pi = await stripeRequest(
            'GET',
            `/payment_intents/${encodeURIComponent(entry.row.paymentIntentId)}`,
            { expand: ['latest_charge'] },
          );
          const charge = pi.charges?.data?.[0] || (typeof pi.latest_charge === 'object' ? pi.latest_charge : null);
          const pmd = charge?.payment_method_details || {};
          const cardPresent = pmd.card_present || {};
          const card = pmd.card || {};
          const isSucceeded = pi.status === 'succeeded';
          const amountReceived = Number(pi.amount_received) || 0;
          const amountCapturable = Number(pi.amount_capturable) || 0;
          const captureBeforeRaw = captureBeforeFromCharge(charge);
          const captureBefore = depositCaptureBeforeIso(entry.row, captureBeforeRaw);
          const extendedApplied = extendedAuthAppliedFromCharge(charge);
          entry.mapped = {
            ...entry.mapped,
            stripeStatus: pi.status,
            captureBefore: captureBefore || entry.mapped.captureBefore || null,
            extendedAuthorizationApplied:
              extendedApplied || entry.mapped.extendedAuthorizationApplied || false,
            captureWindowDays: depositCaptureWindowDays(
              entry.row,
              captureBefore || entry.mapped.captureBefore || null,
            ),
            currentHoldAmount: isSucceeded
              ? amountReceived || entry.mapped.currentHoldAmount || entry.mapped.initialAmount
              : amountCapturable || entry.mapped.currentHoldAmount,
            capturedAmount: isSucceeded
              ? amountReceived || entry.mapped.capturedAmount || entry.mapped.initialAmount
              : entry.mapped.capturedAmount,
            cardBrand: cardPresent.brand || card.brand || entry.mapped.cardBrand || null,
            cardLast4: cardPresent.last4 || card.last4 || entry.mapped.cardLast4 || null,
          };
          if (pi.status === 'requires_capture') {
            entry.mapped.status = 'authorized';
            entry.mapped.stripeBucket = 'hold';
          }
          if (isSucceeded) entry.mapped.status = 'captured';
          if (pi.status === 'canceled') {
            entry.mapped.status = 'cancelled';
            const cancelReasonFromStripe =
              String(pi.cancellation_reason || '').toLowerCase() === 'expired'
                ? 'Authorization expired (Stripe auto-release) — not a staff refund'
                : entry.row.cancelReason || 'Hold cancelled';
            entry.mapped.cancelReason = cancelReasonFromStripe;
            entry.mapped.cancelledByName =
              entry.mapped.cancelledByName ||
              (String(pi.cancellation_reason || '').toLowerCase() === 'expired'
                ? 'Stripe (authorization expired)'
                : entry.mapped.cancelledByName);
          }

          const firestorePatch = {};
          if (captureBefore && captureBefore !== entry.row.captureBefore) {
            firestorePatch.captureBefore = captureBefore;
          }
          if (extendedApplied && !entry.row.extendedAuthorizationApplied) {
            firestorePatch.extendedAuthorizationApplied = true;
          }
          // Always snapshot reusable card token while we still have charge details —
          // including when the hold already expired/canceled/refunded.
          try {
            const resolved = await resolveDepositCardForReuse(
              franchiseId,
              entry.row,
              entry.row.paymentIntentId,
              pi,
            );
            firestorePatch.stripePaymentMethodId = resolved.paymentMethodId;
            firestorePatch.stripeCustomerId = resolved.customerId;
            firestorePatch.tokenSaved = true;
            entry.mapped.tokenSaved = true;
            entry.mapped.stripePaymentMethodId = resolved.paymentMethodId;
            entry.mapped.stripeCustomerId = resolved.customerId;
          } catch (tokenErr) {
            console.warn(
              '[runListDeposits] token snapshot',
              entry.docRef.id,
              tokenErr?.message || tokenErr,
            );
          }
          if (pi.status === 'requires_capture' && entry.row.status === 'pending_collection') {
            firestorePatch.status = 'authorized';
            firestorePatch.stripeStatus = pi.status;
            firestorePatch.currentHoldAmount = amountCapturable || entry.row.currentHoldAmount || entry.row.initialAmount;
            firestorePatch.terminalFailed = false;
            firestorePatch.terminalFailureMessage = '';
            firestorePatch.lastPaymentError = '';
          } else if (isSucceeded && entry.row.status !== 'captured') {
            firestorePatch.status = 'captured';
            firestorePatch.stripeStatus = pi.status;
            firestorePatch.capturedAmount = amountReceived || entry.row.capturedAmount || entry.row.initialAmount;
          } else if (pi.status === 'canceled' && entry.row.status !== 'cancelled') {
            firestorePatch.status = 'cancelled';
            firestorePatch.stripeStatus = pi.status;
            firestorePatch.cancelReason =
              String(pi.cancellation_reason || '').toLowerCase() === 'expired'
                ? 'Authorization expired (Stripe auto-release) — not a staff refund'
                : entry.row.cancelReason || 'Hold cancelled';
            if (String(pi.cancellation_reason || '').toLowerCase() === 'expired') {
              firestorePatch.cancelledByName = 'Stripe (authorization expired)';
              firestorePatch.cancelledBy = null;
            }
          } else if (pi.status === 'canceled' && entry.row.status === 'cancelled') {
            // Backfill clearer expiry reason on already-synced rows.
            if (
              String(pi.cancellation_reason || '').toLowerCase() === 'expired' &&
              !String(entry.row.cancelReason || '').toLowerCase().includes('expired')
            ) {
              firestorePatch.cancelReason =
                'Authorization expired (Stripe auto-release) — not a staff refund';
              firestorePatch.cancelledByName = 'Stripe (authorization expired)';
            }
          }
          if (Object.keys(firestorePatch).length > 0) {
            firestorePatch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
            await entry.docRef.set(firestorePatch, { merge: true });
            entry.row = { ...entry.row, ...firestorePatch };
          }
        } catch {
          /* keep firestore status */
        }
      }));
    }
  }

  const deposits = [];
  const summarySource = [];
  const actorUids = [];
  for (const entry of baseRows) {
    const row = entry.row;
    if (row.createdBy) actorUids.push(row.createdBy);
    if (row.cancelledBy) actorUids.push(row.cancelledBy);
    if (row.capturedBy) actorUids.push(row.capturedBy);
  }
  const nameByUid = await resolveUserDisplayNames(actorUids);

  for (const entry of baseRows) {
    let mapped = enrichDepositActorNames(entry.mapped, nameByUid);
    summarySource.push(mapped);
    deposits.push(mapped);
  }

  const visibility = canViewStripeFinancialTotals(profile) ? 'admin' : 'staff';
  const dailySummary = buildDailyFinancialSummary(summarySource, {
    amountField: 'currentHoldAmount',
    timeZone: CH_TIMEZONE,
  });
  if (visibility === 'staff') {
    dailySummary.volume = null;
  }
  return { deposits, timeZone: CH_TIMEZONE, visibility, dailySummary };
}

async function runIncrementDeposit(request) {
  const { uid, profile } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const newAmountChf = data.newAmountChf ?? data.totalAmountChf;

  if (!depositId) {
    throw new HttpsError('invalid-argument', 'depositId required');
  }

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();
  if (!paymentIntentId) {
    throw new HttpsError('failed-precondition', 'Missing payment intent');
  }

  const newCents = parseChfToCents(newAmountChf);
  const maxCents = Number(row.maxAuthAmount) || newCents;
  const currentCents = Number(row.currentHoldAmount || row.initialAmount) || 0;

  if (newCents <= currentCents) {
    throw new HttpsError(
      'invalid-argument',
      `New total must be greater than current hold (${(currentCents / 100).toFixed(2)} CHF)`,
    );
  }
  const customIncrease = data.customIncrease === true;
  if (!customIncrease && newCents > maxCents) {
    throw new HttpsError(
      'invalid-argument',
      `Amount exceeds maximum authorization (${(maxCents / 100).toFixed(2)} CHF)`,
    );
  }

  // Incremental authorization does NOT extend the validity window — verify the
  // hold is still live and capture_before has not passed before incrementing.
  const piBefore = await stripeRequest(
    'GET',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { expand: ['latest_charge'] },
  );
  if (piBefore.status !== 'requires_capture') {
    throw new HttpsError(
      'failed-precondition',
      `Cannot increase hold — Stripe status is "${piBefore.status}". Use Sync, then charge the saved card instead.`,
    );
  }
  const chargeBefore =
    typeof piBefore.latest_charge === 'object' ? piBefore.latest_charge : null;
  const captureBeforeIso = captureBeforeFromCharge(chargeBefore);
  if (captureBeforeIso && new Date(captureBeforeIso).getTime() <= Date.now()) {
    throw new HttpsError(
      'failed-precondition',
      'The authorization window has expired — this hold can no longer be increased. Charge the saved card instead.',
    );
  }

  // Increment targets an absolute total, so a stable key makes accidental
  // double-submits replay the same result instead of stacking increments.
  const pi = await stripeRequest(
    'POST',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}/increment_authorization`,
    { amount: newCents },
    { idempotencyKey: `inc-${paymentIntentId}-${newCents}` },
  );

  const nextMaxCents = customIncrease ? Math.max(maxCents, newCents) : maxCents;

  await docRef.set(
    {
      currentHoldAmount: Number(pi.amount_capturable) || newCents,
      maxAuthAmount: nextMaxCents,
      ...(captureBeforeIso ? { captureBefore: captureBeforeIso } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'authorized',
    },
    { merge: true },
  );

  await writeAudit(
    franchiseId,
    uid,
    'deposit_incremented',
    {
      ...depositAuditContext(row, { depositId, paymentIntentId }),
      previousAmount: currentCents,
      newAmount: newCents,
      delta: newCents - currentCents,
      customIncrease,
    },
    profile,
  );

  return {
    depositId,
    paymentIntentId: pi.id,
    amount: pi.amount,
    amountCapturable: pi.amount_capturable,
    status: pi.status,
  };
}

async function runCaptureDeposit(request) {
  const { uid, profile } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  let paymentIntentId = String(data.paymentIntentId || '').trim();
  const amountChf = data.amountChf;

  let docRef = null;
  let row = {};

  if (depositId) {
    docRef = depositsCol(franchiseId).doc(depositId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Deposit not found');
    }
    row = docSnap.data() || {};
    paymentIntentId = String(row.paymentIntentId || paymentIntentId).trim();
  } else if (paymentIntentId) {
    const q = await depositsCol(franchiseId)
      .where('paymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();
    if (!q.empty) {
      docRef = q.docs[0].ref;
      row = q.docs[0].data() || {};
    }
  } else {
    throw new HttpsError('invalid-argument', 'depositId or paymentIntentId required');
  }

  if (!paymentIntentId) {
    throw new HttpsError('failed-precondition', 'Missing payment intent');
  }

  const piBefore = await stripeRequest(
    'GET',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    {},
  );

  if (piBefore.status === 'canceled') {
    if (docRef) {
      await docRef.set(
        {
          status: 'cancelled',
          stripeStatus: 'canceled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    throw new HttpsError(
      'failed-precondition',
      'This deposit hold was already released or cancelled. Refresh the list — it cannot be captured.',
    );
  }

  if (piBefore.status === 'succeeded') {
    if (docRef) {
      await docRef.set(
        {
          status: 'captured',
          stripeStatus: 'succeeded',
          capturedAmount: piBefore.amount_received,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    }
    throw new HttpsError(
      'failed-precondition',
      'This deposit was already captured. Refresh the list.',
    );
  }

  if (piBefore.status !== 'requires_capture') {
    throw new HttpsError(
      'failed-precondition',
      `Cannot capture — Stripe status is "${piBefore.status}". Use Sync, then try again.`,
    );
  }

  const capturableCents = Number(piBefore.amount_capturable) || 0;
  const requestedCents =
    amountChf != null && amountChf !== '' ? parseChfToCents(amountChf) : null;

  // Total above the hold: capture the full hold, then charge the remainder
  // off-session from the saved card (e.g. hold 400, requested 3000 → capture
  // 400 + charge 2600).
  let topUpCents = 0;
  const params = {};
  if (requestedCents != null) {
    if (requestedCents <= capturableCents) {
      params.amount_to_capture = requestedCents;
    } else {
      topUpCents = requestedCents - capturableCents;
      if (topUpCents < 50) {
        throw new HttpsError(
          'invalid-argument',
          `Amount above the hold must be at least CHF 0.50 — hold is CHF ${(capturableCents / 100).toFixed(2)}.`,
        );
      }
    }
  }

  const pi = await stripeRequest(
    'POST',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`,
    params,
    { idempotencyKey: `cap-${paymentIntentId}-${requestedCents ?? 'full'}` },
  );

  const actor = actorFromProfile(profile, uid);

  if (docRef) {
    await docRef.set(
      {
        status: 'captured',
        stripeStatus: 'succeeded',
        capturedAmount: pi.amount_received,
        capturedBy: uid,
        capturedByName: actor.actorName,
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await writeAudit(
    franchiseId,
    uid,
    'deposit_captured',
    {
      ...depositAuditContext(row, {
        depositId: docRef?.id || depositId || null,
        paymentIntentId,
      }),
      amountReceived: pi.amount_received,
      capturedBy: actor.actorName,
      requestedTotal: requestedCents,
      topUpPlanned: topUpCents || null,
    },
    profile,
  );

  let topUpResult = null;
  let topUpError = null;
  let topUpRequiresAuthentication = false;
  let topUpClientSecret = null;
  if (topUpCents > 0) {
    try {
      const resolved = await resolveDepositCardForReuse(franchiseId, row, paymentIntentId);
      const resCode = row.resCode || row.reference || '';
      const charged = await stripeRequest('POST', '/payment_intents', {
        amount: topUpCents,
        currency: row.currency || 'chf',
        customer: resolved.customerId,
        payment_method: resolved.paymentMethodId,
        off_session: true,
        confirm: true,
        capture_method: 'automatic',
        description: `Capture top-up — ${resCode || paymentIntentId}`,
        'metadata[franchiseId]': franchiseId,
        'metadata[flow]': 'saved_token_charge',
        'metadata[parentPaymentIntentId]': paymentIntentId,
        'metadata[resCode]': resCode,
        'metadata[customerName]': row.customerName || '',
        'metadata[note]': 'capture_top_up',
      }, { idempotencyKey: `topup-${paymentIntentId}-${topUpCents}` });
      topUpResult = {
        paymentIntentId: charged.id,
        amount: charged.amount_received || topUpCents,
        status: charged.status,
      };
      await writeAudit(franchiseId, uid, 'saved_token_charge', {
        depositId,
        parentPaymentIntentId: paymentIntentId,
        paymentIntentId: charged.id,
        amountChf: topUpCents / 100,
        status: charged.status,
        via: 'capture_top_up',
      });
    } catch (e) {
      topUpError = friendlyPmReuseError(e?.message);
      topUpRequiresAuthentication = e?.details?.requiresAuthentication === true;
      topUpClientSecret = e?.details?.paymentIntentClientSecret || null;
      await writeAudit(franchiseId, uid, 'saved_token_charge_failed', {
        depositId,
        parentPaymentIntentId: paymentIntentId,
        amountChf: topUpCents / 100,
        error: topUpError,
        requiresAuthentication: topUpRequiresAuthentication,
        via: 'capture_top_up',
      });
    }
  }

  return {
    ok: true,
    status: pi.status,
    amountReceived: pi.amount_received,
    capturedAmount: pi.amount_received,
    requestedTotal: requestedCents,
    topUp: topUpResult,
    topUpAmount: topUpCents || null,
    topUpError,
    topUpRequiresAuthentication,
    topUpClientSecret,
  };
}

async function runCancelDeposit(request) {
  const { uid, profile } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const cancelReason = String(data.reason || data.cancelReason || '').trim().slice(0, 500);

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();
  const readerId = String(row.readerId || data.readerId || '').trim();

  let tokenPatch = {};
  if (paymentIntentId) {
    try {
      const pi = await stripeRequest(
        'GET',
        `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
        { expand: ['payment_method', 'latest_charge'] },
      );
      // Save reusable card for ANY terminal state we can still read a card from,
      // including already-canceled / expired holds — not only requires_capture.
      const resolved = await resolveDepositCardForReuse(franchiseId, row, paymentIntentId, pi);
      tokenPatch = {
        stripePaymentMethodId: resolved.paymentMethodId,
        stripeCustomerId: resolved.customerId,
        tokenSaved: true,
      };
    } catch (e) {
      console.warn('[runCancelDeposit] token snapshot', e?.message || e);
    }
  }

  if (readerId) {
    try {
      await stripeRequest(
        'POST',
        `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`,
        {},
      );
    } catch (e) {
      console.warn('[runCancelDeposit] cancel_action', e?.message || e);
    }
  }

  const actor = actorFromProfile(profile, uid);
  const cancelPatch = {
    status: 'cancelled',
    cancelReason: cancelReason || null,
    cancelledBy: uid,
    cancelledByName: actor.actorName,
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (!paymentIntentId) {
    await docRef.set({ ...cancelPatch, ...tokenPatch }, { merge: true });
    await writeAudit(
      franchiseId,
      uid,
      'deposit_released',
      {
        ...depositAuditContext(row, { depositId }),
        reason: cancelReason || null,
        releasedBy: actor.actorName,
      },
      profile,
    );
    return { ok: true, alreadyCancelled: true };
  }

  try {
    await stripeRequest(
      'POST',
      `/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
      {
        'cancellation_reason': 'abandoned',
      },
    );
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (!msg.includes('canceled') && !msg.includes('cancelled')) {
      throw e;
    }
  }

  await docRef.set({ ...cancelPatch, ...tokenPatch }, { merge: true });

  await writeAudit(
    franchiseId,
    uid,
    'deposit_released',
    {
      ...depositAuditContext(row, { depositId, paymentIntentId }),
      reason: cancelReason || null,
      releasedBy: actor.actorName,
    },
    profile,
  );
  return { ok: true };
}

function depositStatusFromPi(pi) {
  if (pi?.status === 'requires_capture') return 'authorized';
  if (pi?.status === 'succeeded') return 'captured';
  if (pi?.status === 'canceled') return 'cancelled';
  return 'pending_collection';
}

function rowFromPaymentIntent(pi, franchiseId) {
  const meta = pi?.metadata || {};
  const metaFranchise = String(meta.franchiseId || meta.franchise || '').trim().toUpperCase();
  if (metaFranchise && metaFranchise !== String(franchiseId || '').trim().toUpperCase()) {
    throw new HttpsError('permission-denied', 'This payment belongs to another franchise.');
  }
  const charge = pi.charges?.data?.[0] || (typeof pi.latest_charge === 'object' ? pi.latest_charge : null);
  const pmd = charge?.payment_method_details || {};
  const cardPresent = pmd.card_present || {};
  const card = pmd.card || {};
  const amountReceived = Number(pi.amount_received) || 0;
  const amountCapturable = Number(pi.amount_capturable) || 0;
  const isSucceeded = pi.status === 'succeeded';
  const captureBeforeRaw = captureBeforeFromCharge(charge);
  return {
    franchiseId,
    paymentIntentId: pi.id,
    resCode: meta.resCode || meta.resNo || meta.rescode || meta.customerReference || '',
    reference: meta.customerReference || meta.resCode || meta.resNo || '',
    customerName: meta.customerName || '',
    customerEmail: meta.customerEmail || '',
    plate: meta.plate || '',
    initialAmount: Number(pi.amount) || amountReceived,
    currentHoldAmount:
      pi.status === 'requires_capture'
        ? amountCapturable || Number(pi.amount)
        : Number(pi.amount),
    capturedAmount: isSucceeded ? amountReceived || Number(pi.amount) : null,
    currency: pi.currency || 'chf',
    status: depositStatusFromPi(pi),
    stripeStatus: pi.status,
    source: meta.source || (meta.flow === 'deposit' ? 'terminal' : 'stripe'),
    cardBrand: cardPresent.brand || card.brand || null,
    cardLast4: cardPresent.last4 || card.last4 || null,
    captureBefore: depositCaptureBeforeIso({}, captureBeforeRaw),
    extendedAuthorizationApplied: extendedAuthAppliedFromCharge(charge),
    cancelReason:
      pi.status === 'canceled' &&
      String(pi.cancellation_reason || '').toLowerCase() === 'expired'
        ? 'Authorization expired (Stripe auto-release) — not a staff refund'
        : null,
  };
}

/** Resolve Firestore deposit for saved-card charge; backfill from Stripe when missing. */
async function resolveDepositDocForCharge(franchiseId, { depositId, paymentIntentId }) {
  if (depositId) {
    const docRef = depositsCol(franchiseId).doc(depositId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Deposit not found');
    }
    return { docRef, row: docSnap.data() || {} };
  }

  const piId = String(paymentIntentId || '').trim();
  if (!piId.startsWith('pi_')) {
    throw new HttpsError('invalid-argument', 'depositId or paymentIntentId is required');
  }

  const snap = await depositsCol(franchiseId)
    .where('paymentIntentId', '==', piId)
    .limit(1)
    .get();
  if (!snap.empty) {
    return { docRef: snap.docs[0].ref, row: snap.docs[0].data() || {} };
  }

  const pi = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(piId)}`, {
    expand: ['payment_method', 'latest_charge'],
  });
  const bootstrap = rowFromPaymentIntent(pi, franchiseId);
  const docRef = depositsCol(franchiseId).doc();
  await docRef.set(
    {
      ...bootstrap,
      createdAt: pi.created
        ? admin.firestore.Timestamp.fromMillis(pi.created * 1000)
        : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      backfilledFromStripe: true,
    },
    { merge: true },
  );
  console.info('[resolveDepositDocForCharge] backfilled deposit from PI', piId, docRef.id);
  return { docRef, row: bootstrap };
}

/** Off-session charge using card saved during a prior deposit (staff+). */
async function runChargeSavedPaymentMethod(request) {
  const { uid, profile } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const paymentIntentId = String(data.paymentIntentId || '').trim();
  const amountChf = Math.round(Number(data.amountChf || 0) * 100);
  const note = String(data.note || data.description || '').trim().slice(0, 500);
  // Client-generated id (one per user action) so a network retry of the same
  // action cannot charge the card twice.
  const requestId = String(data.requestId || '').trim().replace(/[^\w-]/g, '').slice(0, 64);

  if (amountChf < 50) {
    throw new HttpsError('invalid-argument', 'Minimum charge amount is CHF 0.50');
  }
  if (amountChf > MAX_INCREMENT_CHF * 100) {
    throw new HttpsError(
      'invalid-argument',
      `Maximum off-session charge is CHF ${MAX_INCREMENT_CHF.toFixed(2)} — split larger amounts.`,
    );
  }

  let row = null;
  let docRef = null;
  try {
    ({ docRef, row } = await resolveDepositDocForCharge(franchiseId, { depositId, paymentIntentId }));
  } catch (e) {
    if (e instanceof HttpsError) throw e;
    throw new HttpsError('not-found', 'Deposit not found for PaymentIntent');
  }

  const sourcePiId = String(row.paymentIntentId || paymentIntentId || '').trim();
  if (!sourcePiId.startsWith('pi_')) {
    throw new HttpsError('failed-precondition', 'Deposit has no PaymentIntent');
  }

  const sourcePi = await stripeRequest(
    'GET',
    `/payment_intents/${encodeURIComponent(sourcePiId)}`,
    { expand: ['payment_method'] },
  );

  if (sourcePi.status === 'requires_capture') {
    const capturable = Number(sourcePi.amount_capturable) || 0;
    // Funds on hold must be captured, not re-charged (avoids double reserve /
    // false insufficient-funds). Amount above the hold is charged separately.
    const topUpCents = amountChf > capturable ? amountChf - capturable : 0;
    if (topUpCents > 0 && topUpCents < 50) {
      throw new HttpsError(
        'invalid-argument',
        `Amount above the hold must be at least CHF 0.50 — hold is CHF ${(capturable / 100).toFixed(2)}.`,
      );
    }
    const captureParams =
      amountChf < capturable && topUpCents === 0 ? { amount_to_capture: amountChf } : {};
    const captured = await stripeRequest(
      'POST',
      `/payment_intents/${encodeURIComponent(sourcePiId)}/capture`,
      captureParams,
      { idempotencyKey: `cap-${sourcePiId}-${captureParams.amount_to_capture ?? 'full'}` },
    );
    const actor = actorFromProfile(profile, uid);
    await docRef.set(
      {
        status: 'captured',
        stripeStatus: captured.status,
        capturedAmount: captured.amount_received,
        capturedBy: uid,
        capturedByName: actor.actorName,
        capturedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await writeAudit(franchiseId, uid, 'deposit_captured', {
      ...depositAuditContext(row, { depositId: docRef.id, paymentIntentId: sourcePiId }),
      amountReceived: captured.amount_received,
      capturedBy: actor.actorName,
      via: 'saved_token_charge_routed_to_capture',
      requestedTotal: amountChf,
      topUpPlanned: topUpCents || null,
    }, profile);

    let topUpResult = null;
    let topUpError = null;
    if (topUpCents > 0) {
      try {
        const resolvedTopUp = await resolveDepositCardForReuse(franchiseId, row, sourcePiId);
        const resCodeTopUp = row.resCode || row.reference || '';
        const chargedTopUp = await stripeRequest('POST', '/payment_intents', {
          amount: topUpCents,
          currency: row.currency || 'chf',
          customer: resolvedTopUp.customerId,
          payment_method: resolvedTopUp.paymentMethodId,
          off_session: true,
          confirm: true,
          capture_method: 'automatic',
          description: note || `Charge top-up — ${resCodeTopUp || sourcePiId}`,
          'metadata[franchiseId]': franchiseId,
          'metadata[flow]': 'saved_token_charge',
          'metadata[parentPaymentIntentId]': sourcePiId,
          'metadata[resCode]': resCodeTopUp,
          'metadata[customerName]': row.customerName || '',
          'metadata[note]': note || 'charge_top_up',
        }, { idempotencyKey: `topup-${sourcePiId}-${topUpCents}` });
        topUpResult = {
          paymentIntentId: chargedTopUp.id,
          amount: chargedTopUp.amount_received || topUpCents,
          status: chargedTopUp.status,
        };
        await writeAudit(franchiseId, uid, 'saved_token_charge', {
          depositId: docRef.id,
          parentPaymentIntentId: sourcePiId,
          paymentIntentId: chargedTopUp.id,
          amountChf: topUpCents / 100,
          status: chargedTopUp.status,
          via: 'charge_top_up',
        });
      } catch (e) {
        topUpError = friendlyPmReuseError(e?.message);
        await writeAudit(franchiseId, uid, 'saved_token_charge_failed', {
          depositId: docRef.id,
          parentPaymentIntentId: sourcePiId,
          amountChf: topUpCents / 100,
          error: topUpError,
          via: 'charge_top_up',
        });
      }
    }

    return {
      ok: true,
      mode: topUpCents > 0 ? 'capture_plus_charge' : 'capture',
      franchiseId,
      depositId: docRef.id,
      paymentIntentId: captured.id,
      chargedAmount: (captured.amount_received || 0) + (topUpResult?.amount || 0),
      capturedAmount: captured.amount_received,
      topUp: topUpResult,
      topUpAmount: topUpCents || null,
      topUpError,
      status: captured.status,
    };
  }

  let resolved;
  try {
    resolved = await resolveDepositCardForReuse(
      franchiseId,
      row,
      sourcePiId,
      sourcePi,
    );
  } catch (e) {
    throw new HttpsError('failed-precondition', friendlyPmReuseError(e?.message), e?.details);
  }
  const { customerId, paymentMethodId } = resolved;

  await docRef.set(
    {
      stripeCustomerId: customerId,
      stripePaymentMethodId: paymentMethodId,
      tokenSaved: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const resCode = row.resCode || row.reference || '';
  let charged;
  try {
    charged = await stripeRequest('POST', '/payment_intents', {
      amount: amountChf,
      currency: row.currency || 'chf',
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      capture_method: 'automatic',
      description: note || `Charge — ${resCode}`,
      'metadata[franchiseId]': franchiseId,
      'metadata[flow]': 'saved_token_charge',
      'metadata[parentPaymentIntentId]': sourcePiId,
      'metadata[resCode]': resCode,
      'metadata[customerName]': row.customerName || '',
      'metadata[note]': note,
    }, requestId ? { idempotencyKey: `charge-${docRef.id}-${requestId}` } : {});
  } catch (e) {
    throw new HttpsError('failed-precondition', friendlyPmReuseError(e?.message), e?.details);
  }

  await writeAudit(franchiseId, uid, 'saved_token_charge', {
    depositId: docRef.id,
    parentPaymentIntentId: sourcePiId,
    paymentIntentId: charged.id,
    amountChf: amountChf / 100,
    status: charged.status,
  });

  return {
    ok: true,
    franchiseId,
    depositId: docRef.id,
    paymentIntentId: charged.id,
    parentPaymentIntentId: sourcePiId,
    chargedAmount: charged.amount_received || amountChf,
    currency: charged.currency || row.currency || 'chf',
    status: charged.status,
  };
}

async function runCancelTerminalAction(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  let readerId = String(data.readerId || '').trim();
  if (!readerId) {
    const snap = await terminalConfigRef(franchiseId).get();
    readerId = String(snap.data()?.readerId || '').trim();
  }
  if (!readerId) {
    throw new HttpsError('failed-precondition', 'No terminal reader configured');
  }

  try {
    await stripeRequest(
      'POST',
      `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`,
      {},
    );
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (!msg.includes('no active') && !msg.includes('not found')) {
      throw new HttpsError('failed-precondition', e?.message || 'Could not cancel terminal action');
    }
  }

  const paymentIntentId = String(data.paymentIntentId || '').trim();
  if (paymentIntentId) {
    try {
      await stripeRequest(
        'POST',
        `/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
        { 'cancellation_reason': 'abandoned' },
      );
    } catch (e) {
      const msg = String(e?.message || '').toLowerCase();
      if (!msg.includes('canceled') && !msg.includes('cancelled')) {
        console.warn('[runCancelTerminalAction] PI cancel', e?.message || e);
      }
    }
  }

  await writeAudit(franchiseId, uid, 'terminal_action_cancelled', { readerId, paymentIntentId });
  return { ok: true, readerId };
}

async function runCancelPaymentHold(request) {
  const { uid } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const paymentIntentId = String(data.paymentIntentId || '').trim();
  const depositId = String(data.depositId || '').trim();
  const cancelReason = String(data.reason || data.cancelReason || '').trim().slice(0, 500);

  if (depositId) {
    return runCancelDeposit({
      auth: request.auth,
      data: { franchiseId, depositId, reason: cancelReason, readerId: data.readerId },
    });
  }

  if (!paymentIntentId) {
    throw new HttpsError('invalid-argument', 'paymentIntentId or depositId required');
  }

  const readerId = String(data.readerId || '').trim();
  if (readerId) {
    try {
      await stripeRequest(
        'POST',
        `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`,
        {},
      );
    } catch {
      /* ignore */
    }
  }

  try {
    await stripeRequest(
      'POST',
      `/payment_intents/${encodeURIComponent(paymentIntentId)}/cancel`,
      { 'cancellation_reason': 'abandoned' },
    );
  } catch (e) {
    const msg = String(e?.message || '').toLowerCase();
    if (!msg.includes('canceled') && !msg.includes('cancelled')) {
      throw e;
    }
  }

  let tokenPatch = {};
  try {
    const depSnap = await depositsCol(franchiseId)
      .where('paymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();
    if (!depSnap.empty) {
      const depRef = depSnap.docs[0].ref;
      const depRow = depSnap.docs[0].data() || {};
      const pi = await stripeRequest(
        'GET',
        `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
        { expand: ['payment_method', 'latest_charge'] },
      );
      try {
        const resolved = await resolveDepositCardForReuse(
          franchiseId,
          depRow,
          paymentIntentId,
          pi,
        );
        tokenPatch = {
          stripePaymentMethodId: resolved.paymentMethodId,
          stripeCustomerId: resolved.customerId,
          tokenSaved: true,
          status: 'cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      } catch (tokenErr) {
        console.warn('[runCancelPaymentHold] token snapshot', tokenErr?.message);
        tokenPatch = {
          status: 'cancelled',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
      }
      await depRef.set(tokenPatch, { merge: true });
    }
  } catch (lookupErr) {
    console.warn('[runCancelPaymentHold] deposit lookup', lookupErr?.message);
  }

  await writeAudit(franchiseId, uid, 'payment_hold_cancelled', {
    paymentIntentId,
    reason: cancelReason || null,
  });
  return { ok: true };
}

function describeDepositTerminalFailure({ terminalFailureMessage, lastPaymentError, declineCode }) {
  const msg = String(terminalFailureMessage || lastPaymentError || '').trim();
  if (/incremental/i.test(msg)) {
    return 'This card does not support a hold with later increase (incremental authorization). Ask the customer to try another card — usually a credit card.';
  }
  if (declineCode === 'card_not_supported') {
    return 'This card type is not supported for rental deposit holds. Try another card.';
  }
  if (declineCode === 'insufficient_funds') {
    return 'Insufficient funds on card. Try another card.';
  }
  if (msg) return msg;
  return 'Card was declined on POS. Remove the card and try another payment method.';
}

async function runGetDepositStatus(request) {
  await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  if (!depositId) {
    throw new HttpsError('invalid-argument', 'depositId required');
  }

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();
  const readerId = String(row.readerId || '').trim();

  let stripeStatus = '';
  let terminalActionStatus = '';
  let terminalFailureMessage = '';
  let terminalFailureCode = '';
  let lastPaymentError = '';
  let declineCode = '';

  if (paymentIntentId) {
    const pi = await stripeRequest(
      'GET',
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      { expand: ['latest_charge'] },
    );
    stripeStatus = pi.status || '';
    if (pi.last_payment_error) {
      lastPaymentError = String(pi.last_payment_error.message || '').trim();
      declineCode = String(pi.last_payment_error.code || '').trim();
    }
  }

  const pendingOnTerminal =
    row.status === 'pending_collection' ||
    stripeStatus === 'requires_payment_method' ||
    stripeStatus === 'requires_confirmation' ||
    stripeStatus === 'processing';

  if (readerId && pendingOnTerminal) {
    try {
      const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
      const action = reader.action || {};
      terminalActionStatus = action.status || '';
      terminalFailureMessage = String(action.failure_message || '').trim();
      terminalFailureCode = String(action.failure_code || action.type || '').trim();
      const apiError = action.process_payment_intent?.payment_intent?.last_payment_error;
      if (apiError?.message && !lastPaymentError) {
        lastPaymentError = String(apiError.message).trim();
        declineCode = String(apiError.code || '').trim();
      }
    } catch (e) {
      console.warn('[stripeTerminalDeposits] reader status', e?.message);
    }
  }

  const terminalFailed =
    terminalActionStatus === 'failed' ||
    Boolean(terminalFailureMessage) ||
    Boolean(lastPaymentError && stripeStatus === 'requires_payment_method');

  if (terminalFailed) {
    const failureSummary = describeDepositTerminalFailure({
      terminalFailureMessage,
      lastPaymentError,
      declineCode,
    });
    console.warn('[stripeTerminalDeposits] deposit terminal decline', {
      depositId,
      franchiseId,
      paymentIntentId,
      stripeStatus,
      terminalActionStatus,
      terminalFailureMessage,
      terminalFailureCode,
      lastPaymentError,
      declineCode,
    });
    if (!terminalFailureMessage && failureSummary) {
      terminalFailureMessage = failureSummary;
    }
  }

  let status = row.status || 'pending_collection';
  if (stripeStatus === 'requires_capture') status = 'authorized';
  if (stripeStatus === 'succeeded') status = 'captured';
  if (stripeStatus === 'canceled') status = 'cancelled';

  return {
    depositId,
    status,
    stripeStatus,
    paymentIntentId,
    terminalActionStatus,
    terminalFailureMessage,
    terminalFailureCode,
    lastPaymentError,
    declineCode,
    terminalFailed,
    readerId,
  };
}

function friendlyPmReuseError(raw) {
  const msg = String(raw || '');
  if (/authentication[\s_-]?required/i.test(msg)) {
    return 'The card issuer requires 3-D Secure approval for this charge — off-session retries will keep failing. Send the customer a payment link (Mail order) so they can approve it online.';
  }
  if (/without Customer attachment/i.test(msg) || /may not be used again/i.test(msg)) {
    return 'This card cannot be reused — it was not linked to a Stripe customer during the original deposit. Create a new deposit on POS; after hold + cancel the card will be chargeable.';
  }
  if (/card_present/i.test(msg) && /cannot be saved/i.test(msg)) {
    return 'Terminal card token was not converted for reuse. Create a new deposit on POS with customer linking enabled.';
  }
  return msg || 'Card charge failed';
}

async function ensureStripeCustomerForDeposit(franchiseId, row, pi) {
  const fromPi = typeof pi?.customer === 'string' ? pi.customer : pi?.customer?.id;
  if (row.stripeCustomerId) return row.stripeCustomerId;
  if (fromPi) return fromPi;
  const customerParams = {
    name: String(row.customerName || 'Customer').trim() || 'Customer',
    'metadata[franchiseId]': franchiseId,
    'metadata[resCode]': row.resCode || row.reference || '',
  };
  if (row.customerEmail) customerParams.email = row.customerEmail;
  const customer = await stripeRequest('POST', '/customers', customerParams);
  return customer.id;
}

function extractPaymentMethodIdFromPi(pi) {
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  // Terminal deposits: reusable off-session token is generated_card, not card_present on the PI.
  const generatedCard = charge?.payment_method_details?.card_present?.generated_card;
  if (generatedCard) {
    return generatedCard;
  }
  let paymentMethodId =
    typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id || null;
  if (!paymentMethodId && charge?.payment_method) {
    paymentMethodId =
      typeof charge.payment_method === 'string' ? charge.payment_method : charge.payment_method?.id;
  }
  return paymentMethodId;
}

async function resolveReusablePaymentMethodId(pi) {
  let paymentMethodId = extractPaymentMethodIdFromPi(pi);
  let charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;

  if (!paymentMethodId && typeof pi.latest_charge === 'string') {
    charge = await stripeRequest('GET', `/charges/${encodeURIComponent(pi.latest_charge)}`, null);
    paymentMethodId = charge?.payment_method_details?.card_present?.generated_card || null;
  }

  if (!paymentMethodId) {
    return null;
  }

  const pm = await stripeRequest('GET', `/payment_methods/${encodeURIComponent(paymentMethodId)}`, null);
  if (pm.type === 'card_present') {
    if (!charge && typeof pi.latest_charge === 'string') {
      charge = await stripeRequest('GET', `/charges/${encodeURIComponent(pi.latest_charge)}`, null);
    }
    const generatedCard = charge?.payment_method_details?.card_present?.generated_card;
    if (generatedCard) {
      return generatedCard;
    }
    throw new HttpsError(
      'failed-precondition',
      'Terminal card is not ready for off-session charge — complete POS authorization first.',
    );
  }

  return paymentMethodId;
}

/**
 * Ensure terminal card is attached to a Stripe Customer for off-session reuse.
 * @param {object} [piPrefetched] optional PI from caller
 */
async function resolveDepositCardForReuse(franchiseId, row, paymentIntentId, piPrefetched) {
  const storedCustomerId = String(row?.stripeCustomerId || '').trim();
  const storedPaymentMethodId = String(row?.stripePaymentMethodId || '').trim();
  if (storedCustomerId && storedPaymentMethodId) {
    try {
      await ensurePaymentMethodSavedForReuse(storedPaymentMethodId, storedCustomerId);
      return {
        customerId: storedCustomerId,
        paymentMethodId: storedPaymentMethodId,
        tokenSaved: true,
      };
    } catch (e) {
      console.warn('[resolveDepositCard] stored token verify', e?.message);
    }
  }

  const pi =
    piPrefetched ||
    (await stripeRequest('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      expand: ['payment_method', 'latest_charge'],
    }));

  const customerId = await ensureStripeCustomerForDeposit(franchiseId, row, pi);
  const piCustomer = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id;

  if (!piCustomer && customerId && ['requires_capture', 'requires_payment_method', 'canceled', 'succeeded'].includes(pi.status)) {
    try {
      await stripeRequest('POST', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
        customer: customerId,
      });
    } catch (e) {
      console.warn('[resolveDepositCard] pi customer attach', e?.message);
    }
  }

  let paymentMethodId = storedPaymentMethodId || null;
  if (!paymentMethodId) {
    paymentMethodId = await resolveReusablePaymentMethodId(pi);
  }
  if (!paymentMethodId) {
    throw new HttpsError('failed-precondition', 'No card on file for this deposit.');
  }

  await ensurePaymentMethodSavedForReuse(paymentMethodId, customerId);

  const pm = await stripeRequest('GET', `/payment_methods/${encodeURIComponent(paymentMethodId)}`, null);
  if (!pm.customer || pm.customer !== customerId) {
    throw new HttpsError(
      'failed-precondition',
      friendlyPmReuseError(
        'PaymentMethod was not attached to Customer — create a new deposit on POS.',
      ),
    );
  }

  return { customerId, paymentMethodId, tokenSaved: true };
}

async function ensurePaymentMethodSavedForReuse(paymentMethodId, stripeCustomerId) {
  if (!paymentMethodId) {
    throw new HttpsError('failed-precondition', 'No payment method on deposit');
  }
  if (!stripeCustomerId) {
    throw new HttpsError('failed-precondition', 'No Stripe customer for deposit');
  }
  try {
    await stripeRequest('POST', `/payment_methods/${encodeURIComponent(paymentMethodId)}`, {
      allow_redisplay: TERMINAL_ALLOW_REDISPLAY,
    });
  } catch (e) {
    console.warn('[stripeTerminalDeposits] pm allow_redisplay', e?.message);
  }
  try {
    await stripeRequest('POST', `/payment_methods/${encodeURIComponent(paymentMethodId)}/attach`, {
      customer: stripeCustomerId,
    });
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('already been attached') || msg.includes('already attached')) {
      const pm = await stripeRequest('GET', `/payment_methods/${encodeURIComponent(paymentMethodId)}`, null);
      if (pm.customer && pm.customer !== stripeCustomerId) {
        throw new HttpsError('failed-precondition', 'Card is linked to another customer profile.');
      }
      return true;
    }
    throw new HttpsError('failed-precondition', friendlyPmReuseError(msg));
  }
  return true;
}

/**
 * Push PaymentIntent to POS via Stripe API (no browser LAN connection required).
 */
async function runProcessDepositOnTerminal(request) {
  const { uid } = await assertMoneyCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  if (!depositId) {
    throw new HttpsError('invalid-argument', 'depositId required');
  }

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();
  if (!paymentIntentId) {
    throw new HttpsError('failed-precondition', 'Missing payment intent');
  }

  const terminalSnap = await terminalConfigRef(franchiseId).get();
  const terminalCfg = terminalSnap.exists ? terminalSnap.data() || {} : {};
  const readerHint = String(data.readerId || row.readerId || '').trim();
  const resolved = await resolveReaderForDeposit(franchiseId, readerHint);
  const readerId = String(resolved?.readerId || readerHint || terminalCfg.readerId || '').trim();
  if (!readerId) {
    throw new HttpsError('failed-precondition', 'Configure a terminal reader in Settings first.');
  }

  const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
  if (reader.status !== 'online') {
    throw new HttpsError(
      'failed-precondition',
      `POS "${reader.label || readerId}" is ${reader.status || 'offline'}. Power it on and wait until Online in Stripe.`,
    );
  }

  const pi = await ensurePaymentIntentExtendedAuthorization(
    paymentIntentId,
    await stripeRequest(
      'GET',
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      null,
    ),
  );
  if (pi.status === 'canceled') {
    throw new HttpsError('failed-precondition', 'Payment already cancelled.');
  }
  if (pi.status === 'requires_capture' || pi.status === 'succeeded') {
    return {
      ok: true,
      alreadyAuthorized: true,
      depositId,
      paymentIntentId,
      readerId,
      message: 'Card already authorized.',
    };
  }

  try {
    await stripeRequest(
      'POST',
      `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`,
      {},
    );
  } catch {
    /* clear stale reader action */
  }

  await stripeRequest(
    'POST',
    `/terminal/readers/${encodeURIComponent(readerId)}/process_payment_intent`,
    {
      payment_intent: paymentIntentId,
      process_config: { allow_redisplay: TERMINAL_ALLOW_REDISPLAY },
    },
  );

  await docRef.set(
    {
      readerId,
      readerLabel: reader.label || resolved?.readerLabel || terminalCfg.readerLabel || readerId,
      status: 'pending_collection',
      sentToTerminalAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_sent_to_terminal', {
    depositId,
    paymentIntentId,
    readerId,
    readerLabel: reader.label || resolved?.readerLabel || readerId,
    depositDescription: row.resCode || row.reference || 'deposit',
  });

  return {
    ok: true,
    depositId,
    paymentIntentId,
    readerId,
    readerLabel: reader.label || resolved?.readerLabel || terminalCfg.readerLabel || readerId,
    message: `Deposit sent to ${reader.label || 'POS'}. Customer will see DEPOSIT on terminal — ask to tap or insert card.`,
  };
}

async function runConfirmDepositCollection(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();

  const pi = await stripeRequest(
    'GET',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    { expand: ['payment_method', 'latest_charge'] },
  );

  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const status =
    pi.status === 'requires_capture' ? 'authorized' :
    pi.status === 'succeeded' ? 'captured' :
    pi.status === 'canceled' ? 'cancelled' : 'pending_collection';
  const captureBeforeRaw = captureBeforeFromCharge(charge);
  const captureBefore = depositCaptureBeforeIso(row, captureBeforeRaw);
  const extendedAuthorizationApplied = extendedAuthAppliedFromCharge(charge);
  const extendedAuthRequestedOnPi = cardPresentExtendedAuthRequested(pi);

  let tokenFields = null;
  let tokenError = null;
  if (status === 'authorized' || status === 'captured') {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        tokenFields = await snapshotDepositTokenFields(
          franchiseId,
          row,
          paymentIntentId,
          pi,
          charge,
        );
        break;
      } catch (e) {
        tokenError = e?.message || String(e);
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    }
    if (!tokenFields) {
      await writeAudit(
        franchiseId,
        uid,
        'deposit_token_save_failed',
        {
          ...depositAuditContext(row, { depositId, paymentIntentId }),
          error: friendlyPmReuseError(tokenError),
          status,
        },
        profile,
      );
      throw new HttpsError(
        'failed-precondition',
        friendlyPmReuseError(tokenError || 'Could not save card token for this deposit.'),
      );
    }
  }

  const stripeCustomerId = tokenFields?.stripeCustomerId || (await ensureStripeCustomerForDeposit(franchiseId, row, pi));
  const stripePaymentMethodId = tokenFields?.stripePaymentMethodId || row.stripePaymentMethodId || extractPaymentMethodIdFromPi(pi) || null;
  const tokenSaved = tokenFields?.tokenSaved === true || row.tokenSaved === true;

  await docRef.set(
    {
      status,
      stripeStatus: pi.status || null,
      currentHoldAmount: Number(pi.amount_capturable) || row.currentHoldAmount,
      cardBrand: tokenFields?.cardBrand || charge?.payment_method_details?.card_present?.brand || null,
      cardLast4: tokenFields?.cardLast4 || charge?.payment_method_details?.card_present?.last4 || null,
      cardholderName: tokenFields?.cardholderName || extractCardholderName(charge, pi),
      stripePaymentMethodId,
      stripeCustomerId,
      tokenSaved,
      extendedAuthorizationRequested: extendedAuthRequestedOnPi,
      extendedAuthorizationOnPi: extendedAuthRequestedOnPi,
      ...(extendedAuthorizationApplied ? { extendedAuthorizationApplied: true } : {}),
      ...(captureBefore ? { captureBefore } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(
    franchiseId,
    uid,
    'deposit_collection_confirmed',
    {
      ...depositAuditContext(row, { depositId, paymentIntentId }),
      status,
      amountCapturable: pi.amount_capturable,
      captureBefore: captureBefore || null,
      extendedAuthorizationApplied,
      extendedAuthorizationOnPi: extendedAuthRequestedOnPi,
      cardLast4: tokenFields?.cardLast4 || charge?.payment_method_details?.card_present?.last4 || null,
      tokenSaved,
    },
    profile,
  );

  let emailResult = null;
  if (status === 'authorized' && row.sendEmailAfterAuth && row.customerEmail) {
    emailResult = await sendDepositConfirmationEmail({
      franchiseId,
      toEmail: row.customerEmail,
      subject: row.emailSubject,
      html: row.emailBodyHtml,
      depositRow: { ...row, currentHoldAmount: Number(pi.amount_capturable) || row.currentHoldAmount },
      uid,
    });
    await docRef.set(
      {
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSentOk: emailResult.sent === true,
        emailSentMessage: emailResult.message || '',
      },
      { merge: true },
    );
    await writeAudit(franchiseId, uid, 'deposit_email_sent', {
      depositId,
      sent: emailResult.sent,
      message: emailResult.message,
      to: row.customerEmail,
    });
  }

  return {
    depositId,
    status,
    paymentIntentId,
    amountCapturable: pi.amount_capturable,
    cardholderName: extractCardholderName(charge, pi),
    tokenSaved,
    captureBefore: captureBefore || null,
    captureWindowDays: captureWindowDays(captureBefore),
    extendedAuthorizationRequested: extendedAuthRequestedOnPi,
    extendedAuthorizationOnPi: extendedAuthRequestedOnPi,
    extendedAuthorizationApplied,
    emailSent: emailResult?.sent === true,
    emailMessage: emailResult?.message || null,
  };
}

async function runListTerminals(request) {
  await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const readers = await loadReadersForFranchise(franchiseId);
  return { readers, franchiseId };
}

async function runUpsertTerminal(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const readerId = String(data.readerId || '').trim();
  const locationId = String(data.locationId || '').trim();
  const readerLabel = String(data.readerLabel || data.label || '').trim();
  const isDefault = data.isDefault === true;
  const terminalDocId = String(data.terminalId || data.id || '').trim();

  if (!readerId || !readerId.startsWith('tmr_')) {
    throw new HttpsError('invalid-argument', 'Reader ID must start with tmr_');
  }
  if (locationId && !locationId.startsWith('tml_')) {
    throw new HttpsError('invalid-argument', 'Location ID must start with tml_');
  }

  let docRef;
  if (terminalDocId && terminalDocId !== 'legacy') {
    docRef = terminalsCol(franchiseId).doc(terminalDocId);
  } else {
    const existing = await terminalsCol(franchiseId).where('readerId', '==', readerId).limit(1).get();
    docRef = existing.empty ? terminalsCol(franchiseId).doc() : existing.docs[0].ref;
  }

  if (isDefault) {
    const all = await terminalsCol(franchiseId).get();
    const batch = admin.firestore().batch();
    all.docs.forEach((d) => batch.update(d.ref, { isDefault: false }));
    await batch.commit();
  }

  const payload = {
    readerId,
    locationId,
    readerLabel: readerLabel || readerId,
    isDefault,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: uid,
  };
  const existingSnap = await docRef.get();
  if (!existingSnap.exists) {
    payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
    payload.createdBy = uid;
  }
  await docRef.set(payload, { merge: true });

  if (isDefault) {
    await terminalConfigRef(franchiseId).set(
      {
        readerId,
        locationId,
        readerLabel: readerLabel || readerId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: uid,
      },
      { merge: true },
    );
  }

  await writeAudit(franchiseId, uid, 'terminal_upserted', {
    terminalId: docRef.id,
    readerId,
    readerLabel,
    isDefault,
  });
  return { ok: true, terminalId: docRef.id, readerId };
}

async function runDeleteTerminal(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const terminalId = String(data.terminalId || data.id || '').trim();
  if (!terminalId || terminalId === 'legacy') {
    throw new HttpsError('invalid-argument', 'terminalId required');
  }
  const docRef = terminalsCol(franchiseId).doc(terminalId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Terminal not found');
  }
  const row = snap.data() || {};
  await docRef.delete();
  await writeAudit(franchiseId, uid, 'terminal_deleted', { terminalId, readerId: row.readerId });
  return { ok: true };
}

async function runListDepositEmailTemplates(request) {
  await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const snap = await depositEmailTemplatesCol(franchiseId).orderBy('name', 'asc').get();
  const templates = snap.docs.map((d) => {
    const row = d.data() || {};
    return {
      id: d.id,
      name: row.name || '',
      subject: row.subject || '',
      bodyHtml: row.bodyHtml || '',
      createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
      updatedAt: row.updatedAt?.toDate?.()?.toISOString?.() || null,
    };
  });
  return { templates };
}

async function runSaveDepositEmailTemplate(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const name = String(data.name || '').trim();
  const subject = String(data.subject || '').trim();
  const bodyHtml = String(data.bodyHtml || data.body || '').trim();
  const templateId = String(data.templateId || data.id || '').trim();

  if (!name) {
    throw new HttpsError('invalid-argument', 'Template name required');
  }
  if (!subject || !bodyHtml) {
    throw new HttpsError('invalid-argument', 'Subject and HTML body required');
  }

  const docRef = templateId
    ? depositEmailTemplatesCol(franchiseId).doc(templateId)
    : depositEmailTemplatesCol(franchiseId).doc();
  const existing = await docRef.get();
  await docRef.set(
    {
      name,
      subject,
      bodyHtml,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: uid,
      ...(existing.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: uid }),
    },
    { merge: true },
  );
  await writeAudit(franchiseId, uid, 'deposit_email_template_saved', { templateId: docRef.id, name });
  return { ok: true, templateId: docRef.id };
}

async function runDeleteDepositEmailTemplate(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const templateId = String(data.templateId || data.id || '').trim();
  if (!templateId) {
    throw new HttpsError('invalid-argument', 'templateId required');
  }
  await depositEmailTemplatesCol(franchiseId).doc(templateId).delete();
  await writeAudit(franchiseId, uid, 'deposit_email_template_deleted', { templateId });
  return { ok: true };
}

async function runAttachDepositDocuments(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const documents = Array.isArray(data.documents) ? data.documents.slice(0, 50) : [];
  if (!depositId) {
    throw new HttpsError('invalid-argument', 'depositId required');
  }
  const docRef = depositsCol(franchiseId).doc(depositId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const existing = Array.isArray(snap.data()?.documents) ? snap.data().documents : [];
  const merged = [...existing, ...documents].slice(0, 50);
  await docRef.set(
    {
      documents: merged,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  await writeAudit(franchiseId, uid, 'deposit_documents_attached', {
    depositId,
    added: documents.length,
    total: merged.length,
  });
  return { ok: true, documentCount: merged.length };
}

async function runSendDepositEmail(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  if (!depositId) {
    throw new HttpsError('invalid-argument', 'depositId required');
  }
  const docRef = depositsCol(franchiseId).doc(depositId);
  const snap = await docRef.get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = snap.data() || {};
  const emailResult = await sendDepositConfirmationEmail({
    franchiseId,
    toEmail: data.toEmail || row.customerEmail,
    subject: data.subject || row.emailSubject,
    html: data.bodyHtml || row.emailBodyHtml,
    depositRow: row,
    uid,
  });
  await docRef.set(
    {
      emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      emailSentOk: emailResult.sent === true,
      emailSentMessage: emailResult.message || '',
    },
    { merge: true },
  );
  await writeAudit(franchiseId, uid, 'deposit_email_sent', {
    depositId,
    sent: emailResult.sent,
    message: emailResult.message,
    manual: true,
  });
  if (!emailResult.sent) {
    throw new HttpsError('failed-precondition', emailResult.message || 'Email not sent');
  }
  return { ok: true, message: emailResult.message };
}

function depositInputTestsCol(franchiseId) {
  return admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('stripeDepositInputTests');
}

/** Stripe Terminal collect_inputs — signature + phone (deposit test flow only). */
function buildDepositTerminalCollectInputsPayload(sessionMeta = {}) {
  return {
    inputs: [
      {
        type: 'signature',
        custom_text: {
          title: 'Rental Agreement',
          description: 'Please sign below to agree to the deposit hold terms.',
          submit_button: 'Submit',
        },
        required: true,
      },
      {
        type: 'phone',
        custom_text: {
          title: 'Enter your phone',
          description: 'We may contact you about this rental deposit.',
          submit_button: 'Submit',
        },
        required: true,
      },
    ],
    metadata: {
      flow: 'deposit_collect_inputs_test',
      franchiseId: String(sessionMeta.franchiseId || ''),
      sessionId: String(sessionMeta.sessionId || ''),
      resCode: String(sessionMeta.resCode || ''),
    },
  };
}

function extractCollectedInputValue(item) {
  if (!item || typeof item !== 'object') return '';
  const direct = String(item.value || '').trim();
  if (direct) return direct;
  const type = String(item.type || '').trim();
  const typed = item[type]?.value;
  if (typed != null && String(typed).trim()) return String(typed).trim();
  for (const key of ['phone', 'signature', 'email', 'text', 'numeric', 'selection']) {
    const nested = item[key]?.value;
    if (nested != null && String(nested).trim()) return String(nested).trim();
  }
  return '';
}

function normalizeCollectedTerminalInputs(reader) {
  const action = reader?.action || {};
  if (action.type !== 'collect_inputs') {
    return {
      actionType: action.type || null,
      actionStatus: action.status || null,
      collected: [],
      failed: action.status === 'failed',
      failureMessage: String(action.failure_message || action.failure_code || '').trim(),
    };
  }
  const rawList =
    action.collect_inputs?.inputs ||
    action.collect_inputs?.collected_inputs ||
    [];
  const collected = (Array.isArray(rawList) ? rawList : []).map((item) => ({
    type: String(item?.type || ''),
    value: extractCollectedInputValue(item),
    skipped: item?.skipped === true,
    toggles: Array.isArray(item?.toggles) ? item.toggles : [],
  }));
  return {
    actionType: 'collect_inputs',
    actionStatus: action.status || '',
    collected,
    failed: action.status === 'failed',
    failureMessage: String(action.failure_message || action.failure_code || '').trim(),
  };
}

async function downloadStripeSignatureSvg(fileId) {
  if (!fileId) return null;
  const file = await stripeRequest('GET', `/files/${encodeURIComponent(fileId)}`, null);
  const url = file?.url;
  if (!url) return null;
  const secret = getStripeSecretKey();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${secret}` } });
  if (!res.ok) return null;
  const text = await res.text();
  return text.slice(0, 500000);
}

/**
 * Start POS collect_inputs test (signature + phone + email on WisePOS E / S700).
 * https://docs.stripe.com/terminal/features/collect-inputs
 */
async function runStartDepositCollectInputsTest(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const readerHint = String(data.readerId || '').trim();
  const resolved = await resolveReaderForDeposit(franchiseId, readerHint);
  const readerId = String(resolved?.readerId || readerHint || '').trim();
  if (!readerId) {
    throw new HttpsError('failed-precondition', 'Select a POS terminal first.');
  }

  const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
  if (reader.status !== 'online') {
    throw new HttpsError(
      'failed-precondition',
      `POS "${reader.label || readerId}" is ${reader.status || 'offline'}.`,
    );
  }

  const sessionRef = depositInputTestsCol(franchiseId).doc();
  const sessionId = sessionRef.id;
  const resCodeRaw = String(data.resCode || '').trim();
  const resCode = normalizeResCode(resCodeRaw) || resCodeRaw;
  if (!resCode) {
    throw new HttpsError('invalid-argument', 'RES code is required');
  }
  const sessionMeta = {
    franchiseId,
    sessionId,
    resCode,
  };

  await sessionRef.set({
    resCode,
    readerId,
    readerLabel: reader.label || '',
    status: 'starting',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
    createdByName: profile?.name || profile?.displayName || null,
  });

  try {
    await stripeRequest('POST', `/terminal/readers/${encodeURIComponent(readerId)}/cancel_action`, {});
  } catch {
    /* clear stale reader action */
  }

  const payload = buildDepositTerminalCollectInputsPayload(sessionMeta);
  await stripeRequest(
    'POST',
    `/terminal/readers/${encodeURIComponent(readerId)}/collect_inputs`,
    payload,
  );

  await sessionRef.set(
    { status: 'in_progress', updatedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true },
  );
  await writeAudit(franchiseId, uid, 'deposit_collect_inputs_test_started', {
    sessionId,
    readerId,
    resCode: sessionMeta.resCode,
  }, profile);

  return {
    ok: true,
    sessionId,
    readerId,
    readerLabel: reader.label || readerId,
    message: 'POS is collecting signature and phone from the customer.',
  };
}

/** Poll POS collect_inputs test session until succeeded / failed. */
async function runPollDepositCollectInputsTest(request) {
  await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const sessionId = String(data.sessionId || '').trim();
  const readerId = String(data.readerId || '').trim();
  if (!sessionId || !readerId) {
    throw new HttpsError('invalid-argument', 'sessionId and readerId required');
  }

  const sessionRef = depositInputTestsCol(franchiseId).doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new HttpsError('not-found', 'Test session not found');
  }
  const row = sessionSnap.data() || {};

  const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
  const parsed = normalizeCollectedTerminalInputs(reader);

  if (parsed.actionStatus === 'in_progress') {
    return {
      status: 'in_progress',
      sessionId,
      message: 'Waiting for customer on POS…',
    };
  }

  if (parsed.failed) {
    await sessionRef.set(
      {
        status: 'failed',
        posFailureMessage: parsed.failureMessage || 'POS input collection failed',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return {
      status: 'failed',
      sessionId,
      message: parsed.failureMessage || 'POS input collection failed or timed out (2 min).',
    };
  }

  if (parsed.actionStatus !== 'succeeded' || parsed.actionType !== 'collect_inputs') {
    return {
      status: parsed.actionStatus || 'waiting',
      sessionId,
      message: 'POS action not complete yet.',
    };
  }

  const posPhone = parsed.collected.find((i) => i.type === 'phone')?.value || '';
  const sigFileId = parsed.collected.find((i) => i.type === 'signature')?.value || '';
  if (!posPhone && !sigFileId) {
    return {
      status: 'in_progress',
      sessionId,
      message: 'Waiting for POS signature and phone…',
    };
  }
  let posSignatureSvg = null;
  if (sigFileId) {
    try {
      posSignatureSvg = await downloadStripeSignatureSvg(sigFileId);
    } catch (e) {
      console.warn('[pollCollectInputs] signature download', e?.message);
    }
  }

  await sessionRef.set(
    {
      status: 'succeeded',
      posPhone,
      posSignatureFileId: sigFileId || null,
      posSignatureSvg: posSignatureSvg || null,
      posCollected: parsed.collected,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  return {
    status: 'succeeded',
    sessionId,
    resCode: row.resCode || '',
    posPhone,
    posSignatureFileId: sigFileId || null,
    posSignatureSvg: posSignatureSvg || null,
    collected: parsed.collected,
    message: 'POS collected signature and phone.',
  };
}

/**
 * Scheduled safety net: refresh open deposit holds from Stripe so expired or
 * externally captured/cancelled authorizations surface even when nobody opens
 * the deposits list (no webhook fired or webhook not yet configured).
 */
async function syncOpenDepositsSweep({ maxPerFranchise = 100 } = {}) {
  const db = admin.firestore();
  const franchiseRefs = await db.collection('franchises').listDocuments();
  const summary = { franchises: 0, checked: 0, updated: 0 };
  for (const fRef of franchiseRefs) {
    if (!/^CH/i.test(fRef.id)) continue;
    summary.franchises += 1;
    let snap;
    try {
      snap = await depositsCol(fRef.id)
        .where('status', 'in', ['pending_collection', 'authorized'])
        .limit(maxPerFranchise)
        .get();
    } catch (e) {
      console.warn('[depositSweep] query', fRef.id, e?.message);
      continue;
    }
    for (const docSnap of snap.docs) {
      const row = docSnap.data() || {};
      const piId = String(row.paymentIntentId || '').trim();
      if (!piId.startsWith('pi_')) continue;
      summary.checked += 1;
      try {
        const pi = await stripeRequest(
          'GET',
          `/payment_intents/${encodeURIComponent(piId)}`,
          { expand: ['latest_charge'] },
        );
        const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const patch = {};
        if (pi.status !== row.stripeStatus) patch.stripeStatus = pi.status;
        const captureBeforeIso = captureBeforeFromCharge(charge);
        if (captureBeforeIso && captureBeforeIso !== row.captureBefore) {
          patch.captureBefore = captureBeforeIso;
        }
        if (extendedAuthAppliedFromCharge(charge) && !row.extendedAuthorizationApplied) {
          patch.extendedAuthorizationApplied = true;
        }
        if (pi.status === 'requires_capture' && row.status !== 'authorized') {
          patch.status = 'authorized';
          patch.currentHoldAmount =
            Number(pi.amount_capturable) || row.currentHoldAmount || row.initialAmount || 0;
        } else if (pi.status === 'succeeded' && row.status !== 'captured') {
          patch.status = 'captured';
          patch.capturedAmount = Number(pi.amount_received) || row.capturedAmount || null;
        } else if (pi.status === 'canceled' && row.status !== 'cancelled') {
          patch.status = 'cancelled';
          if (String(pi.cancellation_reason || '').toLowerCase() === 'expired') {
            patch.cancelReason = 'Authorization expired (Stripe auto-release) — not a staff refund';
            patch.cancelledByName = 'Stripe (authorization expired)';
          }
        }
        if (Object.keys(patch).length > 0) {
          patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
          await docSnap.ref.set(patch, { merge: true });
          summary.updated += 1;
        }
      } catch (e) {
        console.warn('[depositSweep] pi sync', fRef.id, docSnap.id, e?.message);
      }
    }
  }
  console.info('[depositSweep] done', JSON.stringify(summary));
  return summary;
}

const callableOpts = { cors: true, secrets: [stripeCHSecretKey] };

module.exports = {
  callableOpts,
  runGetTerminalConfig,
  runSaveTerminalConfig,
  runTestTerminalConnection,
  runCreateTerminalConnectionToken,
  runListTerminals,
  runUpsertTerminal,
  runDeleteTerminal,
  runListDepositEmailTemplates,
  runSaveDepositEmailTemplate,
  runDeleteDepositEmailTemplate,
  runAttachDepositDocuments,
  runSendDepositEmail,
  runCreateDeposit,
  runListDeposits,
  runIncrementDeposit,
  runCaptureDeposit,
  runCancelDeposit,
  runChargeSavedPaymentMethod,
  runCancelTerminalAction,
  runCancelPaymentHold,
  runGetDepositStatus,
  runProcessDepositOnTerminal,
  runConfirmDepositCollection,
  runStartDepositCollectInputsTest,
  runPollDepositCollectInputsTest,
  syncOpenDepositsSweep,
  extractCardholderName,
  // Shared with the webhook module — single source for Stripe REST + hold parsing.
  stripeRequest,
  captureBeforeFromCharge,
  extendedAuthAppliedFromCharge,
};
