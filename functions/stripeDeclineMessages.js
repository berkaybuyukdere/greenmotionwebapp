/** Stripe decline codes — staff-facing messages for Cloud Functions. */

const STAFF_DECLINES = {
  stolen_card:
    'Card declined — issuer reported stolen. Do not tell the customer; ask them to contact their bank or use another card. Retries will not succeed.',
  lost_card:
    'Card declined — issuer reported lost. Ask the customer to contact their bank or use another card. Retries will not succeed.',
  fraudulent:
    'Payment declined — flagged as high risk. Ask the customer to contact their bank or use another card.',
  insufficient_funds:
    'Insufficient funds — ask the customer to use another card or add funds.',
  expired_card: 'Card expired — ask the customer to use another card.',
  incorrect_cvc: 'Incorrect CVC — re-enter the security code.',
  incorrect_number: 'Invalid card number — re-enter card details.',
  generic_decline: 'Card declined — ask the customer to contact their bank or try another card.',
  pickup_card: 'Card blocked by issuer — ask the customer to contact their bank.',
  restricted_card: 'Card restricted — ask the customer to contact their bank.',
  do_not_honor: 'Bank declined (do not honor) — customer should contact issuer.',
  processing_error: 'Temporary processing error — try again shortly.',
};

function staffMessageForDecline(declineCode, fallbackMessage) {
  const key = String(declineCode || '')
    .trim()
    .toLowerCase();
  if (key && STAFF_DECLINES[key]) return STAFF_DECLINES[key];
  return fallbackMessage || STAFF_DECLINES.generic_decline;
}

function formatStripeApiError(errorBody) {
  const err = errorBody?.error || errorBody || {};
  const declineCode = err.decline_code || err.payment_intent?.last_payment_error?.decline_code || '';
  const fallback = err.message || 'Card payment failed';
  const detail = staffMessageForDecline(declineCode, fallback);
  if (declineCode) {
    return `${detail} [${declineCode}]`;
  }
  return detail;
}

module.exports = {
  staffMessageForDecline,
  formatStripeApiError,
};
