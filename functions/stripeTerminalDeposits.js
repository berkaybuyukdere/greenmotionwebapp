/**
 * Stripe Terminal deposits — manual capture + incremental authorization (CH car rental).
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const stripeCHSecretKey = defineSecret('STRIPE_CH_SECRET_KEY');

const FINANCIAL_ROLES = new Set(['globaladmin', 'superadmin', 'admin', 'manager']);
const CH_TIMEZONE = 'Europe/Zurich';
const MAX_DEPOSIT_CHF = 5000;
const MAX_INCREMENT_CHF = 10000;

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
  if (!FINANCIAL_ROLES.has(role)) {
    throw new HttpsError('permission-denied', 'Financial access required.');
  }
  return { uid: request.auth.uid, profile };
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
    source: row.source || 'terminal',
    status: row.status || 'pending_collection',
    readerId: row.readerId || '',
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

  return {
    franchiseId,
    publishableKey,
    mode,
    secretConfigured: Boolean(getStripeSecretKey()),
    readerId: String(terminal.readerId || '').trim(),
    locationId: String(terminal.locationId || '').trim(),
    readerLabel: String(terminal.readerLabel || '').trim(),
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
  const readerId = String(cfg.readerId || request.data?.readerId || '').trim();
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
    : parseChfToCents(MAX_INCREMENT_CHF);
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
  const reference = String(data.reference || '').trim();
  const readerId = String(data.readerId || '').trim();
  const source = String(data.source || 'terminal').trim().toLowerCase();

  if (!customerName) {
    throw new HttpsError('invalid-argument', 'Customer name is required');
  }

  const terminalSnap = await terminalConfigRef(franchiseId).get();
  const terminalCfg = terminalSnap.exists ? terminalSnap.data() || {} : {};
  const effectiveReaderId = readerId || String(terminalCfg.readerId || '').trim();

  const pi = await stripeRequest('POST', '/payment_intents', {
    amount: initialCents,
    currency: 'chf',
    capture_method: 'manual',
    payment_method_types: ['card_present'],
    description: `Deposit · ${plate || reference || customerName}`,
    'metadata[franchiseId]': franchiseId,
    'metadata[flow]': 'deposit',
    'metadata[plate]': plate,
    'metadata[customerName]': customerName,
    'metadata[customerReference]': reference,
    'metadata[maxAuthAmount]': String(maxCents),
    'metadata[source]': source === 'wheelsys' ? 'wheelsys' : 'terminal',
    'payment_method_options[card_present][request_incremental_authorization_support]': 'true',
  });

  const docRef = depositsCol(franchiseId).doc();
  await docRef.set({
    paymentIntentId: pi.id,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
    currentHoldAmount: initialCents,
    currency: 'chf',
    plate,
    customerName,
    customerEmail,
    reference,
    readerId: effectiveReaderId,
    source: source === 'wheelsys' ? 'wheelsys' : 'terminal',
    status: 'pending_collection',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: uid,
  });

  await writeAudit(franchiseId, uid, 'deposit_created', {
    depositId: docRef.id,
    paymentIntentId: pi.id,
    initialAmount: initialCents,
    maxAuthAmount: maxCents,
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
  await assertFinancialCallable(request);
  const franchiseId = normalizeFranchiseId(request.data?.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 50, 1), 100);

  const snap = await depositsCol(franchiseId).orderBy('createdAt', 'desc').limit(limit).get();
  const deposits = [];

  for (const docSnap of snap.docs) {
    const row = docSnap.data() || {};
    let mapped = mapDepositDoc(docSnap.id, row);
    if (row.paymentIntentId) {
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
    deposits.push(mapped);
  }

  return { deposits, timeZone: CH_TIMEZONE };
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
    newAmount: newCents,
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

  if (paymentIntentId) {
    const pi = await stripeRequest(
      'GET',
      `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
      null,
    );
    stripeStatus = pi.status || '';
  }

  if (readerId && stripeStatus === 'requires_payment_method') {
    try {
      const reader = await stripeRequest('GET', `/terminal/readers/${encodeURIComponent(readerId)}`, null);
      terminalActionStatus = reader.action?.status || '';
      terminalFailureMessage = String(reader.action?.failure_message || '').trim();
    } catch {
      /* ignore */
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
    readerId,
  };
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
  const readerId = String(row.readerId || terminalCfg.readerId || '').trim();
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
    { payment_intent: paymentIntentId },
  );

  await docRef.set(
    {
      readerId,
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
  });

  return {
    ok: true,
    depositId,
    paymentIntentId,
    readerId,
    readerLabel: reader.label || terminalCfg.readerLabel || readerId,
    message: `Sent to ${reader.label || 'POS'}. Ask customer to tap or insert card.`,
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
    { expand: ['latest_charge'] },
  );

  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const status =
    pi.status === 'requires_capture' ? 'authorized' :
    pi.status === 'succeeded' ? 'captured' :
    pi.status === 'canceled' ? 'cancelled' : 'pending_collection';

  await docRef.set(
    {
      status,
      currentHoldAmount: Number(pi.amount_capturable) || row.currentHoldAmount,
      cardBrand: charge?.payment_method_details?.card_present?.brand || null,
      cardLast4: charge?.payment_method_details?.card_present?.last4 || null,
      cardholderName: extractCardholderName(charge, pi),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'deposit_collection_confirmed', {
    depositId,
    paymentIntentId,
    status,
  });

  return {
    depositId,
    status,
    paymentIntentId,
    amountCapturable: pi.amount_capturable,
    cardholderName: extractCardholderName(charge, pi),
  };
}

const callableOpts = { cors: true, secrets: [stripeCHSecretKey] };

module.exports = {
  callableOpts,
  runGetTerminalConfig,
  runSaveTerminalConfig,
  runTestTerminalConnection,
  runCreateTerminalConnectionToken,
  runCreateDeposit,
  runListDeposits,
  runIncrementDeposit,
  runCaptureDeposit,
  runCancelDeposit,
  runCancelTerminalAction,
  runCancelPaymentHold,
  runGetDepositStatus,
  runProcessDepositOnTerminal,
  runConfirmDepositCollection,
  extractCardholderName,
};
