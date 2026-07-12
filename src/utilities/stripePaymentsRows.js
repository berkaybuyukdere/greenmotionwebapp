/** Merge Stripe API payments + Firestore deposits into unified payment rows. */

import { buildStripeCustomerGroups } from './stripeCustomerGroups';
import {
  depositStatusDisplay,
  depositAmountMinor,
  depositResCode,
  depositCustomerName,
  depositCustomerEmail,
} from './stripeDepositDisplay';

function isInternalStripeId(value) {
  const s = String(value || '').trim();
  return /^(prod_|pi_|ch_|cs_|mail_|price_|in_|sub_)/i.test(s);
}

function pickResCode(...candidates) {
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s && !isInternalStripeId(s)) return s;
  }
  return '';
}

function parseIdentityFromDescription(description) {
  const desc = String(description || '').trim();
  if (!desc) return { name: '', res: '' };
  const dash = desc.match(/(?:Damage|Traffic fine|Extra|Deposit)\s*—\s*(.+)$/i) || desc.match(/—\s*(.+)$/);
  if (!dash) return { name: '', res: '' };
  const tail = dash[1].trim();
  if (/^RES-/i.test(tail) || /^\d{4,6}$/.test(tail)) return { name: '', res: tail };
  return { name: tail, res: '' };
}

export function enrichPaymentRowIdentity(row) {
  const parsed = parseIdentityFromDescription(row.description);
  const customerName = (() => {
    const raw = String(row.customerName || row.cardholderName || '').trim();
    if (raw && !isInternalStripeId(raw)) return raw;
    if (parsed.name) return parsed.name;
    if (row.customerEmail) return row.customerEmail.split('@')[0];
    if (row.cardLast4) return `Card •••• ${row.cardLast4}`;
    return '';
  })();

  const resCode =
    pickResCode(row.resCode, row.resNo, row.reference, parsed.res) ||
    pickResCode(row.plate);

  return {
    ...row,
    customerName,
    resCode,
    resNo: resCode || row.resNo || '',
  };
}

export function enrichPaymentsFromMailOrders(rows, mailOrders = []) {
  const byPi = new Map();
  const byId = new Map();
  mailOrders.forEach((order) => {
    if (order.paymentIntentId) byPi.set(order.paymentIntentId, order);
    if (order.id) byId.set(order.id, order);
  });

  return rows.map((row) => {
    const order =
      (row.paymentIntentId && byPi.get(row.paymentIntentId)) ||
      (row.mailOrderId && byId.get(row.mailOrderId)) ||
      null;

    if (!order) return enrichPaymentRowIdentity(row);

    return enrichPaymentRowIdentity({
      ...row,
      mailOrderId: order.id,
      customerName: order.customerName || order.cardholderName || row.customerName || '',
      customerEmail: order.customerEmail || row.customerEmail || '',
      resCode: order.resNo || row.resCode || '',
      resNo: order.resNo || row.resNo || '',
      reference: order.resNo || row.reference || '',
      cardBrand: row.cardBrand || order.cardBrand || '',
      cardLast4: row.cardLast4 || order.cardLast4 || '',
      channelLabel:
        order.chargeMode === 'direct_card'
          ? 'Manual charge'
          : row.channelLabel || 'Mail order',
    });
  });
}

const TERMINAL_CHARGE_BUCKETS = new Set(['failed', 'blocked', 'refunded', 'disputed']);

function mergeDepositIntoTransaction(tx, dep) {
  if (!dep) return tx;
  const depPi = String(dep.paymentIntentId || '').trim();
  const txPi = String(tx.paymentIntentId || '').trim();
  if (!depPi || !txPi || depPi !== txPi) return tx;

  const identity = {
    customerName: dep.customerName || tx.customerName || '',
    customerEmail: dep.customerEmail || tx.customerEmail || '',
    resCode: dep.resCode || dep.reference || tx.resCode || '',
    plate: dep.plate || tx.plate || '',
    reference: dep.reference || dep.resCode || tx.reference || '',
    cancelledBy: dep.cancelledBy || tx.cancelledBy || null,
    cancelledByName: dep.cancelledByName || tx.cancelledByName || null,
    cancelledAt: dep.cancelledAt || tx.cancelledAt || null,
    cancelReason: dep.cancelReason || tx.cancelReason || '',
    createdByName: dep.createdByName || tx.createdByName || null,
    tokenSaved: dep.tokenSaved === true || tx.tokenSaved,
    cardBrand: dep.cardBrand || tx.cardBrand || null,
    cardLast4: dep.cardLast4 || tx.cardLast4 || null,
  };

  const next = {
    ...tx,
    ...identity,
    depositId: dep.id,
    flowType: 'deposit',
    depositCurrentHold: dep.currentHoldAmount || dep.initialAmount || tx.depositCurrentHold,
    channelLabel: dep.source === 'wheelsys' ? 'WheelSys · Deposit' : 'Deposit',
  };

  // A declined attempt stays Failed/Blocked exactly like Stripe shows it —
  // the deposit doc state must not repaint it as hold/captured/canceled.
  if (TERMINAL_CHARGE_BUCKETS.has(tx.bucket)) {
    return next;
  }

  if (dep.status === 'captured' || dep.stripeStatus === 'succeeded') {
    return {
      ...next,
      bucket: 'successful',
      depositDisplayStatus: 'captured',
      statusLabel: 'Succeeded',
      stripeFailed: false,
      amountReceived: dep.capturedAmount || next.amountReceived || next.amount || dep.initialAmount,
    };
  }
  const stripeCanceled =
    dep.stripeStatus === 'canceled' ||
    dep.stripeStatus === 'cancelled' ||
    dep.status === 'cancelled';
  if (stripeCanceled || tx.bucket === 'cancelled') {
    const reason = String(dep.cancelReason || tx.cancelReason || '').toLowerCase();
    const expired = reason.includes('expired') || reason.includes('auto-release');
    return {
      ...next,
      bucket: 'cancelled',
      depositDisplayStatus: 'cancelled',
      statusLabel: expired ? 'Expired' : 'Canceled',
      cancelReason:
        dep.cancelReason ||
        tx.cancelReason ||
        (expired ? 'Authorization expired (Stripe auto-release) — not a staff refund' : ''),
    };
  }
  if (dep.status === 'authorized' || dep.stripeStatus === 'requires_capture') {
    return {
      ...next,
      bucket: 'hold',
      depositDisplayStatus: 'hold',
      statusLabel: 'Uncaptured',
    };
  }
  if (
    dep.stripeStatus === 'requires_capture' ||
    dep.stripeBucket === 'hold' ||
    tx.bucket === 'hold'
  ) {
    if (dep.status === 'pending_collection') {
      return {
        ...next,
        bucket: 'hold',
        depositDisplayStatus: 'hold',
        statusLabel: 'Uncaptured',
      };
    }
  }
  if (dep.status === 'pending_collection' && tx.bucket !== 'successful' && tx.bucket !== 'cancelled') {
    return {
      ...next,
      bucket: tx.bucket === 'hold' ? 'hold' : 'pending',
      depositDisplayStatus: 'pending',
      statusLabel: 'Pending',
    };
  }
  if (dep.status === 'cancelled') {
    const st = depositStatusDisplay(dep);
    return {
      ...next,
      bucket: 'cancelled',
      depositDisplayStatus: 'cancelled',
      statusLabel: st.label,
      cancelReason: dep.cancelReason || next.cancelReason,
      cancelledByName: dep.cancelledByName || next.cancelledByName,
    };
  }
  return next;
}

function depositToSyntheticTransaction(dep) {
  const st = depositStatusDisplay(dep);
  let bucket = 'pending';
  if (st.label === 'Succeeded') bucket = 'successful';
  else if (st.label === 'Uncaptured' || st.label === 'Increased') bucket = 'hold';
  else if (st.label === 'Canceled' || st.label === 'Expired') bucket = 'cancelled';
  else if (st.label === 'Failed') bucket = 'failed';

  const createdMs = dep.createdAt ? new Date(dep.createdAt).getTime() : 0;
  const amountMinor = depositAmountMinor(dep);

  return {
    id: dep.id,
    paymentIntentId: dep.paymentIntentId || null,
    depositId: dep.id,
    flowType: 'deposit',
    amount: dep.initialAmount || amountMinor || 0,
    holdAmount: dep.currentHoldAmount || dep.initialAmount || amountMinor || 0,
    amountReceived: dep.capturedAmount || (bucket === 'successful' ? amountMinor : null),
    currency: dep.currency || 'chf',
    customerName: depositCustomerName(dep),
    customerEmail: depositCustomerEmail(dep),
    resCode: depositResCode(dep) === '—' ? dep.resCode || '' : depositResCode(dep),
    plate: dep.plate || '',
    reference: dep.reference || dep.resCode || '',
    displayDescription: dep.resCode || dep.reference || dep.customerName || 'Deposit',
    createdAt: dep.createdAt || null,
    created: createdMs ? Math.floor(createdMs / 1000) : 0,
    bucket,
    depositDisplayStatus:
      st.label === 'Increased'
        ? 'increased'
        : st.label === 'Succeeded'
          ? 'captured'
          : st.label === 'Uncaptured'
            ? 'hold'
            : st.label === 'Canceled' || st.label === 'Expired'
              ? 'cancelled'
              : 'pending',
    statusLabel: st.label,
    cancelReason: dep.cancelReason || '',
    cancelledByName: dep.cancelledByName || null,
    cancelledAt: dep.cancelledAt || null,
    tokenSaved: dep.tokenSaved === true,
    failureMessage: st.note || dep.terminalFailureMessage || dep.lastPaymentError || null,
    channelLabel: dep.source === 'wheelsys' ? 'WheelSys · Deposit' : 'Deposit',
    tokenSaved: dep.tokenSaved === true,
    cancelledBy: dep.cancelledBy || null,
    cancelledByName: dep.cancelledByName || null,
    cancelledAt: dep.cancelledAt || null,
    cancelReason: dep.cancelReason || '',
    createdByName: dep.createdByName || null,
    cardBrand: dep.cardBrand || null,
    cardLast4: dep.cardLast4 || null,
    stripeStatus: dep.stripeStatus || null,
    source: dep.source || 'terminal',
  };
}

export function isDirectPaymentRow(row) {
  if (!row) return false;
  const flow = row.stripeFlow || row.flowType;
  if (flow === 'direct_card_operation' || flow === 'saved_token_charge') return true;
  if (row.channelLabel === 'Manual charge' || row.channelLabel === 'Direct charge') return true;
  if (row.bucket === 'successful' && !row.depositId && flow && flow !== 'deposit') return true;
  return false;
}

export function filterDirectPaymentRows(rows = []) {
  return rows.filter(isDirectPaymentRow);
}

export function mergePaymentsAndDeposits(transactions = [], deposits = [], mailOrders = []) {
  const depositByPi = new Map();
  deposits.forEach((d) => {
    if (d.paymentIntentId) depositByPi.set(d.paymentIntentId, d);
  });

  const merged = transactions.map((tx) => {
    const dep = tx.paymentIntentId ? depositByPi.get(tx.paymentIntentId) : null;
    return mergeDepositIntoTransaction(tx, dep);
  });

  const seenPi = new Set(merged.map((tx) => tx.paymentIntentId).filter(Boolean));
  const seenDepId = new Set(merged.map((tx) => tx.depositId).filter(Boolean));

  const orphans = deposits
    .filter((dep) => {
      if (dep.id && seenDepId.has(dep.id)) return false;
      if (dep.paymentIntentId && seenPi.has(dep.paymentIntentId)) return false;
      return true;
    })
    .map(depositToSyntheticTransaction);

  return enrichPaymentsFromMailOrders([...merged, ...orphans], mailOrders);
}

export function resolvePaymentGroup(row, groups, deposits, mailOrders) {
  const pi = row?.paymentIntentId;
  if (pi) {
    const matched = groups.find(
      (g) =>
        g.deposits.some((d) => d.paymentIntentId === pi) ||
        g.directOrders?.some((o) => o.paymentIntentId === pi) ||
        g.mailOrders?.some((o) => o.paymentIntentId === pi),
    );
    if (matched) return matched;
  }

  const mailOrder = mailOrders.find((o) => o.paymentIntentId === pi || o.id === row?.mailOrderId);
  const dep = deposits.find((d) => d.id === row?.depositId || d.paymentIntentId === pi);
  if (mailOrder || dep) {
    const built = buildStripeCustomerGroups(dep ? [dep] : [], mailOrder ? [mailOrder] : []);
    return built[0] || null;
  }
  return null;
}

export function paymentAmountMinor(row) {
  if (row.bucket === 'hold') {
    return Number(row.holdAmount || row.amount) || 0;
  }
  if (row.bucket === 'successful') {
    return Number(row.amountReceived || row.amount) || 0;
  }
  return Number(row.amount || row.holdAmount) || 0;
}

export function paymentFailureNote(row) {
  const msg = String(row.failureMessage || '').trim();
  const code = String(row.declineCode || row.failureCode || '').trim();
  if (msg && code && !msg.toLowerCase().includes(code.toLowerCase())) {
    return `${msg} (${code})`;
  }
  return msg || code || '';
}

export function paymentStatusDisplay(row) {
  if (row.bucket === 'failed') {
    return { variant: 'danger', label: 'Failed', note: paymentFailureNote(row) };
  }
  if (row.bucket === 'blocked') {
    return { variant: 'danger', label: 'Blocked', note: paymentFailureNote(row) };
  }
  if (row.bucket === 'refunded') {
    return { variant: 'refunded', label: 'Refunded' };
  }
  if (row.bucket === 'disputed') {
    return { variant: 'warning', label: 'Disputed' };
  }
  if (row.depositDisplayStatus === 'increased') {
    return { variant: 'purple', label: 'Increased' };
  }
  if (row.bucket === 'successful' || row.depositDisplayStatus === 'captured') {
    return { variant: 'success', label: 'Succeeded' };
  }
  if (row.bucket === 'cancelled' || row.depositDisplayStatus === 'cancelled') {
    if (row.flowType === 'deposit' || row.depositId) {
      const st = depositStatusDisplay({
        status: 'cancelled',
        cancelReason: row.cancelReason,
        cancelledByName: row.cancelledByName,
        stripeStatus: row.stripeStatus,
      });
      return {
        variant: st.variant,
        label: st.label,
        ...(st.note ? { note: st.note } : {}),
      };
    }
    return { variant: 'danger', label: 'Canceled' };
  }
  if (row.bucket === 'hold' || row.depositDisplayStatus === 'hold') {
    return { variant: 'hold', label: 'Uncaptured' };
  }
  if (row.bucket === 'pending') {
    return { variant: 'warning', label: row.statusLabel || 'Pending' };
  }
  return { variant: 'neutral', label: row.statusLabel || 'Unknown' };
}

export function paymentMatchesFilter(row, filter) {
  if (filter === 'all') return true;
  if (filter === 'hold') return row.bucket === 'hold';
  if (filter === 'captured') return row.bucket === 'successful';
  if (filter === 'released') return row.bucket === 'cancelled';
  if (filter === 'failed') return row.bucket === 'failed' || row.bucket === 'blocked';
  if (filter === 'refunded') return row.bucket === 'refunded' || row.bucket === 'disputed';
  if (filter === 'increased') return row.depositDisplayStatus === 'increased';
  return true;
}

export function computePaymentKpi(rows) {
  let hold = 0;
  let holdVol = 0;
  let captured = 0;
  let capturedVol = 0;
  let released = 0;
  let increased = 0;
  let failed = 0;
  let refunded = 0;
  for (const row of rows) {
    if (paymentMatchesFilter(row, 'hold')) {
      hold += 1;
      holdVol += paymentAmountMinor(row);
    }
    if (paymentMatchesFilter(row, 'captured')) {
      captured += 1;
      capturedVol += paymentAmountMinor(row);
    }
    if (paymentMatchesFilter(row, 'released')) released += 1;
    if (paymentMatchesFilter(row, 'increased')) increased += 1;
    if (paymentMatchesFilter(row, 'failed')) failed += 1;
    if (paymentMatchesFilter(row, 'refunded')) refunded += 1;
  }
  return {
    total: rows.length,
    hold,
    holdVol,
    captured,
    capturedVol,
    released,
    increased,
    failed,
    refunded,
  };
}

export function sortPaymentRows(rows, sortBy = 'date_desc') {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortBy === 'amount_desc' || sortBy === 'amount_asc') {
      const aa = paymentAmountMinor(a);
      const bb = paymentAmountMinor(b);
      const diff = sortBy === 'amount_desc' ? bb - aa : aa - bb;
      if (diff !== 0) return diff;
    }
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : (a.created || 0) * 1000;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : (b.created || 0) * 1000;
    if (sortBy === 'date_asc') return ta - tb;
    return tb - ta;
  });
  return sorted;
}

export function paymentRowDate(row) {
  return row.createdAt || (row.created ? new Date(row.created * 1000).toISOString() : null);
}

export function paymentRowResCode(row) {
  const code = pickResCode(row.resCode, row.resNo, row.reference, row.plate);
  return code || '—';
}

export function paymentRowCustomerName(row) {
  const name = String(row.customerName || row.cardholderName || '').trim();
  if (name && !isInternalStripeId(name)) return name;
  const res = paymentRowResCode(row);
  if (res && res !== '—') return res;
  if (row.customerEmail) return row.customerEmail;
  if (row.cardLast4) return `Card •••• ${row.cardLast4}`;
  return 'Unknown payer';
}

export function paymentRowKey(row) {
  // Charge id first: one PaymentIntent can have several attempts and each
  // attempt is its own row (Stripe-dashboard style), so pi_ is not unique.
  return row.chargeId || row.id || row.paymentIntentId || row.depositId;
}
