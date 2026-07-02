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

/** Group Stripe deposits + mail orders by RES / email / name (CH customers hub). */
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
