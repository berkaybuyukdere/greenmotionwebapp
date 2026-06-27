import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import {
  stripeFinancialCreateDeposit,
  stripeFinancialConfirmDepositCollection,
  stripeFinancialGetTerminalConfig,
  stripeFinancialCancelDeposit,
  stripeFinancialProcessDepositOnTerminal,
  stripeFinancialGetDepositStatus,
} from '../../services/stripeFinancialApi';

function chfToDisplay(cents) {
  return (Number(cents || 0) / 100).toFixed(2);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function StripeDepositModal({ franchiseId, onClose, onSuccess }) {
  const [step, setStep] = useState('form');
  const [depositAmountChf, setDepositAmountChf] = useState('400');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [plate, setPlate] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [terminalCfg, setTerminalCfg] = useState(null);
  const [aborting, setAborting] = useState(false);
  const depositIdRef = useRef('');
  const abortRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    stripeFinancialGetTerminalConfig({ franchiseId })
      .then(setTerminalCfg)
      .catch(() => setTerminalCfg(null));
  }, [franchiseId]);

  const pollUntilAuthorized = useCallback(
    async (depositId) => {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (abortRef.current) {
          throw new Error('cancelled');
        }
        const status = await stripeFinancialGetDepositStatus({ franchiseId, depositId });
        if (status.terminalActionStatus === 'failed') {
          throw new Error(
            status.terminalFailureMessage || 'Card presentation failed on terminal.',
          );
        }
        if (status.status === 'authorized' || status.stripeStatus === 'requires_capture') {
          return status;
        }
        if (status.status === 'cancelled' || status.stripeStatus === 'canceled') {
          throw new Error('Payment was cancelled on terminal.');
        }
        setStatusMessage('Waiting for card on POS…');
        await sleep(2000);
      }
      throw new Error('Timed out. Customer did not present card within 2 minutes.');
    },
    [franchiseId],
  );

  const abortSession = useCallback(
    async ({ closeModal = false } = {}) => {
      if (aborting) return;
      setAborting(true);
      abortRef.current = true;
      inFlightRef.current = false;

      const pendingDepositId = depositIdRef.current;
      if (pendingDepositId) {
        try {
          await stripeFinancialCancelDeposit({
            franchiseId,
            depositId: pendingDepositId,
            reason: 'Cancelled by staff before card presentation',
          });
        } catch (e) {
          console.warn('[StripeDepositModal] cancel deposit', e?.message || e);
        }
        depositIdRef.current = '';
      }

      setAborting(false);
      setStep('form');
      setStatusMessage('');
      setError('Payment cancelled. POS closed and authorization voided.');
      if (closeModal) {
        onClose?.();
      }
    },
    [aborting, franchiseId, onClose],
  );

  useEffect(() => {
    return () => {
      abortRef.current = true;
      const id = depositIdRef.current;
      if (id && inFlightRef.current) {
        stripeFinancialCancelDeposit({
          franchiseId,
          depositId: id,
          reason: 'Modal closed during collection',
        }).catch(() => {});
      }
    };
  }, [franchiseId]);

  const handleClose = async () => {
    if (inFlightRef.current || step === 'creating' || step === 'terminal') {
      await abortSession({ closeModal: true });
      return;
    }
    onClose?.();
  };

  const handleStart = async () => {
    setError('');
    setStatusMessage('');
    if (!customerName.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (!terminalCfg?.readerId) {
      setError('Configure a Stripe Terminal reader in Settings → Add device first.');
      return;
    }

    abortRef.current = false;
    inFlightRef.current = true;
    setStep('creating');
    let createdDepositId = '';

    try {
      const created = await stripeFinancialCreateDeposit({
        franchiseId,
        initialAmountChf: Number(depositAmountChf),
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        plate: plate.trim(),
        reference: reference.trim(),
      });
      createdDepositId = created.depositId;
      depositIdRef.current = created.depositId;

      setStep('terminal');
      setStatusMessage('Sending payment to POS…');

      const sent = await stripeFinancialProcessDepositOnTerminal({
        franchiseId,
        depositId: created.depositId,
      });
      setStatusMessage(sent.message || 'Present card on POS device.');

      if (!sent.alreadyAuthorized) {
        await pollUntilAuthorized(created.depositId);
      }

      await stripeFinancialConfirmDepositCollection({
        franchiseId,
        depositId: created.depositId,
      });

      inFlightRef.current = false;
      depositIdRef.current = '';
      setStep('done');
      onSuccess?.();
    } catch (e) {
      inFlightRef.current = false;
      const msg = String(e?.message || '').toLowerCase();
      if (msg === 'cancelled' || msg.includes('cancel')) {
        if (createdDepositId) {
          try {
            await stripeFinancialCancelDeposit({
              franchiseId,
              depositId: createdDepositId,
              reason: 'Cancelled by staff',
            });
          } catch {
            /* ignore */
          }
        }
        depositIdRef.current = '';
        setError('Payment cancelled.');
        setStep('form');
        return;
      }
      if (createdDepositId) {
        try {
          await stripeFinancialCancelDeposit({
            franchiseId,
            depositId: createdDepositId,
            reason: e?.message || 'Terminal payment failed',
          });
        } catch {
          /* ignore */
        }
        depositIdRef.current = '';
      }
      setError(e?.message || 'Deposit failed');
      setStep('form');
    }
  };

  const showCancelDuringTerminal = step === 'creating' || step === 'terminal';

  return (
    <div className="pal-fin-modal-backdrop" role="dialog" aria-modal="true">
      <div className="pal-fin-modal">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">New payment</p>
            <h2 className="pal-fin-modal-title">Rental deposit (Terminal)</h2>
            <p className="pal-fin-modal-sub">
              Authorize a hold on the customer card. Payment is sent to POS via Stripe cloud — no local network setup required.
            </p>
          </div>
          <button
            type="button"
            className="pal-fin-modal-close"
            onClick={handleClose}
            disabled={aborting}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        {step === 'form' && (
          <div className="pal-fin-modal-body">
            <div className="pal-fin-form-grid">
              <label className="pal-fin-field pal-fin-field-full">
                <span>Deposit amount (CHF) *</span>
                <input
                  type="number"
                  min="1"
                  step="0.05"
                  value={depositAmountChf}
                  onChange={(e) => setDepositAmountChf(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Cardholder name *</span>
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="First and last name"
                />
              </label>
              <label className="pal-fin-field">
                <span>Plate</span>
                <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ZG108875" />
              </label>
              <label className="pal-fin-field">
                <span>RES / reference</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="RES-17505" />
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Email (optional)</span>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </label>
            </div>
            {terminalCfg?.readerId ? (
              <p className="pal-fin-hint">
                Terminal: <strong>{terminalCfg.readerLabel || terminalCfg.readerId}</strong>
                {terminalCfg.lastTestOk === false && (
                  <span className="text-amber-600"> — last connection test failed; check POS is Online</span>
                )}
              </p>
            ) : (
              <p className="pal-fin-alert pal-fin-alert-warn">
                No terminal configured. Add a reader under Settings → Stripe Terminal.
              </p>
            )}
            {error && <p className="pal-fin-alert">{error}</p>}
          </div>
        )}

        {showCancelDuringTerminal && (
          <div className="pal-fin-modal-body pal-fin-modal-center">
            <Loader2 className="animate-spin" size={32} />
            <p className="pal-fin-modal-status">{statusMessage || 'Sending to terminal…'}</p>
            <p className="text-caption">Ask the customer to tap or insert their card on the POS device.</p>
            <p className="pal-fin-terminal-security-note">
              Cancel closes the POS screen and voids any pending authorization.
            </p>
          </div>
        )}

        {step === 'done' && (
          <div className="pal-fin-modal-body pal-fin-modal-center">
            <CreditCard size={36} className="text-[var(--erpx-brand)]" />
            <p className="pal-fin-modal-status">Deposit authorized</p>
            <p className="text-caption">
              {chfToDisplay(Number(depositAmountChf) * 100)} CHF authorized on card
            </p>
          </div>
        )}

        <footer className="pal-fin-modal-footer">
          {step === 'form' && (
            <>
              <button type="button" className="gm-btn gm-btn-secondary" onClick={handleClose}>
                Close
              </button>
              <button type="button" className="gm-btn gm-btn-primary" onClick={handleStart}>
                Send to terminal
              </button>
            </>
          )}
          {showCancelDuringTerminal && (
            <button
              type="button"
              className="gm-btn gm-btn-danger"
              disabled={aborting}
              onClick={() => abortSession({ closeModal: false })}
            >
              {aborting ? 'Cancelling…' : 'Cancel payment & close POS'}
            </button>
          )}
          {step === 'done' && (
            <button type="button" className="gm-btn gm-btn-primary" onClick={onClose}>
              Done
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
