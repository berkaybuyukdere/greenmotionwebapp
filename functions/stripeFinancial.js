/**
 * Stripe Financial — CH mail-order products + chargebacks (server-side only).
 * Live secret: Firebase secret STRIPE_CH_SECRET_KEY (Switzerland).
 * Publishable key: franchises/CH/stripeConfig/public
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

const stripeCHSecretKey = defineSecret('STRIPE_CH_SECRET_KEY');

const FINANCIAL_ROLES = new Set(['globaladmin', 'superadmin', 'admin', 'manager']);

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
    throw new HttpsError('permission-denied', 'Financial access required (admin or manager).');
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
    if (status === 'paid' && row.status !== 'paid') {
      await mailOrdersCol(row.franchiseId).doc(row.id).set(
        {
          status: 'paid',
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          stripeSessionStatus: session.status || null,
        },
        { merge: true },
      );
    }
    return {
      ...row,
      status,
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
    const msg = data?.error?.message || `Stripe error ${res.status}`;
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
  return {
    id: d.id,
    amount: d.amount,
    currency: d.currency,
    status: d.status,
    reason: d.reason,
    charge: d.charge,
    paymentIntent: d.payment_intent,
    created: d.created,
    evidenceDetails: d.evidence_details || null,
    isChargeRefundable: d.is_charge_refundable,
    metadata: d.metadata || {},
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

async function runListDisputes(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 50, 1), 100);
  const startingAfter = data.startingAfter ? String(data.startingAfter) : undefined;

  const params = { limit };
  if (startingAfter) params.starting_after = startingAfter;

  const result = await stripeRequest('GET', '/disputes', params);
  const disputes = (result.data || []).map(mapDispute);
  await writeAudit(franchiseId, uid, 'list_disputes', { count: disputes.length });
  return {
    disputes,
    hasMore: result.has_more === true,
    lastId: disputes.length ? disputes[disputes.length - 1].id : null,
  };
}

async function runGetDispute(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const disputeId = String(data.disputeId || '').trim();
  if (!disputeId) throw new HttpsError('invalid-argument', 'disputeId required');

  const d = await stripeRequest('GET', `/disputes/${encodeURIComponent(disputeId)}`, null);
  await writeAudit(franchiseId, uid, 'get_dispute', { disputeId });
  return { dispute: mapDispute(d) };
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
  for (const price of pricesRes.data || []) {
    try {
      await stripeRequest('DELETE', `/prices/${encodeURIComponent(price.id)}`, null);
    } catch (_) {
      await stripeRequest('POST', `/prices/${encodeURIComponent(price.id)}`, { active: false });
    }
  }

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
  if (!productId) throw new HttpsError('invalid-argument', 'productId required');

  const p = await stripeRequest('GET', `/products/${encodeURIComponent(productId)}`, {
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
  const appBase =
    String(process.env.STRIPE_CHECKOUT_RETURN_URL || 'https://vehiclesentinel.com').replace(
      /\/$/,
      ''
    );

  const mailOrderRef = mailOrdersCol(franchiseId).doc();
  const mailOrderId = mailOrderRef.id;
  const priceObj =
    typeof p.default_price === 'object' && p.default_price ? p.default_price : null;

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
      createdByUid: uid,
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

  const session = await stripeRequest('POST', '/checkout/sessions', sessionParams);
  const unitAmount = priceObj?.unit_amount ?? null;
  const currency = priceObj?.currency || 'chf';

  await mailOrderRef.set({
    franchiseId,
    productId,
    productName: p.name || '',
    checkoutSessionId: session.id,
    paymentUrl: session.url || '',
    amount: unitAmount,
    currency,
    status: 'unpaid',
    customerEmail: customerEmail || '',
    createdByUid: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeAudit(franchiseId, uid, 'create_payment_link', {
    productId,
    mailOrderId,
    checkoutSessionId: session.id,
    saveCustomerInfo,
  });
  return {
    url: session.url,
    id: session.id,
    mailOrderId,
    active: session.status !== 'expired',
    saveCustomerInfo,
    paymentStatus: 'unpaid',
    raw: session,
  };
}

async function runListMailOrders(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const limit = Math.min(Math.max(Number(data.limit) || 100, 1), 200);

  const snap = await mailOrdersCol(franchiseId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const rows = snap.docs.map((docSnap) => {
    const row = docSnap.data() || {};
    return {
      id: docSnap.id,
      franchiseId,
      productId: row.productId || '',
      productName: row.productName || '',
      checkoutSessionId: row.checkoutSessionId || '',
      paymentUrl: row.paymentUrl || '',
      amount: row.amount ?? null,
      currency: row.currency || 'chf',
      status: row.status === 'paid' ? 'paid' : 'unpaid',
      customerEmail: row.customerEmail || '',
      createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
      paidAt: row.paidAt?.toDate?.()?.toISOString?.() || null,
    };
  });

  const orders = await Promise.all(rows.map((row) => syncMailOrderPaymentStatus(row)));
  await writeAudit(franchiseId, uid, 'list_mail_orders', { count: orders.length });
  return { orders };
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

function paymentBucketFromCharge(ch) {
  if (ch.status === 'failed') return 'cancelled';
  if (ch.status === 'succeeded' && ch.captured === false) return 'hold';
  if (ch.status === 'succeeded') return 'successful';
  return 'pending';
}

function paymentBucketFromIntent(pi) {
  if (pi.status === 'canceled') return 'cancelled';
  if (pi.status === 'requires_capture') return 'hold';
  if (Number(pi.amount_capturable) > 0 && pi.status !== 'succeeded') return 'hold';
  if (pi.status === 'succeeded') return 'successful';
  return 'pending';
}

function statusLabelForBucket(bucket) {
  if (bucket === 'hold') return 'Hold';
  if (bucket === 'successful') return 'Paid';
  if (bucket === 'cancelled') return 'Canceled';
  return 'Pending';
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
  const fromCharge = charge?.billing_details?.name || '';
  const cardPresent = charge?.payment_method_details?.card_present;
  const fromPresent = cardPresent?.cardholder_name || '';
  const fromMeta = meta?.customerName || pi?.metadata?.customerName || '';
  return String(fromCharge || fromPresent || fromMeta || '').trim();
}

function channelLabel(channel, meta) {
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
  };
  for (const tx of transactions) {
    const bucket = summary[tx.bucket];
    if (!bucket) continue;
    bucket.count += 1;
    if (tx.bucket === 'successful') {
      bucket.amount += Number(tx.amountReceived || tx.amount || 0);
    } else if (tx.bucket === 'hold') {
      bucket.amount += Number(tx.holdAmount || tx.amount || 0);
    } else {
      bucket.amount += Number(tx.amount || 0);
    }
  }
  return summary;
}

async function runListPayments(request) {
  const { uid } = await assertFinancialCallable(request);
  const data = request.data || {};
  const franchiseId = normalizeFranchiseId(data.franchiseId);
  assertSwitzerlandFranchise(franchiseId);
  const timeZone = CH_TIMEZONE;
  const dayKey = String(data.dayKey || localDayKeyInTimezone(timeZone)).trim();
  const lookbackSec = Math.min(Math.max(Number(data.lookbackDays) || 21, 1), 90) * 86400;
  const createdGte = Math.floor(Date.now() / 1000) - lookbackSec;

  const [chargesRes, intentsRes] = await Promise.all([
    stripeRequest('GET', '/charges', { limit: 100, 'created[gte]': createdGte }),
    stripeRequest('GET', '/payment_intents', { limit: 100, 'created[gte]': createdGte }),
  ]);

  const byKey = new Map();

  for (const ch of chargesRes.data || []) {
    if (!isUnixOnLocalDay(ch.created, timeZone, dayKey)) continue;
    const meta = ch.metadata || {};
    if (meta.franchiseId && String(meta.franchiseId).toUpperCase() !== franchiseId) continue;
    const bucket = paymentBucketFromCharge(ch);
    const cardInfo = extractCardInfo(ch.payment_method_details);
    const key = ch.payment_intent || ch.id;
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
      flowType: meta.flow === 'deposit' ? 'deposit' : null,
      depositSource: depositSourceFromMeta(meta),
      paymentMethod: cardInfo.paymentMethod,
      cardBrand: cardInfo.cardBrand,
      cardLast4: cardInfo.cardLast4,
      customerName: extractCardholderName(ch, null, meta),
      description: ch.description || meta.customerReference || meta.plate || '',
      customerEmail: ch.billing_details?.email || '',
      plate: meta.plate || '',
      reference: meta.customerReference || meta.productId || '',
      created: ch.created,
      createdAt: new Date(ch.created * 1000).toISOString(),
    });
  }

  for (const pi of intentsRes.data || []) {
    if (!isUnixOnLocalDay(pi.created, timeZone, dayKey)) continue;
    const meta = pi.metadata || {};
    if (meta.franchiseId && String(meta.franchiseId).toUpperCase() !== franchiseId) continue;
    const bucket = paymentBucketFromIntent(pi);
    const existing = byKey.get(pi.id);
    if (existing) {
      existing.bucket = bucket;
      existing.status = pi.status;
      existing.statusLabel = statusLabelForBucket(bucket);
      existing.amountReceived = pi.amount_received || existing.amountReceived;
      existing.holdAmount = holdAmountForIntent(pi) || existing.holdAmount;
      if (!existing.customerName) {
        existing.customerName = extractCardholderName(null, pi, meta);
      }
      if (meta.flow === 'deposit') {
        existing.flowType = 'deposit';
        existing.channelLabel = 'Deposit';
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
      flowType: meta.flow === 'deposit' ? 'deposit' : null,
      depositSource: depositSourceFromMeta(meta),
      paymentMethod: Array.isArray(pi.payment_method_types) ? pi.payment_method_types[0] : 'card',
      cardBrand: null,
      cardLast4: null,
      customerName: extractCardholderName(null, pi, meta),
      description: pi.description || meta.customerReference || meta.plate || '',
      customerEmail: '',
      plate: meta.plate || '',
      reference: meta.customerReference || meta.productId || meta.mailOrderId || '',
      created: pi.created,
      createdAt: new Date(pi.created * 1000).toISOString(),
    });
  }

  const mailSnap = await mailOrdersCol(franchiseId)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();

  for (const docSnap of mailSnap.docs) {
    const row = docSnap.data() || {};
    const createdAt = row.createdAt?.toDate?.();
    if (!createdAt) continue;
    const rowDayKey = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(createdAt);
    if (rowDayKey !== dayKey) continue;

    let synced = row;
    synced = await syncMailOrderPaymentStatus({
      id: docSnap.id,
      franchiseId,
      ...row,
      checkoutSessionId: row.checkoutSessionId || row.stripeSessionId,
      status: row.status === 'paid' ? 'paid' : 'unpaid',
    });

    const sessionId = row.checkoutSessionId || row.stripeSessionId;
    const piKey = synced.stripePaymentIntentId || synced.paymentIntentId;
    if (piKey && byKey.has(piKey)) continue;
    const key = sessionId || `mail_${docSnap.id}`;
    if (byKey.has(key)) continue;

    byKey.set(key, {
      id: docSnap.id,
      paymentIntentId: piKey || null,
      chargeId: null,
      checkoutSessionId: sessionId,
      bucket: synced.status === 'paid' ? 'successful' : 'pending',
      status: synced.status === 'paid' ? 'paid' : 'unpaid',
      statusLabel: synced.status === 'paid' ? 'Succeeded' : 'Pending',
      amount: row.amount,
      amountReceived: synced.status === 'paid' ? row.amount : 0,
      currency: row.currency || 'chf',
      channel: 'mail_order',
      channelLabel: 'Mail order',
      flowType: null,
      paymentMethod: 'link',
      customerName: row.customerName || '',
      description: row.productName || row.description || '',
      customerEmail: row.customerEmail || '',
      plate: row.plate || '',
      reference: row.productId || docSnap.id,
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
    const depSnap = await admin
      .firestore()
      .collection('franchises')
      .doc(franchiseId)
      .collection('stripeDeposits')
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();

    const depByPi = new Map();
    for (const docSnap of depSnap.docs) {
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
    }
  } catch (e) {
    console.warn('[runListPayments] deposit enrich', e?.message || e);
  }

  const summary = buildSummary(transactions);

  await writeAudit(franchiseId, uid, 'list_payments', {
    dayKey,
    count: transactions.length,
  });

  return {
    dayKey,
    timeZone,
    transactions,
    summary,
    syncedAt: new Date().toISOString(),
  };
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
      createdAt: row.createdAt?.toDate?.()?.toISOString?.() || null,
    };
  });
  return { entries };
}

const callableOpts = { cors: true, secrets: [stripeCHSecretKey] };

module.exports = {
  callableOpts,
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
  runListMailOrders,
  runListPayments,
  runListAudit,
};
