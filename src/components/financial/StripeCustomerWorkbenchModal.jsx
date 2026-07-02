import React, { useEffect, useMemo, useState } from 'react';
import { X, Ban, CreditCard, Lock, Mail, Shield, TrendingUp, CheckCircle2, AlertOctagon, Info } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { PalantirSignal } from '../palantir/PalantirWorkbench';
import {
  stripeFinancialCancelDeposit,
  stripeFinancialIncrementDeposit,
  stripeFinancialChargeSavedPaymentMethod,
} from '../../services/stripeFinancialApi';
import {
  StripeDirectCardRetryPanel,
  mailOrderCanRetryDirectCharge,
} from './StripeDirectCardRetryPanel';
import { humanizeStripeCardDecline } from '../../utilities/stripeDeclineMessages';

function formatMoney(amount, currency) {
  if (amount == null) return '—';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function categoryLabel(category) {
  if (category === 'traffic_fine') return 'Traffic fines';
  if (category === 'damage') return 'Damage';
  return category || 'Mail order';
}

const DEPOSIT_STATUS_VARIANT = {
  authorized: 'hold',
  pending_collection: 'warning',
  captured: 'success',
  cancelled: 'danger',
};

const DEPOSIT_STATUS_LABEL = {
  authorized: 'Hold',
  pending_collection: 'Pending',
  captured: 'Captured',
  cancelled: 'Canceled',
};

function depositCanOffSessionCharge(d) {
  if (!d?.paymentIntentId) return false;
  if (d.tokenSaved || d.stripePaymentMethodId || d.stripeCustomerId) return true;
  return ['authorized', 'pending_collection', 'cancelled', 'captured'].includes(d.status);
}

function humanizeStripeFinancialError(err) {
  const raw = String(err?.message || err || '');
  const msg = raw
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    .trim();
  if (
    /without Customer attachment/i.test(msg) ||
    /may not be used again/i.test(msg) ||
    /not linked to a Stripe customer/i.test(msg)
  ) {
    return {
      title: 'Card cannot be reused',
      detail:
        'This deposit was created before customer linking was required. Start a new deposit on the POS terminal — after hold and cancel, the card will be chargeable from Actions.',
      code: 'PM_REUSE_BLOCKED',
    };
  }
  if (/card_present/i.test(msg) && /cannot be saved/i.test(msg)) {
    return {
      title: 'Terminal card not reusable',
      detail:
        'The POS swipe token cannot be charged directly. Use a deposit created with the latest flow: authorize on terminal, cancel hold, then charge from Actions.',
      code: 'CARD_PRESENT_BLOCKED',
    };
  }
  const cardDecline = humanizeStripeCardDecline(err);
  if (cardDecline.declineCode && cardDecline.declineCode !== 'generic_decline') {
    return {
      title: cardDecline.title,
      detail: cardDecline.detail,
      nextSteps: cardDecline.nextSteps,
      code: cardDecline.code,
    };
  }
  if (/declined|card_declined|payment failed/i.test(msg)) {
    return {
      title: cardDecline.title,
      detail: cardDecline.detail,
      nextSteps: cardDecline.nextSteps,
      code: cardDecline.code,
    };
  }
  return { title: null, detail: msg || 'Something went wrong', code: null };
}

function sortDepositsNewestFirst(deposits) {
  return [...deposits].sort((a, b) => {
    const ta = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return tb - ta;
  });
}

export function StripeCustomerWorkbenchModal({
  group,
  franchiseId,
  showFinancialTotals = false,
  auditEntries = [],
  onClose,
  onChanged,
  onCenterFeedback,
}) {
  const [tab, setTab] = useState('overview');
  const [selectedDepositId, setSelectedDepositId] = useState(null);
  const [selectedDirectOrderId, setSelectedDirectOrderId] = useState(null);
  const [increaseAmountChf, setIncreaseAmountChf] = useState('');
  const [chargeAmountChf, setChargeAmountChf] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab('overview');
    setSelectedDepositId(null);
    setSelectedDirectOrderId(null);
    setIncreaseAmountChf('');
    setChargeAmountChf('');
    setCancelConfirm(false);
  }, [group?.id]);

  const activeDeposits = useMemo(
    () => group?.deposits?.filter((d) => ['authorized', 'pending_collection'].includes(d.status)) || [],
    [group],
  );

  const chargeableDeposits = useMemo(
    () => sortDepositsNewestFirst((group?.deposits || []).filter(depositCanOffSessionCharge)),
    [group],
  );

  const primaryDeposit = useMemo(() => {
    if (!group?.deposits?.length) return null;
    const sorted = sortDepositsNewestFirst(group.deposits);
    if (selectedDepositId) {
      return sorted.find((d) => d.id === selectedDepositId) || sorted[0];
    }
    return activeDeposits[0] || sorted[0];
  }, [group, selectedDepositId, activeDeposits]);

  const chargeDeposit = useMemo(() => {
    if (!chargeableDeposits.length) return null;
    if (selectedDepositId) {
      const sel = chargeableDeposits.find((d) => d.id === selectedDepositId);
      if (sel) return sel;
    }
    return chargeableDeposits[0];
  }, [chargeableDeposits, selectedDepositId]);

  const directOrders = group?.directOrders || [];
  const mailOrders = group?.mailOrders || [];

  const selectedDirectOrder = useMemo(() => {
    if (!selectedDirectOrderId) return null;
    return directOrders.find((o) => o.id === selectedDirectOrderId) || null;
  }, [directOrders, selectedDirectOrderId]);

  const canManageDeposit =
    Boolean(primaryDeposit) &&
    ['authorized', 'pending_collection'].includes(primaryDeposit.status);

  const canChargeSaved = Boolean(showFinancialTotals && chargeDeposit?.id);
  const showActionsTab = canManageDeposit || canChargeSaved;

  const currentHoldChf = (primaryDeposit?.currentHoldAmount || primaryDeposit?.initialAmount || 0) / 100;
  const maxAuthChf = (primaryDeposit?.maxAuthAmount || 0) / 100;

  const increasePreview = useMemo(() => {
    const total = Number(increaseAmountChf);
    if (!Number.isFinite(total) || total <= 0) return null;
    const additional = total - currentHoldChf;
    if (additional <= 0) return { additional: 0, valid: false };
    if (maxAuthChf > 0 && total > maxAuthChf) return { additional, valid: false, overMax: true };
    return { additional, valid: true, total };
  }, [increaseAmountChf, currentHoldChf, maxAuthChf]);

  const unpaidMailLink = useMemo(
    () => mailOrders.filter((o) => o.status !== 'paid').length,
    [mailOrders],
  );

  const unpaidDirect = useMemo(
    () => directOrders.filter((o) => o.status !== 'paid').length,
    [directOrders],
  );

  const pushFeedback = (type, title, detail, code, nextSteps) => {
    onCenterFeedback?.({ type, title, detail, code, nextSteps, at: new Date().toISOString() });
  };

  const pushFeedbackFromError = (defaultTitle, err) => {
    const friendly = humanizeStripeFinancialError(err);
    pushFeedback(
      'error',
      friendly.title || defaultTitle,
      friendly.detail,
      friendly.code,
      friendly.nextSteps,
    );
  };

  if (!group) return null;

  const runIncrement = async () => {
    if (!primaryDeposit?.id || !increasePreview?.valid) return;
    setBusy(true);
    try {
      await stripeFinancialIncrementDeposit({
        franchiseId,
        depositId: primaryDeposit.id,
        newAmountChf: increasePreview.total,
      });
      pushFeedback(
        'success',
        'Deposit authorization increased',
        `New hold CHF ${increasePreview.total.toFixed(2)} (+${increasePreview.additional.toFixed(2)})`,
      );
      setIncreaseAmountChf('');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Increase failed', e);
    } finally {
      setBusy(false);
    }
  };

  const runCancel = async () => {
    if (!primaryDeposit?.id) return;
    if (!cancelConfirm) {
      setCancelConfirm(true);
      return;
    }
    setBusy(true);
    try {
      await stripeFinancialCancelDeposit({ franchiseId, depositId: primaryDeposit.id });
      pushFeedback('success', 'Hold released', 'You can charge the saved card in Actions.');
      setCancelConfirm(false);
      setTab('actions');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Cancel failed', e);
    } finally {
      setBusy(false);
    }
  };

  const runChargeSaved = async () => {
    const amount = Number(chargeAmountChf);
    if (!Number.isFinite(amount) || amount < 0.5) {
      pushFeedback('error', 'Invalid amount', 'Minimum charge is CHF 0.50');
      return;
    }
    if (!chargeDeposit?.id) {
      pushFeedback('error', 'No saved card', 'Complete a deposit on POS first so the card is saved.');
      return;
    }
    setBusy(true);
    try {
      const res = await stripeFinancialChargeSavedPaymentMethod({
        franchiseId,
        depositId: chargeDeposit.id,
        amountChf: amount,
      });
      const charged = (res?.chargedAmount || amount * 100) / 100;
      pushFeedback('success', 'Charge completed', `CHF ${charged.toFixed(2)} charged from saved card`);
      setChargeAmountChf('');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Charge failed', e);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'deposits', label: `Deposits (${group.deposits.length})` },
    ...(showFinancialTotals
      ? [{ id: 'direct', label: `Direct (${directOrders.length})` }]
      : []),
    { id: 'mail', label: `Mail (${mailOrders.length})` },
    ...(showActionsTab ? [{ id: 'actions', label: 'Actions' }] : []),
  ];

  const relatedAudit = auditEntries
    .filter((a) => {
      const blob = JSON.stringify(a.detail || {}).toLowerCase();
      const res = (group.resCode || '').toLowerCase();
      const email = (group.customerEmail || '').toLowerCase();
      return (res && blob.includes(res)) || (email && blob.includes(email));
    })
    .slice(0, 12);

  return (
    <div className="pal-fin-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="pal-fin-modal pal-fin-modal-wide pal-cust-workbench"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Stripe customer</p>
            <h2 className="pal-fin-modal-title">{group.displayTitle}</h2>
            <p className="pal-fin-modal-sub">
              {[group.customerName, group.customerEmail].filter(Boolean).join(' · ') || '—'}
            </p>
            <div className="pal-cust-signal-row pal-cust-signal-row-modal">
              <PalantirSignal label="Deposits" value={group.deposits.length} tone={activeDeposits.length ? 'warn' : undefined} />
              {showFinancialTotals && (
                <PalantirSignal label="Direct" value={directOrders.length} tone={unpaidDirect ? 'bad' : 'ok'} />
              )}
              <PalantirSignal label="Mail" value={mailOrders.length} />
              <PalantirSignal label="Unpaid mail" value={unpaidMailLink} tone={unpaidMailLink ? 'bad' : 'ok'} />
            </div>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <nav className="pal-cust-tab-rail pal-cust-tab-rail-modal" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`pal-cust-tab ${tab === t.id ? 'pal-cust-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="pal-fin-modal-body pal-cust-workbench-body">
          {tab === 'overview' && (
            <div className="pal-cust-workbench-grid">
              <dl className="pal-fin-drawer-dl">
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">RES code</dt>
                  <dd className="pal-fin-drawer-value pal-fin-mono">{group.resCode || '—'}</dd>
                </div>
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">Customer</dt>
                  <dd className="pal-fin-drawer-value">{group.customerName || '—'}</dd>
                </div>
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">Email</dt>
                  <dd className="pal-fin-drawer-value">{group.customerEmail || '—'}</dd>
                </div>
              </dl>
              {activeDeposits.length > 0 && (
                <div className="pal-cust-highlight pal-cust-highlight-hold">
                  <Lock size={14} />
                  <span>
                    {activeDeposits.length} active hold{activeDeposits.length === 1 ? '' : 's'} ·{' '}
                    {formatMoney(
                      activeDeposits.reduce((s, d) => s + (d.currentHoldAmount || d.initialAmount || 0), 0),
                      'chf',
                    )}
                  </span>
                </div>
              )}
              {chargeableDeposits.length > 0 && !activeDeposits.length && showFinancialTotals && (
                <div className="pal-cust-highlight pal-cust-highlight-token">
                  <CreditCard size={14} />
                  <span>
                    {chargeableDeposits.length} deposit{chargeableDeposits.length === 1 ? '' : 's'} with saved card — open Actions to charge.
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === 'deposits' && (
            <div className="pal-cust-timeline pal-cust-timeline-modal">
              {group.deposits.length === 0 ? (
                <p className="pal-cust-empty">No deposit records.</p>
              ) : (
                group.deposits.map((dep) => (
                  <button
                    key={dep.id || dep.paymentIntentId}
                    type="button"
                    className={`pal-cust-timeline-item ${primaryDeposit?.id === dep.id ? 'pal-cust-timeline-item-active' : ''}`}
                    onClick={() => setSelectedDepositId(dep.id)}
                  >
                    <div className="pal-cust-timeline-icon pal-cust-timeline-icon-deposit">
                      <Lock size={14} />
                    </div>
                    <div className="pal-cust-timeline-body">
                      <div className="pal-cust-timeline-head">
                        <span className="pal-fin-mono pal-cust-timeline-amount">
                          {formatMoney(dep.currentHoldAmount || dep.initialAmount, dep.currency)}
                        </span>
                        <StripeStatusBadge
                          sharp
                          variant={DEPOSIT_STATUS_VARIANT[dep.status] || 'neutral'}
                          label={DEPOSIT_STATUS_LABEL[dep.status] || dep.status}
                        />
                        {dep.tokenSaved && (
                          <StripeStatusBadge sharp variant="success" label="Token saved" />
                        )}
                      </div>
                      {dep.readerLabel && <p className="pal-cust-timeline-meta">{dep.readerLabel}</p>}
                      <p className="pal-cust-timeline-meta">{formatDate(dep.createdAt)}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}

          {tab === 'direct' && showFinancialTotals && (
            <div className="pal-cust-mail-tab">
              <div className="pal-cust-timeline pal-cust-timeline-modal">
                {directOrders.length === 0 ? (
                  <p className="pal-cust-empty">No direct card operations.</p>
                ) : (
                  directOrders.map((order) => {
                    const canRetry = mailOrderCanRetryDirectCharge(order);
                    const isActive = selectedDirectOrderId === order.id;
                    return (
                      <button
                        key={order.id}
                        type="button"
                        className={`pal-cust-timeline-item ${isActive ? 'pal-cust-timeline-item-active' : ''}`}
                        onClick={() => setSelectedDirectOrderId(isActive ? null : order.id)}
                      >
                        <div className="pal-cust-timeline-icon pal-cust-timeline-icon-direct">
                          <CreditCard size={14} />
                        </div>
                        <div className="pal-cust-timeline-body">
                          <div className="pal-cust-timeline-head">
                            <span className="pal-cust-timeline-cat">{categoryLabel(order.category)}</span>
                            <StripeStatusBadge
                              sharp
                              variant={order.status === 'paid' ? 'paid' : 'unpaid'}
                              label={order.status === 'paid' ? 'Paid' : 'Unpaid'}
                            />
                          </div>
                          <p className="pal-fin-mono pal-cust-timeline-amount">
                            {formatMoney(order.amount, order.currency)}
                          </p>
                          <p className="pal-cust-timeline-meta">{formatDate(order.createdAt)}</p>
                          {canRetry && (
                            <p className="pal-cust-timeline-hint">Click to change amount and retry charge</p>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedDirectOrder && mailOrderCanRetryDirectCharge(selectedDirectOrder) && (
                <StripeDirectCardRetryPanel
                  franchiseId={franchiseId}
                  mailOrder={selectedDirectOrder}
                  onCardUpdated={() => onChanged?.()}
                  onCancel={() => setSelectedDirectOrderId(null)}
                  onSuccess={(item) => {
                    pushFeedback('success', item.title, item.detail);
                    setSelectedDirectOrderId(null);
                    onChanged?.();
                  }}
                  onError={(friendly) =>
                    pushFeedback(
                      'error',
                      friendly?.title || 'Retry failed',
                      friendly?.detail || friendly?.displayText || 'Charge failed',
                      friendly?.code,
                      friendly?.nextSteps,
                    )
                  }
                />
              )}
            </div>
          )}

          {tab === 'mail' && (
            <div className="pal-cust-mail-tab">
              <div className="pal-cust-timeline pal-cust-timeline-modal">
                {mailOrders.length === 0 ? (
                  <p className="pal-cust-empty">No payment-link mail orders.</p>
                ) : (
                  mailOrders.map((order) => (
                    <div key={order.id} className="pal-cust-timeline-item pal-cust-timeline-item-static">
                      <div className="pal-cust-timeline-icon pal-cust-timeline-icon-mail">
                        <Mail size={14} />
                      </div>
                      <div className="pal-cust-timeline-body">
                        <div className="pal-cust-timeline-head">
                          <span className="pal-cust-timeline-cat">{categoryLabel(order.category)}</span>
                          <StripeStatusBadge
                            sharp
                            variant={order.status === 'paid' ? 'paid' : 'unpaid'}
                            label={order.status === 'paid' ? 'Paid' : 'Unpaid'}
                          />
                        </div>
                        <p className="pal-fin-mono pal-cust-timeline-amount">
                          {formatMoney(order.amount, order.currency)}
                        </p>
                        <p className="pal-cust-timeline-meta">{formatDate(order.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === 'actions' && (
            <div className="pal-cust-actions pal-cust-actions-modal">
              {canManageDeposit && (
                <section className="pal-cust-action-card">
                  <header className="pal-cust-action-card-head">
                    <TrendingUp size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Increase deposit hold</h3>
                      <p className="pal-cust-action-card-sub">
                        Current: {formatMoney(primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount, primaryDeposit.currency)}
                        {maxAuthChf > currentHoldChf && ` · Max CHF ${maxAuthChf.toFixed(2)}`}
                      </p>
                    </div>
                  </header>
                  <label className="pal-cust-field">
                    <span>Total authorized amount (CHF)</span>
                    <input
                      type="number"
                      min={currentHoldChf + 0.05}
                      step="0.05"
                      value={increaseAmountChf}
                      onChange={(e) => setIncreaseAmountChf(e.target.value)}
                      className="pal-fin-input"
                      disabled={busy}
                    />
                    <small>Enter the full target hold — not only the delta.</small>
                  </label>
                  {increasePreview && (
                    <p className={increasePreview.valid ? 'pal-pay-increase-delta-ok' : 'pal-pay-increase-delta-warn'}>
                      {increasePreview.valid
                        ? `+CHF ${increasePreview.additional.toFixed(2)} additional authorization`
                        : increasePreview.overMax
                          ? `Exceeds max CHF ${maxAuthChf.toFixed(2)}`
                          : 'Amount must exceed current hold'}
                    </p>
                  )}
                  <button
                    type="button"
                    className="gm-btn gm-btn-primary gm-btn-sm"
                    disabled={busy || !increasePreview?.valid}
                    onClick={runIncrement}
                  >
                    <TrendingUp size={14} /> Authorize increase
                  </button>
                </section>
              )}

              {canManageDeposit && (
                <section className="pal-cust-action-card pal-cust-action-card-danger">
                  <header className="pal-cust-action-card-head">
                    <Ban size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Release hold</h3>
                      <p className="pal-cust-action-card-sub">Releases POS authorization. Saved card remains for later charges.</p>
                    </div>
                  </header>
                  {cancelConfirm && (
                    <p className="pal-cust-confirm-warn">Confirm release of this hold?</p>
                  )}
                  <div className="pal-cust-action-row">
                    {cancelConfirm && (
                      <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" disabled={busy} onClick={() => setCancelConfirm(false)}>
                        Back
                      </button>
                    )}
                    <button type="button" className="gm-btn gm-btn-danger gm-btn-sm" disabled={busy} onClick={runCancel}>
                      <Ban size={14} /> {cancelConfirm ? 'Confirm cancel' : 'Cancel hold'}
                    </button>
                  </div>
                </section>
              )}

              {canChargeSaved && (
                <section className="pal-cust-action-card pal-cust-action-card-secure">
                  <header className="pal-cust-action-card-head">
                    <CreditCard size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Charge saved card</h3>
                      <p className="pal-cust-action-card-sub">
                        Off-session charge
                        {chargeDeposit?.status === 'cancelled'
                          ? ' · hold was released — card remains on file'
                          : chargeDeposit?.status
                            ? ` · deposit ${chargeDeposit.status}`
                            : ''}
                      </p>
                    </div>
                  </header>
                  {chargeableDeposits.length > 1 && (
                    <label className="pal-cust-field">
                      <span>Deposit to charge from</span>
                      <select
                        className="pal-fin-input"
                        value={chargeDeposit?.id || ''}
                        onChange={(e) => setSelectedDepositId(e.target.value)}
                        disabled={busy}
                      >
                        {chargeableDeposits.map((d) => (
                          <option key={d.id} value={d.id}>
                            {formatMoney(d.currentHoldAmount || d.initialAmount, d.currency)} ·{' '}
                            {DEPOSIT_STATUS_LABEL[d.status] || d.status} ·{' '}
                            {formatDate(d.createdAt)}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="pal-cust-secure-note">
                    <Shield size={14} />
                    <span>Admin only · logged to audit trail</span>
                  </div>
                  <label className="pal-cust-field">
                    <span>Amount (CHF)</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.05"
                      value={chargeAmountChf}
                      onChange={(e) => setChargeAmountChf(e.target.value)}
                      placeholder="1.00"
                      disabled={busy}
                      className="pal-fin-input"
                    />
                  </label>
                  <button type="button" className="gm-btn gm-btn-primary gm-btn-sm" disabled={busy} onClick={runChargeSaved}>
                    <CreditCard size={14} /> Charge card
                  </button>
                </section>
              )}

              {!canManageDeposit && !canChargeSaved && showFinancialTotals && chargeableDeposits.length === 0 && (
                <p className="pal-cust-empty">
                  No chargeable deposit — complete a terminal deposit (card on POS) first.
                </p>
              )}
              {!canManageDeposit && !canChargeSaved && !showFinancialTotals && (
                <p className="pal-cust-empty">No actions available for this customer.</p>
              )}
            </div>
          )}

          <section className="pal-fin-audit-panel pal-cust-audit">
            <h3 className="pal-cust-audit-title">Activity log</h3>
            {relatedAudit.length === 0 ? (
              <p className="pal-cust-empty">No matching audit entries.</p>
            ) : (
              <ul className="pal-fin-audit-list">
                {relatedAudit.map((entry) => (
                  <li key={entry.id || `${entry.action}-${entry.createdAt}`} className="pal-fin-audit-row">
                    <span className="pal-fin-mono">{formatDate(entry.createdAt)}</span>
                    <span className="pal-cust-audit-action">{entry.action || 'event'}</span>
                    <span className="pal-cust-audit-detail">
                      {entry.detail?.paymentIntentId || entry.detail?.depositId || '—'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="pal-fin-modal-footer">
          <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function CenterFeedbackToast({ item, onDismiss }) {
  if (!item) return null;
  const isSuccess = item.type === 'success';
  const isError = item.type === 'error';
  const Icon = isSuccess ? CheckCircle2 : isError ? AlertOctagon : Info;
  const eyebrow = isSuccess ? 'Operation complete' : isError ? 'Operation failed' : 'Notice';
  const cls = isSuccess
    ? 'pal-cust-center-toast pal-cust-center-toast-success'
    : isError
      ? 'pal-cust-center-toast pal-cust-center-toast-error'
      : 'pal-cust-center-toast pal-cust-center-toast-info';

  return (
    <div
      className="pal-cust-center-toast-wrap"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      onClick={onDismiss}
    >
      <div className={cls} onClick={(e) => e.stopPropagation()}>
        <div className="pal-cust-center-toast-accent" aria-hidden="true" />
        <header className="pal-cust-center-toast-head">
          <p className="pal-fin-eyebrow pal-cust-center-toast-eyebrow">{eyebrow}</p>
          <button type="button" className="pal-cust-center-toast-close" onClick={onDismiss} aria-label="Dismiss">
            <X size={16} />
          </button>
        </header>
        <div className="pal-cust-center-toast-body">
          <Icon className="pal-cust-center-toast-icon" size={26} strokeWidth={1.75} aria-hidden="true" />
          <p className="pal-cust-center-toast-title">{item.title}</p>
          {item.detail && <p className="pal-cust-center-toast-detail">{item.detail}</p>}
        {item.nextSteps && <p className="pal-cust-center-toast-next">{item.nextSteps}</p>}
          {(item.code || item.at) && (
            <p className="pal-fin-mono pal-cust-center-toast-meta">
              {item.code && <span>{item.code}</span>}
              {item.at && <span>{new Date(item.at).toLocaleTimeString()}</span>}
            </p>
          )}
        </div>
        <footer className="pal-cust-center-toast-footer">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </footer>
      </div>
    </div>
  );
}

export { CenterFeedbackToast };
