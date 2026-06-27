import React from 'react';

function normalizeBrand(brand, methodType) {
  const raw = String(brand || methodType || 'card').toLowerCase();
  if (raw.includes('visa')) return 'visa';
  if (raw.includes('master')) return 'mastercard';
  if (raw.includes('amex') || raw.includes('american')) return 'amex';
  if (raw.includes('link')) return 'link';
  if (raw.includes('twint')) return 'twint';
  if (raw.includes('card_present') || raw.includes('terminal')) return 'card_present';
  return 'card';
}

function BrandIcon({ brandId }) {
  switch (brandId) {
    case 'visa':
      return <span className="stripe-pay-brand stripe-pay-brand-visa">VISA</span>;
    case 'mastercard':
      return (
        <span className="stripe-pay-brand stripe-pay-brand-mc" aria-hidden>
          <span className="stripe-pay-mc-red" />
          <span className="stripe-pay-mc-yellow" />
        </span>
      );
    case 'amex':
      return <span className="stripe-pay-brand stripe-pay-brand-amex">AMEX</span>;
    case 'link':
      return <span className="stripe-pay-brand stripe-pay-brand-link">Link</span>;
    case 'twint':
      return <span className="stripe-pay-brand stripe-pay-brand-twint">TWINT</span>;
    case 'card_present':
      return <span className="stripe-pay-brand stripe-pay-brand-terminal">POS</span>;
    default:
      return <span className="stripe-pay-brand stripe-pay-brand-card">Card</span>;
  }
}

/** Stripe-dashboard style: brand + masked last4 */
export function StripePaymentMethodCell({ brand, last4, methodType }) {
  const brandId = normalizeBrand(brand, methodType);
  const digits = String(last4 || '').trim();
  return (
    <span className="stripe-pay-method-cell">
      <BrandIcon brandId={brandId} />
      {digits ? (
        <span className="stripe-pay-last4">•••• {digits}</span>
      ) : (
        <span className="stripe-pay-last4 stripe-pay-last4-empty">—</span>
      )}
    </span>
  );
}
