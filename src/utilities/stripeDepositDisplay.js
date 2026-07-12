/** Display helpers for Stripe deposit rows — status, amount, identity fallbacks. */

export function depositResCode(dep) {
  const raw = String(dep?.resCode || dep?.reference || '').trim();
  if (raw) return raw.toUpperCase().startsWith('RES-') ? raw.toUpperCase() : raw;
  return raw || '—';
}

export function depositCustomerName(dep) {
  const name = String(dep?.customerName || '').trim();
  if (name) return name;
  const ref = depositResCode(dep);
  if (ref && ref !== '—') return ref;
  return 'Customer';
}

export function depositCustomerEmail(dep) {
  return String(dep?.customerEmail || '').trim();
}

export function depositAmountMinor(dep) {
  const status = String(dep?.status || '').toLowerCase();
  const stripe = String(dep?.stripeStatus || '').toLowerCase();
  const isCaptured = status === 'captured' || stripe === 'succeeded';
  if (isCaptured) {
    return (
      Number(dep.capturedAmount || dep.currentHoldAmount || dep.initialAmount) || 0
    );
  }
  if (status === 'cancelled') {
    return Number(dep.initialAmount || dep.currentHoldAmount) || 0;
  }
  return Number(dep.currentHoldAmount || dep.initialAmount) || 0;
}

/** True when Stripe has an authorized hold ready to capture (Firestore may still say pending_collection). */
export function depositIsCapturable(dep, stripeTx = null) {
  if (!dep && !stripeTx) return false;
  const status = String(dep?.status || '').toLowerCase();
  const stripe = String(dep?.stripeStatus || stripeTx?.stripeStatus || '').toLowerCase();
  const bucket = String(dep?.stripeBucket || stripeTx?.bucket || '').toLowerCase();
  if (status === 'captured' || stripe === 'succeeded' || bucket === 'successful') return false;
  if (status === 'cancelled' || stripe === 'canceled' || stripe === 'cancelled' || bucket === 'cancelled') {
    return false;
  }
  if (status === 'authorized' || stripe === 'requires_capture' || bucket === 'hold') return true;
  const piId = dep?.paymentIntentId || stripeTx?.paymentIntentId;
  if (piId && bucket === 'hold') return true;
  if (piId && stripe === 'requires_capture') return true;
  if (
    piId &&
    status === 'pending_collection' &&
    !dep?.terminalFailed &&
    Number(dep?.currentHoldAmount || dep?.initialAmount || stripeTx?.holdAmount || stripeTx?.amount) > 0
  ) {
    if (bucket === 'hold' || stripe === 'requires_capture') return true;
  }
  return false;
}

export function stripeTxToSyntheticDeposit(tx) {
  if (!tx?.paymentIntentId) return null;
  const bucket = String(tx.bucket || '').toLowerCase();
  const holdMinor = Number(tx.holdAmount || tx.amount) || 0;
  const receivedMinor = Number(tx.amountReceived || tx.amount) || 0;
  let status = 'pending_collection';
  let stripeStatus = tx.stripeStatus || null;
  if (bucket === 'hold') {
    status = 'authorized';
    stripeStatus = stripeStatus || 'requires_capture';
  } else if (bucket === 'successful') {
    status = 'captured';
    stripeStatus = stripeStatus || 'succeeded';
  } else if (bucket === 'cancelled') {
    status = 'cancelled';
    stripeStatus = stripeStatus || 'canceled';
  }
  return {
    id: tx.depositId || null,
    paymentIntentId: tx.paymentIntentId,
    resCode: tx.resCode || tx.resNo || tx.reference || '',
    reference: tx.reference || tx.resCode || '',
    customerName: tx.customerName || '',
    customerEmail: tx.customerEmail || '',
    plate: tx.plate || '',
    initialAmount: holdMinor || receivedMinor,
    currentHoldAmount: holdMinor || receivedMinor,
    capturedAmount: bucket === 'successful' ? receivedMinor : null,
    currency: tx.currency || 'chf',
    status,
    stripeStatus,
    stripeBucket: bucket,
    cardBrand: tx.cardBrand || null,
    cardLast4: tx.cardLast4 || null,
    cancelReason: tx.cancelReason || null,
    cancelledByName: tx.cancelledByName || null,
    tokenSaved: tx.tokenSaved === true || Boolean(tx.stripePaymentMethodId),
    stripePaymentMethodId: tx.stripePaymentMethodId || null,
    stripeCustomerId: tx.stripeCustomerId || null,
    createdAt: tx.createdAt || (tx.created ? new Date(tx.created * 1000).toISOString() : null),
    source: tx.depositSource || tx.source || 'stripe',
    _fromStripe: true,
  };
}

/** Deposit row eligible for off-session saved-card charge (incl. expired/cancelled holds). */
export function depositCanOffSessionCharge(d) {
  if (!d?.paymentIntentId) return false;
  if (d.tokenSaved || d.stripePaymentMethodId || d.stripeCustomerId) return true;
  const status = String(d.status || '').toLowerCase();
  return ['authorized', 'pending_collection', 'cancelled', 'captured'].includes(status);
}

export function collectGroupDeposits(group) {
  const deposits = [...(group?.deposits || [])];
  const seenPi = new Set(deposits.map((d) => d.paymentIntentId).filter(Boolean));
  for (const tx of group?.stripePayments || []) {
    if (!tx?.paymentIntentId || seenPi.has(tx.paymentIntentId)) continue;
    const isDeposit =
      tx.flowType === 'deposit' ||
      tx.depositId ||
      String(tx.channelLabel || '').toLowerCase().includes('deposit');
    if (!isDeposit) continue;
    const synthetic = stripeTxToSyntheticDeposit(tx);
    if (!synthetic) continue;
    deposits.push(synthetic);
    seenPi.add(tx.paymentIntentId);
  }
  return deposits;
}

/** Newest deposit that can be charged off-session (expired/cancelled holds included). */
export function resolveChargeableDepositTarget(group) {
  const sorted = [...collectGroupDeposits(group)].sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
  return sorted.find((d) => depositCanOffSessionCharge(d)) || null;
}

export function enrichDepositFromStripeTx(dep, stripeTx) {
  if (!dep) return dep;
  if (!stripeTx) return dep;
  const bucket = String(stripeTx.bucket || '').toLowerCase();
  let status = dep.status;
  let stripeStatus = dep.stripeStatus || stripeTx.stripeStatus || null;
  const paymentIntentId = dep.paymentIntentId || stripeTx.paymentIntentId || null;
  if (bucket === 'hold' || stripeStatus === 'requires_capture') {
    if (status === 'pending_collection') status = 'authorized';
    stripeStatus = stripeStatus || 'requires_capture';
  } else if (bucket === 'successful' && status !== 'cancelled') {
    status = 'captured';
    stripeStatus = stripeStatus || 'succeeded';
  } else if (bucket === 'cancelled') {
    status = 'cancelled';
    stripeStatus = stripeStatus || 'canceled';
  }
  return {
    ...dep,
    paymentIntentId,
    status,
    stripeStatus,
    stripeBucket: bucket || dep.stripeBucket || null,
    terminalFailed: bucket === 'hold' || stripeStatus === 'requires_capture' ? false : dep.terminalFailed,
    currentHoldAmount:
      dep.currentHoldAmount ||
      stripeTx.holdAmount ||
      stripeTx.amount ||
      dep.initialAmount,
    capturedAmount: dep.capturedAmount || stripeTx.amountReceived || null,
    cardBrand: dep.cardBrand || stripeTx.cardBrand || null,
    cardLast4: dep.cardLast4 || stripeTx.cardLast4 || null,
  };
}

export function enrichDepositsFromStripePayments(deposits = [], stripeTransactions = []) {
  const byPi = new Map();
  const holdsByRes = new Map();
  stripeTransactions.forEach((tx) => {
    if (!tx?.paymentIntentId) return;
    byPi.set(tx.paymentIntentId, tx);
    const bucket = String(tx.bucket || '').toLowerCase();
    if (bucket === 'hold') {
      const res = String(tx.resCode || tx.resNo || tx.reference || '').trim().toUpperCase();
      if (res) {
        const prev = holdsByRes.get(res);
        const txAt = tx.createdAt || (tx.created ? new Date(tx.created * 1000).toISOString() : '');
        const prevAt = prev?.createdAt || (prev?.created ? new Date(prev.created * 1000).toISOString() : '');
        if (!prev || txAt > prevAt) holdsByRes.set(res, tx);
      }
    }
  });

  const enriched = deposits.map((dep) => {
    let tx = dep.paymentIntentId ? byPi.get(dep.paymentIntentId) : null;
    if (!tx) {
      const res = String(dep.resCode || dep.reference || '').trim().toUpperCase();
      if (res) tx = holdsByRes.get(res);
    }
    return enrichDepositFromStripeTx(dep, tx);
  });

  const seenPi = new Set(enriched.map((d) => d.paymentIntentId).filter(Boolean));
  const orphans = stripeTransactions
    .filter((tx) => tx.paymentIntentId && !seenPi.has(tx.paymentIntentId))
    .map(stripeTxToSyntheticDeposit)
    .filter(Boolean);

  return [...enriched, ...orphans];
}

/** Best capturable hold for customer workbench — deposit doc or live Stripe hold row. */
export function resolveCapturableHoldTarget(group) {
  const deposits = group?.deposits || [];
  const sorted = [...deposits].sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });

  for (const dep of sorted) {
    if (!depositIsCapturable(dep)) continue;
    const piId = dep.paymentIntentId;
    if (!piId) continue;
    return {
      depositId: dep.id || null,
      paymentIntentId: piId,
      currency: dep.currency || 'chf',
      holdAmount: Number(dep.currentHoldAmount || dep.initialAmount) || 0,
      deposit: dep,
    };
  }

  for (const tx of group?.stripePayments || []) {
    if (String(tx.bucket || '').toLowerCase() !== 'hold' || !tx.paymentIntentId) continue;
    const linked =
      sorted.find((d) => d.paymentIntentId === tx.paymentIntentId) ||
      stripeTxToSyntheticDeposit(tx);
    return {
      depositId: tx.depositId || linked?.id || null,
      paymentIntentId: tx.paymentIntentId,
      currency: tx.currency || 'chf',
      holdAmount: Number(tx.holdAmount || tx.amount) || 0,
      deposit: linked,
    };
  }

  return null;
}

export function depositStatusDisplay(dep) {
  const status = String(dep?.status || '').toLowerCase();
  const stripe = String(dep?.stripeStatus || '').toLowerCase();
  const stripeBucket = String(dep?.stripeBucket || '').toLowerCase();

  if (status === 'captured' || stripe === 'succeeded') {
    return { variant: 'success', label: 'Succeeded' };
  }
  if (status === 'cancelled' || stripe === 'canceled' || stripe === 'cancelled') {
    const reason = String(dep?.cancelReason || '').toLowerCase();
    const cancelledBy = String(dep?.cancelledByName || '').toLowerCase();
    if (
      reason.includes('expired') ||
      reason.includes('auto-release') ||
      cancelledBy.includes('expired') ||
      cancelledBy.includes('authorization expired')
    ) {
      return {
        variant: 'danger',
        label: 'Expired',
        note: depositExpiryExplanation(dep),
      };
    }
    const detail = depositExpiryExplanation(dep);
    return {
      variant: 'danger',
      label: 'Canceled',
      ...(detail && detail !== 'Authorization hold is no longer active on the card.'
        ? { note: detail }
        : {}),
    };
  }
  if (
    status === 'authorized' ||
    stripe === 'requires_capture' ||
    stripeBucket === 'hold'
  ) {
    if (
      status === 'authorized' &&
      Number(dep.currentHoldAmount || 0) > Number(dep.initialAmount || 0) + 1
    ) {
      return { variant: 'purple', label: 'Increased' };
    }
    return { variant: 'hold', label: 'Uncaptured' };
  }
  if (status === 'pending_collection' || stripe === 'requires_payment_method') {
    const failure = String(dep?.terminalFailureMessage || dep?.lastPaymentError || '').trim();
    if (failure && stripe !== 'requires_capture' && stripeBucket !== 'hold') {
      return { variant: 'danger', label: 'Failed', note: failure };
    }
    return { variant: 'warning', label: 'Pending' };
  }
  if (stripe === 'requires_action' || stripe === 'processing') {
    return { variant: 'warning', label: 'Processing' };
  }
  if (stripe === 'requires_confirmation') {
    return { variant: 'warning', label: 'Incomplete' };
  }
  return { variant: 'neutral', label: 'Unknown' };
}

export function depositMatchesFilter(dep, filter) {
  if (filter === 'all') return true;
  const status = String(dep?.status || '').toLowerCase();
  const stripe = String(dep?.stripeStatus || '').toLowerCase();
  if (filter === 'hold') {
    return (
      status === 'authorized' ||
      stripe === 'requires_capture' ||
      String(dep?.stripeBucket || '').toLowerCase() === 'hold'
    );
  }
  if (filter === 'captured') return status === 'captured' || stripe === 'succeeded';
  if (filter === 'released') return status === 'cancelled';
  if (filter === 'increased') {
    return (
      status === 'authorized' &&
      Number(dep.currentHoldAmount || 0) > Number(dep.initialAmount || 0) + 1
    );
  }
  return true;
}

/** Human-readable explanation for cancelled / expired deposit holds. */
export function depositExpiryExplanation(dep) {
  if (!dep) return null;
  const reason = String(dep.cancelReason || '').trim();
  const by = String(dep.cancelledByName || '').trim();
  if (reason) return reason;
  if (/expired|authorization expired/i.test(by)) {
    return (
      'Stripe automatically released the card authorization when the issuer hold window ended ' +
      '(often 2–5 days on Visa/Mastercard/Amex without extended auth, or up to ~30 days with extended auth). ' +
      'This is not a staff refund. The saved card can still be charged via New payment.'
    );
  }
  if (by) return by;
  if (String(dep.status || '').toLowerCase() === 'cancelled') {
    return 'Authorization hold is no longer active on the card.';
  }
  return null;
}

export function enrichDepositRow(dep) {
  if (!dep) return dep;
  return {
    ...dep,
    resCode: depositResCode(dep) === '—' ? dep.resCode || '' : depositResCode(dep),
    customerName: depositCustomerName(dep),
    customerEmail: depositCustomerEmail(dep),
    displayStatus: depositStatusDisplay(dep),
    displayAmount: depositAmountMinor(dep),
  };
}

export function formatAuditOperation(entry) {
  const action = String(entry?.action || '');
  const d = entry?.detail || {};
  const labels = {
    deposit_created: 'Deposit authorized',
    deposit_sent_to_terminal: 'Sent to terminal',
    deposit_collection_confirmed: 'Deposit authorized',
    deposit_incremented: 'Hold increased',
    deposit_captured: 'Payment captured',
    deposit_released: 'Hold released',
    deposit_cancelled: 'Hold released',
    payment_hold_cancelled: 'Hold released',
    saved_token_charge: 'Card charged',
    deposit_email_sent: 'Email sent',
    terminal_action_cancelled: 'Terminal canceled',
  };
  return labels[action] || action.replace(/_/g, ' ');
}

export function auditStatusDisplay(entry) {
  const action = String(entry?.action || '');
  if (/failed|declin/i.test(action)) {
    return { variant: 'danger', label: 'Failed' };
  }
  if (/cancel|released/i.test(action)) {
    return { variant: 'neutral', label: 'Canceled' };
  }
  if (/capture|charge|confirmed|created|increment|succeeded|paid/i.test(action)) {
    return { variant: 'success', label: 'Succeeded' };
  }
  if (/pending|terminal|sent/i.test(action)) {
    return { variant: 'warning', label: 'Pending' };
  }
  return { variant: 'info', label: 'Updated' };
}

export function auditAmountMinor(entry) {
  const d = entry?.detail || {};
  if (d.newAmount != null) return Number(d.newAmount);
  if (d.amountReceived != null) return Number(d.amountReceived);
  if (d.initialAmount != null) return Number(d.initialAmount);
  if (d.chargedAmount != null) return Number(d.chargedAmount);
  return null;
}

export function auditCustomerLine(entry) {
  const d = entry?.detail || {};
  const res = d.resCode || '';
  const name = d.customerName || '';
  if (res && name) return `${res} · ${name}`;
  return res || name || '—';
}

export function auditDescriptionLine(entry) {
  const d = entry?.detail || {};
  const parts = [formatAuditOperation(entry)];
  if (d.reason) parts.push(d.reason);
  if (d.releasedBy || d.capturedBy) parts.push(`by ${d.releasedBy || d.capturedBy}`);
  else if (entry.actorName) parts.push(`by ${entry.actorName}`);
  return parts.join(' · ');
}
