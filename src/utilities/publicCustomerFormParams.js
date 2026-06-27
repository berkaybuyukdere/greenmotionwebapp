import { resolveOperationalFranchiseId } from './franchiseIdResolve';

const FRANCHISE_RE = /^[A-Z0-9_-]{1,64}$/;

function parseParamsFromLocation(kind) {
    if (typeof window === 'undefined') return null;

    const pathname = (window.location.pathname || '').replace(/\/$/, '');
    const search = new URLSearchParams(window.location.search || '');

    const hashFull = (window.location.hash || '').replace(/^#/, '');
    const [hashPath, hashQuery] = hashFull.split('?');
    const hashRoute = (hashPath || '').replace(/^\//, '');
    const hashParams = new URLSearchParams(hashQuery || '');

    const htmlPath = kind === 'checkout' ? '/checkout.html' : '/return.html';
    const shortPath = kind === 'checkout' ? '/checkout' : '/return';
    const hashKey = kind;

    const isFormPath =
        pathname.endsWith(htmlPath) ||
        pathname === shortPath ||
        hashRoute === hashKey;

    if (!isFormPath && !search.get('token')) {
        return null;
    }

    let token = (search.get('token') || hashParams.get('token') || '').trim();
    let franchiseRaw = (
        search.get('franchise') ||
        search.get('franchiseId') ||
        hashParams.get('franchise') ||
        hashParams.get('franchiseId') ||
        ''
    ).trim();

    if (!isFormPath && (!token || !franchiseRaw)) {
        return null;
    }

    if (!token || token.length < 10) return null;

    const franchiseId = resolveOperationalFranchiseId(franchiseRaw);
    if (!franchiseId || !FRANCHISE_RE.test(franchiseId)) return null;

    return { token, franchiseId, formKind: kind };
}

/** @deprecated use getPublicCustomerFormParams('return') */
export function getPublicReturnFormParams() {
    return parseParamsFromLocation('return');
}

export function getPublicCheckoutFormParams() {
    return parseParamsFromLocation('checkout');
}

export function getPublicCustomerFormParams(kind = 'return') {
    return parseParamsFromLocation(kind);
}
