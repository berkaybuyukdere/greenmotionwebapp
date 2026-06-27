import { getDownloadURL, getBytes, ref } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { storage, functionsApp } from '../firebase/client';

const FRANCHISE_SCOPED_STORAGE_PREFIXES = new Set([
    'traffic_fines',
    'banking_transactions',
    'semesInvoices',
    'semesinvoices',
    'protocolTemplates',
    'hasar_fotograflari',
    'iade_fotograflari',
    'exit_fotograflari',
    'office_operations',
    'office_Return',
    'iade_signatures',
    'return_pdfs',
    'frontDeskCustomers',
    'fileLibrary',
]);

let fetchPdfPhotoBytesCallable = null;

function getFetchPdfPhotoBytesCallable() {
    if (!fetchPdfPhotoBytesCallable) {
        fetchPdfPhotoBytesCallable = httpsCallable(functionsApp, 'fetchPdfPhotoBytes');
    }
    return fetchPdfPhotoBytesCallable;
}

function activeFranchiseId(franchiseId) {
    return String(franchiseId || 'CH').trim().toUpperCase();
}

export function normalizePhotoRef(input) {
    if (input == null || input === '') return '';
    if (typeof input === 'string') return input.trim();
    if (typeof input === 'object') {
        return String(
            input.url ||
                input.src ||
                input.downloadURL ||
                input.storagePath ||
                input.path ||
                ''
        ).trim();
    }
    return String(input).trim();
}

function normalizeStoragePath(path) {
    return String(path || '')
        .trim()
        .replace(/^gs:\/\/[^/]+\//, '')
        .replace(/^\/+/, '');
}

function expandPhotoPathAliases(path) {
    const normalized = normalizeStoragePath(path);
    if (!normalized) return [];
    const variants = new Set([normalized]);
    if (normalized.startsWith('fotograflari/')) {
        variants.add(`hasar_fotograflari/${normalized.slice('fotograflari/'.length)}`);
    }
    return Array.from(variants);
}

function toScopedStoragePath(path, franchiseId) {
    const normalized = normalizeStoragePath(path);
    if (!normalized) return normalized;
    if (normalized.startsWith('franchises/')) return normalized;
    const rootPrefix = normalized.split('/')[0];
    if (!FRANCHISE_SCOPED_STORAGE_PREFIXES.has(rootPrefix)) {
        return normalized;
    }
    return `franchises/${activeFranchiseId(franchiseId)}/${normalized}`;
}

function getStoragePathCandidates(path, franchiseId) {
    const aliases = expandPhotoPathAliases(path);
    const all = new Set();
    for (const alias of aliases) {
        const normalized = normalizeStoragePath(alias);
        if (!normalized) continue;
        if (normalized.startsWith('franchises/')) {
            const parts = normalized.split('/');
            if (parts.length > 3) {
                const currentFranchise = parts[1] || '';
                const remainder = parts.slice(2).join('/');
                [
                    normalized,
                    `franchises/${currentFranchise.toUpperCase()}/${remainder}`,
                    `franchises/${currentFranchise.toLowerCase()}/${remainder}`,
                    remainder,
                ].forEach((item) => all.add(item));
            } else {
                all.add(normalized);
            }
            continue;
        }
        const scoped = toScopedStoragePath(normalized, franchiseId);
        all.add(scoped);
        all.add(normalized);
    }
    return Array.from(all).filter(Boolean);
}

async function resolveStorageDownloadURL(path, franchiseId) {
    const candidates = getStoragePathCandidates(path, franchiseId);
    let lastError = null;
    for (const candidate of candidates) {
        try {
            return await getDownloadURL(ref(storage, candidate));
        } catch (error) {
            lastError = error;
        }
    }
    throw lastError || new Error('Storage file not found');
}

function extractFirebaseStoragePath(urlString) {
    try {
        const url = new URL(urlString);
        if (!url.hostname.includes('firebasestorage.googleapis.com')) return null;
        const match = url.pathname.match(/\/o\/(.+)$/);
        if (!match?.[1]) return null;
        return decodeURIComponent(match[1]);
    } catch {
        return null;
    }
}

function storagePathCandidatesForPhotoRef(input, franchiseId) {
    const raw = normalizePhotoRef(input);
    if (!raw || raw.startsWith('data:')) return [];
    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const storagePath = extractFirebaseStoragePath(raw);
        return storagePath ? getStoragePathCandidates(storagePath, franchiseId) : [];
    }
    return getStoragePathCandidates(raw, franchiseId);
}

function base64ToUint8Array(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function fetchPhotoBytesViaCallable(input, franchiseId) {
    const raw = normalizePhotoRef(input);
    if (!raw || raw.startsWith('data:')) return null;
    try {
        const fn = getFetchPdfPhotoBytesCallable();
        const { data } = await fn({
            photoRef: raw,
            franchiseId: activeFranchiseId(franchiseId),
        });
        if (data?.base64) {
            return base64ToUint8Array(data.base64);
        }
    } catch (err) {
        console.warn('[loadPdfPhotoBytes] server fetch failed', err?.message || err);
    }
    return null;
}

/**
 * Download photo bytes for PDF embed. Tries Firebase SDK first (fast, needs bucket CORS),
 * then Cloud Function fallback when SDK paths fail.
 */
export async function loadPdfPhotoBytes(input, franchiseId = 'CH') {
    const raw = normalizePhotoRef(input);
    if (!raw || raw.startsWith('data:')) return null;

    const candidates = storagePathCandidatesForPhotoRef(raw, franchiseId);
    for (const candidate of candidates) {
        try {
            return await getBytes(ref(storage, candidate));
        } catch {
            /* try next candidate */
        }
    }

    return fetchPhotoBytesViaCallable(raw, franchiseId);
}

function bytesToObjectUrl(bytes) {
    const mime =
        bytes?.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/jpeg';
    const blob = new Blob([bytes], { type: mime });
    return URL.createObjectURL(blob);
}

/**
 * Resolve a damage/checkout photo reference to a fetchable HTTPS URL.
 */
export async function resolvePdfPhotoUrl(input, franchiseId = 'CH') {
    const raw = normalizePhotoRef(input);
    if (!raw) return null;
    if (raw.startsWith('data:')) return raw;

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        const storagePath = extractFirebaseStoragePath(raw);
        if (storagePath) {
            try {
                return await resolveStorageDownloadURL(storagePath, franchiseId);
            } catch {
                return raw;
            }
        }
        return raw;
    }

    return resolveStorageDownloadURL(raw, franchiseId);
}

/**
 * Load photo as data URL for HTML PDF templates (html2canvas-safe, no CORS).
 */
export async function loadPdfPhotoDataUrl(input, franchiseId = 'CH') {
    const raw = normalizePhotoRef(input);
    if (!raw) return null;
    if (raw.startsWith('data:')) return raw;

    const bytes = await loadPdfPhotoBytes(raw, franchiseId);
    if (bytes) {
        const objectUrl = bytesToObjectUrl(bytes);
        try {
            const img = await new Promise((resolve) => {
                const el = new Image();
                el.onload = () => resolve(el);
                el.onerror = () => resolve(null);
                el.src = objectUrl;
            });
            if (!img) return null;
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return canvas.toDataURL('image/jpeg', 0.92);
        } finally {
            URL.revokeObjectURL(objectUrl);
        }
    }

    return null;
}

export async function resolvePdfPhotoUrls(urls, franchiseId = 'CH') {
    const list = Array.isArray(urls) ? urls : [];
    return Promise.all(list.map((item) => resolvePdfPhotoUrl(item, franchiseId)));
}
