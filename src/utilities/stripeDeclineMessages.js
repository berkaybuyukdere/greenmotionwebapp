/** Stripe card decline codes → staff-facing copy (Customers / direct charge). */

const GENERIC_DECLINE = {
  title: 'Card declined',
  detail: 'The bank declined this payment for an unknown reason.',
  nextSteps: 'Ask the customer to contact their card issuer or try another card.',
  retryable: true,
};

const DECLINE_MAP = {
  authentication_required: {
    title: 'Authentication required',
    detail: 'This payment requires 3D Secure or strong customer authentication.',
    nextSteps: 'Ask the customer to complete bank authentication, or retry on-session with the same card.',
    retryable: true,
  },
  approve_with_id: {
    title: 'Authorization failed',
    detail: 'The payment could not be authorized.',
    nextSteps: 'Try again once. If it still fails, the customer must contact their bank.',
    retryable: true,
  },
  call_issuer: {
    title: 'Card declined',
    detail: 'The bank declined the payment without a specific reason.',
    nextSteps: 'Ask the customer to contact their card issuer.',
    retryable: true,
  },
  card_not_supported: {
    title: 'Card not supported',
    detail: 'This card does not support this type of purchase.',
    nextSteps: 'Ask the customer to use a different card.',
    retryable: false,
  },
  card_velocity_exceeded: {
    title: 'Limit exceeded',
    detail: 'The customer exceeded balance, credit, or transaction limits on this card.',
    nextSteps: 'Ask the customer to contact their bank or use another card.',
    retryable: false,
  },
  currency_not_supported: {
    title: 'Currency not supported',
    detail: 'This card does not support CHF for this purchase.',
    nextSteps: 'Ask the customer to use another card.',
    retryable: false,
  },
  do_not_honor: {
    title: 'Card declined',
    detail: 'The bank declined the payment (do not honor).',
    nextSteps: 'Ask the customer to contact their card issuer.',
    retryable: true,
  },
  duplicate_transaction: {
    title: 'Duplicate transaction',
    detail: 'An identical charge was submitted very recently.',
    nextSteps: 'Check if payment already succeeded before retrying.',
    retryable: false,
  },
  expired_card: {
    title: 'Card expired',
    detail: 'The card expiry date has passed.',
    nextSteps: 'Ask the customer to use another card.',
    retryable: false,
  },
  fraudulent: {
    title: 'Card declined',
    detail: 'Stripe Radar flagged this payment as high risk.',
    nextSteps: 'Do not share fraud details with the customer. Ask them to contact their bank or use another card.',
    retryable: false,
  },
  generic_decline: GENERIC_DECLINE,
  incorrect_address: {
    title: 'Incorrect address',
    detail: 'The billing address does not match the card.',
    nextSteps: 'Re-enter card details with the correct billing address.',
    retryable: true,
  },
  incorrect_cvc: {
    title: 'Incorrect CVC',
    detail: 'The security code (CVC) is wrong.',
    nextSteps: 'Re-enter the card with the correct CVC.',
    retryable: true,
  },
  incorrect_number: {
    title: 'Incorrect card number',
    detail: 'The card number is invalid.',
    nextSteps: 'Re-enter the card number carefully.',
    retryable: true,
  },
  incorrect_zip: {
    title: 'Incorrect postal code',
    detail: 'The billing postal code is wrong.',
    nextSteps: 'Re-enter billing details with the correct postal code.',
    retryable: true,
  },
  insufficient_funds: {
    title: 'Insufficient funds',
    detail: 'The card does not have enough available balance.',
    nextSteps: 'Ask the customer to use another card or add funds.',
    retryable: true,
  },
  invalid_account: {
    title: 'Invalid card account',
    detail: 'The card or linked account is invalid.',
    nextSteps: 'Ask the customer to contact their bank or use another card.',
    retryable: false,
  },
  invalid_amount: {
    title: 'Invalid amount',
    detail: 'The amount is invalid or exceeds the card limit.',
    nextSteps: 'Verify the amount or ask the customer to contact their bank.',
    retryable: true,
  },
  invalid_cvc: {
    title: 'Invalid CVC',
    detail: 'The security code (CVC) is invalid.',
    nextSteps: 'Re-enter the card with the correct CVC.',
    retryable: true,
  },
  invalid_expiry_month: {
    title: 'Invalid expiry month',
    detail: 'The card expiry month is invalid.',
    nextSteps: 'Re-enter the correct expiry date.',
    retryable: true,
  },
  invalid_expiry_year: {
    title: 'Invalid expiry year',
    detail: 'The card expiry year is invalid.',
    nextSteps: 'Re-enter the correct expiry date.',
    retryable: true,
  },
  invalid_number: {
    title: 'Invalid card number',
    detail: 'The card number is invalid.',
    nextSteps: 'Re-enter the card number carefully.',
    retryable: true,
  },
  issuer_not_available: {
    title: 'Bank unavailable',
    detail: 'The card issuer could not be reached.',
    nextSteps: 'Try again in a few minutes.',
    retryable: true,
  },
  lost_card: {
    title: 'Card declined',
    detail: 'The issuer reported this card as lost.',
    nextSteps: 'Do not tell the customer the lost-card reason. Ask them to contact their bank or use another card. Retries with this card will not succeed.',
    retryable: false,
  },
  stolen_card: {
    title: 'Card declined',
    detail: 'The issuer reported this card as stolen.',
    nextSteps: 'Do not tell the customer the stolen-card reason. Ask them to contact their bank or use another card. Retries with this card will not succeed.',
    retryable: false,
  },
  pickup_card: {
    title: 'Card declined',
    detail: 'The issuer blocked this card (possibly lost or stolen).',
    nextSteps: 'Ask the customer to contact their bank or use another card.',
    retryable: false,
  },
  restricted_card: {
    title: 'Card restricted',
    detail: 'The issuer restricted this card for this payment.',
    nextSteps: 'Ask the customer to contact their bank or use another card.',
    retryable: false,
  },
  processing_error: {
    title: 'Processing error',
    detail: 'A temporary error occurred while processing the card.',
    nextSteps: 'Try again. If it persists, use another card or try later.',
    retryable: true,
  },
  reenter_transaction: {
    title: 'Processing error',
    detail: 'The issuer could not process the payment.',
    nextSteps: 'Try again. If it still fails, ask the customer to contact their bank.',
    retryable: true,
  },
  testmode_decline: {
    title: 'Test decline',
    detail: 'A Stripe test decline card was used in live mode (or vice versa).',
    nextSteps: 'Use a real card in live mode, or a test card in test mode.',
    retryable: false,
  },
  transaction_not_allowed: {
    title: 'Transaction not allowed',
    detail: 'This type of transaction is not allowed on this card.',
    nextSteps: 'Ask the customer to contact their bank or use another card.',
    retryable: false,
  },
  withdrawal_count_limit_exceeded: {
    title: 'Limit exceeded',
    detail: 'The customer exceeded balance or credit limits.',
    nextSteps: 'Ask the customer to use another card.',
    retryable: true,
  },
};

function normalizeDeclineCode(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

export function lookupStripeDecline(declineCode) {
  const key = normalizeDeclineCode(declineCode);
  if (!key) return null;
  const entry = DECLINE_MAP[key];
  if (!entry) return null;
  return { ...entry, declineCode: key };
}

function extractDeclineCodeFromUnknown(err) {
  if (!err) return '';
  if (typeof err === 'string') {
    const m = err.match(/\bdecline_code[=:\s]+([a-z0-9_]+)/i);
    if (m) return m[1];
    const codeInText = err.match(/\b(stolen_card|insufficient_funds|lost_card|generic_decline|card_declined)\b/i);
    if (codeInText) return codeInText[1].toLowerCase();
    return '';
  }
  const direct = err.decline_code || err.declineCode;
  if (direct) return direct;
  const piErr = err.payment_intent?.last_payment_error || err.paymentIntent?.last_payment_error;
  if (piErr?.decline_code) return piErr.decline_code;
  if (err.code && err.code !== 'card_declined' && DECLINE_MAP[normalizeDeclineCode(err.code)]) {
    return err.code;
  }
  const msg = String(err.message || '');
  const bracket = msg.match(/\[([a-z0-9_]+)\]\s*$/i);
  if (bracket) return bracket[1];
  if (/stolen/i.test(msg) && /card/i.test(msg)) return 'stolen_card';
  if (/lost/i.test(msg) && /card/i.test(msg)) return 'lost_card';
  if (/insufficient funds/i.test(msg)) return 'insufficient_funds';
  return '';
}

export function humanizeStripeCardDecline(err) {
  const declineCode = normalizeDeclineCode(extractDeclineCodeFromUnknown(err));
  const mapped = lookupStripeDecline(declineCode);

  const rawMessage = String(
    (typeof err === 'string' ? err : null) ||
      err?.message ||
      err?.payment_intent?.last_payment_error?.message ||
      err?.paymentIntent?.last_payment_error?.message ||
      '',
  )
    .replace(/^FirebaseError:\s*/i, '')
    .replace(/^functions\/[a-z-]+:\s*/i, '')
    .trim();

  if (mapped) {
    return {
      title: mapped.title,
      detail: mapped.detail,
      nextSteps: mapped.nextSteps,
      code: mapped.declineCode.toUpperCase(),
      declineCode: mapped.declineCode,
      retryable: mapped.retryable,
      rawMessage: rawMessage || null,
    };
  }

  if (rawMessage) {
    return {
      title: 'Payment failed',
      detail: rawMessage,
      nextSteps: 'Ask the customer to contact their bank or try another card.',
      code: declineCode ? declineCode.toUpperCase() : 'CARD_DECLINED',
      declineCode: declineCode || 'card_declined',
      retryable: true,
      rawMessage,
    };
  }

  return {
    title: 'Payment failed',
    detail: 'The card payment could not be completed.',
    nextSteps: 'Try again or ask the customer to use another card.',
    code: 'CARD_DECLINED',
    declineCode: 'generic_decline',
    retryable: true,
    rawMessage: null,
  };
}

export function formatStripeDeclineForDisplay(err) {
  if (err?.title && err?.detail) {
    const parts = [err.detail];
    if (err.nextSteps) parts.push(err.nextSteps);
    return {
      ...err,
      displayText: parts.join(' '),
    };
  }
  const h = humanizeStripeCardDecline(err);
  const parts = [h.detail];
  if (h.nextSteps) parts.push(h.nextSteps);
  return {
    ...h,
    displayText: parts.join(' '),
  };
}
