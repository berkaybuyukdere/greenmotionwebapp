function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buttonText(label, amountLabel) {
  const safeLabel = escapeHtml(label);
  const amountSuffix = amountLabel ? ` &mdash; ${escapeHtml(amountLabel)}` : '';
  return `${safeLabel}${amountSuffix}`;
}

/**
 * CKEditor / FuseMetrix "Source" mode — simple single-line HTML (no tables).
 * @param {{ url: string, label?: string, amountLabel?: string }} opts
 * @return {string}
 */
export function buildFuseMetrixPaymentButtonHtml({
  url,
  label = 'Pay securely online',
  amountLabel = '',
}) {
  const safeUrl = escapeHtml(url);
  const text = buttonText(label, amountLabel);
  return `<p><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;background-color:#0f766e;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;line-height:1.2;text-decoration:none;border-radius:8px;">${text}</a></p>`;
}

/**
 * Email-safe HTML button/table wrapper for Stripe checkout links (Outlook etc.).
 * @param {{ url: string, label?: string, amountLabel?: string }} opts
 * @return {string}
 */
export function buildMailOrderPaymentButtonHtml({ url, label = 'Pay securely online', amountLabel = '' }) {
  const safeUrl = escapeHtml(url);
  const text = buttonText(label, amountLabel);
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;"><tr><td align="center" style="border-radius:8px;background:#0f766e;"><a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:8px;">${text}</a></td></tr></table>`;
}

/**
 * Plain label for clipboard fallback.
 * @param {{ label?: string, amountLabel?: string }} opts
 * @return {string}
 */
export function buildPaymentButtonPlainLabel({ label = 'Pay securely online', amountLabel = '' }) {
  return amountLabel ? `${label} — ${amountLabel}` : label;
}
