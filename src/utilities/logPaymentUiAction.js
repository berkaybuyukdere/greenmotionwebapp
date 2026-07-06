import { stripeFinancialLogStaffAction } from '../services/stripeFinancialApi';

/** Fire-and-forget audit entry for payment UI button clicks (admin logs tab only). */
export function logPaymentUiAction(franchiseId, button, detail = {}) {
  if (!franchiseId || !button) return;
  stripeFinancialLogStaffAction({
    franchiseId,
    action: 'payment_ui_click',
    detail: { button, ...detail },
  }).catch(() => {});
}
