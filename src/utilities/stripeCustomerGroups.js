import {
  depositStatusDisplay,
  auditStatusDisplay,
  formatAuditOperation,
} from './stripeDepositDisplay';

function groupKeyFor({ resCode = '', customerName = '', customerEmail = '' } = {}) {
  const res = String(resCode || '').trim().toUpperCase();
  if (res) return `res:${res}`;
  const email = String(customerEmail || '').trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = String(customerName || '').trim().toLowerCase();
  if (name) return `name:${name}`;
  return `anon:${Math.random().toString(36).slice(2)}`;
}

function displayTitle({ resCode, customerName, customerEmail, id }) {
  if (resCode) return resCode;
  if (customerName) return customerName;
  if (customerEmail) return customerEmail;
  return id;
}

function sortByCreatedDesc(rows, field = 'createdAt') {
  return [...rows].sort((a, b) => {
    const ta = a?.[field] ? new Date(a[field]).getTime() : 0;
    const tb = b?.[field] ? new Date(b[field]).getTime() : 0;
    return tb - ta;
  });
}

/** Staff direct card charge (New operation) — not a payment-link mail order. */
export function isDirectCardOrder(order) {
  if (!order) return false;
  if (order.chargeMode === 'direct_card') return true;
  if (order.rawStatus === 'pending_charge') return true;
  const hasLink = Boolean(String(order.paymentUrl || '').trim() || String(order.checkoutSessionId || '').trim());
  const hasProduct = Boolean(String(order.productId || '').trim());
  return !hasLink && !hasProduct;
}

export function isPaymentLinkMailOrder(order) {
  return Boolean(order) && !isDirectCardOrder(order);
}

export function buildStripeCustomerGroups(deposits = [], mailOrders = []) {
  const map = new Map();

  const upsert = (key, patch) => {
    const prev = map.get(key) || {
      id: key,
      resCode: '',
      customerName: '',
      customerEmail: '',
      deposits: [],
      mailOrders: [],
      directOrders: [],
    };
    map.set(key, {
      ...prev,
      ...patch,
      deposits: patch.deposits ?? prev.deposits,
      mailOrders: patch.mailOrders ?? prev.mailOrders,
      directOrders: patch.directOrders ?? prev.directOrders,
    });
  };

  deposits.forEach((dep) => {
    const key = groupKeyFor({
      resCode: dep.resCode || dep.reference,
      customerName: dep.customerName,
      customerEmail: dep.customerEmail,
    });
    const entry = map.get(key) || {
      id: key,
      resCode: '',
      customerName: '',
      customerEmail: '',
      deposits: [],
      mailOrders: [],
      directOrders: [],
    };
    entry.deposits.push(dep);
    if (!entry.resCode) entry.resCode = dep.resCode || dep.reference || '';
    if (!entry.customerName) entry.customerName = dep.customerName || '';
    if (!entry.customerEmail) entry.customerEmail = dep.customerEmail || '';
    upsert(key, entry);
  });

  mailOrders.forEach((order) => {
    const key = groupKeyFor({
      resCode: order.resNo,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
    });
    const entry = map.get(key) || {
      id: key,
      resCode: '',
      customerName: '',
      customerEmail: '',
      deposits: [],
      mailOrders: [],
      directOrders: [],
    };
    if (isDirectCardOrder(order)) {
      entry.directOrders.push(order);
    } else {
      entry.mailOrders.push(order);
    }
    if (!entry.resCode) entry.resCode = order.resNo || '';
    if (!entry.customerName) entry.customerName = order.customerName || '';
    if (!entry.customerEmail) entry.customerEmail = order.customerEmail || '';
    upsert(key, entry);
  });

  return [...map.values()]
    .map((group) => ({
      ...group,
      deposits: sortByCreatedDesc(group.deposits),
      mailOrders: sortByCreatedDesc(group.mailOrders),
      directOrders: sortByCreatedDesc(group.directOrders),
      displayTitle: displayTitle(group),
    }))
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
}

const AUDIT_ACTION_LABELS = {
  deposit_created: 'Deposit created',
  deposit_sent_to_terminal: 'Sent to terminal',
  deposit_collection_confirmed: 'Deposit authorized',
  deposit_incremented: 'Hold increased',
  deposit_captured: 'Hold captured',
  deposit_released: 'Deposit released',
  deposit_cancelled: 'Deposit released',
  payment_hold_cancelled: 'Hold released',
  saved_token_charge: 'Saved card charged',
  deposit_email_sent: 'Confirmation email sent',
};

/** Human-readable audit line for customer / deposit activity panels. */
export function formatStripeAuditEntry(entry) {
  const d = entry?.detail || {};
  const actor = entry?.actorName || d.actorName || d.releasedBy || d.capturedBy || 'Staff';
  const label = AUDIT_ACTION_LABELS[entry?.action] || String(entry?.action || 'Event').replace(/_/g, ' ');
  const parts = [label, `by ${actor}`];
  if (d.resCode) parts.push(d.resCode);
  if (d.customerName) parts.push(d.customerName);
  return parts.join(' · ');
}

/** Match audit rows to a customer group (deposit ids, PI ids, RES, email). */
export function filterAuditForCustomerGroup(auditEntries, group) {
  const depositIds = new Set((group?.deposits || []).map((dep) => dep.id).filter(Boolean));
  const piIds = new Set(
    [
      ...(group?.deposits || []).map((dep) => dep.paymentIntentId),
      ...(group?.directOrders || []).map((o) => o.paymentIntentId),
      ...(group?.mailOrders || []).map((o) => o.paymentIntentId),
    ].filter(Boolean),
  );
  const res = String(group?.resCode || '').trim().toLowerCase();
  const email = String(group?.customerEmail || '').trim().toLowerCase();
  const name = String(group?.customerName || '').trim().toLowerCase();

  return (auditEntries || []).filter((entry) => {
    const d = entry.detail || {};
    if (d.depositId && depositIds.has(d.depositId)) return true;
    if (d.paymentIntentId && piIds.has(d.paymentIntentId)) return true;
    const blob = JSON.stringify(d).toLowerCase();
    if (res && blob.includes(res)) return true;
    if (email && blob.includes(email)) return true;
    if (name && name.length > 2 && blob.includes(name)) return true;
    return false;
  });
}

/** Unified timeline for customer overview (deposits + audit). */
export function buildCustomerTimeline(group, auditEntries = []) {
  const events = [];
  for (const dep of group?.deposits || []) {
    const st = depositStatusDisplay(dep);
    if (dep.createdAt) {
      events.push({
        id: `dep-create-${dep.id}`,
        at: dep.createdAt,
        title: 'Deposit authorized',
        detail: dep.createdByName ? `By ${dep.createdByName}` : null,
        amount: dep.initialAmount,
        currency: dep.currency,
        statusVariant: st.variant,
        statusLabel: st.label,
        cardBrand: dep.cardBrand,
        cardLast4: dep.cardLast4,
      });
    }
    if (dep.cancelledAt) {
      events.push({
        id: `dep-cancel-${dep.id}`,
        at: dep.cancelledAt,
        title: 'Hold released',
        detail: dep.cancelledByName ? `By ${dep.cancelledByName}` : dep.cancelReason || null,
        amount: dep.currentHoldAmount || dep.initialAmount,
        currency: dep.currency,
        statusVariant: 'danger',
        statusLabel: 'Canceled',
        cardBrand: dep.cardBrand,
        cardLast4: dep.cardLast4,
      });
    }
    if (dep.capturedAt || dep.status === 'captured') {
      events.push({
        id: `dep-cap-${dep.id}`,
        at: dep.capturedAt || dep.updatedAt || dep.createdAt,
        title: 'Payment captured',
        detail: dep.capturedByName ? `By ${dep.capturedByName}` : null,
        amount: dep.capturedAmount || dep.currentHoldAmount,
        currency: dep.currency,
        statusVariant: 'success',
        statusLabel: 'Succeeded',
        cardBrand: dep.cardBrand,
        cardLast4: dep.cardLast4,
      });
    }
  }
  for (const entry of filterAuditForCustomerGroup(auditEntries, group)) {
    const st = auditStatusDisplay(entry);
    events.push({
      id: entry.id || entry.action,
      at: entry.createdAt,
      title: formatAuditOperation(entry),
      detail: [entry.detail?.resCode, entry.detail?.customerName].filter(Boolean).join(' · ') || null,
      amount: entry.detail?.newAmount || entry.detail?.initialAmount || entry.detail?.chargedAmount || null,
      currency: 'chf',
      statusVariant: st.variant,
      statusLabel: st.label,
    });
  }
  const seen = new Set();
  return events
    .filter((e) => {
      const key = `${e.at}-${e.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return Boolean(e.at);
    })
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
