import React, { useState, useEffect } from 'react';
import { X, CreditCard, Terminal, Mail } from 'lucide-react';
import { StripeDepositModal } from './StripeDepositModal';
import { StripeManualChargeModal } from './StripeManualChargeModal';
import { StripeMailOrderNewPaymentPanel } from './StripeMailOrderNewPaymentPanel';
import { logPaymentUiAction } from '../../utilities/logPaymentUiAction';

export function StripeNewPaymentModal({
  franchiseId,
  fleetCars = [],
  onClose,
  onSuccess,
  onFeedback,
}) {
  const [mode, setMode] = useState(null);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode) setMode(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, onClose]);

  if (mode === 'deposit') {
    return (
      <StripeDepositModal
        franchiseId={franchiseId}
        fleetCars={fleetCars}
        onClose={() => setMode(null)}
        onFeedback={onFeedback}
        onSuccess={() => {
          onSuccess?.();
          onClose?.();
        }}
      />
    );
  }

  if (mode === 'charge') {
    return (
      <StripeManualChargeModal
        franchiseId={franchiseId}
        onClose={() => setMode(null)}
        onFeedback={onFeedback}
        onSuccess={() => {
          onSuccess?.();
          onClose?.();
        }}
      />
    );
  }

  if (mode === 'mailorder') {
    return (
      <StripeMailOrderNewPaymentPanel
        franchiseId={franchiseId}
        onClose={() => setMode(null)}
        onFeedback={onFeedback}
        onSuccess={() => {
          onSuccess?.();
          onClose?.();
        }}
      />
    );
  }

  return (
    <div className="pal-fin-modal-backdrop" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="pal-fin-modal pal-fin-modal-wide">
        <header className="pal-fin-modal-header">
          <div>
            <p className="pal-fin-eyebrow">Payments</p>
            <h2 className="pal-fin-modal-title">New payment</h2>
            <p className="pal-fin-modal-sub">Deposit hold, mail order payment link, or manual card charge.</p>
          </div>
          <button type="button" className="pal-fin-modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="pal-fin-modal-body pal-new-payment-choices">
          <button type="button" className="pal-new-payment-choice" onClick={() => { logPaymentUiAction(franchiseId, 'new_payment_deposit'); setMode('deposit'); }}>
            <span className="pal-new-payment-choice-icon pal-new-payment-choice-icon-deposit">
              <Terminal size={22} />
            </span>
            <span className="pal-new-payment-choice-copy">
              <strong>Deposit</strong>
              <span>RES or RNT walk-in, customer name, amount and POS — terminal shows DEPOSIT.</span>
            </span>
          </button>
          <button type="button" className="pal-new-payment-choice" onClick={() => { logPaymentUiAction(franchiseId, 'new_payment_mailorder'); setMode('mailorder'); }}>
            <span className="pal-new-payment-choice-icon pal-new-payment-choice-icon-mail">
              <Mail size={22} />
            </span>
            <span className="pal-new-payment-choice-copy">
              <strong>Mail order / Payment link</strong>
              <span>Send payment request e-mail with embedded Pay button (traffic, damage, extra).</span>
            </span>
          </button>
          <button type="button" className="pal-new-payment-choice" onClick={() => { logPaymentUiAction(franchiseId, 'new_payment_charge'); setMode('charge'); }}>
            <span className="pal-new-payment-choice-icon pal-new-payment-choice-icon-charge">
              <CreditCard size={22} />
            </span>
            <span className="pal-new-payment-choice-copy">
              <strong>Manual charge</strong>
              <span>Enter card details and charge immediately (traffic, damage, extra).</span>
            </span>
          </button>
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
