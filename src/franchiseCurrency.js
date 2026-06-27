/** Active franchise ISO 4217 code for UI formatting (updated from Firestore `franchises/{id}.currency`). */
let activeCode = 'CHF';

export function setActiveFranchiseCurrencyCode(code) {
    const c = String(code ?? '')
        .trim()
        .toUpperCase();
    activeCode = /^[A-Z]{3}$/.test(c) ? c : 'CHF';
}

export function getActiveFranchiseCurrencyCode() {
    return activeCode;
}
