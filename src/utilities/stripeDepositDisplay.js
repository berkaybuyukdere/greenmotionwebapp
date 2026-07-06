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

export function depositStatusDisplay(dep) {
  const status = String(dep?.status || '').toLowerCase();
  const stripe = String(dep?.stripeStatus || '').toLowerCase();

  if (status === 'captured' || stripe === 'succeeded') {
    return { variant: 'success', label: 'Succeeded' };
  }
  if (status === 'cancelled' || stripe === 'canceled' || stripe === 'cancelled') {
    return { variant: 'danger', label: 'Canceled' };
  }
  if (
    status === 'authorized' &&
    Number(dep.currentHoldAmount || 0) > Number(dep.initialAmount || 0) + 1
  ) {
    return { variant: 'purple', label: 'Increased' };
  }
  if (status === 'authorized' || stripe === 'requires_capture') {
    return { variant: 'hold', label: 'Uncaptured' };
  }
  if (status === 'pending_collection' || stripe === 'requires_payment_method') {
    const failure = String(dep?.terminalFailureMessage || dep?.lastPaymentError || '').trim();
    if (failure) {
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
    return ['authorized', 'pending_collection'].includes(status);
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
