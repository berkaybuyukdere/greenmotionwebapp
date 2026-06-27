/**
 * Maps deprecated franchise document IDs to the real operational franchise.
 * TR_SABIHA must not be used — use TR_SABIHAGOKCEN (Sabiha Gökçen airport).
 */
const DEPRECATED_FRANCHISE_ALIASES = {
    TR_SABIHA: 'TR_SABIHAGOKCEN',
    TR_IST_SABIHA: 'TR_SABIHAGOKCEN',
};

export function resolveOperationalFranchiseId(raw) {
    const id = String(raw || '').trim().toUpperCase();
    if (!id) return id;
    return DEPRECATED_FRANCHISE_ALIASES[id] || id;
}

export function isDeprecatedFranchiseId(raw) {
    return String(raw || '').trim().toUpperCase() === 'TR_SABIHA';
}
