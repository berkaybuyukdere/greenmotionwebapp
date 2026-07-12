/**
 * Stripe webhook (CH account) — pushes PaymentIntent / charge lifecycle into
 * Firestore so deposit holds and mail orders stay correct without anyone
 * opening the list (expired holds, off-session failures, external refunds).
 *
 * Setup:
 *   1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *      URL: https://<region>-<project>.cloudfunctions.net/stripeFinancialWebhook
 *      Events: payment_intent.amount_capturable_updated, payment_intent.succeeded,
 *              payment_intent.payment_failed, payment_intent.canceled,
 *              charge.refunded
 *   2. Put the signing secret in functions env: STRIPE_CH_WEBHOOK_SECRET=whsec_…
 *      (functions/.env or Cloud Run env). Without it the endpoint answers 503
 *      and does nothing — deploys never break on a missing secret.
 */
const crypto = require('crypto');
const admin = require('firebase-admin');
const {
  stripeRequest,
  captureBeforeFromCharge,
  extendedAuthAppliedFromCharge,
} = require('./stripeTerminalDeposits');
const { recordOfficeOperationForChargeServer } = require('./stripeOfficeMirror');

const SIGNATURE_TOLERANCE_SEC = 5 * 60;

function getWebhookSecret() {
  return String(process.env.STRIPE_CH_WEBHOOK_SECRET || '').trim();
}

/** Verify Stripe-Signature header (t=…,v1=…) against the raw payload. */
function verifyStripeSignature(payload, header, secret) {
  const parts = {};
  for (const kv of String(header || '').split(',')) {
    const idx = kv.indexOf('=');
    if (idx <= 0) continue;
    const key = kv.slice(0, idx).trim();
    const value = kv.slice(idx + 1).trim();
    (parts[key] = parts[key] || []).push(value);
  }
  const timestamp = Number(parts.t?.[0] || 0);
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > SIGNATURE_TOLERANCE_SEC) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(String(sig), 'utf8');
    if (sigBuf.length !== expectedBuf.length) return false;
    try {
      return crypto.timingSafeEqual(sigBuf, expectedBuf);
    } catch {
      return false;
    }
  });
}

function normalizeFranchiseId(raw) {
  const fid = String(raw || '').trim().toUpperCase();
  if (!fid || fid.length > 80 || fid.includes('/')) return null;
  return fid;
}

function depositsCol(franchiseId) {
  return admin.firestore().collection('franchises').doc(franchiseId).collection('stripeDeposits');
}

function mailOrdersCol(franchiseId) {
  return admin.firestore().collection('franchises').doc(franchiseId).collection('stripeMailOrders');
}

async function findDepositDoc(franchiseId, paymentIntentId) {
  const snap = await depositsCol(franchiseId)
    .where('paymentIntentId', '==', paymentIntentId)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

/** Resolve latest charge object for a PI event (event payloads carry only the id). */
async function resolveLatestCharge(pi) {
  if (pi && typeof pi.latest_charge === 'object') return pi.latest_charge;
  const chargeId = typeof pi?.latest_charge === 'string' ? pi.latest_charge : '';
  if (!chargeId) return null;
  try {
    return await stripeRequest('GET', `/charges/${encodeURIComponent(chargeId)}`, null);
  } catch (e) {
    console.warn('[stripeWebhook] charge fetch', chargeId, e?.message);
    return null;
  }
}

async function applyDepositPatchFromPi(franchiseId, pi) {
  const docSnap = await findDepositDoc(franchiseId, pi.id);
  if (!docSnap) return false;
  const row = docSnap.data() || {};
  const patch = {};
  if (pi.status && pi.status !== row.stripeStatus) patch.stripeStatus = pi.status;

  if (pi.status === 'requires_capture') {
    const charge = await resolveLatestCharge(pi);
    const captureBeforeIso = captureBeforeFromCharge(charge);
    if (captureBeforeIso && captureBeforeIso !== row.captureBefore) {
      patch.captureBefore = captureBeforeIso;
    }
    if (extendedAuthAppliedFromCharge(charge) && !row.extendedAuthorizationApplied) {
      patch.extendedAuthorizationApplied = true;
    }
    if (row.status !== 'authorized') patch.status = 'authorized';
    const capturable = Number(pi.amount_capturable) || 0;
    if (capturable && capturable !== Number(row.currentHoldAmount)) {
      patch.currentHoldAmount = capturable;
    }
    patch.terminalFailed = false;
  } else if (pi.status === 'succeeded') {
    if (row.status !== 'captured') {
      patch.status = 'captured';
      patch.capturedAmount = Number(pi.amount_received) || row.capturedAmount || null;
    }
  } else if (pi.status === 'canceled') {
    if (row.status !== 'cancelled') patch.status = 'cancelled';
    if (String(pi.cancellation_reason || '').toLowerCase() === 'expired') {
      patch.cancelReason = 'Authorization expired (Stripe auto-release) — not a staff refund';
      patch.cancelledByName = 'Stripe (authorization expired)';
    }
  } else if (pi.last_payment_error) {
    patch.lastPaymentError = String(pi.last_payment_error.message || '').slice(0, 500);
    patch.lastPaymentErrorCode = String(pi.last_payment_error.code || '');
  }

  if (Object.keys(patch).length === 0) return false;
  patch.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  await docSnap.ref.set(patch, { merge: true });
  return true;
}

async function applyMailOrderPaidFromPi(franchiseId, pi) {
  const mailOrderId = String(pi.metadata?.mailOrderId || '').trim();
  if (!mailOrderId) return false;
  const ref = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const row = snap.data() || {};
  if (row.status === 'paid') return false;
  await ref.set(
    {
      status: 'paid',
      paymentIntentId: pi.id,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  // Mirror into office bookkeeping — idempotent on paymentIntentId.
  await recordOfficeOperationForChargeServer({
    franchiseId,
    category: row.category || pi.metadata?.category,
    resNo: row.resNo || row.productName || pi.metadata?.resNo,
    customerName: row.customerName || pi.metadata?.customerName,
    amountMajor: (Number(pi.amount_received) || Number(pi.amount) || row.amount || 0) / 100,
    mailOrderId,
    paymentIntentId: pi.id,
    source: 'stripe_webhook',
  });
  return true;
}

async function applyMailOrderFailedFromPi(franchiseId, pi) {
  const mailOrderId = String(pi.metadata?.mailOrderId || '').trim();
  if (!mailOrderId) return false;
  const ref = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const row = snap.data() || {};
  if (row.status === 'paid') return false;
  const err = pi.last_payment_error || {};
  await ref.set(
    {
      status: 'charge_failed',
      chargeErrorCode: err.code || null,
      chargeErrorMessage: String(err.message || 'Card declined').slice(0, 500),
      chargeFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

async function applyChargeRefunded(franchiseId, charge) {
  const piId = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id || '';
  if (!piId) return false;
  const snap = await mailOrdersCol(franchiseId)
    .where('paymentIntentId', '==', piId)
    .limit(1)
    .get();
  if (snap.empty) return false;
  const refundedMinor = Number(charge.amount_refunded) || 0;
  const fullRefund = refundedMinor >= (Number(charge.amount_captured) || Number(charge.amount) || 0);
  await snap.docs[0].ref.set(
    {
      refundedAmount: refundedMinor,
      refundedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: fullRefund ? 'refunded' : 'partially_refunded',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  return true;
}

async function routeStripeEvent(event) {
  const type = String(event?.type || '');
  const object = event?.data?.object || {};
  const franchiseId = normalizeFranchiseId(object.metadata?.franchiseId);
  if (!franchiseId || !/^CH/i.test(franchiseId)) {
    // Payments created outside this system (or other countries) — ignore.
    return { handled: false, reason: 'no_franchise_metadata' };
  }

  switch (type) {
    case 'payment_intent.amount_capturable_updated':
    case 'payment_intent.canceled': {
      const changed = await applyDepositPatchFromPi(franchiseId, object);
      return { handled: changed };
    }
    case 'payment_intent.succeeded': {
      const depositChanged = await applyDepositPatchFromPi(franchiseId, object);
      const mailOrderChanged = await applyMailOrderPaidFromPi(franchiseId, object);
      return { handled: depositChanged || mailOrderChanged };
    }
    case 'payment_intent.payment_failed': {
      const depositChanged = await applyDepositPatchFromPi(franchiseId, object);
      const mailOrderChanged = await applyMailOrderFailedFromPi(franchiseId, object);
      return { handled: depositChanged || mailOrderChanged };
    }
    case 'charge.refunded': {
      const changed = await applyChargeRefunded(franchiseId, object);
      return { handled: changed };
    }
    default:
      return { handled: false, reason: 'ignored_event_type' };
  }
}

/** Express-style handler for onRequest — signature check, then route. */
async function handleStripeWebhookRequest(req, res) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }
  const secret = getWebhookSecret();
  if (!secret) {
    console.warn('[stripeWebhook] STRIPE_CH_WEBHOOK_SECRET not configured — event dropped');
    res.status(503).send('Webhook secret not configured');
    return;
  }
  const payload = req.rawBody ? req.rawBody.toString('utf8') : '';
  const signature = req.headers['stripe-signature'];
  if (!payload || !verifyStripeSignature(payload, signature, secret)) {
    res.status(400).send('Invalid signature');
    return;
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    res.status(400).send('Invalid JSON');
    return;
  }
  try {
    const result = await routeStripeEvent(event);
    res.json({ received: true, ...result });
  } catch (e) {
    // 500 → Stripe retries with backoff; handlers are idempotent.
    console.error('[stripeWebhook]', event?.type, e?.message || e);
    res.status(500).send('Handler error');
  }
}

module.exports = {
  handleStripeWebhookRequest,
  verifyStripeSignature,
  routeStripeEvent,
};
