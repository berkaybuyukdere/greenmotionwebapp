#!/usr/bin/env node
/**
 * Stripe TEST: 1 CHF hold → increment to 2 CHF → cancel (no capture).
 * Uses sk_test from functions/.env — does not charge real money.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Stripe = require('stripe');

async function main() {
  const key = String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_CH_SECRET_KEY || '').trim();
  if (!key.startsWith('sk_test_')) {
    console.error('Refusing to run: need sk_test_ key in functions/.env (STRIPE_SECRET_KEY)');
    process.exit(1);
  }

  const stripe = new Stripe(key, { apiVersion: '2024-11-20.acacia' });

  console.log('=== Stripe TEST deposit increment 1 CHF → 2 CHF ===\n');

  const pi = await stripe.paymentIntents.create({
    amount: 100,
    currency: 'chf',
    capture_method: 'manual',
    payment_method_types: ['card'],
    description: 'TEST DEPOSIT · CHF 1.00 · RES-TEST',
    statement_descriptor_suffix: 'DEPOSIT',
    metadata: { flow: 'deposit', test: 'increment_1_to_2' },
    payment_method_options: {
      card: { request_incremental_authorization: 'if_available' },
    },
  });
  console.log('1) Created PaymentIntent:', pi.id, 'amount:', pi.amount, 'status:', pi.status);

  const confirmed = await stripe.paymentIntents.confirm(pi.id, {
    payment_method: 'pm_card_visa',
    return_url: 'https://example.com/return',
  });
  console.log('2) Confirmed hold:', confirmed.status, 'capturable:', confirmed.amount_capturable);

  if (confirmed.status !== 'requires_capture') {
    console.error('Expected requires_capture after confirm, got', confirmed.status);
    process.exit(1);
  }

  const incremented = await stripe.paymentIntents.incrementAuthorization(pi.id, {
    amount: 200,
  });
  console.log('3) Incremented to 2 CHF:', incremented.status, 'amount:', incremented.amount, 'capturable:', incremented.amount_capturable);

  if (incremented.amount !== 200 || incremented.amount_capturable !== 200) {
    console.error('Increment failed — expected amount/capturable 200');
    process.exit(1);
  }

  const cancelled = await stripe.paymentIntents.cancel(pi.id, {
    cancellation_reason: 'abandoned',
  });
  console.log('4) Cancelled (test cleanup):', cancelled.status);

  console.log('\n✅ TEST PASSED: 1.00 CHF → 2.00 CHF incremental authorization works in Stripe test mode.');
  console.log('   PaymentIntent:', pi.id);
}

main().catch((e) => {
  console.error('TEST FAILED:', e.message || e);
  process.exit(1);
});
