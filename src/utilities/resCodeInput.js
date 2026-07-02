export const RES_CODE_PREFIX = 'RES-';

export function defaultResCodeValue() {
  return RES_CODE_PREFIX;
}

/** Keep RES- prefix; user types digits only after it. */
export function normalizeResCodeInput(raw) {
  const value = String(raw || '').trim().toUpperCase();
  if (!value || value === 'RES' || value === 'RES-') return RES_CODE_PREFIX;
  const digits = value.replace(/^RES-?/i, '').replace(/\D/g, '');
  return digits ? `${RES_CODE_PREFIX}${digits}` : RES_CODE_PREFIX;
}

export function resCodeNumberPart(value) {
  return String(value || '').replace(/^RES-/i, '').replace(/\D/g, '');
}

export function isResCodeComplete(value) {
  return resCodeNumberPart(value).length > 0;
}

export function formatResCodeForSubmit(value) {
  const digits = resCodeNumberPart(value);
  return digits ? `${RES_CODE_PREFIX}${digits}` : '';
}
