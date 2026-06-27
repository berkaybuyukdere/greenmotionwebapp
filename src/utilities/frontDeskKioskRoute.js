import { resolveOperationalFranchiseId } from './franchiseIdResolve';

/** Kiosk URL: /front-desk?franchise=CH or #front-desk?franchise=CH — no auth. */
export function getFrontDeskKioskFranchiseId() {
    if (typeof window === 'undefined') return null;
    const hashFull = window.location.hash.replace(/^#/, '');
    const [hashPathPart, hashQueryPart] = hashFull.split('?');
    const hashPath = (hashPathPart || '').replace(/^\//, '');
    const pathName = (window.location.pathname || '').replace(/^\/+|\/+$/g, '');

    const isKioskRoute =
        hashPath === 'front-desk' ||
        pathName === 'front-desk' ||
        pathName === 'frontdesk';

    if (!isKioskRoute) return null;

    const params = new URLSearchParams(
        hashPath === 'front-desk' ? (hashQueryPart || '') : window.location.search
    );
    const fr = (params.get('franchise') || params.get('franchiseId') || 'CH').trim();
    return fr ? resolveOperationalFranchiseId(fr) : 'CH';
}

export function isFrontDeskKioskRoute() {
    return Boolean(getFrontDeskKioskFranchiseId());
}
