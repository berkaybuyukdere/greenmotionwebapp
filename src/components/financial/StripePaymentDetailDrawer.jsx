import React, { useMemo, useState } from 'react';
import { X, Ban, TrendingUp, CreditCard } from 'lucide-react';
import { StripeStatusBadge } from '../StripeListUI';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import {
  stripeFinancialCancelPaymentHold,
  stripeFinancialCaptureDeposit,
  stripeFinancialIncrementDeposit,
} from '../../services/stripeFinancialApi';
import { humanizeStripeFinancialError } from './StripeFinFeedback';

const BUCKET_VARIANT = {
  successful: 'success',
  hold: 'info',
  pending: 'warning',
  cancelled: 'danger',
};

const BUCKET_LABEL = {
  successful: 'Paid',
  hold: 'Hold',
  pending: 'Pending',
  cancelled: 'Canceled',
};

const CHANNEL_VARIANT = {
  Deposit: 'deposit',
  'WheelSys · Deposit': 'wheelsys',
  Terminal: 'info',
  'Mail order': 'neutral',
  Online: 'neutral',
};

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
  return new Date(iso).toLocaleString();
}

function DetailRow({ label, value, mono }) {
  return (
    <div className="pal-pay-detail-row">
      <span className="pal-pay-detail-label">{label}</span>
      <span className={mono ? 'pal-pay-detail-value pal-fin-mono' : 'pal-pay-detail-value'}>
        {value || '—'}
      </span>
    </div>
  );
}

function resolveDepositLifecycle(transaction, deposit) {
  const depositStatus = String(deposit?.status || '').toLowerCase();
  const stripePiStatus = String(deposit?.stripeStatus || transaction?.stripeStatus || '').toLowerCase();
  const displayStatus = String(transaction?.depositDisplayStatus || '').toLowerCase();
  const bucket = transaction?.bucket || 'pending';

  const isCaptured =
    depositStatus === 'captured' ||
    stripePiStatus === 'succeeded' ||
    displayStatus === 'captured' ||
    displayStatus === 'captured_increased' ||
    (bucket === 'successful' && (transaction?.flowType === 'deposit' || Boolean(deposit)));

  const isCancelled =
    depositStatus === 'cancelled' ||
    displayStatus === 'cancelled' ||
    bucket === 'cancelled';

  const isAuthorizedHold =
    !isCaptured &&
    !isCancelled &&
    (depositStatus === 'authorized' || stripePiStatus === 'requires_capture');

  const isPendingCollection =
    !isCaptured &&
    !isCancelled &&
    !isAuthorizedHold &&
    (depositStatus === 'pending_collection' || bucket === 'pending');

  const effectiveBucket = isCaptured
    ? 'successful'
    : isCancelled
      ? 'cancelled'
      : isAuthorizedHold
        ? 'hold'
        : isPendingCollection
          ? 'pending'
          : bucket;

  return {
    bucket: effectiveBucket,
    isCaptured,
    isCancelled,
    isAuthorizedHold,
    isPendingCollection,
    canCancel: isAuthorizedHold,
    canCaptureDeposit: isAuthorizedHold,
    canManageDeposit: isAuthorizedHold,
  };
}

export function StripePaymentDetailDrawer({
  transaction,
  deposit,
  franchiseId,
  layout = 'drawer',
  onClose,
  onChanged,
  onFeedback,
}) {
  const [cancelReason, setCancelReason] = useState('');
  const [totalAmountChf, setTotalAmountChf] = useState('');
  const [showIncreasePanel, setShowIncreasePanel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const lifecycle = useMemo(
    () => resolveDepositLifecycle(transaction, deposit),
    [transaction, deposit],
  );
  const {
    bucket,
    isCaptured,
    isCancelled,
    isPendingCollection,
    canCancel,
    canCaptureDeposit,
    canManageDeposit,
  } = lifecycle;
  const isDeposit = transaction?.flowType === 'deposit' || Boolean(deposit);
  const inline = layout === 'inline';

  const currentHoldCents =
    deposit?.currentHoldAmount || deposit?.initialAmount || transaction?.depositCurrentHold || 0;
  const currentHoldChf = currentHoldCents / 100;
  const maxAuthChf = (deposit?.maxAuthAmount || transaction?.depositMaxAuthAmount || 0) / 100;
  const canIncreaseToMax = maxAuthChf > currentHoldChf && canManageDeposit;

  const applyIncreaseToMax = () => {
    setShowIncreasePanel(true);
    setTotalAmountChf(maxAuthChf.toFixed(2));
    setError('');
  };

  const increasePreview = useMemo(() => {
    const total = Number(totalAmountChf);
    if (!Number.isFinite(total) || total <= 0) return null;
    const additional = total - currentHoldChf;
    if (additional <= 0) return { additional: 0, valid: false };
    if (total > maxAuthChf) return { additional, valid: false, overMax: true };
    return { additional, valid: true, total };
  }, [totalAmountChf, currentHoldChf, maxAuthChf]);

  const amountDisplay = useMemo(() => {
    if (!transaction) return '—';
    const cents = isCaptured
      ? deposit?.capturedAmount || transaction.amountReceived || transaction.amount
      : bucket === 'hold'
        ? transaction.holdAmount || transaction.amount
        : transaction.amountReceived || transaction.amount;
    return formatMoney(cents, transaction.currency);
  }, [transaction, bucket, isCaptured, deposit?.capturedAmount]);

  if (!transaction) return null;

  const channelLabel = transaction.channelLabel || (isDeposit ? 'Deposit' : null);
  const statusLabel = isCaptured
    ? 'Paid'
    : BUCKET_LABEL[bucket] || transaction.statusLabel || transaction.status;

  const pushFeedback = (type, title, detail, extra = {}) => {
    onFeedback?.({ type, title, detail, ...extra, at: new Date().toISOString() });
  };

  const pushFeedbackFromError = (defaultTitle, err) => {
    const friendly = humanizeStripeFinancialError(err);
    pushFeedback(
      'error',
      friendly.title || defaultTitle,
      friendly.detail,
      { code: friendly.code, nextSteps: friendly.nextSteps },
    );
  };

  const runCancel = async () => {
    if (!cancelReason.trim()) {
      setError('Please enter a cancellation reason.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await stripeFinancialCancelPaymentHold({
        franchiseId,
        depositId: deposit?.id || transaction.depositId,
        paymentIntentId: transaction.paymentIntentId,
        reason: cancelReason.trim(),
      });
      pushFeedback('success', 'Hold released', 'Deposit authorization cancelled and hold released.');
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Cancel failed', e);
      setError(e?.message || 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const runCapture = async () => {
    const depositId = deposit?.id || transaction.depositId;
    if (!depositId) return;
    setBusy(true);
    setError('');
    try {
      const res = await stripeFinancialCaptureDeposit({ franchiseId, depositId });
      const capturedChf =
        (Number(res?.amountReceived) || currentHoldCents || 0) / 100;
      pushFeedback(
        'success',
        'Hold captured',
        `CHF ${capturedChf.toFixed(2)} charged from the authorized deposit hold.`,
      );
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Capture failed', e);
      setError(e?.message || 'Capture failed');
    } finally {
      setBusy(false);
    }
  };

  const runIncrement = async () => {
    const depositId = deposit?.id || transaction.depositId;
    if (!depositId || !increasePreview?.valid) return;
    setBusy(true);
    setError('');
    try {
      await stripeFinancialIncrementDeposit({
        franchiseId,
        depositId,
        newAmountChf: increasePreview.total,
      });
      pushFeedback(
        'success',
        'Deposit authorization increased',
        `New hold CHF ${increasePreview.total.toFixed(2)} (+${increasePreview.additional.toFixed(2)}).`,
      );
      onChanged?.();
      onClose?.();
    } catch (e) {
      pushFeedbackFromError('Increase failed', e);
      setError(e?.message || 'Increase failed');
    } finally {
      setBusy(false);
    }
  };

  const panelBody = (
    <>
        <header className="pal-pay-drawer-header">
          <div>
            <p className="pal-fin-eyebrow">{isCaptured ? 'Captured deposit' : 'Deposit preview'}</p>
            <p className="pal-pay-drawer-amount">{amountDisplay}</p>
            <div className="pal-pay-drawer-badges">
              <StripeStatusBadge
                sharp
                variant={BUCKET_VARIANT[bucket] || 'neutral'}
                label={statusLabel}
              />
              {channelLabel && (
                <StripeStatusBadge
                  sharp
                  variant={CHANNEL_VARIANT[channelLabel] || 'neutral'}
                  label={channelLabel}
                />
              )}
            </div>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pal-pay-drawer-body">
          <DetailRow label="Customer" value={transaction.customerName} />
          <DetailRow label="Email" value={transaction.customerEmail} />
          <DetailRow label="Plate" value={transaction.plate} mono />
          <DetailRow label="RES code" value={transaction.reference || deposit?.resCode || transaction.displayDescription} mono />
          <DetailRow label="Date" value={formatDate(transaction.createdAt)} />
          {isDeposit && (
            <DetailRow
              label="Deposit hold"
              value={formatMoney(currentHoldCents, transaction.currency)}
            />
          )}
          {(deposit?.tokenSaved || transaction?.tokenSaved) && (
            <div className="pal-pay-detail-row">
              <span className="pal-pay-detail-label">Token</span>
              <span className="pal-fin-token-saved-badge">Token saved</span>
            </div>
          )}
          {transaction.depositSource === 'wheelsys' && (
            <DetailRow label="Origin" value="WheelSys rental flow" />
          )}
          <div className="pal-pay-detail-row">
            <span className="pal-pay-detail-label">Card</span>
            <StripePaymentMethodCell
              brand={transaction.cardBrand}
              last4={transaction.cardLast4}
              methodType={transaction.paymentMethod}
            />
          </div>
          {transaction.paymentIntentId && (
            <DetailRow label="Payment intent" value={transaction.paymentIntentId} mono />
          )}
          {isCaptured && deposit?.capturedAt && (
            <DetailRow label="Captured at" value={formatDate(deposit.capturedAt)} />
          )}

          {deposit?.cancelReason && (
            <DetailRow label="Cancel note" value={deposit.cancelReason} />
          )}

          {isPendingCollection && (
            <div className="pal-pay-drawer-section">
              <p className="pal-fin-alert pal-fin-alert-warn">
                Waiting for card on POS — capture is available only after the hold is authorized.
              </p>
            </div>
          )}

          {isCaptured && (
            <div className="pal-pay-drawer-section">
              <p className="pal-fin-alert pal-fin-alert-ok">
                Funds captured — reported as Paid / Successful. Hold release and cancel are disabled.
              </p>
            </div>
          )}

          {deposit?.emailSentAt && (
            <DetailRow
              label="Email"
              value={deposit.emailSentOk ? `Sent ${new Date(deposit.emailSentAt).toLocaleString()}` : deposit.emailSentMessage || 'Failed'}
            />
          )}

          {canManageDeposit && (
            <div className="pal-pay-drawer-section">
              <p className="pal-fin-eyebrow">Deposit actions</p>
              {!showIncreasePanel ? (
                <div className="pal-pay-drawer-actions">
                  {canCaptureDeposit && (
                    <button
                      type="button"
                      className="gm-btn gm-btn-primary gm-btn-sm"
                      disabled={busy}
                      onClick={runCapture}
                    >
                      <CreditCard size={14} /> Capture hold
                    </button>
                  )}
                  {canIncreaseToMax && (
                    <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" disabled={busy} onClick={applyIncreaseToMax}>
                      <TrendingUp size={14} /> Increase to {maxAuthChf.toFixed(0)} CHF
                    </button>
                  )}
                  <button
                    type="button"
                    className="gm-btn gm-btn-secondary gm-btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setShowIncreasePanel(true);
                      setTotalAmountChf('');
                      setError('');
                    }}
                  >
                    <TrendingUp size={14} /> Custom increase
                  </button>
                </div>
              ) : (
                <div className="pal-pay-increase-panel">
                  <p className="text-caption">
                    Current hold: <strong>{formatMoney(currentHoldCents, transaction.currency)}</strong>
                  </p>
                  <label className="pal-fin-field pal-fin-field-full">
                    <span>Total amount to authorize (CHF)</span>
                    <input
                      type="number"
                      min={currentHoldChf + 0.05}
                      step="0.05"
                      value={totalAmountChf}
                      onChange={(e) => setTotalAmountChf(e.target.value)}
                      placeholder={`e.g. ${(currentHoldChf + 100).toFixed(2)}`}
                      disabled={busy}
                    />
                    <small>Enter the full amount to hold after damage — not just the extra.</small>
                  </label>
                  {increasePreview && (
                    <p
                      className={
                        increasePreview.valid
                          ? 'pal-pay-increase-delta pal-pay-increase-delta-ok'
                          : 'pal-pay-increase-delta pal-pay-increase-delta-warn'
                      }
                    >
                      {increasePreview.valid
                        ? `Additional authorization: ${increasePreview.additional.toFixed(2)} CHF`
                        : increasePreview.overMax
                          ? `Exceeds max authorization (${maxAuthChf.toFixed(2)} CHF)`
                          : 'Total must be greater than current deposit hold'}
                    </p>
                  )}
                  <div className="pal-pay-drawer-actions">
                    <button
                      type="button"
                      className="gm-btn gm-btn-secondary gm-btn-sm"
                      disabled={busy}
                      onClick={() => {
                        setShowIncreasePanel(false);
                        setTotalAmountChf('');
                      }}
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      className="gm-btn gm-btn-primary gm-btn-sm"
                      disabled={busy || !increasePreview?.valid}
                      onClick={runIncrement}
                    >
                      Authorize {increasePreview?.valid ? `${increasePreview.total.toFixed(2)} CHF` : 'increase'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {canCancel && (
            <div className="pal-pay-drawer-section pal-pay-drawer-cancel">
              <p className="pal-fin-eyebrow">Cancel transaction</p>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Reason (required)</span>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="e.g. Customer declined, wrong amount, duplicate attempt…"
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                className="gm-btn gm-btn-danger gm-btn-sm"
                disabled={busy}
                onClick={runCancel}
              >
                <Ban size={14} /> Cancel & release hold
              </button>
            </div>
          )}

          {error && <p className="pal-fin-alert">{error}</p>}
        </div>
    </>
  );

  if (inline) {
    return (
      <aside className="pal-pay-drawer pal-pay-panel-inline" aria-label="Deposit detail">
        {panelBody}
      </aside>
    );
  }

  return (
    <div className="pal-pay-drawer-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="pal-pay-drawer"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        {panelBody}
      </aside>
    </div>
  );
}
