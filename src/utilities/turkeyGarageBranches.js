/**
 * Turkey garage / branch list — mirrors iOS TurkiyeGarajSubeleri + FranchiseGarageBranch.parseList.
 */
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';

/** Static fallback (iOS TurkiyeGarajSubeleri.branches). */
export const TURKIYE_GARAJ_SUBELERI = [
    { storageKey: 'TR_IST_SABIHA', displayName: 'İstanbul Sabiha Gökçen' },
    { storageKey: 'TR_NEVSEHIR', displayName: 'Nevşehir' },
    { storageKey: 'TR_IST_AIRPORT', displayName: 'İstanbul Havalimanı' },
    { storageKey: 'TR_ANTALYA', displayName: 'Antalya' },
    { storageKey: 'TR_IZMIR', displayName: 'İzmir' },
    { storageKey: 'TR_ANKARA', displayName: 'Ankara' },
];

function foldBranchToken(s) {
    return String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, '');
}

export function displayTitleForStoredKey(key) {
    const trimmed = String(key || '').trim();
    if (!trimmed) return '—';
    const hit = TURKIYE_GARAJ_SUBELERI.find((b) => b.storageKey.toUpperCase() === trimmed.toUpperCase());
    if (hit) return hit.displayName;
    const canon = canonicalGarageStorageKey(trimmed);
    if (canon) {
        const hit2 = TURKIYE_GARAJ_SUBELERI.find((b) => b.storageKey === canon);
        if (hit2) return hit2.displayName;
    }
    return trimmed;
}

export function canonicalGarageStorageKey(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const upper = trimmed.toUpperCase();
    const direct = TURKIYE_GARAJ_SUBELERI.find((b) => b.storageKey.toUpperCase() === upper);
    if (direct) return direct.storageKey;
    const folded = foldBranchToken(trimmed);
    for (const b of TURKIYE_GARAJ_SUBELERI) {
        if (foldBranchToken(b.displayName) === folded) return b.storageKey;
        const tail = b.storageKey.slice(3).replace(/_/g, '');
        if (folded === tail) return b.storageKey;
    }
    return '';
}

function anyString(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v.trim();
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    return '';
}

function parseBranchDict(dict) {
    const key = ['storageKey', 'storage_key', 'id', 'code', 'branchId', 'branch_id', 'branchKey', 'key', 'franchiseId']
        .map((k) => anyString(dict[k]))
        .find(Boolean);
    if (!key) return null;
    let name = ['displayName', 'display_name', 'name', 'title', 'label', 'branchName', 'locationName']
        .map((k) => anyString(dict[k]))
        .find(Boolean);
    if (!name) name = key;
    const ccRaw = ['countryCode', 'country_code', 'country'].map((k) => anyString(dict[k])).find(Boolean);
    return { storageKey: key.toUpperCase(), displayName: name, countryCode: ccRaw ? ccRaw.toUpperCase() : null };
}

function parseFromArrayField(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        const dicts = value.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
        if (dicts.length) {
            return dicts.map(parseBranchDict).filter(Boolean);
        }
        return value
            .map((x) => anyString(x))
            .filter(Boolean)
            .map((s) => ({ storageKey: s.toUpperCase(), displayName: s, countryCode: null }));
    }
    return [];
}

function parseKeyedBranchMap(map) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    return Object.entries(map)
        .map(([key, value]) => {
            const sk = String(key || '').trim().toUpperCase();
            if (!sk) return null;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return parseBranchDict({ ...value, storageKey: value.storageKey || sk });
            }
            const name = anyString(value);
            return { storageKey: sk, displayName: name || sk, countryCode: null };
        })
        .filter(Boolean)
        .sort((a, b) => a.storageKey.localeCompare(b.storageKey));
}

/** Parse `garageBranches` / `locations` from a franchise document (iOS FranchiseGarageBranch.parseList). */
export function parseGarageBranchesFromFranchiseData(data) {
    if (!data || typeof data !== 'object') return [];
    const arrayKeys = [
        'garageBranches',
        'locations',
        'branches',
        'garageLocations',
        'franchiseGarages',
        'subeler',
        'garage_branch_list',
        'officeLocations',
    ];
    for (const key of arrayKeys) {
        const parsed = parseFromArrayField(data[key]);
        if (parsed.length) return parsed;
    }
    const mapKeys = ['locations', 'garageBranchesById', 'garageBranchMap', 'locationMap', 'garages'];
    for (const key of mapKeys) {
        const parsed = parseKeyedBranchMap(data[key]);
        if (parsed.length) return parsed;
    }
    return [];
}

export function matchingBranchStorageKey(candidates, sessionFranchiseId) {
    const sessionRaw = String(sessionFranchiseId || '').trim().toUpperCase();
    if (!sessionRaw) return '';
    if (!candidates?.length) {
        if (sessionRaw.startsWith('TR_')) return sessionRaw;
        const c = canonicalGarageStorageKey(sessionRaw);
        return c || sessionRaw;
    }
    const hit = candidates.find((b) => b.storageKey.toUpperCase() === sessionRaw);
    if (hit) return hit.storageKey;
    const canon = canonicalGarageStorageKey(sessionRaw);
    if (canon) {
        const hit2 = candidates.find((b) => b.storageKey.toUpperCase() === canon);
        if (hit2) return hit2.storageKey;
    }
    if (sessionRaw.startsWith('TR_')) return sessionRaw;
    return '';
}

/** Load TR branches: `franchises/TR_*` docs first, then active franchise doc fields, then static list. */
export async function loadTurkeyGarageBranches(db, activeFranchiseId) {
    const fromCollection = [];
    try {
        const snap = await getDocs(collection(db, 'franchises'));
        snap.docs.forEach((d) => {
            const id = String(d.id || '').trim().toUpperCase();
            if (!id.startsWith('TR_')) return;
            const data = d.data() || {};
            const title = anyString(data.name) || anyString(data.franchiseName);
            fromCollection.push({
                storageKey: id,
                displayName: title || displayTitleForStoredKey(id),
                countryCode: 'TR',
            });
        });
        fromCollection.sort((a, b) => a.storageKey.localeCompare(b.storageKey));
    } catch (e) {
        console.warn('[turkeyGarageBranches] collection list', e);
    }
    if (fromCollection.length) return fromCollection;

    const fid = String(activeFranchiseId || '').trim().toUpperCase();
    if (fid) {
        try {
            const snap = await getDoc(doc(db, 'franchises', fid));
            if (snap.exists()) {
                const parsed = parseGarageBranchesFromFranchiseData(snap.data() || {});
                const trOnly = parsed.filter((b) => !b.countryCode || b.countryCode === 'TR');
                if (trOnly.length) return trOnly;
            }
        } catch (e) {
            console.warn('[turkeyGarageBranches] franchise doc', e);
        }
    }

    return TURKIYE_GARAJ_SUBELERI.map((b) => ({ ...b, countryCode: 'TR' }));
}
