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
]);
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

async function stripeRequest(method, path, params = null) {
  const secret = getStripeSecretKey();
  const url = `https://api.stripe.com/v1${path}`;
  const init = {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
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

async function parseStripeResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpsError('internal', `Stripe invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    throw new HttpsError('failed-precondition', data?.error?.message || `Stripe ${res.status}`);
  }
  return data;
}

function normalizeRoleKey(role) {
  return String(role || '').toLowerCase().trim().replace(/[\s_-]+/g, '');
}

async function assertFinancialCallable(request) {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const snap = await admin.firestore().collection('users').doc(request.auth.uid).get();
  if (!snap.exists) {
    throw new HttpsError('permission-denied', 'User profile missing');
  }
  const profile = snap.data() || {};
  const role = normalizeRoleKey(profile.role);
  if (!STRIPE_FINANCE_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Stripe finance access required.');
  }
  return { uid: request.auth.uid, profile };
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

async function writeAudit(franchiseId, uid, action, detail = {}) {
  try {
    await admin
      .firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeFinancialAudit')
      .add({
        action,
        detail,
        uid,
        franchiseId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
  } catch (e) {
    console.warn('[stripeTerminalDeposits] audit', e?.message);
  }
}

function mapDepositDoc(id, row) {
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
    tokenSaved: row.tokenSaved === true,
    stripeCustomerId: row.stripeCustomerId || null,
    stripePaymentMethodId: row.stripePaymentMethodId || null,
    createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
    updatedAt: row.updatedAt?.toDate?.()?.toISOString?.() || null,
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
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const initialCents = parseChfToCents(data.initialAmountChf);
  const maxCents = data.maxAuthAmountChf != null && data.maxAuthAmountChf !== ''
    ? parseChfToCents(data.maxAuthAmountChf)
    : parseChfToCents(DEFAULT_MAX_AUTH_CHF);
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
    'metadata[franchiseId]': franchiseId,
    'metadata[flow]': 'deposit',
    'metadata[plate]': plate,
    'metadata[customerName]': customerName,
    'metadata[customerReference]': reference,
    'metadata[resCode]': resCode,
    'metadata[maxAuthAmount]': String(maxCents),
    'metadata[source]': source === 'wheelsys' ? 'wheelsys' : 'terminal',
    'payment_method_options[card_present][request_incremental_authorization_support]': 'true',
  };

  const customerParams = {
    name: customerName,
    'metadata[franchiseId]': franchiseId,
    'metadata[resCode]': resCode,
  };
  if (customerEmail) customerParams.email = customerEmail;
  const customer = await stripeRequest('POST', '/customers', customerParams);
  const stripeCustomerId = customer.id;
  piParams.customer = stripeCustomerId;

  const pi = await stripeRequest('POST', '/payment_intents', piParams);

  const docRef = depositsCol(franchiseId).doc();
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
    emailSubject,
    emailBodyHtml,
    emailTemplateId,
    sendEmailAfterAuth,
    documents,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await writeAudit(franchiseId, uid, 'deposit_created', {
    depositId: docRef.id,
    paymentIntentId: pi.id,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
    resCode,
    readerId: effectiveReaderId,
    customerEmail: customerEmail || null,
    documentCount: documents.length,
  });

  return {
    depositId: docRef.id,
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
    currency: 'chf',
    readerId: effectiveReaderId,
  };
}

async function runListDeposits(request) {
  const { profile } = await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 100);
  const syncStripe = request.data?.syncStripe === true;

  const snap = await depositsCol(franchiseId).orderBy('createdAt', 'desc').limit(limit).get();
  const deposits = [];
  const summarySource = [];

  for (const docSnap of snap.docs) {
    const row = docSnap.data() || {};
    let mapped = mapDepositDoc(docSnap.id, row);
    if (syncStripe && row.paymentIntentId) {
      try {
        const pi = await stripeRequest(
          'GET',
          `/payment_intents/${encodeURIComponent(row.paymentIntentId)}`,
          null,
        );
        mapped = {
          ...mapped,
          stripeStatus: pi.status,
          currentHoldAmount: Number(pi.amount_capturable) || mapped.currentHoldAmount,
          cardBrand: pi.charges?.data?.[0]?.payment_method_details?.card_present?.brand || null,
          cardLast4: pi.charges?.data?.[0]?.payment_method_details?.card_present?.last4 || null,
        };
        if (pi.status === 'requires_capture') mapped.status = 'authorized';
        if (pi.status === 'succeeded') mapped.status = 'captured';
        if (pi.status === 'canceled') mapped.status = 'cancelled';
      } catch {
        /* keep firestore status */
      }
    }
    summarySource.push(mapped);
    if (!canViewStripeFinancialTotals(profile)) {
      mapped = {
        ...mapped,
        initialAmount: null,
        maxAuthAmount: null,
        currentHoldAmount: null,
        capturedAmount: null,
      };
    }
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
  const { uid } = await assertFinancialCallable(request);
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
  if (newCents > maxCents) {
    throw new HttpsError(
      'invalid-argument',
      `Amount exceeds maximum authorization (${(maxCents / 100).toFixed(2)} CHF)`,
    );
  }

  const pi = await stripeRequest(
    'POST',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}/increment_authorization`,
    { amount: newCents },
  );

  await docRef.set(
    {
      currentHoldAmount: Number(pi.amount_capturable) || newCents,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'authorized',
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_incremented', {
    depositId,
    paymentIntentId,
    previousAmount: currentCents,
    newAmount: newCents,
    delta: newCents - currentCents,
  });

  return {
    depositId,
    paymentIntentId: pi.id,
    amount: pi.amount,
    amountCapturable: pi.amount_capturable,
    status: pi.status,
  };
}

async function runCaptureDeposit(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const amountChf = data.amountChf;

  const docRef = depositsCol(franchiseId).doc(depositId);
  const docSnap = await docRef.get();
  if (!docSnap.exists) {
    throw new HttpsError('not-found', 'Deposit not found');
  }
  const row = docSnap.data() || {};
  const paymentIntentId = String(row.paymentIntentId || '').trim();

  const params = {};
  if (amountChf != null && amountChf !== '') {
    params.amount_to_capture = parseChfToCents(amountChf);
  }

  const pi = await stripeRequest(
    'POST',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}/capture`,
    params,
  );

  await docRef.set(
    {
      status: 'captured',
      capturedAmount: pi.amount_received,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_captured', { depositId, paymentIntentId });
  return { ok: true, status: pi.status, amountReceived: pi.amount_received };
}

async function runCancelDeposit(request) {
  const { uid } = await assertFinancialCallable(request);
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
      if (pi.status === 'requires_capture') {
        const resolved = await resolveDepositCardForReuse(franchiseId, row, paymentIntentId, pi);
        tokenPatch = {
          stripePaymentMethodId: resolved.paymentMethodId,
          stripeCustomerId: resolved.customerId,
          tokenSaved: true,
        };
      }
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

  if (!paymentIntentId) {
    await docRef.set(
      {
        status: 'cancelled',
        cancelReason: cancelReason || null,
        cancelledBy: uid,
        cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
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

  await docRef.set(
    {
      status: 'cancelled',
      cancelReason: cancelReason || null,
      cancelledBy: uid,
      cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...tokenPatch,
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_cancelled', {
    depositId,
    paymentIntentId,
    reason: cancelReason || null,
  });
  return { ok: true };
}

/** Off-session charge using card saved during a prior deposit (admin+). */
async function runChargeSavedPaymentMethod(request) {
  const { uid } = await assertFinancialAdminCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const depositId = String(data.depositId || '').trim();
  const paymentIntentId = String(data.paymentIntentId || '').trim();
  const amountChf = Math.round(Number(data.amountChf || 0) * 100);
  const note = String(data.note || data.description || '').trim().slice(0, 500);

  if (amountChf < 50) {
    throw new HttpsError('invalid-argument', 'Minimum charge amount is CHF 0.50');
  }

  let row = null;
  let docRef = null;
  if (depositId) {
    docRef = depositsCol(franchiseId).doc(depositId);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Deposit not found');
    }
    row = docSnap.data() || {};
  } else if (paymentIntentId.startsWith('pi_')) {
    const snap = await depositsCol(franchiseId)
      .where('paymentIntentId', '==', paymentIntentId)
      .limit(1)
      .get();
    if (snap.empty) {
      throw new HttpsError('not-found', 'Deposit not found for PaymentIntent');
    }
    docRef = snap.docs[0].ref;
    row = snap.docs[0].data() || {};
  } else {
    throw new HttpsError('invalid-argument', 'depositId or paymentIntentId is required');
  }

  const sourcePiId = String(row.paymentIntentId || paymentIntentId || '').trim();
  if (!sourcePiId.startsWith('pi_')) {
    throw new HttpsError('failed-precondition', 'Deposit has no PaymentIntent');
  }

  let resolved;
  try {
    resolved = await resolveDepositCardForReuse(franchiseId, row, sourcePiId);
  } catch (e) {
    throw new HttpsError('failed-precondition', friendlyPmReuseError(e?.message));
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
    });
  } catch (e) {
    throw new HttpsError('failed-precondition', friendlyPmReuseError(e?.message));
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
  const { uid } = await assertFinancialCallable(request);
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
  const pi =
    piPrefetched ||
    (await stripeRequest('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
      expand: ['payment_method', 'latest_charge'],
    }));

  const customerId = await ensureStripeCustomerForDeposit(franchiseId, row, pi);
  const piCustomer = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id;

  if (!piCustomer && customerId && ['requires_capture', 'requires_payment_method'].includes(pi.status)) {
    try {
      await stripeRequest('POST', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {
        customer: customerId,
      });
    } catch (e) {
      console.warn('[resolveDepositCard] pi customer attach', e?.message);
    }
  }

  const paymentMethodId = await resolveReusablePaymentMethodId(pi);
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
  const { uid } = await assertFinancialCallable(request);
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

  const pi = await stripeRequest(
    'GET',
    `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    null,
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
  const { uid } = await assertFinancialCallable(request);
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

  const paymentMethodId = extractPaymentMethodIdFromPi(pi);
  let stripeCustomerId = await ensureStripeCustomerForDeposit(franchiseId, row, pi);
  let stripePaymentMethodId = paymentMethodId;
  let tokenSaved = false;
  if (paymentMethodId && status === 'authorized') {
    try {
      const resolved = await resolveDepositCardForReuse(franchiseId, row, paymentIntentId, pi);
      stripeCustomerId = resolved.customerId;
      stripePaymentMethodId = resolved.paymentMethodId;
      tokenSaved = true;
    } catch (e) {
      console.warn('[runConfirmDepositCollection] card reuse', e?.message);
    }
  }

  await docRef.set(
    {
      status,
      currentHoldAmount: Number(pi.amount_capturable) || row.currentHoldAmount,
      cardBrand: charge?.payment_method_details?.card_present?.brand || null,
      cardLast4: charge?.payment_method_details?.card_present?.last4 || null,
      cardholderName: extractCardholderName(charge, pi),
      stripePaymentMethodId,
      stripeCustomerId,
      tokenSaved,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_collection_confirmed', {
    depositId,
    paymentIntentId,
    status,
    amountCapturable: pi.amount_capturable,
    cardLast4: charge?.payment_method_details?.card_present?.last4 || null,
  });

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
  extractCardholderName,
};
