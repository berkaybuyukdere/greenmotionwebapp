import { httpsCallable } from 'firebase/functions';
import { functionsApp, functionsEu } from '../firebase/client';

function call(name, data = {}) {
  const fn = httpsCallable(functionsApp, name);
  return fn(data).then((res) => res.data);
}

function callEu(name, data = {}) {
  const fn = httpsCallable(functionsEu, name);
  return fn(data).then((res) => res.data);
}

/** CH Stripe daily KPI reports (europe-west6). */
export function chStripeGetDailyReports({ franchiseId, period = '7d' } = {}) {
  return callEu('getCHStripeDailyReports', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    period,
  });
}

export function stripeFinancialGetConfig({ franchiseId } = {}) {
  return call('stripeFinancialGetConfig', { franchiseId });
}

export function stripeFinancialListDisputes({ franchiseId, limit = 50, startingAfter } = {}) {
  return call('stripeFinancialListDisputes', { franchiseId, limit, startingAfter });
}

export function stripeFinancialGetDispute({ franchiseId, disputeId }) {
  return call('stripeFinancialGetDispute', { franchiseId, disputeId });
}

export function stripeFinancialListProducts({ franchiseId, limit = 50, activeOnly = false } = {}) {
  return call('stripeFinancialListProducts', { franchiseId, limit, activeOnly });
}

export function stripeFinancialGetProduct({ franchiseId, productId }) {
  return call('stripeFinancialGetProduct', { franchiseId, productId });
}

export function stripeFinancialCreateProduct(payload) {
  return call('stripeFinancialCreateProduct', payload);
}

export function stripeFinancialUpdateProduct(payload) {
  return call('stripeFinancialUpdateProduct', payload);
}

export function stripeFinancialArchiveProduct({ franchiseId, productId }) {
  return call('stripeFinancialArchiveProduct', { franchiseId, productId });
}

export function stripeFinancialDeleteProduct({ franchiseId, productId }) {
  return call('stripeFinancialDeleteProduct', { franchiseId, productId });
}

export function stripeFinancialListMailOrders({ franchiseId, limit = 100 } = {}) {
  return call('stripeFinancialListMailOrders', { franchiseId, limit });
}

export function stripeFinancialListPayments({ franchiseId, dayKey, lookbackDays = 21 } = {}) {
  return call('stripeFinancialListPayments', { franchiseId, dayKey, lookbackDays });
}

export function stripeFinancialCreateMailOrderPaymentLink({
  franchiseId,
  productId,
  customerEmail,
  saveCustomerInfo,
}) {
  return call('stripeFinancialCreateMailOrderPaymentLink', {
    franchiseId,
    productId,
    customerEmail,
    saveCustomerInfo,
  });
}

export function stripeFinancialListAudit({ franchiseId, limit = 40 }) {
  return call('stripeFinancialListAudit', { franchiseId, limit });
}

export function stripeFinancialGetTerminalConfig({ franchiseId } = {}) {
  return call('stripeFinancialGetTerminalConfig', { franchiseId });
}

export function stripeFinancialSaveTerminalConfig(payload) {
  return call('stripeFinancialSaveTerminalConfig', payload);
}

export function stripeFinancialTestTerminalConnection({ franchiseId } = {}) {
  return call('stripeFinancialTestTerminalConnection', { franchiseId });
}

export function stripeFinancialCreateTerminalConnectionToken({ franchiseId } = {}) {
  return call('stripeFinancialCreateTerminalConnectionToken', { franchiseId });
}

export function stripeFinancialCreateDeposit(payload) {
  return call('stripeFinancialCreateDeposit', payload);
}

export function stripeFinancialListDeposits({ franchiseId, limit = 50 } = {}) {
  return call('stripeFinancialListDeposits', { franchiseId, limit });
}

export function stripeFinancialIncrementDeposit(payload) {
  return call('stripeFinancialIncrementDeposit', payload);
}

export function stripeFinancialCaptureDeposit(payload) {
  return call('stripeFinancialCaptureDeposit', payload);
}

export function stripeFinancialCancelDeposit(payload) {
  return call('stripeFinancialCancelDeposit', payload);
}

export function stripeFinancialCancelTerminalAction(payload) {
  return call('stripeFinancialCancelTerminalAction', payload);
}

export function stripeFinancialCancelPaymentHold(payload) {
  return call('stripeFinancialCancelPaymentHold', payload);
}

export function stripeFinancialConfirmDepositCollection(payload) {
  return call('stripeFinancialConfirmDepositCollection', payload);
}

export function stripeFinancialGetDepositStatus(payload) {
  return call('stripeFinancialGetDepositStatus', payload);
}

export function stripeFinancialProcessDepositOnTerminal(payload) {
  return call('stripeFinancialProcessDepositOnTerminal', payload);
}
