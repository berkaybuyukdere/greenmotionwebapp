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
export function chStripeGetDailyReports({ franchiseId, period = '7d', startDayKey, endDayKey } = {}) {
  return callEu('getCHStripeDailyReports', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    period,
    ...(startDayKey && endDayKey ? { startDayKey, endDayKey } : {}),
  });
}

/** Charge saved card from prior deposit (us-central1, admin+). */
export function stripeFinancialChargeSavedPaymentMethod({ franchiseId, depositId, paymentIntentId, amountChf, note } = {}) {
  return call('stripeFinancialChargeSavedPaymentMethod', {
    franchiseId,
    ...(depositId ? { depositId } : {}),
    ...(paymentIntentId ? { paymentIntentId } : {}),
    amountChf,
    note,
  });
}

// Config (publishable key + mode) changes rarely but every financial view
// fetches it on mount — cache per franchise for a few minutes so page loads
// skip one callable round-trip. In-flight requests are shared so parallel
// mounts don't duplicate the call.
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
const configCache = new Map();

export function stripeFinancialGetConfig({ franchiseId } = {}) {
  const key = String(franchiseId || '').toUpperCase();
  const cached = configCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = call('stripeFinancialGetConfig', { franchiseId }).catch((err) => {
    configCache.delete(key);
    throw err;
  });
  configCache.set(key, { promise, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
  return promise;
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

export function stripeFinancialListPayments({ franchiseId, dayKey, period = '1d', lookbackDays = 90 } = {}) {
  return call('stripeFinancialListPayments', { franchiseId, dayKey, period, lookbackDays });
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

export function stripeFinancialListDeposits({ franchiseId, limit = 50, syncStripe = true } = {}) {
  return call('stripeFinancialListDeposits', { franchiseId, limit, syncStripe });
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

export function stripeFinancialListTerminals({ franchiseId } = {}) {
  return call('stripeFinancialListTerminals', { franchiseId });
}

export function stripeFinancialUpsertTerminal(payload) {
  return call('stripeFinancialUpsertTerminal', payload);
}

export function stripeFinancialDeleteTerminal({ franchiseId, terminalId }) {
  return call('stripeFinancialDeleteTerminal', { franchiseId, terminalId });
}

export function stripeFinancialListDepositEmailTemplates({ franchiseId } = {}) {
  return call('stripeFinancialListDepositEmailTemplates', { franchiseId });
}

export function stripeFinancialSaveDepositEmailTemplate(payload) {
  return call('stripeFinancialSaveDepositEmailTemplate', payload);
}

export function stripeFinancialDeleteDepositEmailTemplate({ franchiseId, templateId }) {
  return call('stripeFinancialDeleteDepositEmailTemplate', { franchiseId, templateId });
}

export function stripeFinancialAttachDepositDocuments(payload) {
  return call('stripeFinancialAttachDepositDocuments', payload);
}

export function stripeFinancialSendDepositEmail(payload) {
  return call('stripeFinancialSendDepositEmail', payload);
}

export function stripeFinancialCreateMailOrderPayment(payload) {
  return call('stripeFinancialCreateMailOrderPayment', payload);
}

export function stripeFinancialCreateDirectCardOperation(payload) {
  return call('stripeFinancialCreateDirectCardOperation', payload);
}

export function stripeFinancialFinalizeDirectCardOperation(payload) {
  return call('stripeFinancialFinalizeDirectCardOperation', payload);
}

export function stripeFinancialPersistDirectCardSnapshot(payload) {
  return call('stripeFinancialPersistDirectCardSnapshot', payload);
}

export function stripeFinancialRetryDirectCardOperation(payload) {
  return call('stripeFinancialRetryDirectCardOperation', payload);
}

export function stripeFinancialRetryDirectCardSavedPayment(payload) {
  return call('stripeFinancialRetryDirectCardSavedPayment', payload);
}

export function stripeFinancialSendMailOrderEmail(payload) {
  return call('stripeFinancialSendMailOrderEmail', payload);
}

export function stripeFinancialAttachMailOrderDocuments(payload) {
  return call('stripeFinancialAttachMailOrderDocuments', payload);
}
