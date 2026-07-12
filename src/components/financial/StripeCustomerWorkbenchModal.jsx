import React, { useEffect, useMemo, useState } from 'react';
import { X, CreditCard, Lock, RotateCcw, Banknote } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { StripePaymentDetailDrawer } from './StripePaymentDetailDrawer';
import {
  stripeFinancialCancelDeposit,
  stripeFinancialCaptureDeposit,
  stripeFinancialChargeSavedPaymentMethod,
  stripeFinancialRefundPayment,
} from '../../services/stripeFinancialApi';
import { FoundryActivityLog } from './FoundryActivityLog';
import { humanizeStripeFinancialError } from './StripeFinFeedback';
import { filterAuditForCustomerGroup, formatStripeAuditEntry, buildCustomerTransactionRows } from '../../utilities/stripeCustomerGroups';
import { depositStatusDisplay, depositAmountMinor, depositIsCapturable, resolveCapturableHoldTarget, depositCanOffSessionCharge, resolveChargeableDepositTarget, collectGroupDeposits } from '../../utilities/stripeDepositDisplay';
import { logPaymentUiAction } from '../../utilities/logPaymentUiAction';

function formatMoney(amount, currency) {
  if (amount == null) return 'â€”';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function formatDate(iso) {
  if (!iso) return 'â€”';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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
  initialTab = 'general',
  hideSignalStrip = false,
  onClose,
  onChanged,
  onCenterFeedback,
}) {
  const [tab, setTab] = useState('general');
  const [selectedDepositId, setSelectedDepositId] = useState(null);
  const [selectedTxnDetail, setSelectedTxnDetail] = useState(null);
  const [chargeAmountChf, setChargeAmountChf] = useState('');
  const [refundAmountChf, setRefundAmountChf] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentPanel, setPaymentPanel] = useState(null);

  useEffect(() => {
    setTab(initialTab === 'overview' ? 'general' : initialTab === 'actions' ? 'payments' : (initialTab || 'general'));
    setSelectedDepositId(null);
    setSelectedTxnDetail(null);
    setChargeAmountChf('');
    setRefundAmountChf('');
    setReleaseReason('');
    setPaymentPanel(null);
  }, [group?.id, initialTab]);

  const activeDeposits = useMemo(
    () =>
      group?.deposits?.filter((d) => {
        const label = depositStatusDisplay(d).label;
        return label === 'Uncaptured' || label === 'Increased';
      }) || [],
    [group],
  );

  const chargeableDeposits = useMemo(
    () => sortDepositsNewestFirst(collectGroupDeposits(group).filter(depositCanOffSessionCharge)),
    [group],
  );

  const captureTarget = useMemo(() => resolveCapturableHoldTarget(group), [group]);

  const chargeDeposit = useMemo(() => {
    const resolved = resolveChargeableDepositTarget(group);
    if (!resolved) return null;
    if (selectedDepositId) {
      const sel = chargeableDeposits.find(
        (d) => d.id === selectedDepositId || d.paymentIntentId === selectedDepositId,
      );
      if (sel) return sel;
    }
    return resolved;
  }, [group, chargeableDeposits, selectedDepositId]);

  const directOrders = group?.directOrders || [];
  const mailOrders = group?.mailOrders || [];
  const pendingDirectOrders = useMemo(
    () =>
      directOrders.filter(
        (o) => o.status !== 'paid' && o.status !== 'failed' && o.chargeMode === 'direct_card',
      ),
    [directOrders],
  );

  const canCaptureDeposit =
    canPerformOperations &&
    Boolean(captureTarget?.paymentIntentId) &&
    Number(captureTarget?.holdAmount || 0) > 0 &&
    (depositIsCapturable(captureTarget.deposit, null) ||
      Boolean(group?.stripePayments?.some((tx) => String(tx.bucket).toLowerCase() === 'hold' && tx.paymentIntentId === captureTarget.paymentIntentId)));

  const canChargeSaved =
    canPerformOperations &&
    Boolean(chargeDeposit?.paymentIntentId) &&
    depositCanOffSessionCharge(chargeDeposit);

  const paymentActionHint = useMemo(() => {
    if (!canPerformOperations) return 'You do not have permission to run payment actions.';
    if (canChargeSaved) return null;
    if (pendingDirectOrders.length > 0 && chargeableDeposits.length === 0) {
      return 'A manual direct charge is pending because the card was never entered. Complete it from Direct payment, or wait for sync if a deposit exists on Stripe.';
    }
    if (chargeableDeposits.length === 0) {
      return 'No deposit with a saved card found for this customer. Authorize a deposit on POS first.';
    }
    if (!chargeDeposit?.paymentIntentId) {
      return 'Deposit is missing a Stripe payment reference — run Sync and try again.';
    }
    return 'Saved card is not available yet — open this customer after Sync completes.';
  }, [
    canPerformOperations,
    canChargeSaved,
    pendingDirectOrders.length,
    chargeableDeposits.length,
    chargeDeposit?.paymentIntentId,
  ]);

  const primaryDeposit = useMemo(() => {
    if (captureTarget?.deposit) return captureTarget.deposit;
    const sorted = sortDepositsNewestFirst(collectGroupDeposits(group));
    if (!sorted.length) return null;
    if (selectedDepositId) {
      return (
        sorted.find((d) => d.id === selectedDepositId || d.paymentIntentId === selectedDepositId) ||
        sorted[0]
      );
    }
    const capturable = sorted.find((d) => depositIsCapturable(d));
    return capturable || sorted[0];
  }, [group, selectedDepositId, captureTarget]);

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
  const canReleaseHold = canCaptureDeposit;
  const canRefundOrRelease = canRefundDeposit || canReleaseHold;

  useEffect(() => {
    if (tab === 'overview') setTab('general');
    if (tab === 'actions' || tab === 'deposits' || tab === 'direct' || tab === 'mail') setTab('payments');
  }, [tab]);

  useEffect(() => {
    if (tab !== 'payments' || !onChanged) return undefined;
    const timer = window.setInterval(() => {
      onChanged();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [tab, onChanged, group?.id]);

  const currentHoldChf = (primaryDeposit?.currentHoldAmount || primaryDeposit?.initialAmount || 0) / 100;

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

  const runCapture = async () => {
    if (!captureTarget?.paymentIntentId) {
      pushFeedback('error', 'No hold', 'There is no capturable deposit hold for this customer.');
      return;
    }
    const holdMinor = captureTarget.holdAmount || 0;
    if (holdMinor <= 0) {
      pushFeedback('error', 'No hold', 'There is no capturable deposit hold for this customer.');
      return;
    }
    setBusy(true);
    logPaymentUiAction(franchiseId, 'capture_execute', {
      resCode: group.resCode,
      depositId: captureTarget.depositId,
      paymentIntentId: captureTarget.paymentIntentId,
    });
    try {
      const res = await stripeFinancialCaptureDeposit({
        franchiseId,
        ...(captureTarget.depositId ? { depositId: captureTarget.depositId } : {}),
        paymentIntentId: captureTarget.paymentIntentId,
      });
      const capturedChf =
        (Number(res?.capturedAmount ?? res?.amountReceived) ||
          primaryDeposit.currentHoldAmount ||
          primaryDeposit.initialAmount ||
          0) / 100;
      pushFeedback(
        'success',
        'Hold captured',
        `CHF ${capturedChf.toFixed(2)} charged from the authorized deposit hold.`,
      );
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
    logPaymentUiAction(franchiseId, 'refund_deposit_execute', {
      resCode: group.resCode,
      paymentIntentId: dep.paymentIntentId,
    });
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

  const runReleaseHold = async () => {
    if (!primaryDeposit?.id) return;
    const reason = releaseReason.trim();
    if (!reason) {
      pushFeedback('error', 'Reason required', 'Enter why this hold is being released.');
      return;
    }
    setBusy(true);
    logPaymentUiAction(franchiseId, 'release_hold_execute', {
      resCode: group.resCode,
      depositId: primaryDeposit.id,
    });
    try {
      await stripeFinancialCancelDeposit({
        franchiseId,
        depositId: primaryDeposit.id,
        reason,
      });
      pushFeedback(
        'success',
        'Hold released',
        `${formatMoney(primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount, primaryDeposit.currency)} hold released — logged to audit trail.`,
      );
      setReleaseReason('');
      setPaymentPanel(null);
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Release failed', e);
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
    if (!chargeDeposit?.paymentIntentId) {
      pushFeedback('error', 'No saved card', 'Complete a deposit on POS first so the card is saved.');
      return;
    }
    setBusy(true);
    logPaymentUiAction(franchiseId, 'charge_saved_execute', {
      resCode: group.resCode,
      depositId: chargeDeposit.id || null,
      paymentIntentId: chargeDeposit.paymentIntentId,
      amountChf: amount,
    });
    try {
      const res = await stripeFinancialChargeSavedPaymentMethod({
        franchiseId,
        ...(chargeDeposit.id ? { depositId: chargeDeposit.id } : {}),
        paymentIntentId: chargeDeposit.paymentIntentId,
        amountChf: amount,
      });
      const charged = (res?.chargedAmount || amount * 100) / 100;
      if (res?.topUpError) {
        const capturedChf = (Number(res?.capturedAmount) || 0) / 100;
        pushFeedback(
          'error',
          'Hold captured â€” extra charge failed',
          `CHF ${capturedChf.toFixed(2)} captured from the hold, but the additional charge of CHF ${((Number(res.topUpAmount) || 0) / 100).toFixed(2)} failed: ${res.topUpError}`,
        );
      } else if (res?.mode === 'capture_plus_charge') {
        const capturedChf = (Number(res?.capturedAmount) || 0) / 100;
        const topUpChf = (Number(res?.topUp?.amount) || 0) / 100;
        pushFeedback(
          'success',
          'Total charged',
          `CHF ${charged.toFixed(2)} â€” ${capturedChf.toFixed(2)} captured from the hold + ${topUpChf.toFixed(2)} charged from the saved card.`,
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
      setPaymentPanel(null);
      onChanged?.();
    } catch (e) {
      pushFeedbackFromError('Charge failed', e);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General' },
    { id: 'payments', label: 'Payments' },
  ];

  const relatedAudit = useMemo(
    () => filterAuditForCustomerGroup(auditEntries, group).slice(0, 20),
    [auditEntries, group],
  );

  const allTransactions = useMemo(() => buildCustomerTransactionRows(group), [group]);

  const txnDetailDeposit = useMemo(() => {
    if (!selectedTxnDetail) return null;
    if (selectedTxnDetail.depositId) {
      return (group?.deposits || []).find((d) => d.id === selectedTxnDetail.depositId) || null;
    }
    if (selectedTxnDetail.paymentIntentId) {
      return (
        (group?.deposits || []).find((d) => d.paymentIntentId === selectedTxnDetail.paymentIntentId) ||
        null
      );
    }
    return null;
  }, [selectedTxnDetail, group]);

  const openTxnDetail = (tx) => {
    // Prefer full Stripe payment row when available so drawer fields are rich.
    const stripeMatch = (group?.stripePayments || []).find(
      (p) =>
        (tx.paymentIntentId && p.paymentIntentId === tx.paymentIntentId) ||
        (tx.depositId && p.depositId === tx.depositId),
    );
    const base = stripeMatch
      ? {
          ...stripeMatch,
          mailOrderId: tx.mailOrderId || stripeMatch.mailOrderId,
          paidAt: tx.paidAt || stripeMatch.paidAt,
          category: tx.category || stripeMatch.category,
          cancelReason: tx.cancelReason || stripeMatch.cancelReason,
          cancelledByName: tx.cancelledByName || stripeMatch.cancelledByName,
        }
      : {
          id: tx.id,
          paymentIntentId: tx.paymentIntentId || null,
          mailOrderId: tx.mailOrderId || null,
          depositId: tx.depositId || null,
          bucket: tx.bucket || (tx.statusLabel === 'Succeeded' ? 'successful' : 'pending'),
          status: tx.statusLabel,
          statusLabel: tx.statusLabel,
          amount: tx.amount,
          amountReceived: tx.amount,
          currency: tx.currency,
          customerName: tx.customerName || group?.customerName,
          customerEmail: tx.customerEmail || group?.customerEmail,
          resCode: tx.resCode || group?.resCode,
          reference: tx.reference || tx.resCode || group?.resCode,
          category: tx.category,
          channelLabel: tx.channelLabel || tx.type,
          cardBrand: tx.cardBrand,
          cardLast4: tx.cardLast4,
          createdAt: tx.createdAt || tx.at,
          paidAt: tx.paidAt || null,
          plate: tx.plate || '',
          flowType: tx.flowType || null,
          cancelReason: tx.cancelReason || null,
          cancelledByName: tx.cancelledByName || null,
        };
    setSelectedTxnDetail(base);
  };

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
              {[group.customerName, group.customerEmail].filter(Boolean).join(' Â· ') || 'â€”'}
            </p>
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
          {tab === 'general' && (
            <div className="pal-cust-workbench-grid">
              <dl className="pal-fin-drawer-dl">
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">RES code</dt>
                  <dd className="pal-fin-drawer-value pal-fin-mono">{group.resCode || 'â€”'}</dd>
                </div>
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">Customer</dt>
                  <dd className="pal-fin-drawer-value">{group.customerName || 'â€”'}</dd>
                </div>
                <div className="pal-fin-drawer-row">
                  <dt className="pal-fin-drawer-label">Email</dt>
                  <dd className="pal-fin-drawer-value">{group.customerEmail || 'â€”'}</dd>
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
                    {activeDeposits[0]?.captureBefore
                      ? ` · expires ${formatDate(activeDeposits[0].captureBefore)}`
                      : ''}
                  </span>
                </div>
              )}
              {chargeableDeposits.length > 0 && !activeDeposits.length && (
                <div className="pal-cust-highlight pal-cust-highlight-token">
                  <CreditCard size={14} />
                  <span>
                    Saved card on file â€” use Payments â†’ New payment to charge.
                  </span>
                </div>
              )}
              {refundableDeposits.length > 0 && (
                <div className="pal-cust-deposit-status-card">
                  <p className="pal-cust-deposit-status-label">Captured deposit</p>
                  <p className="pal-fin-mono pal-cust-deposit-status-value">
                    {formatMoney(
                      refundableDeposits[0].capturedAmount || refundableDeposits[0].initialAmount,
                      refundableDeposits[0].currency,
                    )}
                  </p>
                  <p className="pal-cust-deposit-status-meta">
                    {formatDate(refundableDeposits[0].capturedAt || refundableDeposits[0].createdAt)}
                  </p>
                </div>
              )}
            </div>
          )}

          {tab === 'payments' && (
            <div className="pal-cust-payments-tab">
              {canPerformOperations && (
                <>
                  <div className="pal-cust-pay-toolbar" role="toolbar" aria-label="Payment actions">
                    <button
                      type="button"
                      className="pal-cust-pay-tool pal-cust-pay-tool-capture"
                      disabled={busy || !canCaptureDeposit}
                      onClick={runCapture}
                    >
                      <CreditCard size={16} aria-hidden />
                      <span>Capture</span>
                      {canCaptureDeposit && (
                        <small>
                          {formatMoney(
                            primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount,
                            primaryDeposit.currency,
                          )}
                        </small>
                      )}
                    </button>
                    <button
                      type="button"
                      className={`pal-cust-pay-tool pal-cust-pay-tool-refund ${paymentPanel === 'refund' ? 'pal-cust-pay-tool-active' : ''}`}
                      disabled={busy || !canRefundOrRelease}
                      onClick={() => setPaymentPanel((p) => (p === 'refund' ? null : 'refund'))}
                    >
                      <RotateCcw size={16} aria-hidden />
                      <span>{canReleaseHold && !canRefundDeposit ? 'Release' : 'Refund'}</span>
                    </button>
                    <button
                      type="button"
                      className={`pal-cust-pay-tool pal-cust-pay-tool-new ${paymentPanel === 'charge' ? 'pal-cust-pay-tool-active' : ''}`}
                      disabled={busy || !canChargeSaved}
                      onClick={() => setPaymentPanel((p) => (p === 'charge' ? null : 'charge'))}
                    >
                      <Banknote size={16} aria-hidden />
                      <span>New payment</span>
                    </button>
                  </div>

                  <div className="pal-cust-pay-panel-slot">
                    {paymentPanel === 'refund' && canReleaseHold && (
                      <div className="pal-cust-pay-inline-form pal-cust-pay-inline-form-stack">
                        <p className="pal-cust-pay-hint pal-cust-pay-hint-inline">
                          Release the uncaptured hold of{' '}
                          {formatMoney(
                            primaryDeposit.currentHoldAmount || primaryDeposit.initialAmount,
                            primaryDeposit.currency,
                          )}{' '}
                          — manual staff action only, logged to audit.
                        </p>
                        <label className="pal-cust-pay-field pal-cust-pay-field-full">
                          <span>Reason for release</span>
                          <textarea
                            rows={2}
                            className="pal-fin-input"
                            value={releaseReason}
                            onChange={(e) => setReleaseReason(e.target.value)}
                            placeholder="e.g. Customer declined, wrong amount…"
                            disabled={busy}
                          />
                        </label>
                        <button
                          type="button"
                          className="gm-btn gm-btn-danger gm-btn-sm"
                          disabled={busy}
                          onClick={runReleaseHold}
                        >
                          Release hold
                        </button>
                      </div>
                    )}

                    {paymentPanel === 'refund' && canRefundDeposit && (
                      <div className="pal-cust-pay-inline-form">
                        <label className="pal-cust-pay-field">
                          <span>Refund amount</span>
                          <div className="pal-cust-chf-input">
                            <Banknote size={16} aria-hidden />
                            <span className="pal-cust-chf-prefix">CHF</span>
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
                          </div>
                        </label>
                        <button
                          type="button"
                          className="gm-btn gm-btn-danger gm-btn-sm"
                          disabled={busy}
                          onClick={runRefundDeposit}
                        >
                          Refund deposit
                        </button>
                      </div>
                    )}

                    {paymentPanel === 'charge' && canChargeSaved && (
                      <div className="pal-cust-pay-inline-form">
                        <label className="pal-cust-pay-field">
                          <span>Charge saved card</span>
                          <div className="pal-cust-chf-input">
                            <Banknote size={16} aria-hidden />
                            <span className="pal-cust-chf-prefix">CHF</span>
                            <input
                              type="number"
                              min="0.5"
                              step="0.05"
                              value={chargeAmountChf}
                              onChange={(e) => setChargeAmountChf(e.target.value)}
                              placeholder="0.00"
                              className="pal-fin-input"
                              disabled={busy}
                            />
                          </div>
                        </label>
                        <button
                          type="button"
                          className="gm-btn gm-btn-primary gm-btn-sm"
                          disabled={busy}
                          onClick={runChargeSaved}
                        >
                          Charge card
                        </button>
                      </div>
                    )}

                    {!paymentPanel && (
                      <p className="pal-cust-pay-hint">
                        Capture charges the full hold. Refund or New payment opens amount entry below.
                      </p>
                    )}
                    {paymentActionHint && (
                      <p className="pal-fin-alert pal-fin-alert-warn pal-cust-pay-hint">{paymentActionHint}</p>
                    )}
                    {pendingDirectOrders.length > 0 && (
                      <p className="pal-fin-alert pal-fin-alert-warn pal-cust-pay-hint">
                        {formatMoney(pendingDirectOrders[0].amount, pendingDirectOrders[0].currency)} direct
                        charge is still pending — the card form was not completed. You can still charge the
                        customer&apos;s saved deposit card via New payment.
                      </p>
                    )}
                  </div>
                </>
              )}

              <section className="pal-cust-tx-section">
                <h3 className="pal-cust-audit-title">Transactions</h3>
                {allTransactions.length === 0 ? (
                  <p className="pal-cust-empty">No transactions yet.</p>
                ) : (
                  <div className="pal-cust-tx-table-wrap">
                    <table className="gm-table pal-cust-tx-table">
                      <thead>
                        <tr>
                          <th>Amount</th>
                          <th>Status</th>
                          <th>Type</th>
                          <th>Method</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allTransactions.map((tx) => (
                          <tr
                            key={tx.id}
                            className="pal-cust-tx-row-selectable"
                            onClick={() => openTxnDetail(tx)}
                            style={{ cursor: 'pointer' }}
                          >
                            <td className="pal-fin-mono tabular-nums">
                              {formatMoney(tx.amount, tx.currency)}
                            </td>
                            <td>
                              <div className="stripe-pay-status-cell" title={tx.statusNote || undefined}>
                                <StripeStatusBadge sharp variant={tx.statusVariant} label={tx.statusLabel} />
                                {tx.statusNote && (
                                  <span className="stripe-pay-status-note">{tx.statusNote}</span>
                                )}
                              </div>
                            </td>
                            <td className="pal-cust-tx-type-cell">{tx.type}</td>
                            <td>
                              {(tx.cardBrand || tx.cardLast4) ? (
                                <StripePaymentMethodCell brand={tx.cardBrand} last4={tx.cardLast4} />
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="tabular-nums text-[var(--erpx-ink-secondary)]">{formatDate(tx.at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          )}

          <FoundryActivityLog
            title="Activity log"
            defaultOpen={false}
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

        {selectedTxnDetail && (
          <StripePaymentDetailDrawer
            transaction={selectedTxnDetail}
            deposit={txnDetailDeposit}
            franchiseId={franchiseId}
            canPerformOperations={canPerformOperations}
            onClose={() => setSelectedTxnDetail(null)}
            onChanged={() => {
              setSelectedTxnDetail(null);
              onChanged?.();
            }}
            onFeedback={onCenterFeedback}
          />
        )}

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
