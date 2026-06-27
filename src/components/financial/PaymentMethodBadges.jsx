import React from 'react';

/** Palantir-style payment method chips for mail-order checkout preview */
const METHODS = [
  { id: 'link', label: 'Payment link', className: 'pal-pay-link' },
  { id: 'apple_pay', label: 'Apple Pay', className: 'pal-pay-apple' },
  { id: 'google_pay', label: 'Google Pay', className: 'pal-pay-google' },
  { id: 'klarna', label: 'Klarna', className: 'pal-pay-klarna' },
  { id: 'card_present', label: 'Terminal', className: 'pal-pay-visa' },
  { id: 'card', label: 'Card', className: 'pal-pay-visa' },
  { id: 'mastercard', label: 'Mastercard', className: 'pal-pay-mc' },
  { id: 'amex', label: 'Amex', className: 'pal-pay-amex' },
  { id: 'twint', label: 'TWINT', className: 'pal-pay-twint' },
];

export function PaymentMethodBadges({ title = null, compact = false, methods = null }) {
  const visible = methods?.length
    ? METHODS.filter((m) => methods.includes(m.id))
    : METHODS;
  return (
    <div className={`pal-pay-strip ${compact ? 'pal-pay-strip-compact' : ''}`}>
      {title ? <p className="pal-pay-strip-title">{title}</p> : null}
      <div className="pal-pay-strip-row" role="list" aria-label={title}>
        {visible.map((m) => (
          <span key={m.id} className={`pal-pay-chip ${m.className}`} role="listitem" title={m.label}>
            <PaymentMethodIcon id={m.id} />
            {!compact && <span className="pal-pay-chip-label">{m.label}</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

function PaymentMethodIcon({ id }) {
  switch (id) {
    case 'link':
      return (
        <svg viewBox="0 0 24 24" className="pal-pay-icon" aria-hidden>
          <path
            fill="currentColor"
            d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-.5.5M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l.5-.5"
            stroke="currentColor"
            strokeWidth="2"
            fill="none"
          />
        </svg>
      );
    case 'apple_pay':
      return (
        <svg viewBox="0 0 24 24" className="pal-pay-icon" aria-hidden>
          <path
            fill="currentColor"
            d="M16.34 12.14c.02-2.17 1.77-3.21 1.85-3.26-1.01-1.47-2.58-1.67-3.14-1.69-1.34-.14-2.62.79-3.3.79-.68 0-1.73-.77-2.85-.75-1.47.02-2.82.85-3.58 2.16-1.53 2.65-.39 6.57 1.1 8.72.73 1.05 1.6 2.23 2.74 2.19 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.86.69 1.18-.02 1.93-1.07 2.65-2.12.84-1.22 1.19-2.4 1.21-2.46-.03-.01-2.32-.89-2.34-3.52zM14.28 4.56c.6-.73 1.01-1.74.9-2.76-.87.04-1.92.58-2.54 1.31-.56.65-1.05 1.7-.92 2.7.97.08 1.96-.49 2.56-1.25z"
          />
        </svg>
      );
    case 'google_pay':
      return (
        <svg viewBox="0 0 24 24" className="pal-pay-icon" aria-hidden>
          <path fill="#4285F4" d="M21.8 12.2c0-.7-.06-1.2-.19-1.7H12v3.1h5.6c-.11.9-.7 2.2-2 3.1l-.02.1 2.9 2.2.2.02c1.9-1.7 3-4.2 3-6.8z" />
          <path fill="#34A853" d="M12 22c2.7 0 5-0.9 6.6-2.4l-3.1-2.4c-.8.6-1.9 1-3.5 1-2.7 0-5-1.8-5.8-4.3l-.1.01-3.1 2.4-.04.1C4.9 19.4 8.1 22 12 22z" />
          <path fill="#FBBC05" d="M6.2 14.3l-.1-.01-3.1-2.4-.04-.1C2.3 13.6 2 12.8 2 12s.3-1.6.9-2.3l3.3 2.6z" />
          <path fill="#EA4335" d="M12 5.4c1.9 0 3.2.8 3.9 1.5l2.9-2.8C17 2.5 14.7 2 12 2 8.1 2 4.9 4.6 3.1 7.7l3.3 2.6C7.4 7.2 9.5 5.4 12 5.4z" />
        </svg>
      );
    case 'klarna':
      return <span className="pal-pay-text-logo">Klarna</span>;
    case 'visa':
      return <span className="pal-pay-text-logo pal-pay-visa-text">VISA</span>;
    case 'mastercard':
      return (
        <span className="pal-pay-mc-circles" aria-hidden>
          <span className="pal-pay-mc-red" />
          <span className="pal-pay-mc-yellow" />
        </span>
      );
    case 'amex':
      return <span className="pal-pay-text-logo pal-pay-amex-text">AMEX</span>;
    case 'twint':
      return <span className="pal-pay-text-logo pal-pay-twint-text">TWINT</span>;
    default:
      return null;
  }
}
