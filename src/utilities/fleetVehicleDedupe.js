/**
 * Fleet vehicle deduplication by license plate (franchise-scoped).
 *
 * Root cause: multiple Firestore `araclar` documents can exist for the same plate
 * (repeated spreadsheet import, manual re-add, or legacy sync). iOS only dedupes by UUID,
 * so duplicate plates appear as separate rows with split damage arrays.
 *
 * Display merge combines embedded `hasarKayitlari` without deleting documents.
 * `persistFleetPlateMerges` copies damages onto the canonical doc only (iOS keeps every UUID visible).
 */

import { isAracSoftDeletedForList } from './firebaseHelpers';
import { plateDedupeKeyForFranchise } from './fleetListImport';

function carTimestamp(car) {
    const v = car?.kayitTarihi || car?.createdAt;
    if (!v) return 0;
    if (typeof v === 'object' && v.seconds) return v.seconds * 1000;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function activeDamageCount(car) {
    return (car?.hasarKayitlari || []).filter((h) => !h?.isDeleted).length;
}

/** Prefer doc with most damages, then metadata, then newest record. */
export function scoreCanonicalFleetCar(car) {
    const damages = activeDamageCount(car);
    const meta = [car?.marka, car?.model, car?.kategori, car?.renk].filter((x) =>
        String(x || '').trim()
    ).length;
    return damages * 10000 + meta * 100 + carTimestamp(car) / 1e6;
}

export function pickCanonicalFleetCar(cars) {
    if (!cars?.length) return null;
    return [...cars].sort((a, b) => scoreCanonicalFleetCar(b) - scoreCanonicalFleetCar(a))[0];
}

function exitRecordTimestamp(exit) {
    const v = exit?.exitTarihi || exit?.createdAt;
    if (!v) return 0;
    if (typeof v === 'object' && v.seconds) return v.seconds * 1000;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/**
 * Resolve list/detail display fields when `araclar` docs lack plate/brand/model
 * but linked `exitIslemleri` (or sibling plate doc) has the data.
 * Display-only — does not mutate Firestore.
 */
export function resolveFleetCarDisplay(
    car,
    { exitIslemleri = [], fleetCars = [], franchiseId = '' } = {}
) {
    const carIds = new Set(
        [car?.id, car?.documentId].filter(Boolean).map((x) => String(x))
    );

    let plaka = String(car?.plaka || '').trim();
    let marka = String(car?.marka || '').trim();
    let model = String(car?.model || '').trim();
    let kategori = String(car?.kategori || '').trim();

    const linkedExits = (exitIslemleri || [])
        .filter((e) => !e?.isDeleted)
        .filter((e) => {
            const ids = [e.aracId, e.aracID].filter(Boolean).map(String);
            return ids.some((id) => carIds.has(id));
        })
        .sort((a, b) => exitRecordTimestamp(b) - exitRecordTimestamp(a));

    if (!plaka && linkedExits.length) {
        plaka = String(linkedExits[0].aracPlaka || linkedExits[0].plaka || '').trim();
    }

    const plateKey = plaka ? plateDedupeKeyForFranchise(franchiseId, plaka) : '';
    const enrichFromDoc = (doc) => {
        if (!doc) return;
        if (!marka) marka = String(doc.marka || '').trim();
        if (!model) model = String(doc.model || '').trim();
        if (!kategori) kategori = String(doc.kategori || '').trim();
        if (!plaka) plaka = String(doc.plaka || '').trim();
    };

    if (plateKey && (!marka || !model || !kategori)) {
        const siblings = (fleetCars || []).filter((c) => {
            if (c === car) return false;
            const sibPlate = String(c?.plaka || '').trim();
            if (!sibPlate) return false;
            return plateDedupeKeyForFranchise(franchiseId, sibPlate) === plateKey;
        });
        const sibling = siblings.sort((a, b) => scoreCanonicalFleetCar(b) - scoreCanonicalFleetCar(a))[0];
        enrichFromDoc(sibling);
    }

    if ((!marka || !model || !kategori) && linkedExits.length) {
        for (const exit of linkedExits) {
            const exitPlateKey = plateDedupeKeyForFranchise(
                franchiseId,
                exit.aracPlaka || exit.plaka || plaka
            );
            if (!exitPlateKey) continue;
            const match = (fleetCars || []).find((c) => {
                const sibPlate = String(c?.plaka || '').trim();
                return sibPlate && plateDedupeKeyForFranchise(franchiseId, sibPlate) === exitPlateKey;
            });
            if (match) {
                enrichFromDoc(match);
                break;
            }
        }
    }

    const vehicleLabel = [marka, model].filter(Boolean).join(' ') || '—';
    return {
        plaka: plaka || '—',
        marka,
        model,
        kategori: kategori || '—',
        vehicleLabel,
    };
}

function damageMergeKey(dmg) {
    if (!dmg || dmg.isDeleted) return null;
    if (dmg.id != null && String(dmg.id).trim()) return `id:${String(dmg.id).trim()}`;
    if (dmg.resKodu != null && String(dmg.resKodu).trim()) {
        return `res:${String(dmg.resKodu).trim()}`;
    }
    const t = dmg.tarih || dmg.createdAt || '';
    const ph = (dmg.fotograflar || []).length;
    return `anon:${t}:${ph}:${String(dmg.aciklama || '').slice(0, 40)}`;
}

/** Union damage records from duplicate vehicle docs; keeps richest copy per key. */
export function mergeHasarKayitlariFromCars(cars) {
    const merged = [];
    const seen = new Map();
    for (const car of cars || []) {
        for (const dmg of car?.hasarKayitlari || []) {
            const key = damageMergeKey(dmg);
            if (!key) continue;
            const prev = seen.get(key);
            if (!prev) {
                seen.set(key, dmg);
                merged.push(dmg);
                continue;
            }
            const a = (prev.fotograflar || []).length;
            const b = (dmg.fotograflar || []).length;
            if (b > a) {
                seen.set(key, dmg);
                const idx = merged.indexOf(prev);
                if (idx >= 0) merged[idx] = dmg;
            }
        }
    }
    return merged;
}

/**
 * One row per plate for lists, analytics, and KPIs.
 * @returns {Array<object>} vehicles with optional `_fleetMergedCount`, `_fleetDuplicateDocumentIds`
 */
export function dedupeFleetCarsByPlate(franchiseId, cars) {
    if (!Array.isArray(cars) || cars.length === 0) return [];

    const groups = new Map();
    for (const car of cars) {
        const plateKey = plateDedupeKeyForFranchise(franchiseId, car?.plaka);
        const groupKey = plateKey || `__doc:${String(car.documentId || car.id || '')}`;
        if (!groups.has(groupKey)) groups.set(groupKey, []);
        groups.get(groupKey).push(car);
    }

    const out = [];
    for (const group of groups.values()) {
        if (group.length === 1) {
            out.push(group[0]);
            continue;
        }
        const canonical = pickCanonicalFleetCar(group);
        const canonicalId = String(canonical.documentId || canonical.id || '');
        const duplicateIds = group
            .map((c) => String(c.documentId || c.id || ''))
            .filter((id) => id && id !== canonicalId);
        const mergedAracIds = group.map((c) => c.id || c.documentId).filter(Boolean);
        out.push({
            ...canonical,
            hasarKayitlari: mergeHasarKayitlariFromCars(group),
            _fleetMergedCount: group.length,
            _fleetDuplicateDocumentIds: duplicateIds,
            _fleetMergedAracIds: mergedAracIds,
        });
    }
    return out;
}

/** Groups with 2+ Firestore docs for the same plate (for admin merge UI). */
export function fleetCarMatchesAracId(car, aracId) {
    if (!car || aracId == null || aracId === '') return false;
    const id = String(aracId);
    if (String(car.id || '') === id || String(car.documentId || '') === id) return true;
    return (car._fleetMergedAracIds || []).some((x) => String(x) === id);
}

/** Resolve vehicle from deduped fleet list (includes merged duplicate doc ids). */
export function findFleetCarByAracId(cars, aracId) {
    if (aracId == null || aracId === '') return null;
    for (const car of cars || []) {
        if (fleetCarMatchesAracId(car, aracId)) return car;
    }
    return null;
}

export function findFleetPlateDuplicateGroups(franchiseId, cars) {
    const groups = new Map();
    for (const car of cars || []) {
        const plateKey = plateDedupeKeyForFranchise(franchiseId, car?.plaka);
        if (!plateKey) continue;
        if (!groups.has(plateKey)) groups.set(plateKey, []);
        groups.get(plateKey).push(car);
    }
    return Array.from(groups.entries())
        .filter(([, g]) => g.length > 1)
        .map(([plateKey, group]) => ({
            plateKey,
            plate: group[0]?.plaka,
            cars: group,
            canonical: pickCanonicalFleetCar(group),
        }));
}

/**
 * Vehicle hidden by web fleet merge (soft-deleted duplicate Firestore row).
 */
export function isFleetMergeHiddenVehicle(row) {
    if (!row) return false;
    if (!isAracSoftDeletedForList(row)) return false;
    const mergedInto = String(row.mergedIntoVehicleId || '').trim();
    const mergedPlate = String(row.mergedIntoPlate || '').trim();
    return Boolean(mergedInto || mergedPlate);
}

/**
 * Undo fleet merge soft-deletes — restores iOS/web visibility without removing merged damages on canonical.
 */
export async function restoreFleetMergeSoftDeletes({
    hiddenCars,
    docRefHelper,
    updateDoc,
    deleteField,
    Timestamp,
    auth,
}) {
    const targets = (hiddenCars || []).filter(isFleetMergeHiddenVehicle);
    if (!targets.length) {
        return { restoredDocs: 0, plates: [] };
    }

    const uid = auth?.currentUser?.uid || null;
    const plates = [];

    for (const car of targets) {
        const docId = String(car.documentId || car.id || '');
        if (!docId) continue;
        await updateDoc(docRefHelper('araclar', docId), {
            isDeleted: false,
            mergedIntoVehicleId: deleteField(),
            mergedIntoPlate: deleteField(),
            deletedAt: deleteField(),
            deletedBy: deleteField(),
            fleetMergeRestoredAt: Timestamp.now(),
            fleetMergeRestoredBy: uid,
        });
        if (car.plaka) plates.push(String(car.plaka));
    }

    return {
        restoredDocs: targets.length,
        plates: [...new Set(plates)],
    };
}

/**
 * Persist merge: copy all damages to canonical doc. Does NOT soft-delete duplicates (iOS UUID links).
 */
export async function persistFleetPlateMerges({
    franchiseId,
    cars,
    docRefHelper,
    updateDoc,
    Timestamp,
    auth,
}) {
    const groups = findFleetPlateDuplicateGroups(franchiseId, cars);
    if (!groups.length) {
        return { mergedPlates: 0, softDeletedDocs: 0, duplicateGroups: 0 };
    }

    const uid = auth?.currentUser?.uid || null;

    for (const { cars: plateGroup, canonical } of groups) {
        const canonicalId = String(canonical.documentId || canonical.id || '');
        if (!canonicalId) continue;

        const mergedDamages = mergeHasarKayitlariFromCars(plateGroup);
        await updateDoc(docRefHelper('araclar', canonicalId), {
            hasarKayitlari: mergedDamages,
            fleetMergeUpdatedAt: Timestamp.now(),
            fleetMergeUpdatedBy: uid,
        });
    }

    return {
        mergedPlates: groups.length,
        softDeletedDocs: 0,
        duplicateGroups: groups.length,
    };
}
