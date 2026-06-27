/**
 * Canonical operational franchise IDs.
 * TR_SABIHA is a deprecated duplicate — legal/kiosk data lives on TR_SABIHAGOKCEN.
 */
const DEPRECATED_FRANCHISE_ALIASES = {
  TR_SABIHA: 'TR_SABIHAGOKCEN',
  TR_IST_SABIHA: 'TR_SABIHAGOKCEN',
};

/** @deprecated franchise docs that must not receive new kiosk/legal writes */
const DEPRECATED_FRANCHISE_IDS = new Set(['TR_SABIHA']);

function resolveOperationalFranchiseId(raw) {
  const id = String(raw || '').trim().toUpperCase();
  if (!id) return id;
  return DEPRECATED_FRANCHISE_ALIASES[id] || id;
}

function isDeprecatedFranchiseId(raw) {
  return DEPRECATED_FRANCHISE_IDS.has(String(raw || '').trim().toUpperCase());
}

module.exports = {
  DEPRECATED_FRANCHISE_ALIASES,
  DEPRECATED_FRANCHISE_IDS,
  resolveOperationalFranchiseId,
  isDeprecatedFranchiseId,
};
