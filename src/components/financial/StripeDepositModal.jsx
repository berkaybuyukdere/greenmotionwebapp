import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, Loader2, X } from 'lucide-react';
import {
  stripeFinancialCreateDeposit,
  stripeFinancialConfirmDepositCollection,
  stripeFinancialListTerminals,
  stripeFinancialCancelDeposit,
  stripeFinancialProcessDepositOnTerminal,
  stripeFinancialGetDepositStatus,
} from '../../services/stripeFinancialApi';
import { useConfirmDirtyClose } from '../../utilities/useConfirmDirtyClose';
import {
  defaultResCodeValue,
  formatResCodeForSubmit,
  isResCodeComplete,
  normalizeResCodeInput,
  resCodeNumberPart,
} from '../../utilities/resCodeInput';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function StripeDepositModal({ franchiseId, onClose, onSuccess }) {
  const [step, setStep] = useState('form');
  const [depositAmountChf, setDepositAmountChf] = useState('400');
  const [maxAuthAmountChf, setMaxAuthAmountChf] = useState('3000');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [resCode, setResCode] = useState(defaultResCodeValue);
  const [plate, setPlate] = useState('');
  const [readers, setReaders] = useState([]);
  const [selectedReaderId, setSelectedReaderId] = useState('');
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [aborting, setAborting] = useState(false);
  const [tokenSaved, setTokenSaved] = useState(false);
  const [retryDepositId, setRetryDepositId] = useState('');
  const depositIdRef = useRef('');
  const abortRef = useRef(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    stripeFinancialListTerminals({ franchiseId })
      .then((termRes) => {
        const list = termRes.readers || [];
        setReaders(list);
        const def = list.find((r) => r.isDefault) || list[0];
        if (def) setSelectedReaderId(def.readerId);
      })
      .catch(() => {
        setReaders([]);
      });
  }, [franchiseId]);

  const pollUntilAuthorized = useCallback(
    async (depositId) => {
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        if (abortRef.current) throw new Error('cancelled');
        const status = await stripeFinancialGetDepositStatus({ franchiseId, depositId });
        if (status.terminalFailed || status.terminalActionStatus === 'failed') {
          throw new Error(
            status.terminalFailureMessage ||
              status.lastPaymentError ||
              'Card presentation failed on terminal.',
          );
        }
        if (status.status === 'authorized' || status.stripeStatus === 'requires_capture') {
          return status;
        }
        if (status.status === 'cancelled' || status.stripeStatus === 'canceled') {
          throw new Error('Payment was cancelled on terminal.');
        }
        if (status.terminalActionStatus === 'in_progress') {
          setStatusMessage('Card detected on POS — authorizing hold…');
        } else {
          setStatusMessage('Waiting for card on POS (DEPOSIT)…');
        }
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
      setError('Deposit cancelled. POS closed and authorization voided.');
      if (closeModal) onClose?.();
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
    setRetryDepositId('');
    if (!customerName.trim()) {
      setError('Customer name is required.');
      return;
    }
    if (!isResCodeComplete(resCode)) {
      setError('RES number is required.');
      return;
    }
    if (!selectedReaderId) {
      setError('Select a POS terminal in Settings → Add device first.');
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
        maxAuthAmountChf: Number(maxAuthAmountChf) || 3000,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        resCode: formatResCodeForSubmit(resCode),
        reference: formatResCodeForSubmit(resCode),
        plate: plate.trim(),
        readerId: selectedReaderId,
      });
      createdDepositId = created.depositId;
      depositIdRef.current = created.depositId;

      setStep('terminal');
      setStatusMessage('Sending DEPOSIT to POS…');

      const sent = await stripeFinancialProcessDepositOnTerminal({
        franchiseId,
        depositId: created.depositId,
        readerId: selectedReaderId,
      });
      setStatusMessage(sent.message || 'Present card on POS device.');

      if (!sent.alreadyAuthorized) {
        await pollUntilAuthorized(created.depositId);
      }

      const confirmed = await stripeFinancialConfirmDepositCollection({
        franchiseId,
        depositId: created.depositId,
      });

      inFlightRef.current = false;
      depositIdRef.current = '';
      setRetryDepositId('');
      setTokenSaved(confirmed?.tokenSaved === true);
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
        setRetryDepositId('');
        setError('Deposit cancelled.');
        setStep('form');
        return;
      }
      if (msg.includes('timed out')) {
        if (createdDepositId) {
          try {
            await stripeFinancialCancelDeposit({
              franchiseId,
              depositId: createdDepositId,
              reason: e?.message || 'Timed out',
            });
          } catch {
            /* ignore */
          }
        }
        depositIdRef.current = '';
        setRetryDepositId('');
        setError(e?.message || 'Deposit timed out');
        setStep('form');
        return;
      }
      if (createdDepositId) {
        depositIdRef.current = createdDepositId;
        setRetryDepositId(createdDepositId);
        setError(e?.message || 'Card declined on POS. Remove the card and try another payment method.');
        setStep('form');
        return;
      }
      setError(e?.message || 'Deposit failed');
      setStep('form');
    }
  };

  const retryOnTerminal = async () => {
    const depositId = retryDepositId || depositIdRef.current;
    if (!depositId || !selectedReaderId) return;
    setError('');
    abortRef.current = false;
    inFlightRef.current = true;
    setStep('terminal');
    setStatusMessage('Sending DEPOSIT to POS again…');
    try {
      const sent = await stripeFinancialProcessDepositOnTerminal({
        franchiseId,
        depositId,
        readerId: selectedReaderId,
      });
      setStatusMessage(sent.message || 'Present card on POS device.');
      if (!sent.alreadyAuthorized) {
        await pollUntilAuthorized(depositId);
      }
      const confirmed = await stripeFinancialConfirmDepositCollection({ franchiseId, depositId });
      inFlightRef.current = false;
      depositIdRef.current = '';
      setRetryDepositId('');
      setTokenSaved(confirmed?.tokenSaved === true);
      setStep('done');
      onSuccess?.();
    } catch (e) {
      inFlightRef.current = false;
      const msg = String(e?.message || '').toLowerCase();
      if (msg === 'cancelled' || msg.includes('cancel')) {
        setError('Deposit cancelled.');
      } else {
        depositIdRef.current = depositId;
        setRetryDepositId(depositId);
        setError(e?.message || 'Card declined on POS.');
      }
      setStep('form');
    }
  };

  const showCancelDuringTerminal = step === 'creating' || step === 'terminal';
  const selectedReader = readers.find((r) => r.readerId === selectedReaderId);

  const isFormDirty = useMemo(
    () =>
      step === 'form' &&
      Boolean(
        customerName.trim() ||
          customerEmail.trim() ||
          resCodeNumberPart(resCode) ||
          plate.trim() ||
          depositAmountChf !== '400' ||
          maxAuthAmountChf !== '3000',
      ),
    [step, customerName, customerEmail, resCode, plate, depositAmountChf, maxAuthAmountChf],
  );

  const requestClose = useConfirmDirtyClose({
    isDirty: isFormDirty,
    onClose: handleClose,
    enabled: step === 'form',
  });

  return (
    <div
      className="pal-fin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && requestClose()}
    >
      <div className="pal-fin-modal pal-fin-modal-wide">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">New deposit</p>
            <h2 className="pal-fin-modal-title">Rental deposit (Terminal hold)</h2>
            <p className="pal-fin-modal-sub">
              Authorize a card hold via POS. Increment later (e.g. 400 → 3&apos;000 CHF) using incremental authorization on the same card.
            </p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={requestClose} disabled={aborting} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        {step === 'form' && (
          <div className="pal-fin-modal-body">
            <div className="pal-fin-form-grid">
              <label className="pal-fin-field">
                <span>RES code *</span>
                <input
                  value={resCode}
                  onChange={(e) => setResCode(normalizeResCodeInput(e.target.value))}
                  placeholder="17505"
                  className="pal-fin-mono"
                />
                <small>Type reservation number only — RES- is added automatically.</small>
              </label>
              <label className="pal-fin-field">
                <span>Plate</span>
                <input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="ZG108875" className="pal-fin-mono" />
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Customer name *</span>
                <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="First and last name" />
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Customer email</span>
                <input type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </label>
              <label className="pal-fin-field">
                <span>Initial hold (CHF) *</span>
                <input type="number" min="1" step="0.05" value={depositAmountChf} onChange={(e) => setDepositAmountChf(e.target.value)} />
              </label>
              <label className="pal-fin-field">
                <span>Max authorization (CHF)</span>
                <input type="number" min="1" step="0.05" value={maxAuthAmountChf} onChange={(e) => setMaxAuthAmountChf(e.target.value)} />
                <small>Upper limit for &quot;Increase deposit&quot; (default 3&apos;000 CHF)</small>
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>POS terminal *</span>
                <select value={selectedReaderId} onChange={(e) => setSelectedReaderId(e.target.value)}>
                  <option value="">Select terminal…</option>
                  {readers.map((r) => (
                    <option key={r.readerId} value={r.readerId}>
                      {r.readerLabel || r.readerId}{r.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedReader ? (
              <p className="pal-fin-hint">
                Terminal: <strong>{selectedReader.readerLabel || selectedReader.readerId}</strong> — customer will see <strong>DEPOSIT</strong> on POS.
                Card details are saved for future off-session use.
              </p>
            ) : (
              <p className="pal-fin-alert pal-fin-alert-warn">No terminal selected. Add readers under Settings → Stripe Terminal.</p>
            )}
            {error && <p className="pal-fin-alert">{error}</p>}
            {retryDepositId && (
              <p className="pal-fin-hint">
                POS declined this card — use <strong>Try another card</strong> below (same deposit hold, no double charge).
              </p>
            )}
          </div>
        )}

        {showCancelDuringTerminal && (
          <div className="pal-fin-modal-body pal-fin-modal-center">
            <Loader2 className="animate-spin" size={32} />
            <p className="pal-fin-modal-status">{statusMessage || 'Sending to terminal…'}</p>
            <p className="text-caption">Ask the customer to tap or insert their card. POS shows DEPOSIT.</p>
            <p className="pal-fin-terminal-security-note">Cancel closes the POS screen and voids any pending authorization.</p>
          </div>
        )}

        {step === 'done' && (
          <div className="pal-fin-modal-body pal-fin-modal-center">
            <CreditCard size={36} className="text-[var(--erpx-brand)]" />
            <p className="pal-fin-modal-status">Deposit authorized</p>
            <p className="text-caption">{Number(depositAmountChf).toFixed(2)} CHF hold on card · max {Number(maxAuthAmountChf).toFixed(2)} CHF</p>
            {tokenSaved && (
              <span className="pal-fin-token-saved-badge">Token saved</span>
            )}
          </div>
        )}

        <footer className="pal-fin-modal-footer">
          {step === 'form' && (
            <>
              <button type="button" className="gm-btn gm-btn-secondary" onClick={handleClose}>Close</button>
              {retryDepositId ? (
                <button type="button" className="gm-btn gm-btn-primary" onClick={retryOnTerminal}>
                  Try another card on POS
                </button>
              ) : (
                <button type="button" className="gm-btn gm-btn-primary" onClick={handleStart}>Send deposit to terminal</button>
              )}
            </>
          )}
          {showCancelDuringTerminal && (
            <button type="button" className="gm-btn gm-btn-danger" disabled={aborting} onClick={() => abortSession({ closeModal: false })}>
              {aborting ? 'Cancelling…' : 'Cancel deposit & close POS'}
            </button>
          )}
          {step === 'done' && (
            <button type="button" className="gm-btn gm-btn-primary" onClick={onClose}>Done</button>
          )}
        </footer>
      </div>
    </div>
  );
}
