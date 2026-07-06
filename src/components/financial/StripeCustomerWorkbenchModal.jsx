import React, { useEffect, useMemo, useState } from 'react';
import { X, CreditCard, Lock, RotateCcw, Banknote } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import {
  stripeFinancialCancelDeposit,
  stripeFinancialCaptureDeposit,
  stripeFinancialChargeSavedPaymentMethod,
  stripeFinancialRefundPayment,
} from '../../services/stripeFinancialApi';
import { FoundryActivityLog } from './FoundryActivityLog';
import { humanizeStripeFinancialError } from './StripeFinFeedback';
import { filterAuditForCustomerGroup, formatStripeAuditEntry } from '../../utilities/stripeCustomerGroups';
import { depositStatusDisplay, depositAmountMinor } from '../../utilities/stripeDepositDisplay';
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
  initialTab = 'general',
  hideSignalStrip = false,
  onClose,
  onChanged,
  onCenterFeedback,
}) {
  const [tab, setTab] = useState('general');
  const [selectedDepositId, setSelectedDepositId] = useState(null);
  const [chargeAmountChf, setChargeAmountChf] = useState('');
  const [refundAmountChf, setRefundAmountChf] = useState('');
  const [releaseReason, setReleaseReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentPanel, setPaymentPanel] = useState(null);

  useEffect(() => {
    setTab(initialTab === 'overview' ? 'general' : initialTab === 'actions' ? 'payments' : (initialTab || 'general'));
    setSelectedDepositId(null);
    setChargeAmountChf('');
    setRefundAmountChf('');
    setReleaseReason('');
    setPaymentPanel(null);
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

  const canCaptureDeposit =
    canPerformOperations &&
    Boolean(primaryDeposit) &&
    primaryDeposit.status !== 'captured' &&
    primaryDeposit.status !== 'cancelled' &&
    primaryDeposit.stripeStatus !== 'canceled' &&
    primaryDeposit.stripeStatus !== 'cancelled' &&
    (primaryDeposit.status === 'authorized' || primaryDeposit.stripeStatus === 'requires_capture');

  const canChargeSaved = canPerformOperations && Boolean(chargeDeposit?.id);

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
    if (!primaryDeposit?.id || currentHoldChf <= 0) {
      pushFeedback('error', 'No hold', 'There is no capturable deposit hold for this customer.');
      return;
    }
    setBusy(true);
    logPaymentUiAction(franchiseId, 'capture_execute', { resCode: group.resCode, depositId: primaryDeposit.id });
    try {
      const res = await stripeFinancialCaptureDeposit({
        franchiseId,
        depositId: primaryDeposit.id,
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
    if (!chargeDeposit?.id) {
      pushFeedback('error', 'No saved card', 'Complete a deposit on POS first so the card is saved.');
      return;
    }
    setBusy(true);
    logPaymentUiAction(franchiseId, 'charge_saved_execute', {
      resCode: group.resCode,
      depositId: chargeDeposit.id,
      amountChf: amount,
    });
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

  const allTransactions = useMemo(() => {
    const items = [];
    for (const d of group?.deposits || []) {
      const st = depositStatusDisplay(d);
      items.push({
        id: `dep-${d.id}`,
        type: 'Deposit',
        at: d.createdAt,
        amount: depositAmountMinor(d),
        currency: d.currency || 'chf',
        statusLabel: st.label,
        statusVariant: st.variant,
        cardBrand: d.cardBrand,
        cardLast4: d.cardLast4,
      });
    }
    for (const o of directOrders) {
      items.push({
        id: `dir-${o.id}`,
        type: 'Direct',
        at: o.createdAt,
        amount: o.amount,
        currency: o.currency || 'chf',
        statusLabel: o.status === 'paid' ? 'Succeeded' : o.status === 'failed' ? 'Failed' : 'Pending',
        statusVariant: o.status === 'paid' ? 'success' : o.status === 'failed' ? 'danger' : 'warning',
        cardBrand: o.cardBrand,
        cardLast4: o.cardLast4,
      });
    }
    for (const o of mailOrders) {
      items.push({
        id: `mail-${o.id}`,
        type: 'Mail',
        at: o.createdAt,
        amount: o.amount,
        currency: o.currency || 'chf',
        statusLabel: o.status === 'paid' ? 'Succeeded' : 'Unpaid',
        statusVariant: o.status === 'paid' ? 'success' : 'unpaid',
        cardBrand: o.cardBrand,
        cardLast4: o.cardLast4,
      });
    }
    return items.sort((a, b) => {
      const ta = a.at ? new Date(a.at).getTime() : 0;
      const tb = b.at ? new Date(b.at).getTime() : 0;
      return tb - ta;
    });
  }, [group, directOrders, mailOrders]);

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
                    {activeDeposits.length} active hold{activeDeposits.length === 1 ? '' : 's'} Â·{' '}
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
                          <tr key={tx.id}>
                            <td className="pal-fin-mono tabular-nums">
                              {formatMoney(tx.amount, tx.currency)}
                            </td>
                            <td>
                              <StripeStatusBadge sharp variant={tx.statusVariant} label={tx.statusLabel} />
                            </td>
                            <td className="pal-cust-tx-type-cell">{tx.type}</td>
                            <td>
                              {(tx.cardBrand || tx.cardLast4) ? (
                                <StripePaymentMethodCell brand={tx.cardBrand} last4={tx.cardLast4} />
                              ) : (
                                'â€”'
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
