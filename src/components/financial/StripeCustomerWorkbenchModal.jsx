import React, { useEffect, useMemo, useState } from 'react';
import { X, Ban, CreditCard, Lock, Mail, Shield, TrendingUp, Info, CheckCircle2, RotateCcw } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { PalantirSignal } from '../palantir/PalantirWorkbench';
import {
  stripeFinancialCancelDeposit,
  stripeFinancialCaptureDeposit,
  stripeFinancialIncrementDeposit,
  stripeFinancialChargeSavedPaymentMethod,
  stripeFinancialRefundPayment,
} from '../../services/stripeFinancialApi';
import { FoundryActivityLog } from './FoundryActivityLog';
import {
  StripeDirectCardRetryPanel,
  mailOrderCanRetryDirectCharge,
} from './StripeDirectCardRetryPanel';
import { humanizeStripeFinancialError } from './StripeFinFeedback';
import { filterAuditForCustomerGroup, formatStripeAuditEntry, buildCustomerTimeline } from '../../utilities/stripeCustomerGroups';
import { depositStatusDisplay, depositAmountMinor } from '../../utilities/stripeDepositDisplay';

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
  canPerformOperations = false,
  auditEntries = [],
  layout = 'modal',
  initialTab = 'overview',
  hideSignalStrip = false,
  onClose,
  onChanged,
  onCenterFeedback,
}) {
  const [tab, setTab] = useState('overview');
  const [selectedDepositId, setSelectedDepositId] = useState(null);
  const [selectedDirectOrderId, setSelectedDirectOrderId] = useState(null);
  const [increaseAmountChf, setIncreaseAmountChf] = useState('');
  const [chargeAmountChf, setChargeAmountChf] = useState('');
  const [captureAmountChf, setCaptureAmountChf] = useState('');
  const [refundAmountChf, setRefundAmountChf] = useState('');
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [cancelConfirmText, setCancelConfirmText] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setTab(initialTab || 'overview');
    setSelectedDepositId(null);
    setSelectedDirectOrderId(null);
    setIncreaseAmountChf('');
    setChargeAmountChf('');
    setCaptureAmountChf('');
    setRefundAmountChf('');
    setCancelConfirm(false);
    setCancelConfirmText('');
    setCancelReason('');
  }, [group?.id, initialTab]);

  const activeDeposits = useMemo(
    () =>
      group?.deposits?.filter(
        (d) =>
          ['authorized', 'pending_collection'].includes(d.status) &&
          d.stripeStatus !== 'canceled' &&
          d.stripeStatus !== 'cancelled',
      ) || [],
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
    const capturable = sorted.find(
      (d) =>
        (d.status === 'authorized' || d.stripeStatus === 'requires_capture') &&
        d.status !== 'cancelled' &&
        d.stripeStatus !== 'canceled' &&
        d.stripeStatus !== 'cancelled',
    );
    return capturable || sorted[0];
  }, [group, selectedDepositId]);

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

  const paidDirectOrders = useMemo(
    () => directOrders.filter((o) => o.status === 'paid'),
    [directOrders],
  );

  const canManageDeposit =
    Boolean(primaryDeposit) &&
    primaryDeposit.status !== 'captured' &&
    primaryDeposit.status !== 'cancelled' &&
    primaryDeposit.stripeStatus !== 'canceled' &&
    primaryDeposit.stripeStatus !== 'cancelled' &&
    (primaryDeposit.status === 'authorized' || primaryDeposit.stripeStatus === 'requires_capture');

  const canCaptureDeposit =
    Boolean(primaryDeposit) &&
    primaryDeposit.status !== 'captured' &&
    primaryDeposit.status !== 'cancelled' &&
    primaryDeposit.stripeStatus !== 'canceled' &&
    primaryDeposit.stripeStatus !== 'cancelled' &&
    (primaryDeposit.status === 'authorized' || primaryDeposit.stripeStatus === 'requires_capture');

  const canIncreaseDeposit =
    Boolean(primaryDeposit) &&
    (primaryDeposit.status === 'authorized' || primaryDeposit.stripeStatus === 'requires_capture');

  const canChargeSaved = Boolean(chargeDeposit?.id);
  const canRefundDirect = canPerformOperations && paidDirectOrders.some((o) => o.paymentIntentId);

  const refundableDeposits = useMemo(
    () =>
      sortDepositsNewestFirst(
        (group?.deposits || []).filter(
          (d) => d.status === 'captured' && d.paymentIntentId && Number(d.capturedAmount || d.initialAmount) > 0,
        ),
      ),
    [group],
  );
  const canRefundDeposit = canPerformOperations && refundableDeposits.length > 0;

  const showActionsTab =
    canManageDeposit ||
    canChargeSaved ||
    canCaptureDeposit ||
    canIncreaseDeposit ||
    canRefundDirect ||
    canRefundDeposit;

  useEffect(() => {
    if (tab === 'actions' && !showActionsTab) setTab('overview');
  }, [tab, showActionsTab]);

  const currentHoldChf = (primaryDeposit?.currentHoldAmount || primaryDeposit?.initialAmount || 0) / 100;
  const maxAuthChf = (primaryDeposit?.maxAuthAmount || 0) / 100;

  // Capture total preview: entering more than the hold captures the full hold
  // and charges the remainder from the saved card.
  const capturePreview = useMemo(() => {
    if (captureAmountChf === '') {
      return { mode: 'full', captureChf: currentHoldChf, extraChf: 0, valid: currentHoldChf > 0 };
    }
    const total = Number(captureAmountChf);
    if (!Number.isFinite(total) || total <= 0) return { valid: false };
    if (total <= currentHoldChf) {
      return { mode: 'partial', captureChf: total, extraChf: 0, valid: true, total };
    }
    const extra = total - currentHoldChf;
    return {
      mode: 'topup',
      captureChf: currentHoldChf,
      extraChf: extra,
      valid: extra >= 0.5,
      total,
    };
  }, [captureAmountChf, currentHoldChf]);

  const increasePreview = useMemo(() => {
    const total = Number(increaseAmountChf);
    if (!Number.isFinite(total) || total <= 0) return null;
    const additional = total - currentHoldChf;
    if (additional <= 0) return { additional: 0, valid: false };
    return { additional, valid: true, total };
  }, [increaseAmountChf, currentHoldChf]);

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
        customIncrease: true,
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

  const runCapture = async () => {
    if (!primaryDeposit?.id) return;
    if (!capturePreview?.valid) {
      pushFeedback(
        'error',
        'Invalid amount',
        capturePreview?.mode === 'topup'
          ? 'Amount above the hold must be at least CHF 0.50.'
          : 'Enter a valid capture amount.',
      );
      return;
    }
    setBusy(true);
    try {
      const payload = { franchiseId, depositId: primaryDeposit.id };
      if (captureAmountChf !== '') payload.amountChf = Number(captureAmountChf);
      const res = await stripeFinancialCaptureDeposit(payload);
      const capturedChf =
        (Number(res?.capturedAmount ?? res?.amountReceived) ||
          primaryDeposit.currentHoldAmount ||
          primaryDeposit.initialAmount ||
          0) / 100;
      const topUpChf = res?.topUp?.amount ? Number(res.topUp.amount) / 100 : 0;

      if (res?.topUpError) {
        pushFeedback(
          'error',
          'Hold captured — extra charge failed',
          `CHF ${capturedChf.toFixed(2)} captured from the hold, but the additional charge of CHF ${((Number(res.topUpAmount) || 0) / 100).toFixed(2)} failed: ${res.topUpError}`,
        );
      } else if (topUpChf > 0) {
        pushFeedback(
          'success',
          'Total charged',
          `CHF ${(capturedChf + topUpChf).toFixed(2)} — ${capturedChf.toFixed(2)} captured from the hold + ${topUpChf.toFixed(2)} charged from the saved card.`,
        );
      } else {
        pushFeedback(
          'success',
          'Hold captured',
          `CHF ${capturedChf.toFixed(2)} charged from the authorized deposit hold.`,
        );
      }
      setCaptureAmountChf('');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Capture failed', e);
    } finally {
      setBusy(false);
    }
  };

  const runRefundDeposit = async () => {
    const dep = refundableDeposits[0];
    if (!dep?.paymentIntentId) return;
    const capturedChf = Number(dep.capturedAmount || dep.initialAmount || 0) / 100;
    let amountChf = null;
    if (refundAmountChf !== '') {
      amountChf = Number(refundAmountChf);
      if (!Number.isFinite(amountChf) || amountChf < 0.5 || amountChf > capturedChf) {
        pushFeedback(
          'error',
          'Invalid refund amount',
          `Enter between CHF 0.50 and CHF ${capturedChf.toFixed(2)} (captured amount).`,
        );
        return;
      }
    }
    setBusy(true);
    try {
      const res = await stripeFinancialRefundPayment({
        franchiseId,
        paymentIntentId: dep.paymentIntentId,
        ...(amountChf != null ? { amountChf } : {}),
      });
      const refundedChf = (Number(res?.amount) || (amountChf != null ? amountChf * 100 : capturedChf * 100)) / 100;
      pushFeedback(
        'success',
        'Refund issued',
        `CHF ${refundedChf.toFixed(2)} refunded to the customer's card — logged to audit trail.`,
      );
      setRefundAmountChf('');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Refund failed', e);
    } finally {
      setBusy(false);
    }
  };

  const runCancel = async () => {
    if (!primaryDeposit?.id) return;
    if (!cancelReason.trim()) {
      pushFeedback('error', 'Reason required', 'Enter why this hold is being released.');
      return;
    }
    if (!cancelConfirm) {
      setCancelConfirm(true);
      return;
    }
    if (cancelConfirmText.trim().toUpperCase() !== 'CANCEL') {
      pushFeedback('error', 'Confirmation required', 'Type CANCEL to release this hold.');
      return;
    }
    setBusy(true);
    try {
      await stripeFinancialCancelDeposit({
        franchiseId,
        depositId: primaryDeposit.id,
        reason: cancelReason.trim(),
      });
      pushFeedback('success', 'Deposit released', `${group.resCode || 'Hold'} released — logged with your name.`);
      setCancelConfirm(false);
      setCancelConfirmText('');
      setCancelReason('');
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
      if (res?.topUpError) {
        const capturedChf = (Number(res?.capturedAmount) || 0) / 100;
        pushFeedback(
          'error',
          'Hold captured — extra charge failed',
          `CHF ${capturedChf.toFixed(2)} captured from the hold, but the additional charge of CHF ${((Number(res.topUpAmount) || 0) / 100).toFixed(2)} failed: ${res.topUpError}`,
        );
      } else if (res?.mode === 'capture_plus_charge') {
        const capturedChf = (Number(res?.capturedAmount) || 0) / 100;
        const topUpChf = (Number(res?.topUp?.amount) || 0) / 100;
        pushFeedback(
          'success',
          'Total charged',
          `CHF ${charged.toFixed(2)} — ${capturedChf.toFixed(2)} captured from the hold + ${topUpChf.toFixed(2)} charged from the saved card.`,
        );
      } else if (res?.mode === 'capture') {
        pushFeedback(
          'success',
          'Hold captured',
          `CHF ${charged.toFixed(2)} captured from the existing deposit hold.`,
        );
      } else {
        pushFeedback('success', 'Charge completed', `CHF ${charged.toFixed(2)} charged from saved card`);
      }
      setChargeAmountChf('');
      setTab('direct');
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Charge failed', e);
    } finally {
      setBusy(false);
    }
  };

  const runRefundDirect = async (order) => {
    if (!order?.paymentIntentId && !order?.id) return;
    setBusy(true);
    try {
      await stripeFinancialRefundPayment({
        franchiseId,
        paymentIntentId: order.paymentIntentId,
        mailOrderId: order.id,
      });
      pushFeedback(
        'success',
        'Refund issued',
        `${formatMoney(order.amount, order.currency)} refunded — logged to audit trail.`,
      );
      setSelectedDirectOrderId(null);
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Refund failed', e);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'deposits', label: `Deposits (${group.deposits.length})` },
    { id: 'direct', label: `Direct (${directOrders.length})` },
    { id: 'mail', label: `Mail (${mailOrders.length})` },
    ...(showActionsTab ? [{ id: 'actions', label: 'Actions' }] : []),
  ];

  const relatedAudit = useMemo(
    () => filterAuditForCustomerGroup(auditEntries, group).slice(0, 20),
    [auditEntries, group],
  );

  const timeline = useMemo(
    () => buildCustomerTimeline(group, auditEntries).slice(0, 24),
    [group, auditEntries],
  );

  const panelShellClass =
    layout === 'inline'
      ? 'pal-cust-inspector-panel flex flex-col min-h-0 h-full'
      : layout === 'drawer'
        ? 'pal-cust-drawer-panel flex flex-col min-h-0 h-full'
        : 'pal-fin-modal pal-fin-modal-wide pal-cust-workbench';

  const panel = (
    <div
      className={panelShellClass}
      role={layout === 'inline' ? 'region' : 'dialog'}
      aria-modal={layout === 'inline' ? undefined : 'true'}
      onClick={layout === 'inline' ? undefined : (e) => e.stopPropagation()}
    >
        <header className={layout === 'drawer' ? 'pal-pay-drawer-header' : 'pal-fin-modal-header'}>
          <div>
            <p className="pal-fin-eyebrow">Stripe customer</p>
            <h2 className="pal-fin-modal-title">{group.displayTitle}</h2>
            <p className="pal-fin-modal-sub">
              {[group.customerName, group.customerEmail].filter(Boolean).join(' · ') || '—'}
            </p>
            <div className="pal-cust-signal-row pal-cust-signal-row-modal">
              {!hideSignalStrip && (
                <>
                  <PalantirSignal label="Deposits" value={group.deposits.length} tone={activeDeposits.length ? 'warn' : undefined} />
                  <PalantirSignal label="Direct" value={directOrders.length} tone={unpaidDirect ? 'bad' : 'ok'} />
                  <PalantirSignal label="Mail" value={mailOrders.length} />
                  <PalantirSignal label="Unpaid mail" value={unpaidMailLink} tone={unpaidMailLink ? 'bad' : 'ok'} />
                </>
              )}
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

        <div className={`${layout === 'drawer' ? 'pal-pay-drawer-body' : 'pal-fin-modal-body'} pal-cust-workbench-body`}>
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
              {chargeableDeposits.length > 0 && !activeDeposits.length && (
                <div className="pal-cust-highlight pal-cust-highlight-token">
                  <CreditCard size={14} />
                  <span>
                    {chargeableDeposits.length} deposit{chargeableDeposits.length === 1 ? '' : 's'} with saved card — open Actions to charge.
                  </span>
                </div>
              )}
              <section className="pal-cust-pipeline">
                <h3 className="pal-cust-audit-title">Timeline</h3>
                {timeline.length === 0 ? (
                  <p className="pal-cust-empty">No activity yet.</p>
                ) : (
                  <ol className="pal-cust-pipeline-list">
                    {timeline.map((ev) => (
                      <li key={ev.id} className="pal-cust-pipeline-item">
                        <span className="pal-cust-pipeline-dot" aria-hidden />
                        <div className="pal-cust-pipeline-body">
                          <div className="pal-cust-timeline-head pal-cust-pipeline-head">
                            <span className="pal-cust-pipeline-title">{ev.title}</span>
                            {ev.statusLabel && (
                              <StripeStatusBadge sharp variant={ev.statusVariant || 'neutral'} label={ev.statusLabel} />
                            )}
                          </div>
                          <span className="pal-cust-pipeline-meta pal-fin-mono">{formatDate(ev.at)}</span>
                          {(ev.detail || ev.amount != null) && (
                            <span className="pal-cust-pipeline-sub">
                              {[ev.detail, ev.amount != null ? formatMoney(ev.amount, ev.currency) : null]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                          {(ev.cardBrand || ev.cardLast4) && (
                            <span className="pal-cust-pipeline-method">
                              <StripePaymentMethodCell brand={ev.cardBrand} last4={ev.cardLast4} />
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          )}

          {tab === 'deposits' && (
            <div className="pal-cust-timeline pal-cust-timeline-modal">
              {group.deposits.length === 0 ? (
                <p className="pal-cust-empty">No deposit records.</p>
              ) : (
                group.deposits.map((dep) => {
                  const st = depositStatusDisplay(dep);
                  return (
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
                          {formatMoney(depositAmountMinor(dep), dep.currency)}
                        </span>
                        <StripeStatusBadge sharp variant={st.variant} label={st.label} />
                        {dep.tokenSaved && (
                          <StripeStatusBadge sharp variant="success" label="Token saved" />
                        )}
                      </div>
                      <p className="pal-cust-timeline-meta">
                        <StripePaymentMethodCell
                          brand={dep.cardBrand}
                          last4={dep.cardLast4}
                          methodType={dep.source === 'terminal' ? 'card_present' : 'card'}
                        />
                      </p>
                      {dep.readerLabel && <p className="pal-cust-timeline-meta">{dep.readerLabel}</p>}
                      <p className="pal-cust-timeline-meta">{formatDate(dep.createdAt)}</p>
                    </div>
                  </button>
                  );
                })
              )}
            </div>
          )}

          {tab === 'direct' && (
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
                              variant={
                                order.status === 'paid'
                                  ? 'paid'
                                  : order.status === 'failed'
                                    ? 'danger'
                                    : order.status === 'pending'
                                      ? 'warning'
                                      : 'unpaid'
                              }
                              label={
                                order.status === 'paid'
                                  ? 'Paid'
                                  : order.status === 'failed'
                                    ? 'Failed'
                                    : order.status === 'pending'
                                      ? 'Pending'
                                      : 'Unpaid'
                              }
                            />
                          </div>
                          <p className="pal-fin-mono pal-cust-timeline-amount">
                            {formatMoney(order.amount, order.currency)}
                          </p>
                          <p className="pal-cust-timeline-meta">{formatDate(order.createdAt)}</p>
                          {order.status === 'paid' && canPerformOperations && order.paymentIntentId && (
                            <button
                              type="button"
                              className="gm-btn gm-btn-secondary gm-btn-sm pal-cust-refund-btn"
                              disabled={busy}
                              onClick={(e) => {
                                e.stopPropagation();
                                runRefundDirect(order);
                              }}
                            >
                              <RotateCcw size={14} /> Refund
                            </button>
                          )}
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
              {primaryDeposit?.status === 'pending_collection' &&
                primaryDeposit?.stripeStatus !== 'requires_capture' && (
                <div className="pal-cust-highlight pal-cust-highlight-hold">
                  <Info size={14} />
                  <span>
                    Waiting for card on POS — complete terminal collection before capture or increase.
                  </span>
                </div>
              )}

              {canCaptureDeposit && (
                <section className="pal-cust-action-card pal-cust-action-card-secure">
                  <header className="pal-cust-action-card-head">
                    <CheckCircle2 size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Capture</h3>
                      <p className="pal-cust-action-card-sub">
                        {formatMoney(
                          primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount,
                          primaryDeposit.currency,
                        )}{' '}
                        currently on hold. Enter the TOTAL to charge — above the hold, the rest is
                        charged from the saved card.
                      </p>
                    </div>
                  </header>
                  <label className="pal-cust-field">
                    <span>Total amount (CHF)</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.05"
                      value={captureAmountChf}
                      onChange={(e) => setCaptureAmountChf(e.target.value)}
                      placeholder={currentHoldChf.toFixed(2)}
                      className="pal-fin-input"
                      disabled={busy}
                    />
                    <small>Leave empty to capture the full hold.</small>
                  </label>
                  {capturePreview?.mode === 'topup' && (
                    <p className={capturePreview.valid ? 'pal-pay-increase-delta-ok' : 'pal-pay-increase-delta-warn'}>
                      {capturePreview.valid
                        ? `Capture CHF ${capturePreview.captureChf.toFixed(2)} hold + charge CHF ${capturePreview.extraChf.toFixed(2)} from saved card = CHF ${capturePreview.total.toFixed(2)} total`
                        : 'Amount above the hold must be at least CHF 0.50'}
                    </p>
                  )}
                  {capturePreview?.mode === 'partial' && (
                    <p className="pal-pay-increase-delta-ok">
                      {`Capture CHF ${capturePreview.captureChf.toFixed(2)} — remaining CHF ${(currentHoldChf - capturePreview.captureChf).toFixed(2)} of the hold is released`}
                    </p>
                  )}
                  <button
                    type="button"
                    className="gm-btn gm-btn-primary gm-btn-sm"
                    disabled={busy || !capturePreview?.valid}
                    onClick={runCapture}
                  >
                    <CreditCard size={14} /> Capture
                  </button>
                </section>
              )}

              {canRefundDeposit && (
                <section className="pal-cust-action-card">
                  <header className="pal-cust-action-card-head">
                    <RotateCcw size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Refund</h3>
                      <p className="pal-cust-action-card-sub">
                        Captured deposit:{' '}
                        {formatMoney(
                          refundableDeposits[0].capturedAmount || refundableDeposits[0].initialAmount,
                          refundableDeposits[0].currency,
                        )}{' '}
                        · {formatDate(refundableDeposits[0].capturedAt || refundableDeposits[0].createdAt)}
                      </p>
                    </div>
                  </header>
                  <label className="pal-cust-field">
                    <span>Refund amount (CHF)</span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.05"
                      value={refundAmountChf}
                      onChange={(e) => setRefundAmountChf(e.target.value)}
                      placeholder={(
                        Number(refundableDeposits[0].capturedAmount || refundableDeposits[0].initialAmount || 0) / 100
                      ).toFixed(2)}
                      className="pal-fin-input"
                      disabled={busy}
                    />
                    <small>Leave empty for a full refund.</small>
                  </label>
                  <button
                    type="button"
                    className="gm-btn gm-btn-danger gm-btn-sm"
                    disabled={busy}
                    onClick={runRefundDeposit}
                  >
                    <RotateCcw size={14} /> Refund
                  </button>
                </section>
              )}

              {canIncreaseDeposit && (
                <section className="pal-cust-action-card">
                  <header className="pal-cust-action-card-head">
                    <TrendingUp size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Increase deposit hold</h3>
                      <p className="pal-cust-action-card-sub">
                        Current hold: {formatMoney(primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount, primaryDeposit.currency)}
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
                    <>
                      <p className="pal-cust-confirm-warn">
                        Type <strong>CANCEL</strong> to release this hold. Action is logged with RES, customer and your name.
                      </p>
                      <label className="pal-cust-field">
                        <span>Reason (required)</span>
                        <textarea
                          rows={2}
                          className="pal-fin-input"
                          value={cancelReason}
                          onChange={(e) => setCancelReason(e.target.value)}
                          placeholder="Why is this hold being released?"
                          disabled={busy}
                        />
                      </label>
                      <label className="pal-cust-field">
                        <span>Type CANCEL</span>
                        <input
                          type="text"
                          className="pal-fin-input"
                          value={cancelConfirmText}
                          onChange={(e) => setCancelConfirmText(e.target.value)}
                          placeholder="CANCEL"
                          disabled={busy}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                    </>
                  )}
                  <div className="pal-cust-action-row">
                    {cancelConfirm && (
                      <button
                        type="button"
                        className="gm-btn gm-btn-secondary gm-btn-sm"
                        disabled={busy}
                        onClick={() => {
                          setCancelConfirm(false);
                          setCancelConfirmText('');
                        }}
                      >
                        Back
                      </button>
                    )}
                    <button type="button" className="gm-btn gm-btn-danger gm-btn-sm" disabled={busy} onClick={runCancel}>
                      <Ban size={14} /> {cancelConfirm ? 'Release deposit' : 'Cancel hold'}
                    </button>
                  </div>
                </section>
              )}

              {canChargeSaved && (
                <section className="pal-cust-action-card pal-cust-action-card-secure">
                  <header className="pal-cust-action-card-head">
                    <CreditCard size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Direct charge</h3>
                      <p className="pal-cust-action-card-sub">
                        Off-session charge from the saved card token
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
                    <span>Logged to audit trail</span>
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

              {!canManageDeposit && !canChargeSaved && chargeableDeposits.length === 0 && (
                <p className="pal-cust-empty">
                  No chargeable deposit — complete a terminal deposit (card on POS) first.
                </p>
              )}
              {!canManageDeposit &&
                !canChargeSaved &&
                !canCaptureDeposit &&
                !canIncreaseDeposit &&
                !canRefundDirect &&
                !canRefundDeposit && (
                <p className="pal-cust-empty">No actions available for this customer.</p>
              )}

              {canRefundDirect && (
                <section className="pal-cust-action-card">
                  <header className="pal-cust-action-card-head">
                    <RotateCcw size={18} />
                    <div>
                      <h3 className="pal-cust-action-card-title">Refund direct charge</h3>
                      <p className="pal-cust-action-card-sub">Full refund on succeeded manual / saved-card charges</p>
                    </div>
                  </header>
                  <ul className="pal-cust-refund-list">
                    {paidDirectOrders.map((order) => (
                      <li key={order.id} className="pal-cust-refund-row">
                        <span className="pal-fin-mono">
                          {formatMoney(order.amount, order.currency)} · {formatDate(order.createdAt)}
                        </span>
                        <button
                          type="button"
                          className="gm-btn gm-btn-danger gm-btn-sm"
                          disabled={busy}
                          onClick={() => runRefundDirect(order)}
                        >
                          <RotateCcw size={14} /> Refund
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}

          <FoundryActivityLog
            title="Activity log"
            entries={relatedAudit}
            formatEntry={(entry) => formatStripeAuditEntry(entry)}
            formatDetail={(entry) =>
              [
                entry.detail?.resCode,
                entry.detail?.customerEmail,
                entry.detail?.paymentIntentId,
                entry.detail?.amountChf != null ? `CHF ${entry.detail.amountChf}` : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—'
            }
            emptyMessage="No matching audit entries."
          />
        </div>

        <footer className={layout === 'inline' ? 'pal-cust-inspector-footer' : layout === 'drawer' ? 'pal-cust-drawer-footer' : 'pal-fin-modal-footer'}>
          <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose}>
            {layout === 'inline' ? 'Clear selection' : 'Close'}
          </button>
        </footer>
    </div>
  );

  if (layout === 'inline') {
    return panel;
  }

  if (layout === 'drawer') {
    return (
      <div className="pal-pay-drawer-backdrop" role="presentation" onClick={onClose}>
        <aside
          className="pal-pay-drawer pal-pay-drawer-wide"
          role="dialog"
          aria-modal="true"
          aria-label="Customer detail"
          onClick={(e) => e.stopPropagation()}
        >
          {panel}
        </aside>
      </div>
    );
  }

  return (
    <div className="pal-fin-modal-backdrop" role="presentation" onClick={onClose}>
      {panel}
    </div>
  );
}

export { CenterFeedbackToast } from './StripeFinFeedback';
