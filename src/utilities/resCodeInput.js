export const RES_CODE_PREFIX = 'RES-';
export const RNT_CODE_PREFIX = 'RNT-';

export const BOOKING_CODE_RES = 'RES';
export const BOOKING_CODE_RNT = 'RNT';

export function defaultResCodeValue(kind = BOOKING_CODE_RES) {
  return kind === BOOKING_CODE_RNT ? RNT_CODE_PREFIX : RES_CODE_PREFIX;
}

export function defaultBookingCodeValue(kind = BOOKING_CODE_RES) {
  return defaultResCodeValue(kind);
}

function prefixForKind(kind) {
  return kind === BOOKING_CODE_RNT ? RNT_CODE_PREFIX : RES_CODE_PREFIX;
}

/** Keep RES-/RNT- prefix; user types digits only after it. */
export function normalizeResCodeInput(raw, kind = BOOKING_CODE_RES) {
  return normalizeBookingCodeInput(raw, kind);
}

export function normalizeBookingCodeInput(raw, kind = BOOKING_CODE_RES) {
  const prefix = prefixForKind(kind);
  const value = String(raw || '').trim().toUpperCase();
  const bare = kind === BOOKING_CODE_RNT ? 'RNT' : 'RES';
  if (!value || value === bare || value === `${bare}-`) return prefix;
  const digits = value.replace(/^(RES|RNT)-?/i, '').replace(/\D/g, '');
  return digits ? `${prefix}${digits}` : prefix;
}

export function resCodeNumberPart(value) {
  return String(value || '').replace(/^(RES|RNT)-/i, '').replace(/\D/g, '');
}

export function bookingCodeNumberPart(value) {
  return resCodeNumberPart(value);
}

export function isResCodeComplete(value) {
  return resCodeNumberPart(value).length > 0;
}

export function isBookingCodeComplete(value) {
  return isResCodeComplete(value);
}

export function formatResCodeForSubmit(value, kind = BOOKING_CODE_RES) {
  return formatBookingCodeForSubmit(value, kind);
}

export function formatBookingCodeForSubmit(value, kind = BOOKING_CODE_RES) {
  const digits = resCodeNumberPart(value);
  const prefix = prefixForKind(kind);
  return digits ? `${prefix}${digits}` : '';
}

export function isWalkInBookingCode(value) {
  return String(value || '').trim().toUpperCase().startsWith(RNT_CODE_PREFIX);
}

export function bookingCodeKind(value) {
  return isWalkInBookingCode(value) ? BOOKING_CODE_RNT : BOOKING_CODE_RES;
}
