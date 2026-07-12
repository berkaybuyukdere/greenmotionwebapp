import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Hash, Loader2, Terminal as TerminalIcon, X } from 'lucide-react';
import {
  stripeFinancialCancelTerminalAction,
  stripeFinancialListTerminals,
  stripeFinancialPollDepositCollectInputsTest,
  stripeFinancialStartDepositCollectInputsTest,
} from '../../services/stripeFinancialApi';
import {
  defaultResCodeValue,
  formatResCodeForSubmit,
  isResCodeComplete,
  normalizeResCodeInput,
  resCodeNumberPart,
  BOOKING_CODE_RES,
} from '../../utilities/resCodeInput';
import { humanizeStripeFinancialError } from './StripeFinFeedback';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function StripeDepositCollectInputsTestModal({ franchiseId, onClose, onFeedback }) {
  const [resCode, setResCode] = useState(defaultResCodeValue());
  const [readers, setReaders] = useState([]);
  const [selectedReaderId, setSelectedReaderId] = useState('');
  const [step, setStep] = useState('form');
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const [aborting, setAborting] = useState(false);

  useEffect(() => {
    stripeFinancialListTerminals({ franchiseId })
      .then((termRes) => {
        const list = termRes.readers || [];
        setReaders(list);
        const def = list.find((r) => r.isDefault) || list[0];
        if (def) setSelectedReaderId(def.readerId);
      })
      .catch(() => setReaders([]));
  }, [franchiseId]);

  const pollUntilDone = useCallback(
    async (sid, readerId) => {
      const deadline = Date.now() + 130000;
      while (Date.now() < deadline) {
        const poll = await stripeFinancialPollDepositCollectInputsTest({
          franchiseId,
          sessionId: sid,
          readerId,
        });
        if (poll.status === 'in_progress' || poll.status === 'waiting') {
          setStatusMessage(poll.message || 'Customer completing inputs on POS…');
          await sleep(1500);
          continue;
        }
        if (poll.status === 'failed') {
          throw new Error(poll.message || 'POS input collection failed.');
        }
        if (poll.status === 'succeeded') {
          if (!poll.posPhone && !poll.posSignatureFileId) {
            setStatusMessage('Waiting for POS signature and phone…');
            await sleep(1500);
            continue;
          }
          return poll;
        }
        await sleep(3000);
      }
      throw new Error('Timed out waiting for POS inputs (2 minutes).');
    },
    [franchiseId],
  );

  const handleStart = async () => {
    setError('');
    setResult(null);
    if (!isResCodeComplete(resCode)) {
      setError('RES number is required.');
      return;
    }
    if (!selectedReaderId) {
      setError('Select a POS terminal in Settings → Stripe Terminal.');
      return;
    }

    setStep('collecting');
    setStatusMessage('Sending signature and phone screens to POS…');

    try {
      const started = await stripeFinancialStartDepositCollectInputsTest({
        franchiseId,
        readerId: selectedReaderId,
        resCode: formatResCodeForSubmit(resCode, BOOKING_CODE_RES),
      });
      setSessionId(started.sessionId);
      setStatusMessage(started.message || 'Customer should complete POS screens now.');
      const poll = await pollUntilDone(started.sessionId, selectedReaderId);
      setResult(poll);
      setStep('done');
      onFeedback?.({
        type: 'success',
        title: 'Terminal input test complete',
        detail: `${poll.resCode || formatResCodeForSubmit(resCode, BOOKING_CODE_RES)} — signature and phone collected on POS.`,
        at: new Date().toISOString(),
      });
    } catch (e) {
      const human = humanizeStripeFinancialError(e);
      setError(human.detail || e?.message || 'POS test failed.');
      setStep('form');
      onFeedback?.({
        type: 'error',
        title: human.title || 'POS input test failed',
        detail: human.detail || e?.message,
        at: new Date().toISOString(),
      });
    }
  };

  const handleCancelPos = async () => {
    if (aborting) return;
    setAborting(true);
    try {
      await stripeFinancialCancelTerminalAction({
        franchiseId,
        readerId: selectedReaderId,
      });
      setStatusMessage('POS action cancelled.');
      setStep('form');
      setError('Test cancelled on POS.');
    } catch (e) {
      setError(e?.message || 'Could not cancel POS action.');
    } finally {
      setAborting(false);
    }
  };

  const selectedReader = readers.find((r) => r.readerId === selectedReaderId);

  return (
    <div
      className="pal-fin-modal-backdrop"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && step !== 'collecting' && onClose?.()}
    >
      <div className="pal-fin-modal pal-fin-modal-wide">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Deposit · Test only</p>
            <h2 className="pal-fin-modal-title">Terminal input test</h2>
            <p className="pal-fin-modal-sub">
              Does <strong>not</strong> create a deposit or charge. Enter <strong>RES</strong> here only — POS
              collects <strong>signature</strong> and <strong>phone</strong>.
            </p>
          </div>
          <button
            type="button"
            className="pal-fin-modal-close"
            onClick={onClose}
            disabled={step === 'collecting'}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        {step === 'form' && (
          <div className="pal-fin-modal-body">
            <div className="pal-fin-form-grid">
              <label className="pal-fin-field pal-fin-field-full">
                <span className="pal-fin-field-label-row">
                  <Hash size={14} aria-hidden />
                  RES code *
                </span>
                <input
                  value={resCode}
                  onChange={(e) => setResCode(normalizeResCodeInput(e.target.value, BOOKING_CODE_RES))}
                  placeholder="17505"
                  className="pal-fin-mono"
                />
                <small>Type reservation number only — RES- is added automatically.</small>
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span className="pal-fin-field-label-row">
                  <TerminalIcon size={14} aria-hidden />
                  POS terminal *
                </span>
                <select value={selectedReaderId} onChange={(e) => setSelectedReaderId(e.target.value)}>
                  <option value="">Select terminal…</option>
                  {readers.map((r) => (
                    <option key={r.readerId} value={r.readerId}>
                      {r.readerLabel || r.readerId}
                      {r.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedReader && (
              <p className="pal-fin-hint">
                POS will show: <strong>Rental Agreement (signature)</strong> → <strong>Phone</strong>.
              </p>
            )}
            {error && <p className="pal-fin-alert">{error}</p>}
          </div>
        )}

        {step === 'collecting' && (
          <div className="pal-fin-modal-body pal-fin-terminal-state pal-fin-terminal-state-loading">
            <div className="pal-fin-terminal-state-icon">
              <Loader2 className="animate-spin" size={28} />
            </div>
            <p className="pal-fin-terminal-state-title">{statusMessage}</p>
            <p className="pal-fin-terminal-state-detail">
              Ask the customer to sign and enter their phone on the POS. Timeout after 2 minutes of inactivity.
            </p>
            {sessionId && <p className="pal-fin-hint pal-fin-mono text-xs">Session {sessionId}</p>}
          </div>
        )}

        {step === 'done' && result && (
          <div className="pal-fin-modal-body pal-fin-terminal-state pal-fin-terminal-state-success">
            <div className="pal-fin-terminal-state-icon">
              <CheckCircle2 size={28} />
            </div>
            <p className="pal-fin-terminal-state-title">Test complete</p>
            <ul className="pal-fin-test-result-list">
              <li>RES: {result.resCode || formatResCodeForSubmit(resCode, BOOKING_CODE_RES)}</li>
              <li>Phone (POS): {result.posPhone || '—'}</li>
              <li>
                Signature (POS):{' '}
                {result.posSignatureFileId ? (
                  <span className="pal-fin-mono text-xs">{result.posSignatureFileId}</span>
                ) : (
                  '—'
                )}
              </li>
            </ul>
            {result.posSignatureSvg && (
              <div
                className="pal-fin-pos-signature-preview"
                dangerouslySetInnerHTML={{ __html: result.posSignatureSvg }}
              />
            )}
          </div>
        )}

        <footer className="pal-fin-modal-footer">
          {step === 'form' && (
            <>
              <button type="button" className="gm-btn gm-btn-secondary" onClick={onClose}>
                Close
              </button>
              <button type="button" className="gm-btn gm-btn-primary" onClick={handleStart}>
                Start terminal test
              </button>
            </>
          )}
          {step === 'collecting' && (
            <button
              type="button"
              className="gm-btn gm-btn-danger"
              disabled={aborting}
              onClick={handleCancelPos}
            >
              {aborting ? 'Cancelling…' : 'Cancel POS test'}
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
