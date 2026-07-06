/**
 * Stripe Financial — CH mail-order products + chargebacks (server-side only).
 * Live secret: Firebase secret STRIPE_CH_SECRET_KEY (Switzerland).
 * Publishable key: franchises/CH/stripeConfig/public
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { sendMailOrderPaymentEmail, sendMailOrderReceiptEmail } = require('./stripeMailOrderMail');
const { formatStripeApiError } = require('./stripeDeclineMessages');

const MAIL_ORDER_LINK_VALID_DAYS = 30;
const MAIL_ORDER_REMINDER_1_DAYS = 15;
const MAIL_ORDER_REMINDER_2_DAYS = 29;

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

const STRIPE_FINANCE_ADMIN_ROLES = new Set(['globaladmin', 'superadmin', 'admin']);

function canViewStripeFinancialTotals(profile) {
  return STRIPE_FINANCE_ADMIN_ROLES.has(normalizeRoleKey(profile?.role));
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

function redactMailOrderForStaff(row, profile) {
  // Per-row amounts stay visible for all finance roles; KPI totals are gated separately.
  if (canViewStripeFinancialTotals(profile)) return row;
  return row;
}

function redactPaymentForStaff(row, profile) {
  if (canViewStripeFinancialTotals(profile)) return row;
  return row;
}

function normalizeRoleKey(role) {
  return String(role || '')
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '');
}

function getStripeSecretKey() {
  let key = '';
  try {
    key = String(stripeCHSecretKey.value() || '').trim();
  } catch (_) {
    key = '';
  }
  if (!key) {
    key = String(
      process.env.STRIPE_CH_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SK ||
      '',
    ).trim();
  }
  if (!key) {
    throw new HttpsError(
      'failed-precondition',
      'Stripe CH secret missing (set STRIPE_CH_SECRET_KEY).',
    );
  }
  return key;
}

async function resolvePublishableKey(franchiseId) {
  try {
    const snap = await admin.firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeConfig')
      .doc('public')
      .get();
    if (snap.exists) {
      const pk = String(snap.data()?.publishableKey || '').trim();
      if (pk) return pk;
    }
  } catch (e) {
    console.warn('[stripeFinancial] public config', e?.message);
  }
  return String(
    process.env.STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_PK || '',
  ).trim();
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

function normalizeFranchiseId(raw) {
  const fid = String(raw || '').trim().toUpperCase();
  if (!fid || fid.length > 80 || fid.includes('/')) {
    throw new HttpsError('invalid-argument', 'Invalid franchiseId');
  }
  return fid;
}

/** Stripe mail-order / chargebacks are Switzerland-only. */
function assertSwitzerlandFranchise(franchiseId) {
  if (!/^CH/i.test(String(franchiseId || '').trim())) {
    throw new HttpsError(
      'permission-denied',
      'Stripe financial features are only available for Switzerland franchises.',
    );
  }
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

function mailOrdersCol(franchiseId) {
  return admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('stripeMailOrders');
}

function generateMailOrderAccessToken() {
  return crypto.randomBytes(32).toString('hex');
}

function timingSafeTokenMatch(provided, stored) {
  const a = String(provided || '');
  const b = String(stored || '');
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

function addDaysToDate(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d;
}

function resolveAppBaseUrl() {
  return String(process.env.STRIPE_CHECKOUT_RETURN_URL || 'https://vehiclesentinel.com').replace(
    /\/$/,
    '',
  );
}

function buildStableMailOrderPaymentUrl(franchiseId, mailOrderId, accessToken) {
  const base = resolveAppBaseUrl();
  return `${base}/pay/mo/${encodeURIComponent(franchiseId)}/${encodeURIComponent(mailOrderId)}?t=${encodeURIComponent(accessToken)}`;
}

function isoOrNull(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function computeReminderSlot(plannedAtIso, status, paymentStatus, nowMs = Date.now()) {
  if (paymentStatus === 'paid') {
    return { status: 'na_paid', label: 'N/A (paid)', tone: 'success', plannedAt: plannedAtIso, shouldSend: false };
  }
  const raw = String(status || 'planned').toLowerCase();
  if (raw === 'sent') {
    return { status: 'sent', label: 'Sent', tone: 'info', plannedAt: plannedAtIso, shouldSend: false };
  }
  if (raw === 'skipped') {
    return { status: 'skipped', label: 'Skipped', tone: 'neutral', plannedAt: plannedAtIso, shouldSend: false };
  }
  const plannedMs = plannedAtIso ? new Date(plannedAtIso).getTime() : NaN;
  const due = Number.isFinite(plannedMs) && plannedMs <= nowMs;
  return {
    status: due ? 'due' : 'planned',
    label: due ? 'Due — send manually' : 'Planned',
    tone: due ? 'danger' : 'warning',
    plannedAt: plannedAtIso,
    shouldSend: due,
  };
}

function enrichMailOrderRow(row) {
  const nowMs = Date.now();
  const linkSentAt = isoOrNull(row.linkSentAt) || isoOrNull(row.createdAt);
  const linkValidUntil =
    isoOrNull(row.linkValidUntil) ||
    (linkSentAt ? addDaysToDate(linkSentAt, MAIL_ORDER_LINK_VALID_DAYS).toISOString() : null);
  const reminder1PlannedAt =
    isoOrNull(row.reminder1PlannedAt) ||
    (linkSentAt ? addDaysToDate(linkSentAt, MAIL_ORDER_REMINDER_1_DAYS).toISOString() : null);
  const reminder2PlannedAt =
    isoOrNull(row.reminder2PlannedAt) ||
    (linkSentAt ? addDaysToDate(linkSentAt, MAIL_ORDER_REMINDER_2_DAYS).toISOString() : null);

  let linkStatus = 'active';
  if (row.status === 'paid') linkStatus = 'paid';
  else if (linkValidUntil && new Date(linkValidUntil).getTime() < nowMs) linkStatus = 'expired';

  const paymentStatus = row.status === 'paid' ? 'paid' : 'unpaid';
  const reminder1 = computeReminderSlot(
    reminder1PlannedAt,
    row.reminder1Status || 'planned',
    paymentStatus,
    nowMs,
  );
  const reminder2 = computeReminderSlot(
    reminder2PlannedAt,
    row.reminder2Status || 'planned',
    paymentStatus,
    nowMs,
  );

  return {
    ...row,
    resNo: row.resNo || row.productName || '',
    mailContent: row.mailContent || row.description || '',
    linkSentAt,
    linkValidUntil,
    linkStatus,
    reminder1PlannedAt,
    reminder1Status: row.reminder1Status || 'planned',
    reminder1,
    reminder2PlannedAt,
    reminder2Status: row.reminder2Status || 'planned',
    reminder2,
    reminderSendingEnabled: row.reminderSendingEnabled === true,
  };
}

async function createCheckoutSessionForMailOrder({
  franchiseId,
  mailOrderId,
  productId,
  saveCustomerInfo,
  customerEmail,
  uid,
}) {
  const p = await stripeRequest('GET', `/products/${encodeURIComponent(productId)}`, {
    expand: ['default_price'],
  });
  const priceId =
    typeof p.default_price === 'object' && p.default_price ? p.default_price.id : p.default_price;
  if (!priceId) {
    throw new HttpsError('failed-precondition', 'Product has no default price.');
  }

  const appBase = resolveAppBaseUrl();
  const sessionParams = {
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appBase}/#stripeMailOrder?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBase}/#stripeMailOrder?cancel=1`,
    metadata: {
      franchiseId,
      productId,
      mailOrderId,
      mailOrder: 'true',
      saveCustomerInfo: saveCustomerInfo ? 'true' : 'false',
      createdByUid: uid || 'public_checkout',
    },
    billing_address_collection: 'auto',
    phone_number_collection: { enabled: true },
  };

  if (customerEmail) {
    sessionParams.customer_email = customerEmail;
  }
  if (saveCustomerInfo) {
    sessionParams.customer_creation = 'always';
    sessionParams.payment_intent_data = { setup_future_usage: 'off_session' };
  } else {
    sessionParams.customer_creation = 'if_required';
  }

  return stripeRequest('POST', '/checkout/sessions', sessionParams);
}

/**
 * @param {object} session Stripe checkout session
 * @return {'paid'|'unpaid'}
 */
function paymentStatusFromSession(session) {
  if (!session) return 'unpaid';
  if (session.payment_status === 'paid') return 'paid';
  return 'unpaid';
}

/**
 * @param {object} row Firestore mail-order row
 * @return {Promise<object>}
 */
async function syncMailOrderPaymentStatus(row) {
  if (row.status === 'paid' || row.paidAt) {
    return { ...row, status: 'paid' };
  }

  const sessionId = String(row.checkoutSessionId || '').trim();
  if (!sessionId) {
    return { ...row, status: row.status === 'paid' ? 'paid' : 'unpaid' };
  }
  try {
    const session = await stripeRequest(
      'GET',
      `/checkout/sessions/${encodeURIComponent(sessionId)}`,
      null,
    );
    const status = paymentStatusFromSession(session);
    if (status === 'paid') {
      await mailOrdersCol(row.franchiseId).doc(row.id).set(
        {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionStatus: session.status || null,
        },
        { merge: true },
      );
      return {
        ...row,
        status: 'paid',
        stripeSessionStatus: session.status || null,
        paymentStatus: session.payment_status || null,
      };
    }
    return {
      ...row,
      status: row.status === 'paid' ? 'paid' : 'unpaid',
      stripeSessionStatus: session.status || null,
      paymentStatus: session.payment_status || null,
    };
  } catch (e) {
    console.warn('[stripeFinancial] mail order status sync', row.id, e?.message);
    return { ...row, status: row.status === 'paid' ? 'paid' : 'unpaid' };
  }
}

async function parseStripeResponse(res) {
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpsError('internal', `Stripe returned invalid JSON (${res.status})`);
  }
  if (!res.ok) {
    const msg = formatStripeApiError(data);
    throw new HttpsError('failed-precondition', msg);
  }
  return data;
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
    console.warn('[stripeFinancial] audit write failed', e?.message);
  }
}

function mapProduct(p) {
  const price = p.default_price;
  const priceObj = typeof price === 'object' && price ? price : null;
  return {
    id: p.id,
    name: p.name || '',
    description: p.description || '',
    active: p.active !== false,
    images: Array.isArray(p.images) ? p.images : [],
    created: p.created,
    updated: p.updated,
    metadata: p.metadata || {},
    defaultPriceId: priceObj?.id || (typeof price === 'string' ? price : null),
    currency: priceObj?.currency || null,
    unitAmount: priceObj?.unit_amount ?? null,
    saveCustomerInfo: p.metadata?.mailOrderSaveCustomer === 'true',
    raw: p,
  };
}

function mapDispute(d) {
  const evidence = d.evidence_details || {};
  const charge = typeof d.charge === 'object' && d.charge ? d.charge : null;
  return {
    id: d.id,
    object: d.object,
    amount: d.amount,
    currency: d.currency,
    status: d.status,
    reason: d.reason,
    charge: typeof d.charge === 'string' ? d.charge : charge?.id,
    paymentIntent: typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id,
    created: d.created,
    evidenceDetails: evidence,
    evidenceDueBy: evidence.due_by || null,
    hasEvidence: evidence.has_evidence,
    pastDue: evidence.past_due,
    submissionCount: evidence.submission_count,
    isChargeRefundable: d.is_charge_refundable,
    balanceTransactions: d.balance_transactions || [],
    networkReasonCode: d.network_reason_code,
    livemode: d.livemode,
    metadata: d.metadata || {},
    chargeDetails: charge
      ? {
          id: charge.id,
          amount: charge.amount,
          amountCaptured: charge.amount_captured,
          amountRefunded: charge.amount_refunded,
          currency: charge.currency,
          status: charge.status,
          captured: charge.captured,
          disputed: charge.disputed,
          description: charge.description,
          receiptEmail: charge.receipt_email,
          receiptUrl: charge.receipt_url,
          billingName: charge.billing_details?.name,
          billingEmail: charge.billing_details?.email,
          cardBrand: charge.payment_method_details?.card?.brand,
          cardLast4: charge.payment_method_details?.card?.last4,
          cardCountry: charge.payment_method_details?.card?.country,
          created: charge.created,
        }
      : null,
    raw: d,
  };
}

function hasStripeSecret() {
  try {
    if (String(stripeCHSecretKey.value() || '').trim()) return true;
  } catch (_) {
    /* secret not bound in emulator */
  }
  return Boolean(
    String(
      process.env.STRIPE_CH_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SK ||
      '',
    ).trim(),
  );
}

async function runGetConfig(request) {
  await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId || 'CH');
  assertSwitzerlandFranchise(franchiseId);
  let sk = '';
  try {
    sk = getStripeSecretKey();
  } catch (_) {
    sk = '';
  }
  const pk = await resolvePublishableKey(franchiseId);
  return {
    franchiseId,
    publishableKey: pk,
    configured: hasStripeSecret(),
    mode: sk.startsWith('sk_live_') ? 'live' : sk ? 'test' : 'unset',
  };
}

function redactDisputeForStaff(dispute, profile) {
  if (canViewStripeFinancialTotals(profile)) return dispute;
  return { ...dispute, amount: null };
}

async function runListDisputes(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 100);
  const startingAfter = data.startingAfter ? String(data.startingAfter) : undefined;

  const params = { limit };
  if (startingAfter) params.starting_after = startingAfter;

  const result = await stripeRequest('GET', '/disputes', params);
  const disputes = (result.data || []).map(mapDispute).map((d) => redactDisputeForStaff(d, profile));
  await writeAudit(franchiseId, uid, 'list_disputes', { count: disputes.length });
  return {
    disputes,
    hasMore: result.has_more === true,
    lastId: disputes.length ? disputes[disputes.length - 1].id : null,
  };
}

async function runGetDispute(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const disputeId = String(data.disputeId || '').trim();
  if (!disputeId) throw new HttpsError('invalid-argument', 'disputeId required');

  const d = await stripeRequest('GET', `/disputes/${encodeURIComponent(disputeId)}`, {
    expand: ['charge', 'charge.payment_intent', 'charge.customer'],
  });
  await writeAudit(franchiseId, uid, 'get_dispute', { disputeId });
  return { dispute: redactDisputeForStaff(mapDispute(d), profile) };
}

async function runListProducts(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 100);
  const activeOnly = data.activeOnly === true;

  const params = {
    limit,
    expand: ['data.default_price'],
  };
  if (activeOnly) params.active = true;

  const result = await stripeRequest('GET', '/products', params);
  const products = (result.data || []).map(mapProduct);
  await writeAudit(franchiseId, uid, 'list_products', { count: products.length });
  return {
    products,
    hasMore: result.has_more === true,
  };
}

async function runGetProduct(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const productId = String(data.productId || '').trim();
  if (!productId) throw new HttpsError('invalid-argument', 'productId required');

  const p = await stripeRequest('GET', `/products/${encodeURIComponent(productId)}`, {
    expand: ['default_price'],
  });
  await writeAudit(franchiseId, uid, 'get_product', { productId });
  return { product: mapProduct(p) };
}

async function runCreateProduct(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const name = String(data.name || '').trim();
  if (!name || name.length > 250) {
    throw new HttpsError('invalid-argument', 'Product name is required (max 250 chars).');
  }
  const description = String(data.description || '').trim().slice(0, 5000);
  const currency = String(data.currency || 'chf').trim().toLowerCase();
  const unitAmount = Math.round(Number(data.unitAmount));
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new HttpsError('invalid-argument', 'unitAmount must be at least 50 (minor units).');
  }

  const params = {
    name,
    description,
    active: data.active !== false,
    metadata: {
      franchiseId,
      createdByUid: uid,
      createdByName: String(profile.displayName || profile.email || uid).slice(0, 120),
      source: 'erpx_mail_order',
      mailOrderSaveCustomer: data.saveCustomerInfo === true ? 'true' : 'false',
    },
    default_price_data: {
      currency,
      unit_amount: unitAmount,
    },
  };

  const p = await stripeRequest('POST', '/products', params);
  await writeAudit(franchiseId, uid, 'create_product', { productId: p.id, name });
  return { product: mapProduct(p) };
}

async function runUpdateProduct(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const productId = String(data.productId || '').trim();
  if (!productId) throw new HttpsError('invalid-argument', 'productId required');

  const params = {};
  if (data.name != null) {
    const name = String(data.name).trim();
    if (!name) throw new HttpsError('invalid-argument', 'name cannot be empty');
    params.name = name;
  }
  if (data.description != null) params.description = String(data.description).trim().slice(0, 5000);
  if (data.active != null) params.active = data.active === true;
  if (data.saveCustomerInfo != null) {
    const existing = await stripeRequest('GET', `/products/${encodeURIComponent(productId)}`);
    params.metadata = {
      ...(existing.metadata || {}),
      mailOrderSaveCustomer: data.saveCustomerInfo === true ? 'true' : 'false',
    };
  }

  const p = await stripeRequest('POST', `/products/${encodeURIComponent(productId)}`, params);

  if (data.unitAmount != null && data.currency) {
    const unitAmount = Math.round(Number(data.unitAmount));
    const currency = String(data.currency).trim().toLowerCase();
    if (Number.isFinite(unitAmount) && unitAmount >= 50) {
      const newPrice = await stripeRequest('POST', '/prices', {
        product: productId,
        currency,
        unit_amount: unitAmount,
      });
      await stripeRequest('POST', `/products/${encodeURIComponent(productId)}`, {
        default_price: newPrice.id,
      });
    }
  }

  const refreshed = await stripeRequest('GET', `/products/${encodeURIComponent(productId)}`, {
    expand: ['default_price'],
  });
  await writeAudit(franchiseId, uid, 'update_product', { productId });
  return { product: mapProduct(refreshed) };
}

async function runArchiveProduct(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const productId = String(data.productId || '').trim();
  if (!productId) throw new HttpsError('invalid-argument', 'productId required');

  const p = await stripeRequest('POST', `/products/${encodeURIComponent(productId)}`, {
    active: false,
  });
  await writeAudit(franchiseId, uid, 'archive_product', { productId });
  return { product: mapProduct(p), archived: true };
}

async function runDeleteProduct(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const productId = String(data.productId || '').trim();
  if (!productId) throw new HttpsError('invalid-argument', 'productId required');

  const pricesRes = await stripeRequest('GET', '/prices', {
    product: productId,
    limit: 100,
  });
  await Promise.all((pricesRes.data || []).map(async (price) => {
    try {
      await stripeRequest('DELETE', `/prices/${encodeURIComponent(price.id)}`, null);
    } catch (_) {
      await stripeRequest('POST', `/prices/${encodeURIComponent(price.id)}`, { active: false });
    }
  }));

  let hardDeleted = false;
  let message = '';
  try {
    await stripeRequest('DELETE', `/products/${encodeURIComponent(productId)}`, null);
    hardDeleted = true;
    message = 'Product permanently deleted from Stripe.';
  } catch (err) {
    await stripeRequest('POST', `/products/${encodeURIComponent(productId)}`, { active: false });
    hardDeleted = false;
    message =
      'Product has past payments — deactivated in Stripe and removed from your catalog.';
  }

  const mailSnap = await mailOrdersCol(franchiseId).where('productId', '==', productId).get();
  if (!mailSnap.empty) {
    const batch = admin.firestore().batch();
    mailSnap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
  }

  await writeAudit(franchiseId, uid, 'delete_product', { productId, hardDeleted });
  return { ok: true, productId, hardDeleted, message };
}

async function runCreateMailOrderPaymentLink(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const productId = String(data.productId || '').trim();
  const mailOrderIdArg = String(data.mailOrderId || '').trim();
  if (!productId && !mailOrderIdArg) {
    throw new HttpsError('invalid-argument', 'productId or mailOrderId required');
  }

  if (mailOrderIdArg) {
    const existingRef = mailOrdersCol(franchiseId).doc(mailOrderIdArg);
    const existingSnap = await existingRef.get();
    if (!existingSnap.exists) {
      throw new HttpsError('not-found', 'Mail order not found');
    }
    const existing = existingSnap.data() || {};
    if (existing.status === 'paid') {
      throw new HttpsError('failed-precondition', 'Already paid.');
    }
    if (existing.emailSentAt && !data.forceRegenerate) {
      throw new HttpsError('failed-precondition', 'Payment email already sent.');
    }
    if (existing.paymentUrl) {
      return {
        url: existing.paymentUrl,
        id: mailOrderIdArg,
        mailOrderId: mailOrderIdArg,
        active: existing.linkStatus !== 'expired',
        paymentStatus: existing.status === 'paid' ? 'paid' : 'unpaid',
        linkValidUntil: existing.linkValidUntil?.toDate?.()?.toISOString?.() || null,
        reused: true,
      };
    }
  }

  const effectiveProductId = productId || (await mailOrdersCol(franchiseId).doc(mailOrderIdArg).get()).data()?.productId;
  const p = await stripeRequest('GET', `/products/${encodeURIComponent(effectiveProductId)}`, {
    expand: ['default_price'],
  });
  const priceId =
    typeof p.default_price === 'object' && p.default_price
      ? p.default_price.id
      : p.default_price;
  if (!priceId) {
    throw new HttpsError('failed-precondition', 'Product has no default price.');
  }

  const saveCustomerInfo =
    data.saveCustomerInfo === true ||
    (data.saveCustomerInfo !== false && p.metadata?.mailOrderSaveCustomer === 'true');

  const customerEmail = String(data.customerEmail || '').trim();

  const mailOrderRef = mailOrdersCol(franchiseId).doc();
  const mailOrderId = mailOrderRef.id;
  const accessToken = generateMailOrderAccessToken();
  const now = new Date();
  const linkValidUntil = addDaysToDate(now, MAIL_ORDER_LINK_VALID_DAYS);
  const reminder1PlannedAt = addDaysToDate(now, MAIL_ORDER_REMINDER_1_DAYS);
  const reminder2PlannedAt = addDaysToDate(now, MAIL_ORDER_REMINDER_2_DAYS);
  const stablePaymentUrl = buildStableMailOrderPaymentUrl(franchiseId, mailOrderId, accessToken);

  const priceObj =
    typeof p.default_price === 'object' && p.default_price ? p.default_price : null;
  const unitAmount = priceObj?.unit_amount ?? null;
  const currency = priceObj?.currency || 'chf';
  const resNo = String(p.name || '').trim();
  const mailContent = String(p.description || '').trim();

  await mailOrderRef.set({
    franchiseId,
    productId,
    productName: resNo,
    resNo,
    mailContent,
    description: mailContent,
    checkoutSessionId: '',
    paymentUrl: stablePaymentUrl,
    accessToken,
    amount: unitAmount,
    currency,
    status: 'unpaid',
    customerEmail: customerEmail || '',
    createdByUid: uid,
    saveCustomerInfo,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    linkSentAt: admin.firestore.FieldValue.serverTimestamp(),
    linkValidUntil: admin.firestore.Timestamp.fromDate(linkValidUntil),
    reminder1PlannedAt: admin.firestore.Timestamp.fromDate(reminder1PlannedAt),
    reminder1Status: 'planned',
    reminder2PlannedAt: admin.firestore.Timestamp.fromDate(reminder2PlannedAt),
    reminder2Status: 'planned',
    reminderSendingEnabled: false,
  });

  await writeAudit(franchiseId, uid, 'create_payment_link', {
    productId,
    mailOrderId,
    saveCustomerInfo,
    linkValidUntil: linkValidUntil.toISOString(),
  });
  return {
    url: stablePaymentUrl,
    id: mailOrderId,
    mailOrderId,
    active: true,
    saveCustomerInfo,
    paymentStatus: 'unpaid',
    linkValidUntil: linkValidUntil.toISOString(),
    reminder1PlannedAt: reminder1PlannedAt.toISOString(),
    reminder2PlannedAt: reminder2PlannedAt.toISOString(),
  };
}

async function runAttachMailOrderDocuments(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  const documents = Array.isArray(data.documents) ? data.documents.slice(0, 20) : [];
  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Mail order not found');

  const existing = Array.isArray(snap.data()?.documents) ? snap.data().documents : [];
  const merged = [...existing, ...documents].slice(0, 20);
  await docRef.set({ documents: merged, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  await writeAudit(franchiseId, uid, 'mail_order_attach_documents', { mailOrderId, count: documents.length });
  return { ok: true, mailOrderId, documents: merged };
}

async function runSendMailOrderEmail(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Mail order not found');
  const row = snap.data() || {};
  const customerEmail = String(row.customerEmail || '').trim();

  if (!customerEmail) {
    return {
      ok: true,
      mailOrderId,
      sent: false,
      message: 'No customer email — payment link created without email',
    };
  }

  if (row.emailSentAt && !data.resend) {
    throw new HttpsError('failed-precondition', 'Payment email already sent.');
  }
  if (row.status === 'paid') {
    throw new HttpsError('failed-precondition', 'Already paid.');
  }

  const emailResult = await sendMailOrderPaymentEmail({
    franchiseId,
    category: row.category || 'damage',
    toEmail: row.customerEmail,
    customerName: row.customerName,
    resNo: row.resNo || row.productName,
    mailContent: row.mailContent || row.description,
    paymentUrl: row.paymentUrl,
    amountCents: row.amount,
    currency: row.currency,
    subject: data.subject || row.emailSubject,
    htmlBody: data.htmlBody || row.emailBodyHtml,
    documents: row.documents || [],
  });

  await docRef.set(
    {
      emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      emailSentOk: emailResult.sent === true,
      emailSentMessage: emailResult.message || '',
    },
    { merge: true },
  );
  await writeAudit(franchiseId, uid, 'mail_order_email_sent', {
    mailOrderId,
    sent: emailResult.sent,
    message: emailResult.message,
    to: row.customerEmail,
  });

  if (!emailResult.sent) {
    throw new HttpsError('failed-precondition', emailResult.message || 'Email not sent');
  }
  return { ok: true, mailOrderId, sent: true };
}

async function runCreateMailOrderPayment(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const category = String(data.category || '').toLowerCase();
  if (!['traffic_fine', 'damage'].includes(category)) {
    throw new HttpsError('invalid-argument', 'category must be traffic_fine or damage');
  }
  const resNo = String(data.resNo || data.name || '').trim();
  const customerName = String(data.customerName || '').trim();
  const customerEmail = String(data.customerEmail || '').trim();
  const mailContent = String(data.mailContent || data.description || '').trim();
  const unitAmount = Number(data.unitAmount);
  const currency = String(data.currency || 'chf').toLowerCase();
  const documents = Array.isArray(data.documents) ? data.documents.slice(0, 20) : [];

  if (!resNo) throw new HttpsError('invalid-argument', 'RES code required');
  if (!customerName) throw new HttpsError('invalid-argument', 'Customer name required');
  if (!Number.isFinite(unitAmount) || unitAmount <= 0) {
    throw new HttpsError('invalid-argument', 'Valid amount required');
  }

  const product = await stripeRequest('POST', '/products', {
    name: resNo,
    description: mailContent,
    active: true,
    'metadata[franchiseId]': franchiseId,
    'metadata[mailOrderCategory]': category,
    'metadata[mailOrderSaveCustomer]': 'true',
    default_price_data: {
      currency,
      unit_amount: Math.round(unitAmount),
    },
  });

  const productId = product.id;
  const mailOrderRef = mailOrdersCol(franchiseId).doc();
  const mailOrderId = mailOrderRef.id;
  const accessToken = generateMailOrderAccessToken();
  const now = new Date();
  const linkValidUntil = addDaysToDate(now, MAIL_ORDER_LINK_VALID_DAYS);
  const reminder1PlannedAt = addDaysToDate(now, MAIL_ORDER_REMINDER_1_DAYS);
  const reminder2PlannedAt = addDaysToDate(now, MAIL_ORDER_REMINDER_2_DAYS);
  const stablePaymentUrl = buildStableMailOrderPaymentUrl(franchiseId, mailOrderId, accessToken);

  await mailOrderRef.set({
    franchiseId,
    productId,
    productName: resNo,
    resNo,
    mailContent,
    description: mailContent,
    category,
    customerName,
    customerEmail,
    checkoutSessionId: '',
    paymentUrl: stablePaymentUrl,
    accessToken,
    amount: Math.round(unitAmount),
    currency,
    status: 'unpaid',
    createdByUid: uid,
    saveCustomerInfo: true,
    documents,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    linkSentAt: admin.firestore.FieldValue.serverTimestamp(),
    linkValidUntil: admin.firestore.Timestamp.fromDate(linkValidUntil),
    reminder1PlannedAt: admin.firestore.Timestamp.fromDate(reminder1PlannedAt),
    reminder1Status: 'planned',
    reminder2PlannedAt: admin.firestore.Timestamp.fromDate(reminder2PlannedAt),
    reminder2Status: 'planned',
    reminderSendingEnabled: false,
  });

  const skipEmail = data.skipEmail === true;
  let emailResult = { sent: false, message: 'skipped' };
  if (!skipEmail) {
    emailResult = await sendMailOrderPaymentEmail({
      franchiseId,
      category,
      toEmail: customerEmail,
      customerName,
      resNo,
      mailContent,
      paymentUrl: stablePaymentUrl,
      amountCents: Math.round(unitAmount),
      currency,
      documents,
    });
    await mailOrderRef.set(
      {
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSentOk: emailResult.sent === true,
        emailSentMessage: emailResult.message || '',
      },
      { merge: true },
    );
  }

  await writeAudit(franchiseId, uid, 'create_mail_order_payment', {
    mailOrderId,
    productId,
    category,
    resNo,
    emailSent: emailResult.sent,
  });

  if (!skipEmail && customerEmail && !emailResult.sent) {
    throw new HttpsError('failed-precondition', emailResult.message || 'Mail order created but email failed');
  }

  return {
    ok: true,
    mailOrderId,
    productId,
    paymentUrl: stablePaymentUrl,
    emailSent: emailResult.sent === true,
    linkValidUntil: linkValidUntil.toISOString(),
  };
}

/** Staff-entered card (MOTO) — creates mail order + PaymentIntent client secret. */
async function runCreateDirectCardOperation(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);

  const category = String(data.category || '').toLowerCase();
  if (!['traffic_fine', 'damage'].includes(category)) {
    throw new HttpsError('invalid-argument', 'category must be traffic_fine or damage');
  }
  const resNo = String(data.resNo || data.name || '').trim();
  const customerName = String(data.customerName || '').trim();
  const customerEmail = String(data.customerEmail || '').trim();
  const cardholderName = String(data.cardholderName || customerName || '').trim();
  const mailContent = String(data.mailContent || data.emailBodyHtml || '').trim();
  const emailSubject = String(data.emailSubject || '').trim();
  const emailBodyHtml = String(data.emailBodyHtml || data.mailContent || '').trim();
  const unitAmount = Number(data.unitAmount);
  const currency = String(data.currency || 'chf').toLowerCase();

  if (!resNo) throw new HttpsError('invalid-argument', 'RES code required');
  if (!customerName) throw new HttpsError('invalid-argument', 'Customer name required');
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new HttpsError('invalid-argument', 'Minimum amount is CHF 0.50');
  }

  const customer = await stripeRequest('POST', '/customers', {
    name: customerName,
    ...(customerEmail ? { email: customerEmail } : {}),
    'metadata[franchiseId]': franchiseId,
    'metadata[resNo]': resNo,
  });

  const mailOrderRef = mailOrdersCol(franchiseId).doc();
  const mailOrderId = mailOrderRef.id;

  const pi = await stripeRequest('POST', '/payment_intents', {
    amount: Math.round(unitAmount),
    currency,
    customer: customer.id,
    payment_method_types: ['card'],
    capture_method: 'automatic',
    description: `${category === 'traffic_fine' ? 'Traffic fine' : 'Damage'} — ${resNo}`,
    ...(customerEmail ? { receipt_email: customerEmail } : {}),
    'metadata[franchiseId]': franchiseId,
    'metadata[flow]': 'direct_card_operation',
    'metadata[mailOrderId]': mailOrderId,
    'metadata[category]': category,
    'metadata[resNo]': resNo,
    'metadata[customerName]': customerName,
    ...(customerEmail ? { 'metadata[customerEmail]': customerEmail } : {}),
  });

  await mailOrderRef.set({
    franchiseId,
    productId: '',
    productName: resNo,
    resNo,
    mailContent,
    description: mailContent,
    emailSubject,
    emailBodyHtml,
    category,
    customerName,
    customerEmail,
    cardholderName,
    stripeCustomerId: customer.id,
    paymentIntentId: pi.id,
    chargeMode: 'direct_card',
    checkoutSessionId: '',
    paymentUrl: '',
    amount: Math.round(unitAmount),
    currency,
    status: 'pending_charge',
    createdByUid: uid,
    documents: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const publishableKey = await resolvePublishableKey(franchiseId);
  if (!publishableKey) {
    throw new HttpsError('failed-precondition', 'Stripe publishable key not configured for CH');
  }

  await writeAudit(franchiseId, uid, 'direct_card_operation_created', {
    mailOrderId,
    paymentIntentId: pi.id,
    category,
    resNo,
    amount: Math.round(unitAmount),
  });

  return {
    ok: true,
    mailOrderId,
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    publishableKey,
  };
}

async function extractCardSnapshotFromPaymentIntent(pi) {
  let pm = typeof pi.payment_method === 'object' && pi.payment_method ? pi.payment_method : null;
  const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pm?.id;
  if (!pm && pmId) {
    pm = await stripeRequest('GET', `/payment_methods/${encodeURIComponent(pmId)}`, null);
  }
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const card = pm?.card || charge?.payment_method_details?.card || null;
  const customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null;
  return {
    stripePaymentMethodId: pm?.id || pmId || null,
    stripeCustomerId: customerId,
    cardBrand: card?.brand || null,
    cardLast4: card?.last4 || null,
    cardExpMonth: card?.exp_month || null,
    cardExpYear: card?.exp_year || null,
    cardholderName: pm?.billing_details?.name || null,
  };
}

function deriveMailOrderUiStatus(row) {
  const raw = String(row?.status || '').toLowerCase();
  if (raw === 'paid') return 'paid';
  if (raw === 'pending_charge' || raw === 'pending') return 'pending';
  if (raw === 'charge_failed' || raw === 'failed' || raw === 'declined') return 'failed';
  return 'unpaid';
}

/** Save card snapshot from a PaymentIntent after entry (incl. failed attempts) for retry. */
async function runPersistDirectCardSnapshot(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  const paymentIntentId = String(data.paymentIntentId || '').trim();

  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
  const row = snap.data() || {};

  const piId = paymentIntentId || row.paymentIntentId;
  if (!piId) throw new HttpsError('failed-precondition', 'Missing PaymentIntent');

  const pi = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(piId)}`, {
    expand: ['payment_method', 'latest_charge'],
  });

  if (pi.metadata?.mailOrderId && pi.metadata.mailOrderId !== mailOrderId) {
    throw new HttpsError('failed-precondition', 'PaymentIntent does not match this operation');
  }

  const cardSnap = await extractCardSnapshotFromPaymentIntent(pi);
  if (!cardSnap.stripePaymentMethodId && !cardSnap.cardLast4) {
    throw new HttpsError('not-found', 'No card found on this payment attempt');
  }

  const customerId = cardSnap.stripeCustomerId || row.stripeCustomerId;
  if (cardSnap.stripePaymentMethodId && customerId) {
    try {
      await stripeRequest(
        'POST',
        `/payment_methods/${encodeURIComponent(cardSnap.stripePaymentMethodId)}/attach`,
        { customer: customerId },
      );
    } catch (e) {
      const msg = String(e?.message || '');
      if (!msg.includes('already been attached') && !msg.includes('already attached')) {
        console.warn('[persistDirectCard] attach', msg);
      }
    }
  }

  const patch = {
    paymentIntentId: pi.id,
    stripeCustomerId: customerId || row.stripeCustomerId || null,
    stripePaymentMethodId: cardSnap.stripePaymentMethodId || row.stripePaymentMethodId || null,
    cardBrand: cardSnap.cardBrand || row.cardBrand || null,
    cardLast4: cardSnap.cardLast4 || row.cardLast4 || null,
    cardExpMonth: cardSnap.cardExpMonth || row.cardExpMonth || null,
    cardExpYear: cardSnap.cardExpYear || row.cardExpYear || null,
    cardholderName: cardSnap.cardholderName || row.cardholderName || row.customerName || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (pi.status === 'canceled' || pi.status === 'requires_payment_method') {
    const err = pi.last_payment_error;
    patch.status = 'charge_failed';
    patch.chargeErrorCode = err?.code || null;
    patch.chargeErrorMessage = err?.message || 'Card declined';
    patch.chargeFailedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await docRef.set(patch, { merge: true });

  await writeAudit(franchiseId, uid, 'direct_card_snapshot_saved', {
    mailOrderId,
    paymentIntentId: pi.id,
    cardLast4: patch.cardLast4,
    hasPaymentMethod: Boolean(patch.stripePaymentMethodId),
  });

  return {
    ok: true,
    mailOrderId,
    ...patch,
    cardExpMonth: patch.cardExpMonth,
    cardExpYear: patch.cardExpYear,
  };
}

/** After client confirms PaymentIntent — mark paid and send receipt e-mail. */
async function runFinalizeDirectCardOperation(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  const paymentIntentId = String(data.paymentIntentId || '').trim();
  const sendEmail = data.sendEmail !== false;

  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
  const row = snap.data() || {};

  const piId = paymentIntentId || row.paymentIntentId;
  if (!piId) throw new HttpsError('failed-precondition', 'Missing PaymentIntent');

  const pi = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(piId)}`, {
    expand: ['payment_method', 'latest_charge'],
  });

  if (pi.metadata?.mailOrderId && pi.metadata.mailOrderId !== mailOrderId) {
    throw new HttpsError('failed-precondition', 'PaymentIntent does not match this operation');
  }

  if (pi.status !== 'succeeded') {
    throw new HttpsError('failed-precondition', `Payment not completed (${pi.status})`);
  }

  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
  const cardSnap = await extractCardSnapshotFromPaymentIntent(pi);
  const card = charge?.payment_method_details?.card || cardSnap;

  await docRef.set(
    {
      status: 'paid',
      paymentIntentId: pi.id,
      amount: pi.amount_received || pi.amount || row.amount,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      cardBrand: cardSnap.cardBrand || card?.brand || null,
      cardLast4: cardSnap.cardLast4 || card?.last4 || null,
      cardExpMonth: cardSnap.cardExpMonth || card?.exp_month || null,
      cardExpYear: cardSnap.cardExpYear || card?.exp_year || null,
      cardholderName: cardSnap.cardholderName || row.cardholderName || row.customerName || null,
      stripePaymentMethodId:
        cardSnap.stripePaymentMethodId ||
        (typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id) ||
        row.stripePaymentMethodId ||
        null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  let emailResult = { sent: false, message: 'skipped' };
  if (sendEmail && row.customerEmail) {
    emailResult = await sendMailOrderReceiptEmail({
      franchiseId,
      category: row.category || 'damage',
      toEmail: row.customerEmail,
      customerName: row.customerName,
      resNo: row.resNo || row.productName,
      mailContent: row.mailContent || row.emailBodyHtml,
      amountCents: pi.amount_received || pi.amount || row.amount,
      currency: row.currency,
      subject: row.emailSubject,
      htmlBody: row.emailBodyHtml,
      documents: row.documents || [],
    });
    await docRef.set(
      {
        emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        emailSentOk: emailResult.sent === true,
        emailSentMessage: emailResult.message || '',
      },
      { merge: true },
    );
  }

  await writeAudit(franchiseId, uid, 'direct_card_operation_paid', {
    mailOrderId,
    paymentIntentId: pi.id,
    emailSent: emailResult.sent,
    cardLast4: card?.last4 || null,
  });

  return {
    ok: true,
    mailOrderId,
    paymentIntentId: pi.id,
    status: pi.status,
    emailSent: emailResult.sent === true,
    cardLast4: card?.last4 || null,
  };
}

/** Refund a succeeded direct charge or saved-card charge (staff+). */
async function runRefundPayment(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const paymentIntentId = String(data.paymentIntentId || '').trim();
  const mailOrderId = String(data.mailOrderId || '').trim();
  const reason = String(data.reason || 'requested_by_customer').trim().slice(0, 200);
  const amountChf = data.amountChf != null ? Number(data.amountChf) : null;

  if (!paymentIntentId.startsWith('pi_') && !mailOrderId) {
    throw new HttpsError('invalid-argument', 'paymentIntentId or mailOrderId required');
  }

  let piId = paymentIntentId;
  let mailRef = null;
  let mailRow = null;
  if (mailOrderId) {
    mailRef = mailOrdersCol(franchiseId).doc(mailOrderId);
    const snap = await mailRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
    mailRow = snap.data() || {};
    piId = String(mailRow.paymentIntentId || piId).trim();
  }
  if (!piId.startsWith('pi_')) {
    throw new HttpsError('failed-precondition', 'No PaymentIntent to refund');
  }

  const pi = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(piId)}`);
  if (pi.status !== 'succeeded') {
    throw new HttpsError('failed-precondition', `Payment is ${pi.status}; only succeeded charges can be refunded`);
  }

  const refundBody = { payment_intent: piId, reason: 'requested_by_customer' };
  if (amountChf != null && Number.isFinite(amountChf) && amountChf > 0) {
    const minor = Math.round(amountChf * 100);
    if (minor < 50) throw new HttpsError('invalid-argument', 'Minimum refund is CHF 0.50');
    refundBody.amount = minor;
  }

  const refund = await stripeRequest('POST', '/refunds', refundBody);

  if (mailRef && mailRow) {
    const refundedMinor = refund.amount || pi.amount_received || pi.amount;
    const fullRefund = !refundBody.amount || refundedMinor >= (pi.amount_received || pi.amount);
    await mailRef.set(
      {
        refundId: refund.id,
        refundedAmount: refundedMinor,
        refundedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: fullRefund ? 'refunded' : 'partially_refunded',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  await writeAudit(franchiseId, uid, 'payment_refunded', {
    paymentIntentId: piId,
    mailOrderId: mailOrderId || mailRow?.id || null,
    refundId: refund.id,
    amountChf: (refund.amount || pi.amount_received || 0) / 100,
    reason,
  });

  return {
    ok: true,
    refundId: refund.id,
    paymentIntentId: piId,
    amount: refund.amount,
    currency: refund.currency || pi.currency,
    status: refund.status,
  };
}

/** Retry unpaid direct-card operation with a new amount (new PaymentIntent). */
async function runRetryDirectCardOperation(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  const unitAmount = Number(data.unitAmount);

  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new HttpsError('invalid-argument', 'Minimum amount is CHF 0.50');
  }

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
  const row = snap.data() || {};

  if (row.status === 'paid') {
    throw new HttpsError('failed-precondition', 'Already paid');
  }
  if (row.chargeMode !== 'direct_card' && row.status !== 'pending_charge') {
    throw new HttpsError(
      'failed-precondition',
      'Only direct card charges can be retried — use Mail order page for payment links.',
    );
  }

  let customerId = row.stripeCustomerId;
  if (!customerId) {
    const customer = await stripeRequest('POST', '/customers', {
      name: row.customerName || 'Customer',
      ...(row.customerEmail ? { email: row.customerEmail } : {}),
      'metadata[franchiseId]': franchiseId,
      'metadata[resNo]': row.resNo || row.productName || '',
    });
    customerId = customer.id;
  }

  const oldPiId = String(row.paymentIntentId || '').trim();
  if (oldPiId.startsWith('pi_')) {
    try {
      const oldPi = await stripeRequest('GET', `/payment_intents/${encodeURIComponent(oldPiId)}`, null);
      if (['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(oldPi.status)) {
        await stripeRequest('POST', `/payment_intents/${encodeURIComponent(oldPiId)}/cancel`, {
          cancellation_reason: 'abandoned',
        });
      }
    } catch (e) {
      console.warn('[retryDirectCard] cancel old PI', e?.message);
    }
  }

  const resNo = row.resNo || row.productName || '';
  const category = row.category || 'damage';
  const currency = row.currency || 'chf';

  const pi = await stripeRequest('POST', '/payment_intents', {
    amount: Math.round(unitAmount),
    currency,
    customer: customerId,
    payment_method_types: ['card'],
    capture_method: 'automatic',
    description: `${category === 'traffic_fine' ? 'Traffic fine' : 'Damage'} — ${resNo}`,
    'metadata[franchiseId]': franchiseId,
    'metadata[flow]': 'direct_card_operation',
    'metadata[mailOrderId]': mailOrderId,
    'metadata[category]': category,
    'metadata[resNo]': resNo,
    'metadata[customerName]': row.customerName || '',
    'metadata[retry]': 'true',
  });

  await docRef.set(
    {
      stripeCustomerId: customerId,
      paymentIntentId: pi.id,
      amount: Math.round(unitAmount),
      status: 'pending_charge',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  const publishableKey = await resolvePublishableKey(franchiseId);
  if (!publishableKey) {
    throw new HttpsError('failed-precondition', 'Stripe publishable key not configured for CH');
  }

  await writeAudit(franchiseId, uid, 'direct_card_operation_retry', {
    mailOrderId,
    paymentIntentId: pi.id,
    amount: Math.round(unitAmount),
    previousPaymentIntentId: oldPiId || null,
  });

  return {
    ok: true,
    mailOrderId,
    paymentIntentId: pi.id,
    clientSecret: pi.client_secret,
    publishableKey,
  };
}

/** Off-session retry when card was saved on a prior attempt. */
async function runRetryDirectCardSavedPayment(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const mailOrderId = String(data.mailOrderId || '').trim();
  const unitAmount = Number(data.unitAmount);

  if (!mailOrderId) throw new HttpsError('invalid-argument', 'mailOrderId required');
  if (!Number.isFinite(unitAmount) || unitAmount < 50) {
    throw new HttpsError('invalid-argument', 'Minimum amount is CHF 0.50');
  }

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Operation not found');
  const row = snap.data() || {};

  if (row.status === 'paid') {
    throw new HttpsError('failed-precondition', 'Already paid');
  }
  const customerId = row.stripeCustomerId;
  const paymentMethodId = row.stripePaymentMethodId;
  if (!customerId || !paymentMethodId) {
    throw new HttpsError('failed-precondition', 'No saved card on this operation — enter card details.');
  }

  const resNo = row.resNo || row.productName || '';
  const category = row.category || 'damage';
  const currency = row.currency || 'chf';

  let charged;
  try {
    charged = await stripeRequest('POST', '/payment_intents', {
      amount: Math.round(unitAmount),
      currency,
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      capture_method: 'automatic',
      description: `${category === 'traffic_fine' ? 'Traffic fine' : 'Damage'} — ${resNo}`,
      'metadata[franchiseId]': franchiseId,
      'metadata[flow]': 'direct_card_operation',
      'metadata[mailOrderId]': mailOrderId,
      'metadata[resNo]': resNo,
      'metadata[retry]': 'saved_card',
    });
  } catch (e) {
    throw new HttpsError('failed-precondition', String(e?.message || 'Saved card charge failed'));
  }

  await docRef.set(
    {
      paymentIntentId: charged.id,
      amount: Math.round(unitAmount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await writeAudit(franchiseId, uid, 'direct_card_operation_retry_saved', {
    mailOrderId,
    paymentIntentId: charged.id,
    amount: Math.round(unitAmount),
  });

  return {
    ok: true,
    mailOrderId,
    paymentIntentId: charged.id,
    status: charged.status,
  };
}

async function runListMailOrders(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 100, 1), 200);
  const syncStripe = data.syncStripe === true;

  const snap = await mailOrdersCol(franchiseId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const rows = snap.docs.map((docSnap) => {
    const row = docSnap.data() || {};
    return enrichMailOrderRow({
      id: docSnap.id,
      franchiseId,
      productId: row.productId || '',
      productName: row.productName || '',
      resNo: row.resNo || row.productName || '',
      mailContent: row.mailContent || row.description || '',
      checkoutSessionId: row.checkoutSessionId || '',
      paymentUrl: row.paymentUrl || '',
      amount: row.amount ?? null,
      currency: row.currency || 'chf',
      status: deriveMailOrderUiStatus(row),
      rawStatus: row.status || 'unpaid',
      chargeMode: row.chargeMode || '',
      paymentIntentId: row.paymentIntentId || '',
      stripePaymentMethodId: row.stripePaymentMethodId || '',
      cardBrand: row.cardBrand || '',
      cardLast4: row.cardLast4 || '',
      cardExpMonth: row.cardExpMonth || null,
      cardExpYear: row.cardExpYear || null,
      cardholderName: row.cardholderName || row.customerName || '',
      emailSubject: row.emailSubject || '',
      emailBodyHtml: row.emailBodyHtml || '',
      customerEmail: row.customerEmail || '',
      createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
      paidAt: row.paidAt?.toDate?.()?.toISOString?.() || null,
      linkSentAt: row.linkSentAt?.toDate?.()?.toISOString?.() || null,
      linkValidUntil: row.linkValidUntil?.toDate?.()?.toISOString?.() || null,
      reminder1PlannedAt: row.reminder1PlannedAt?.toDate?.()?.toISOString?.() || null,
      reminder1Status: row.reminder1Status || 'planned',
      reminder2PlannedAt: row.reminder2PlannedAt?.toDate?.()?.toISOString?.() || null,
      reminder2Status: row.reminder2Status || 'planned',
      reminderSendingEnabled: row.reminderSendingEnabled === true,
      category: row.category || '',
      customerName: row.customerName || row.cardholderName || '',
      emailSentAt: row.emailSentAt?.toDate?.()?.toISOString?.() || null,
      emailSentOk: row.emailSentOk === true,
      documents: row.documents || [],
    });
  });

  const syncedRows = syncStripe
    ? await Promise.all(rows.map((row) => syncMailOrderPaymentStatus(row)))
    : rows;
  const visibility = canViewStripeFinancialTotals(profile) ? 'admin' : 'staff';
  const dailySummary = buildDailyFinancialSummary(syncedRows, { amountField: 'amount' });
  if (visibility === 'staff') {
    dailySummary.volume = null;
  }
  const enriched = syncedRows.map((row) => {
    const safe = enrichMailOrderRow(row);
    delete safe.accessToken;
    return redactMailOrderForStaff(safe, profile);
  });
  await writeAudit(franchiseId, uid, 'list_mail_orders', { count: enriched.length, visibility });
  return { orders: enriched, visibility, dailySummary };
}

const CH_TIMEZONE = 'Europe/Zurich';

function localDayKeyInTimezone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isUnixOnLocalDay(unixSec, timeZone, dayKey) {
  if (!unixSec) return false;
  const key = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number(unixSec) * 1000));
  return key === dayKey;
}

function localDayKeyFromUnix(unixSec, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number(unixSec) * 1000));
}

function addDaysToDayKey(dayKey, days, timeZone) {
  const parts = String(dayKey).split('-').map(Number);
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function resolvePaymentPeriodRange(period, timeZone, dayKey) {
  const endDayKey = String(dayKey || localDayKeyInTimezone(timeZone)).trim();
  const p = String(period || '1d').toLowerCase();
  if (p === 'all') {
    return { startDayKey: addDaysToDayKey(endDayKey, -89, timeZone), endDayKey, all: true };
  }
  const span = p === '7d' ? 6 : p === '30d' ? 29 : 0;
  return { startDayKey: addDaysToDayKey(endDayKey, -span, timeZone), endDayKey, all: false };
}

function isUnixInDayRange(unixSec, timeZone, startDayKey, endDayKey) {
  if (!unixSec) return false;
  const key = localDayKeyFromUnix(unixSec, timeZone);
  return key >= startDayKey && key <= endDayKey;
}

function resolveDepositDisplayStatus(tx, dep) {
  if (!dep && tx?.flowType !== 'deposit') return null;
  const initial = Number(dep?.initialAmount || tx?.depositInitialAmount) || 0;
  const current = Number(dep?.currentHoldAmount || dep?.initialAmount || tx?.depositCurrentHold) || 0;
  const depStatus = String(dep?.status || '').toLowerCase();
  const capturedAmount = Number(dep?.capturedAmount) || 0;

  if (depStatus === 'captured' || (tx?.bucket === 'successful' && tx?.flowType === 'deposit')) {
    if (capturedAmount > initial || current > initial) return 'captured_increased';
    return 'captured';
  }
  if (depStatus === 'authorized' || tx?.bucket === 'hold') {
    if (current > initial) return 'increased';
    return 'hold';
  }
  if (depStatus === 'cancelled' || tx?.bucket === 'cancelled') return 'cancelled';
  if (depStatus === 'pending_collection' || tx?.bucket === 'pending') return 'pending';
  return null;
}

/**
 * Buckets that come from a settled charge outcome and must never be
 * overwritten by PaymentIntent-level state (mirrors Stripe dashboard).
 */
const TERMINAL_CHARGE_BUCKETS = new Set(['failed', 'blocked', 'refunded', 'disputed']);

/**
 * Maps a Stripe Charge to a dashboard bucket exactly like the Stripe
 * Transactions list: Failed / Blocked / Disputed / Refunded / Uncaptured /
 * Succeeded. A declined attempt is FAILED — never "cancelled".
 * @param {object} ch Stripe charge
 * @return {string} bucket id
 */
function paymentBucketFromCharge(ch) {
  if (ch.status === 'failed') {
    return ch.outcome && ch.outcome.type === 'blocked' ? 'blocked' : 'failed';
  }
  if (ch.disputed) return 'disputed';
  if (ch.refunded || Number(ch.amount_refunded) > 0) return 'refunded';
  if (ch.status === 'succeeded' && ch.captured === false) return 'hold';
  if (ch.status === 'succeeded') return 'successful';
  return 'pending';
}

/**
 * Maps a Stripe PaymentIntent to a dashboard bucket. A PI whose last
 * attempt was declined (last_payment_error) is FAILED, not canceled.
 * @param {object} pi Stripe payment intent
 * @return {string} bucket id
 */
function paymentBucketFromIntent(pi) {
  if (pi.status === 'canceled') return 'cancelled';
  if (pi.status === 'requires_capture') return 'hold';
  if (Number(pi.amount_capturable) > 0 && pi.status !== 'succeeded') return 'hold';
  if (pi.status === 'succeeded') return 'successful';
  if (pi.last_payment_error) return 'failed';
  return 'pending';
}

/**
 * Stripe-dashboard naming for each bucket.
 * @param {string} bucket bucket id
 * @return {string} display label
 */
function statusLabelForBucket(bucket) {
  if (bucket === 'hold') return 'Uncaptured';
  if (bucket === 'successful') return 'Succeeded';
  if (bucket === 'cancelled') return 'Canceled';
  if (bucket === 'failed') return 'Failed';
  if (bucket === 'blocked') return 'Blocked';
  if (bucket === 'refunded') return 'Refunded';
  if (bucket === 'disputed') return 'Disputed';
  return 'Pending';
}

/**
 * Extracts human-readable failure details from a charge outcome so the UI
 * can show the decline reason as a note on the row.
 * @param {object} ch Stripe charge
 * @return {{message: (string|null), code: (string|null), declineCode: (string|null)}|null} detail
 */
function chargeFailureDetail(ch) {
  if (!ch) return null;
  const outcome = ch.outcome || {};
  const message = ch.failure_message || outcome.seller_message || null;
  const code = ch.failure_code || outcome.reason || null;
  if (!message && !code) return null;
  return {
    message,
    code,
    declineCode: outcome.network_decline_code || ch.failure_code || null,
  };
}

function extractCardInfo(pmd) {
  if (!pmd) {
    return { cardBrand: null, cardLast4: null, paymentMethod: 'card' };
  }
  const card = pmd.card || pmd.card_present || null;
  if (card) {
    return {
      cardBrand: card.brand || 'card',
      cardLast4: card.last4 || '',
      paymentMethod: pmd.card_present ? 'card_present' : (card.brand || 'card'),
    };
  }
  if (pmd.type === 'link') {
    return { cardBrand: 'link', cardLast4: '', paymentMethod: 'link' };
  }
  return {
    cardBrand: pmd.type || 'card',
    cardLast4: '',
    paymentMethod: pmd.type || 'card',
  };
}

function holdAmountForCharge(ch) {
  if (ch.status === 'succeeded' && ch.captured === false) {
    return Number(ch.amount) || 0;
  }
  return 0;
}

function holdAmountForIntent(pi) {
  if (pi.status === 'requires_capture' || Number(pi.amount_capturable) > 0) {
    return Number(pi.amount_capturable) || Number(pi.amount) || 0;
  }
  return 0;
}

function detectPaymentChannel(chargeDetails, metadata) {
  const meta = metadata || {};
  if (chargeDetails?.card_present) return 'terminal';
  if (meta.mailOrder === 'true' || meta.flow === 'mail_order' || meta.mailOrderId) {
    return 'mail_order';
  }
  return 'online';
}

function extractCardholderName(charge, pi, meta) {
  const customerObj = (charge?.customer && typeof charge.customer === 'object' && charge.customer) ||
    (pi?.customer && typeof pi.customer === 'object' && pi.customer) ||
    null;
  const fromCharge = charge?.billing_details?.name || '';
  const cardPresent = charge?.payment_method_details?.card_present;
  const fromPresent = cardPresent?.cardholder_name || '';
  const fromCustomer = customerObj?.name || '';
  const fromMeta = meta?.customerName || pi?.metadata?.customerName || '';
  const name = String(fromCharge || fromPresent || fromCustomer || fromMeta || '').trim();
  if (name && !/^cus_|^guest$/i.test(name)) return name;
  return '';
}

function extractCardholderEmail(charge, pi, meta) {
  const customerObj = (charge?.customer && typeof charge.customer === 'object' && charge.customer) ||
    (pi?.customer && typeof pi.customer === 'object' && pi.customer) ||
    null;
  const fromCharge = charge?.billing_details?.email || charge?.receipt_email || '';
  const fromCustomer = customerObj?.email || '';
  const fromMeta = meta?.customerEmail || pi?.metadata?.customerEmail || '';
  return String(fromCharge || fromCustomer || fromMeta || '').trim();
}

function channelLabel(channel, meta) {
  if (meta?.flow === 'saved_token_charge') return 'Direct charge';
  if (meta?.flow === 'direct_card_operation') return 'Manual charge';
  if (meta?.flow === 'deposit') {
    if (String(meta?.source || '').toLowerCase() === 'wheelsys') return 'WheelSys · Deposit';
    return 'Deposit';
  }
  if (channel === 'terminal') return 'Terminal';
  if (channel === 'mail_order') return 'Mail order';
  return 'Online';
}

function depositSourceFromMeta(meta) {
  if (meta?.flow !== 'deposit') return null;
  const src = String(meta?.source || 'terminal').toLowerCase();
  return src === 'wheelsys' ? 'wheelsys' : 'terminal';
}

function buildDisplayDescription(tx) {
  const parts = [];
  if (tx.flowType === 'deposit') parts.push('Deposit');
  if (tx.plate) parts.push(tx.plate);
  if (tx.reference) parts.push(tx.reference);
  if (tx.customerName) parts.push(tx.customerName);
  if (parts.length) return parts.join(' · ');
  return tx.description || '—';
}

function buildSummary(transactions) {
  const summary = {
    successful: { count: 0, amount: 0 },
    hold: { count: 0, amount: 0 },
    pending: { count: 0, amount: 0 },
    cancelled: { count: 0, amount: 0 },
    failed: { count: 0, amount: 0 },
    blocked: { count: 0, amount: 0 },
    refunded: { count: 0, amount: 0 },
    disputed: { count: 0, amount: 0 },
  };
  for (const tx of transactions) {
    const bucket = summary[tx.bucket];
    if (!bucket) continue;
    bucket.count += 1;
    if (tx.bucket === 'successful') {
      bucket.amount += Number(tx.amountReceived || tx.amount || 0);
    } else if (tx.bucket === 'hold') {
      bucket.amount += Number(tx.holdAmount || tx.amount || 0);
    } else if (tx.bucket === 'refunded') {
      bucket.amount += Number(tx.refundedAmount || tx.amount || 0);
    } else {
      bucket.amount += Number(tx.amount || 0);
    }
  }
  return summary;
}

async function runListPayments(request) {
  const { uid, profile } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const timeZone = CH_TIMEZONE;
  const dayKey = String(data.dayKey || localDayKeyInTimezone(timeZone)).trim();
  const period = String(data.period || '1d').trim();
  const range = resolvePaymentPeriodRange(period, timeZone, dayKey);
  const lookbackSec = Math.min(Math.max(Number(data.lookbackDays) || 90, 1), 90) * 86400;
  const createdGte = Math.floor(Date.now() / 1000) - lookbackSec;

  const dayFilter = (unixSec) =>
    range.all
      ? isUnixInDayRange(unixSec, timeZone, range.startDayKey, range.endDayKey)
      : isUnixOnLocalDay(unixSec, timeZone, dayKey);

  // Firestore reads are independent of the Stripe list calls — run all four
  // together so total latency is max() of them instead of their sum.
  const [chargesRes, intentsRes, mailSnap, depSnapSettled] = await Promise.all([
    stripeRequest('GET', '/charges', {
      limit: 100,
      'created[gte]': createdGte,
      expand: ['data.customer'],
    }),
    stripeRequest('GET', '/payment_intents', {
      limit: 100,
      'created[gte]': createdGte,
      expand: ['data.customer'],
    }),
    mailOrdersCol(franchiseId).orderBy('createdAt', 'desc').limit(100).get(),
    admin
      .firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeDeposits')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get()
      .catch(() => null),
  ]);

  const byKey = new Map();
  // pi id -> array of charge-derived rows (one row per attempt, like Stripe)
  const rowsByPi = new Map();

  for (const ch of chargesRes.data || []) {
    if (!dayFilter(ch.created)) continue;
    const meta = ch.metadata || {};
    if (meta.franchiseId && String(meta.franchiseId).toUpperCase() !== franchiseId) continue;
    const bucket = paymentBucketFromCharge(ch);
    const cardInfo = extractCardInfo(ch.payment_method_details);
    const failure = chargeFailureDetail(ch);
    const key = ch.id;
    byKey.set(key, {
      id: ch.id,
      paymentIntentId: ch.payment_intent || null,
      chargeId: ch.id,
      bucket,
      status: ch.status,
      statusLabel: statusLabelForBucket(bucket),
      amount: ch.amount,
      amountReceived: ch.amount_captured || ch.amount,
      holdAmount: holdAmountForCharge(ch),
      currency: ch.currency,
      channel: detectPaymentChannel(ch.payment_method_details, meta),
      channelLabel: channelLabel(detectPaymentChannel(ch.payment_method_details, meta), meta),
      flowType: meta.flow === 'deposit' ? 'deposit' : meta.flow || null,
      stripeFlow: meta.flow || null,
      depositSource: depositSourceFromMeta(meta),
      paymentMethod: cardInfo.paymentMethod,
      cardBrand: cardInfo.cardBrand,
      cardLast4: cardInfo.cardLast4,
      customerName: extractCardholderName(ch, null, meta),
      description: ch.description || meta.customerReference || meta.plate || '',
      customerEmail: extractCardholderEmail(ch, null, meta),
      plate: meta.plate || '',
      resCode: meta.resNo || meta.resCode || meta.customerReference || '',
      reference: meta.resNo || meta.customerReference || meta.resCode || '',
      mailOrderId: meta.mailOrderId || null,
      failureMessage: failure?.message || null,
      failureCode: failure?.code || null,
      declineCode: failure?.declineCode || null,
      refundedAmount: Number(ch.amount_refunded) || 0,
      created: ch.created,
      createdAt: new Date(ch.created * 1000).toISOString(),
    });
    if (ch.payment_intent) {
      const list = rowsByPi.get(ch.payment_intent) || [];
      list.push(byKey.get(key));
      rowsByPi.set(ch.payment_intent, list);
    }
  }

  for (const pi of intentsRes.data || []) {
    if (!dayFilter(pi.created)) continue;
    const meta = pi.metadata || {};
    if (meta.franchiseId && String(meta.franchiseId).toUpperCase() !== franchiseId) continue;
    const bucket = paymentBucketFromIntent(pi);
    const chargeRows = rowsByPi.get(pi.id);
    if (chargeRows && chargeRows.length) {
      for (const existing of chargeRows) {
        // Charge-level outcomes (Failed/Blocked/Refunded/Disputed) are what
        // Stripe shows — never overwrite them with PI-level state.
        const isTerminal = TERMINAL_CHARGE_BUCKETS.has(existing.bucket);
        const holdReleased = existing.bucket === 'hold' && pi.status === 'canceled';
        if (!isTerminal && (existing.bucket === 'pending' || holdReleased)) {
          existing.bucket = holdReleased ? 'cancelled' : bucket;
          existing.status = pi.status;
          existing.statusLabel = statusLabelForBucket(existing.bucket);
        }
        if (existing.bucket === 'successful') {
          existing.amountReceived = pi.amount_received || existing.amountReceived;
        }
        if (existing.bucket === 'hold') {
          existing.holdAmount = holdAmountForIntent(pi) || existing.holdAmount;
        }
        if (!existing.customerName) {
          existing.customerName = extractCardholderName(null, pi, meta);
        }
        if (!existing.customerEmail) {
          existing.customerEmail = extractCardholderEmail(null, pi, meta);
        }
        if (!existing.resCode) existing.resCode = meta.resNo || meta.resCode || '';
        if (meta.resNo) existing.reference = meta.resNo;
        if (meta.mailOrderId) existing.mailOrderId = meta.mailOrderId;
        if (meta.flow) {
          existing.stripeFlow = meta.flow;
          if (meta.flow === 'deposit') {
            existing.flowType = 'deposit';
            existing.channelLabel = 'Deposit';
          } else {
            existing.channelLabel = channelLabel(existing.channel, meta);
            existing.flowType = meta.flow;
          }
        }
      }
      continue;
    }
    byKey.set(pi.id, {
      id: pi.id,
      paymentIntentId: pi.id,
      chargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : null,
      bucket,
      status: pi.status,
      statusLabel: statusLabelForBucket(bucket),
      amount: pi.amount,
      amountReceived: pi.amount_received || 0,
      holdAmount: holdAmountForIntent(pi),
      currency: pi.currency,
      channel: detectPaymentChannel(null, meta),
      channelLabel: channelLabel(detectPaymentChannel(null, meta), meta),
      flowType: meta.flow === 'deposit' ? 'deposit' : meta.flow || null,
      stripeFlow: meta.flow || null,
      depositSource: depositSourceFromMeta(meta),
      paymentMethod: Array.isArray(pi.payment_method_types) ? pi.payment_method_types[0] : 'card',
      cardBrand: null,
      cardLast4: null,
      customerName: extractCardholderName(null, pi, meta),
      description: pi.description || meta.customerReference || meta.plate || '',
      customerEmail: extractCardholderEmail(null, pi, meta),
      plate: meta.plate || '',
      resCode: meta.resNo || meta.resCode || meta.customerReference || '',
      reference: meta.resNo || meta.customerReference || meta.mailOrderId || '',
      mailOrderId: meta.mailOrderId || null,
      failureMessage: pi.last_payment_error?.message || null,
      failureCode: pi.last_payment_error?.code || null,
      declineCode: pi.last_payment_error?.decline_code || null,
      created: pi.created,
      createdAt: new Date(pi.created * 1000).toISOString(),
    });
    rowsByPi.set(pi.id, [byKey.get(pi.id)]);
  }

  for (const docSnap of mailSnap.docs) {
    const row = docSnap.data() || {};
    const createdAt = row.createdAt?.toDate?.();
    if (!createdAt) continue;
    if (!dayFilter(Math.floor(createdAt.getTime() / 1000))) continue;

    const sessionId = row.checkoutSessionId || row.stripeSessionId;
    const piKey = row.stripePaymentIntentId || row.paymentIntentId;
    const piRows = piKey ? rowsByPi.get(piKey) : null;
    if (piRows && piRows.length) {
      for (const existing of piRows) {
        existing.customerName =
          existing.customerName || row.customerName || row.cardholderName || '';
        existing.customerEmail = existing.customerEmail || row.customerEmail || '';
        existing.resCode = row.resNo || existing.resCode || '';
        existing.resNo = row.resNo || existing.resNo || '';
        if (row.resNo) existing.reference = row.resNo;
        existing.mailOrderId = docSnap.id;
        if (row.cardBrand && !existing.cardBrand) existing.cardBrand = row.cardBrand;
        if (row.cardLast4 && !existing.cardLast4) existing.cardLast4 = row.cardLast4;
        if (row.chargeMode === 'direct_card') {
          existing.channelLabel = 'Manual charge';
        } else if (!existing.channelLabel || existing.channelLabel === 'Online') {
          existing.channelLabel = 'Mail order';
        }
      }
      continue;
    }
    const key = sessionId || `mail_${docSnap.id}`;
    if (byKey.has(key)) continue;

    const mailUiStatus = deriveMailOrderUiStatus(row);
    const mailBucket =
      mailUiStatus === 'paid'
        ? 'successful'
        : mailUiStatus === 'failed'
          ? 'failed'
          : 'pending';
    byKey.set(key, {
      id: docSnap.id,
      paymentIntentId: piKey || null,
      chargeId: null,
      checkoutSessionId: sessionId,
      bucket: mailBucket,
      status: mailUiStatus,
      statusLabel: statusLabelForBucket(mailBucket),
      failureMessage: row.chargeErrorMessage || null,
      failureCode: row.chargeErrorCode || null,
      amount: row.amount,
      amountReceived: row.status === 'paid' ? row.amount : 0,
      currency: row.currency || 'chf',
      channel: 'mail_order',
      channelLabel: 'Mail order',
      flowType: null,
      paymentMethod: 'link',
      customerName: row.customerName || row.cardholderName || '',
      description: row.productName || row.description || '',
      customerEmail: row.customerEmail || '',
      plate: row.plate || '',
      resCode: row.resNo || '',
      resNo: row.resNo || '',
      reference: row.resNo || row.productName || docSnap.id,
      mailOrderId: docSnap.id,
      created: Math.floor(createdAt.getTime() / 1000),
      createdAt: createdAt.toISOString(),
    });
  }

  const transactions = [...byKey.values()]
    .map((tx) => ({
      ...tx,
      displayDescription: buildDisplayDescription(tx),
    }))
    .sort((a, b) => b.created - a.created);

  try {
    const depSnap = depSnapSettled;
    const depByPi = new Map();
    for (const docSnap of depSnap?.docs || []) {
      const row = docSnap.data() || {};
      if (row.paymentIntentId) {
        depByPi.set(row.paymentIntentId, { id: docSnap.id, ...row });
      }
    }

    for (const tx of transactions) {
      if (!tx.paymentIntentId) continue;
      const dep = depByPi.get(tx.paymentIntentId);
      if (!dep) continue;
      tx.flowType = 'deposit';
      tx.depositId = dep.id;
      const source = String(dep.source || tx.depositSource || 'terminal').toLowerCase();
      tx.depositSource = source;
      tx.channelLabel = source === 'wheelsys' ? 'WheelSys · Deposit' : 'Deposit';
      tx.depositInitialAmount = dep.initialAmount || null;
      tx.depositMaxAuthAmount = dep.maxAuthAmount || null;
      tx.depositCurrentHold = dep.currentHoldAmount || dep.initialAmount || null;
      tx.tokenSaved = dep.tokenSaved === true;
      tx.depositDisplayStatus = resolveDepositDisplayStatus(tx, dep);
      tx.customerName = tx.customerName || dep.customerName || '';
      tx.customerEmail = tx.customerEmail || dep.customerEmail || '';
      tx.resCode = dep.resCode || dep.reference || tx.resCode || '';
      tx.plate = tx.plate || dep.plate || '';
      tx.reference = tx.reference || dep.reference || dep.resCode || '';
      tx.cancelledBy = dep.cancelledBy || null;
      tx.cancelledByName = dep.cancelledByName || null;
      tx.cancelledAt = dep.cancelledAt?.toDate?.()?.toISOString?.()
        || (typeof dep.cancelledAt === 'string' ? dep.cancelledAt : null);
      tx.cancelReason = dep.cancelReason || '';
      tx.createdByName = dep.createdByName || null;
      if (TERMINAL_CHARGE_BUCKETS.has(tx.bucket)) {
        // A declined attempt on a deposit stays Failed/Blocked — the deposit
        // doc must not repaint it as a hold or capture.
        tx.depositDisplayStatus = null;
        continue;
      }
      if (tx.depositDisplayStatus === 'hold' || tx.depositDisplayStatus === 'increased') {
        tx.bucket = 'hold';
        tx.statusLabel = tx.depositDisplayStatus === 'increased' ? 'Increased' : 'Uncaptured';
      } else if (tx.depositDisplayStatus === 'captured' || tx.depositDisplayStatus === 'captured_increased') {
        tx.bucket = 'successful';
        tx.statusLabel =
          tx.depositDisplayStatus === 'captured_increased' ? 'Captured (after increase)' : 'Captured';
      }
    }
  } catch (e) {
    console.warn('[runListPayments] deposit enrich', e?.message || e);
  }

  const summary = buildSummary(transactions);
  const visibility = canViewStripeFinancialTotals(profile) ? 'admin' : 'staff';
  const dailySummary = buildDailyFinancialSummary(transactions, {
    amountField: 'amountReceived',
    dayKey,
    timeZone,
  });
  const safeTransactions = visibility === 'admin'
    ? transactions
    : transactions.map((tx) => redactPaymentForStaff(tx, profile));
  const safeSummary = visibility === 'admin'
    ? summary
    : {
        successful: { count: dailySummary.count, amount: dailySummary.volume },
        hold: { count: 0, amount: 0 },
        pending: { count: 0, amount: 0 },
        cancelled: { count: 0, amount: 0 },
        failed: { count: 0, amount: 0 },
        blocked: { count: 0, amount: 0 },
        refunded: { count: 0, amount: 0 },
        disputed: { count: 0, amount: 0 },
      };

  return {
    dayKey,
    period,
    startDayKey: range.startDayKey,
    endDayKey: range.endDayKey,
    timeZone,
    transactions: safeTransactions,
    summary: safeSummary,
    dailySummary,
    visibility,
    syncedAt: new Date().toISOString(),
  };
}

async function runLogStaffAction(request) {
  await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const uid = request.auth?.uid || 'unknown';
  const action = String(data.action || 'payment_ui_click').slice(0, 80);
  const detail =
    data.detail && typeof data.detail === 'object' && !Array.isArray(data.detail) ? data.detail : {};
  await writeAudit(franchiseId, uid, action, { ...detail, uiOnly: true });
  return { ok: true };
}

async function runListAudit(request) {
  await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 40, 1), 100);

  const snap = await admin
    .firestore()
    .collection('franchises')
    .doc(franchiseId)
    .collection('stripeFinancialAudit')
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const entries = snap.docs.map((doc) => {
    const row = doc.data() || {};
    return {
      id: doc.id,
      action: row.action,
      detail: row.detail || {},
      uid: row.uid,
      actorName: row.actorName || row.detail?.actorName || null,
      actorEmail: row.actorEmail || row.detail?.actorEmail || null,
      createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  });

  const missingActorUids = entries
    .filter((e) => !e.actorName && e.uid)
    .map((e) => e.uid);
  if (missingActorUids.length > 0) {
    const unique = [...new Set(missingActorUids)];
    const nameByUid = new Map();
    await Promise.all(
      unique.map(async (uid) => {
        try {
          const userSnap = await admin.firestore().collection('users').doc(uid).get();
          const d = userSnap.exists ? userSnap.data() || {} : {};
          nameByUid.set(uid, String(d.displayName || d.email || uid).slice(0, 120));
        } catch {
          nameByUid.set(uid, String(uid).slice(0, 8));
        }
      }),
    );
    for (const entry of entries) {
      if (!entry.actorName && entry.uid) {
        entry.actorName = nameByUid.get(entry.uid) || entry.uid.slice(0, 8);
      }
    }
  }

  return { entries };
}

function renderMailOrderHtml(title, message) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#f4f6f8;color:#1a2332;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}.card{max-width:420px;background:#fff;border:1px solid #d8dee6;border-radius:8px;padding:28px 24px;text-align:center}h1{font-size:18px;margin:0 0 10px}p{margin:0;color:#5c6778;font-size:14px;line-height:1.5}</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

async function runMailOrderCheckoutRedirect(req, res) {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const parts = String(req.path || '').split('/').filter(Boolean);
  if (parts.length < 4 || parts[0] !== 'pay' || parts[1] !== 'mo') {
    res.status(404).send('Not found');
    return;
  }

  let franchiseId;
  try {
    franchiseId = normalizeFranchiseId(parts[2]);
    assertSwitzerlandFranchise(franchiseId);
  } catch {
    res.status(404).send('Not found');
    return;
  }

  const mailOrderId = String(parts[3] || '').trim();
  const token = String(req.query?.t || '').trim();
  if (!mailOrderId || !token || token.length > 128) {
    res.status(404).send('Not found');
    return;
  }

  const docRef = mailOrdersCol(franchiseId).doc(mailOrderId);
  const snap = await docRef.get();
  if (!snap.exists) {
    res.status(404).send('Not found');
    return;
  }

  const row = snap.data() || {};
  if (!timingSafeTokenMatch(token, row.accessToken)) {
    res.status(404).send('Not found');
    return;
  }

  if (row.status === 'paid') {
    res
      .status(200)
      .send(
        renderMailOrderHtml(
          'Payment already completed',
          'This payment link has already been used. If you need assistance, please contact Green Motion.',
        ),
      );
    return;
  }

  const linkValidUntilMs = row.linkValidUntil?.toDate?.()?.getTime?.() || 0;
  const fallbackValidUntil = row.linkSentAt?.toDate?.()?.getTime?.() || row.createdAt?.toDate?.()?.getTime?.() || 0;
  const validUntilMs =
    linkValidUntilMs ||
    (fallbackValidUntil
      ? addDaysToDate(new Date(fallbackValidUntil), MAIL_ORDER_LINK_VALID_DAYS).getTime()
      : 0);
  if (validUntilMs && validUntilMs < Date.now()) {
    res
      .status(410)
      .send(
        renderMailOrderHtml(
          'Payment link expired',
          'This payment link is no longer active. Please contact Green Motion for a new link.',
        ),
      );
    return;
  }

  const productId = String(row.productId || '').trim();
  if (!productId) {
    res.status(404).send('Not found');
    return;
  }

  try {
    const session = await createCheckoutSessionForMailOrder({
      franchiseId,
      mailOrderId,
      productId,
      saveCustomerInfo: row.saveCustomerInfo === true,
      customerEmail: String(row.customerEmail || '').trim(),
      uid: row.createdByUid || 'public_checkout',
    });

    await docRef.set(
      {
        checkoutSessionId: session.id || '',
        lastCheckoutSessionAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    if (!session.url) {
      res.status(503).send('Payment unavailable');
      return;
    }
    res.redirect(302, session.url);
  } catch (e) {
    console.error('[stripeFinancial] mail order checkout redirect', mailOrderId, e?.message);
    res.status(503).send('Payment unavailable');
  }
}

const callableOpts = { cors: true, secrets: [stripeCHSecretKey] };
const httpOpts = { cors: false, secrets: [stripeCHSecretKey] };

module.exports = {
  callableOpts,
  httpOpts,
  stripeCHSecretKey,
  runGetConfig,
  runListDisputes,
  runGetDispute,
  runListProducts,
  runGetProduct,
  runCreateProduct,
  runUpdateProduct,
  runArchiveProduct,
  runDeleteProduct,
  runCreateMailOrderPaymentLink,
  runCreateMailOrderPayment,
  runCreateDirectCardOperation,
  runFinalizeDirectCardOperation,
  runRefundPayment,
  runPersistDirectCardSnapshot,
  runRetryDirectCardOperation,
  runRetryDirectCardSavedPayment,
  runSendMailOrderEmail,
  runAttachMailOrderDocuments,
  runListMailOrders,
  runListPayments,
  runListAudit,
  runLogStaffAction,
  runMailOrderCheckoutRedirect,
};
