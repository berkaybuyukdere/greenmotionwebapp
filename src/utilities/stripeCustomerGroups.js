import {
  depositStatusDisplay,
  auditStatusDisplay,
  formatAuditOperation,
  enrichDepositsFromStripePayments,
  stripeTxToSyntheticDeposit,
  depositIsCapturable,
  collectGroupDeposits,
} from './stripeDepositDisplay';

function stripeTxStatusDisplay(tx) {
  const bucket = String(tx?.bucket || '').toLowerCase();
  if (bucket === 'hold') return { variant: 'hold', label: 'Uncaptured' };
  if (bucket === 'successful') return { variant: 'success', label: 'Succeeded' };
  if (bucket === 'cancelled') {
    const reason = String(tx?.cancelReason || '').toLowerCase();
    if (reason.includes('expired') || reason.includes('auto-release')) {
      return {
        variant: 'danger',
        label: 'Expired',
        note: 'Hold expired automatically — not a staff refund',
      };
    }
    return { variant: 'danger', label: 'Canceled' };
  }
  if (bucket === 'failed' || bucket === 'blocked') return { variant: 'danger', label: 'Failed' };
  if (bucket === 'refunded') return { variant: 'refunded', label: 'Refunded' };
  if (bucket === 'pending') return { variant: 'warning', label: 'Pending' };
  return { variant: 'neutral', label: tx?.statusLabel || 'Unknown' };
}

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

export function buildStripeCustomerGroups(deposits = [], mailOrders = [], stripeTransactions = []) {
  const mergedDeposits = enrichDepositsFromStripePayments(deposits, stripeTransactions);
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

  mergedDeposits.forEach((dep) => {
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

  const seenStripePi = new Set(
    mergedDeposits.map((d) => d.paymentIntentId).filter(Boolean),
  );

  stripeTransactions.forEach((tx) => {
    if (!tx?.paymentIntentId || seenStripePi.has(tx.paymentIntentId)) return;
    const synthetic = stripeTxToSyntheticDeposit(tx);
    if (!synthetic) return;
    const key = groupKeyFor({
      resCode: synthetic.resCode || synthetic.reference,
      customerName: synthetic.customerName,
      customerEmail: synthetic.customerEmail,
    });
    const entry = map.get(key) || {
      id: key,
      resCode: '',
      customerName: '',
      customerEmail: '',
      deposits: [],
      mailOrders: [],
      directOrders: [],
      stripePayments: [],
    };
    entry.deposits.push(synthetic);
    if (!entry.resCode) entry.resCode = synthetic.resCode || synthetic.reference || '';
    if (!entry.customerName) entry.customerName = synthetic.customerName || '';
    if (!entry.customerEmail) entry.customerEmail = synthetic.customerEmail || '';
    upsert(key, entry);
    seenStripePi.add(tx.paymentIntentId);
  });

  stripeTransactions.forEach((tx) => {
    if (!tx?.paymentIntentId) return;
    let entry = null;
    for (const g of map.values()) {
      const linked =
        g.deposits.some((d) => d.paymentIntentId === tx.paymentIntentId) ||
        (g.directOrders || []).some((o) => o.paymentIntentId === tx.paymentIntentId) ||
        (g.mailOrders || []).some((o) => o.paymentIntentId === tx.paymentIntentId);
      if (linked) {
        entry = g;
        break;
      }
    }
    if (!entry) {
      const key = groupKeyFor({
        resCode: tx.resCode || tx.resNo || tx.reference,
        customerName: tx.customerName,
        customerEmail: tx.customerEmail,
      });
      entry = map.get(key);
    }
    if (!entry) return;
    if (!entry.stripePayments) entry.stripePayments = [];
    if (
      entry.stripePayments.some(
        (r) => r.paymentIntentId === tx.paymentIntentId && r.chargeId === tx.chargeId,
      )
    ) {
      return;
    }
    entry.stripePayments.push(tx);
    upsert(entry.id, entry);
  });

  return [...map.values()]
    .map((group) => ({
      ...group,
      deposits: sortByCreatedDesc(group.deposits),
      mailOrders: sortByCreatedDesc(group.mailOrders),
      directOrders: sortByCreatedDesc(group.directOrders),
      stripePayments: sortByCreatedDesc(group.stripePayments || [], 'createdAt'),
      displayTitle: displayTitle(group),
    }))
    .sort((a, b) => a.displayTitle.localeCompare(b.displayTitle));
}

/** All payment rows for customer workbench — deposits, direct, mail, and Stripe API rows. */
export function buildCustomerTransactionRows(group) {
  const items = [];
  const seen = new Set();

  const push = (row) => {
    const key = row.depositId || row.paymentIntentId || row.id;
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    items.push(row);
  };

  for (const d of collectGroupDeposits(group)) {
    const linkedHold = (group?.stripePayments || []).find(
      (tx) =>
        String(tx.bucket || '').toLowerCase() === 'hold' &&
        (tx.paymentIntentId === d.paymentIntentId ||
          String(tx.resCode || tx.resNo || tx.reference || '').trim().toUpperCase() ===
            String(d.resCode || d.reference || '').trim().toUpperCase()),
    );
    const st = depositStatusDisplay(d);
    push({
      id: `dep-${d.id || d.paymentIntentId}`,
      depositId: d.id || null,
      paymentIntentId: d.paymentIntentId || null,
      type: 'Deposit',
      at: d.createdAt,
      amount: d.capturedAmount || d.currentHoldAmount || d.initialAmount || 0,
      currency: d.currency || 'chf',
      statusLabel: st.label,
      statusVariant: st.variant,
      statusNote: st.note || null,
      cancelReason: d.cancelReason || null,
      cancelledByName: d.cancelledByName || null,
      cardBrand: d.cardBrand,
      cardLast4: d.cardLast4,
      capturable: depositIsCapturable(d, linkedHold),
      tokenSaved: d.tokenSaved || Boolean(d.stripePaymentMethodId),
    });
  }

  for (const o of group?.directOrders || []) {
    const pendingDirect =
      o.status !== 'paid' && o.status !== 'failed' && o.chargeMode === 'direct_card';
    push({
      id: `dir-${o.id}`,
      mailOrderId: o.id,
      paymentIntentId: o.paymentIntentId || null,
      type: 'Direct charge',
      at: o.paidAt || o.createdAt,
      paidAt: o.paidAt || null,
      amount: o.amount,
      currency: o.currency || 'chf',
      statusLabel: o.status === 'paid' ? 'Succeeded' : o.status === 'failed' ? 'Failed' : 'Pending',
      statusVariant: o.status === 'paid' ? 'success' : o.status === 'failed' ? 'danger' : 'warning',
      statusNote: pendingDirect
        ? 'Manual charge started — card was not entered. Use New payment to charge the saved deposit card instead.'
        : null,
      cardBrand: o.cardBrand,
      cardLast4: o.cardLast4,
      customerName: o.customerName || group?.customerName || '',
      customerEmail: o.customerEmail || group?.customerEmail || '',
      category: o.category || null,
      resCode: o.resNo || group?.resCode || '',
      reference: o.resNo || '',
      channelLabel: 'Direct charge',
      bucket: o.status === 'paid' ? 'successful' : o.status === 'failed' ? 'failed' : 'pending',
      createdAt: o.createdAt,
    });
  }

  for (const o of group?.mailOrders || []) {
    push({
      id: `mail-${o.id}`,
      mailOrderId: o.id,
      paymentIntentId: o.paymentIntentId || null,
      type: 'Mail order',
      at: o.paidAt || o.createdAt,
      paidAt: o.paidAt || null,
      amount: o.amount,
      currency: o.currency || 'chf',
      statusLabel: o.status === 'paid' ? 'Succeeded' : 'Unpaid',
      statusVariant: o.status === 'paid' ? 'success' : 'unpaid',
      cardBrand: o.cardBrand,
      cardLast4: o.cardLast4,
      customerName: o.customerName || group?.customerName || '',
      customerEmail: o.customerEmail || group?.customerEmail || '',
      category: o.category || null,
      resCode: o.resNo || group?.resCode || '',
      reference: o.resNo || '',
      channelLabel: 'Mail order',
      bucket: o.status === 'paid' ? 'successful' : 'pending',
      createdAt: o.createdAt,
    });
  }

  for (const tx of group?.stripePayments || []) {
    const st = stripeTxStatusDisplay(tx);
    push({
      id: `stripe-${tx.chargeId || tx.id || tx.paymentIntentId}`,
      depositId: tx.depositId || null,
      paymentIntentId: tx.paymentIntentId || null,
      type: tx.channelLabel || 'Stripe',
      at: tx.createdAt || (tx.created ? new Date(tx.created * 1000).toISOString() : null),
      amount:
        tx.bucket === 'successful'
          ? Number(tx.amountReceived || tx.amount) || 0
          : Number(tx.holdAmount || tx.amount) || 0,
      currency: tx.currency || 'chf',
      statusLabel: st.label,
      statusVariant: st.variant,
      cardBrand: tx.cardBrand,
      cardLast4: tx.cardLast4,
      capturable: tx.bucket === 'hold',
      customerName: tx.customerName || group?.customerName || '',
      customerEmail: tx.customerEmail || group?.customerEmail || '',
      category: tx.category || null,
      resCode: tx.resCode || tx.resNo || group?.resCode || '',
      reference: tx.reference || tx.resNo || '',
      channelLabel: tx.channelLabel || null,
      bucket: tx.bucket,
      flowType: tx.flowType || null,
      createdAt: tx.createdAt,
      amountReceived: tx.amountReceived,
      plate: tx.plate || '',
    });
  }

  return items.sort((a, b) => {
    const ta = a.at ? new Date(a.at).getTime() : 0;
    const tb = b.at ? new Date(b.at).getTime() : 0;
    return tb - ta;
  });
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
