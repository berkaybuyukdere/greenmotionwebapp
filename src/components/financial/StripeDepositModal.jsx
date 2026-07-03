import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, X, XCircle } from 'lucide-react';
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
import { formatStripeDeclineForDisplay } from '../../utilities/stripeDeclineMessages';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function StripeDepositModal({ franchiseId, fleetCars = [], onClose, onSuccess }) {
  const [step, setStep] = useState('form');
  const [depositAmountChf, setDepositAmountChf] = useState('400');
  const [maxAuthAmountChf, setMaxAuthAmountChf] = useState('3000');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [resCode, setResCode] = useState(defaultResCodeValue);
  const [plate, setPlate] = useState('');
  const [plateSuggestOpen, setPlateSuggestOpen] = useState(false);
  const [declineDetail, setDeclineDetail] = useState(null);
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
  const plateOptions = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const car of fleetCars || []) {
      const p = String(car?.plaka || car?.plate || '').trim();
      if (!p || p === '—' || seen.has(p.toLowerCase())) continue;
      seen.add(p.toLowerCase());
      out.push(p);
    }
    return out.sort((a, b) => a.localeCompare(b));
  }, [fleetCars]);

  const plateSuggestions = useMemo(() => {
    const q = plate.trim().toLowerCase();
    if (!q) return plateOptions.slice(0, 8);
    return plateOptions.filter((p) => p.toLowerCase().includes(q)).slice(0, 8);
  }, [plate, plateOptions]);

  const showPlateSuggest = plateSuggestOpen && plateSuggestions.length > 0;

  const setDeclineError = (err) => {
    const friendly = formatStripeDeclineForDisplay(err);
    setDeclineDetail(friendly);
    setError(friendly.displayText);
    setStep('declined');
  };

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
    setDeclineDetail(null);
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
        setDeclineError(e);
        return;
      }
      setDeclineError(e);
    }
  };

  const retryOnTerminal = async () => {
    const depositId = retryDepositId || depositIdRef.current;
    if (!depositId || !selectedReaderId) return;
    setError('');
    setDeclineDetail(null);
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
        setDeclineError(e);
      }
      return;
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
              <label className="pal-fin-field pal-fin-plate-field">
                <span>Plate</span>
                <input
                  value={plate}
                  onChange={(e) => {
                    setPlate(e.target.value);
                    setPlateSuggestOpen(true);
                  }}
                  onFocus={() => setPlateSuggestOpen(true)}
                  onBlur={() => setTimeout(() => setPlateSuggestOpen(false), 150)}
                  placeholder="ZG108875"
                  className="pal-fin-mono"
                  autoComplete="off"
                />
                {showPlateSuggest && (
                  <ul className="pal-fin-plate-suggest" role="listbox">
                    {plateSuggestions.map((p) => (
                      <li key={p}>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setPlate(p);
                            setPlateSuggestOpen(false);
                          }}
                        >
                          {p}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
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
          <div className="pal-fin-modal-body pal-fin-terminal-state pal-fin-terminal-state-loading">
            <div className="pal-fin-terminal-state-icon">
              <Loader2 className="animate-spin" size={28} />
            </div>
            <p className="pal-fin-terminal-state-title">{statusMessage || 'Sending to terminal…'}</p>
            <p className="pal-fin-terminal-state-detail">Ask the customer to tap or insert their card. POS shows DEPOSIT.</p>
            <p className="pal-fin-terminal-security-note">Cancel closes the POS screen and voids any pending authorization.</p>
          </div>
        )}

        {step === 'declined' && (
          <div className="pal-fin-modal-body pal-fin-terminal-state pal-fin-terminal-state-declined">
            <div className="pal-fin-terminal-state-icon">
              <XCircle size={28} />
            </div>
            <p className="pal-fin-terminal-state-title">{declineDetail?.title || 'Card declined on POS'}</p>
            <p className="pal-fin-terminal-state-detail">{declineDetail?.detail || error}</p>
            {declineDetail?.nextSteps && (
              <p className="pal-fin-terminal-state-detail">{declineDetail.nextSteps}</p>
            )}
            {declineDetail?.code && <span className="pal-fin-decline-code">{declineDetail.code}</span>}
          </div>
        )}

        {step === 'done' && (
          <div className="pal-fin-modal-body pal-fin-terminal-state pal-fin-terminal-state-success">
            <div className="pal-fin-terminal-state-icon">
              <CheckCircle2 size={28} />
            </div>
            <p className="pal-fin-terminal-state-title">Deposit authorized</p>
            <p className="pal-fin-terminal-state-detail">
              {Number(depositAmountChf).toFixed(2)} CHF hold on card · max {Number(maxAuthAmountChf).toFixed(2)} CHF
            </p>
            {tokenSaved && <span className="pal-fin-token-saved-badge">Token saved</span>}
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
          {step === 'declined' && (
            <>
              <button type="button" className="gm-btn gm-btn-secondary" onClick={() => { setStep('form'); setDeclineDetail(null); }}>
                Back to form
              </button>
              {retryDepositId && (
                <button type="button" className="gm-btn gm-btn-primary" onClick={retryOnTerminal}>
                  Try another card on POS
                </button>
              )}
            </>
          )}
          {step === 'done' && (
            <button type="button" className="gm-btn gm-btn-primary" onClick={onClose}>Done</button>
          )}
        </footer>
      </div>
    </div>
  );
}
