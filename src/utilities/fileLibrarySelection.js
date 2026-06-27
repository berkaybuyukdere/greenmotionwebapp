const STORAGE_PREFIX = 'gm_file_library_selection_';

export function loadPersistedSelection(franchiseId) {
    try {
        const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${String(franchiseId || 'CH').toUpperCase()}`);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr.filter(Boolean) : []);
    } catch {
        return new Set();
    }
}

export function persistSelection(franchiseId, selectedIds) {
    try {
        const key = `${STORAGE_PREFIX}${String(franchiseId || 'CH').toUpperCase()}`;
        sessionStorage.setItem(key, JSON.stringify([...selectedIds]));
    } catch {
        /* ignore quota */
    }
}

/** All files under folder (recursive). */
export function collectFilesUnderFolder(folderId, allItems) {
    const files = [];
    const walk = (parentId) => {
        for (const item of allItems) {
            if ((item.parentId || '') !== parentId) continue;
            if (item.type === 'file' && item.storagePath) files.push(item);
            if (item.type === 'folder') walk(item.id);
        }
    };
    walk(folderId);
    return files;
}
