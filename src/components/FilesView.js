import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    collection,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    orderBy,
    serverTimestamp,
    Timestamp,
} from 'firebase/firestore';
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import JSZip from 'jszip';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search,
    FolderPlus,
    Upload,
    ChevronRight,
    Home,
    Download,
    Eye,
    Pencil,
    Trash2,
    X,
    Loader2,
    FileUp,
    FileSpreadsheet,
    CheckSquare,
    Square,
    Archive,
} from 'lucide-react';
import {
    loadPersistedSelection,
    persistSelection,
    collectFilesUnderFolder,
} from '../utilities/fileLibrarySelection';
import { getCollectionRef } from '../utilities/firebaseHelpers';
import { useToast } from './ToastNotification';
import {
    FILE_LIBRARY_CATEGORIES,
    FileTypeIcon,
    avatarColorFromUid,
    buildSearchBlob,
    categoryLabel,
    formatFileSize,
    MAX_FILE_LIBRARY_BYTES,
    userInitials,
} from '../utilities/fileLibraryHelpers';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';

function tsToDate(ts) {
    if (!ts) return null;
    if (ts instanceof Timestamp) return ts.toDate();
    if (typeof ts?.toDate === 'function') return ts.toDate();
    if (typeof ts?.seconds === 'number') return new Date(ts.seconds * 1000);
    return null;
}

function formatWhen(ts) {
    const d = tsToDate(ts);
    if (!d) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function UploadProgressPanel({ queue, onClose }) {
    if (!queue?.length) return null;
    const active = queue.filter((q) => q.status !== 'done' && q.status !== 'error');
    const done = queue.filter((q) => q.status === 'done').length;
    const total = queue.length;
    if (active.length === 0 && done === total) {
        return (
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="fixed bottom-6 right-6 z-[80] w-full max-w-md rounded-2xl border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-xl p-4"
            >
                <div className="flex items-center gap-2 text-[var(--erpx-green)]">
                    <FileUp size={18} />
                    <span className="text-sm font-semibold">{done} file(s) uploaded</span>
                    <button type="button" onClick={onClose} className="ml-auto text-[var(--erpx-ink-muted)] hover:text-[var(--erpx-ink)]">
                        <X size={16} />
                    </button>
                </div>
            </motion.div>
        );
    }
    return (
        <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="fixed bottom-6 right-6 z-[80] w-full max-w-md rounded-2xl border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-2xl overflow-hidden"
        >
            <div className="px-4 py-3 border-b border-[var(--erpx-border)] flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-[var(--erpx-brand)]" />
                <span className="text-sm font-semibold text-[var(--erpx-ink)]">
                    Uploading {done}/{total}
                </span>
            </div>
            <div className="max-h-56 overflow-y-auto p-3 space-y-2">
                {queue.map((item) => (
                    <div key={item.id} className="rounded-xl bg-[var(--erpx-subtle)] p-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span className="text-xs font-medium truncate text-[var(--erpx-ink)]">
                                {item.fileName}
                            </span>
                            <span className="text-[10px] text-[var(--erpx-ink-muted)] tabular-nums shrink-0">
                                {formatFileSize(item.fileSize)}
                            </span>
                        </div>
                        <div className="h-1.5 rounded-full bg-[var(--erpx-border)] overflow-hidden">
                            <motion.div
                                className={`h-full rounded-full ${
                                    item.status === 'error' ? 'bg-[var(--erpx-red)]' : 'bg-[var(--erpx-brand)]'
                                }`}
                                initial={{ width: 0 }}
                                animate={{ width: `${Math.min(100, item.progress || 0)}%` }}
                                transition={{ duration: 0.2 }}
                            />
                        </div>
                        <p className="text-[10px] mt-1 text-[var(--erpx-ink-muted)]">
                            {item.status === 'error'
                                ? item.error || 'Failed'
                                : item.status === 'done'
                                  ? 'Complete'
                                  : `${Math.round(item.progress || 0)}%`}
                        </p>
                    </div>
                ))}
            </div>
        </motion.div>
    );
}

export function FilesView({ db, storage, auth, user, userProfile, franchiseId, onOpenInExcel }) {
    const { success: toastSuccess, error: toastError } = useToast();

    const fid = String(franchiseId || 'CH').trim().toUpperCase();
    const collRef = useMemo(
        () => getCollectionRef(db, 'fileLibrary', user, userProfile, fid),
        [db, user, userProfile, fid]
    );

    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentFolderId, setCurrentFolderId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [uploadQueue, setUploadQueue] = useState([]);
    const [showUploadQueue, setShowUploadQueue] = useState(false);

    const [folderModal, setFolderModal] = useState(null);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);
    const [uploadCategory, setUploadCategory] = useState('other');
    const [preview, setPreview] = useState(null);
    const [editItem, setEditItem] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [busy, setBusy] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => loadPersistedSelection(fid));
    const [bulkProgress, setBulkProgress] = useState(null);

    const fileInputRef = useRef(null);

    useEffect(() => {
        persistSelection(fid, selectedIds);
    }, [fid, selectedIds]);

    const uploaderName = useMemo(() => {
        const fn = userProfile?.firstName || '';
        const ln = userProfile?.lastName || '';
        const full = `${fn} ${ln}`.trim();
        return full || userProfile?.nickname || userProfile?.username || user?.email || 'User';
    }, [userProfile, user]);

    useEffect(() => {
        if (!user) return undefined;
        setLoading(true);
        const q = query(collRef, orderBy('updatedAt', 'desc'));
        const unsub = onSnapshot(
            q,
            (snap) => {
                const rows = snap.docs.map((d) => {
                    const data = d.data() || {};
                    return {
                        id: d.id,
                        ...data,
                        searchBlob: buildSearchBlob({ ...data, type: data.type }),
                    };
                });
                setItems(rows.filter((r) => String(r.franchiseId || '').toUpperCase() === fid));
                setLoading(false);
            },
            (err) => {
                console.error('[FilesView] listener', err);
                setLoading(false);
                toastError(err?.message || 'Could not load files');
            }
        );
        return () => unsub();
    }, [collRef, fid, user]);

    const folderById = useMemo(() => {
        const m = new Map();
        items.filter((i) => i.type === 'folder').forEach((f) => m.set(f.id, f));
        return m;
    }, [items]);

    const breadcrumb = useMemo(() => {
        const trail = [];
        let id = currentFolderId;
        let guard = 0;
        while (id && guard < 20) {
            const f = folderById.get(id);
            if (!f) break;
            trail.unshift(f);
            id = f.parentId || '';
            guard += 1;
        }
        return trail;
    }, [currentFolderId, folderById]);

    const normalizedSearch = searchQuery.trim().toLowerCase();

    const visibleItems = useMemo(() => {
        if (normalizedSearch) {
            return items.filter((item) => item.searchBlob?.includes(normalizedSearch));
        }
        const pid = currentFolderId || '';
        return items.filter((item) => (item.parentId || '') === pid);
    }, [items, currentFolderId, normalizedSearch]);

    const foldersInView = useMemo(
        () => visibleItems.filter((i) => i.type === 'folder').sort((a, b) => (a.name || '').localeCompare(b.name || '')),
        [visibleItems]
    );
    const filesInView = useMemo(
        () =>
            visibleItems
                .filter((i) => i.type === 'file')
                .sort(
                    (a, b) =>
                        (tsToDate(b.updatedAt)?.getTime() || 0) - (tsToDate(a.updatedAt)?.getTime() || 0)
                ),
        [visibleItems]
    );

    const folderPathLabel = (item) => {
        if (!item?.parentId) return 'Files';
        const parts = [];
        let id = item.parentId;
        let g = 0;
        while (id && g < 12) {
            const f = folderById.get(id);
            if (!f) break;
            parts.unshift(f.name);
            id = f.parentId || '';
            g += 1;
        }
        return parts.length ? parts.join(' / ') : 'Files';
    };

    const storagePathFor = (parentId, docId, fileName) => {
        const safeParent = parentId || '_root';
        const safeName = String(fileName || 'file').replace(/[/\\#?]/g, '_');
        return `franchises/${fid}/fileLibrary/${safeParent}/${docId}_${safeName}`;
    };

    const saveFolder = async ({ name, note, editingId }) => {
        const nm = String(name || '').trim();
        if (!nm) {
            toastError('Folder name is required');
            return;
        }
        setBusy(true);
        try {
            const existing = editingId ? items.find((i) => i.id === editingId) : null;
            const payload = {
                franchiseId: fid,
                type: 'folder',
                name: nm,
                note: String(note || '').trim(),
                parentId: existing?.parentId ?? (currentFolderId || ''),
                searchBlob: `${nm} ${note || ''}`.toLowerCase(),
                updatedAt: serverTimestamp(),
            };
            if (editingId) {
                await updateDoc(doc(collRef, editingId), {
                    name: payload.name,
                    note: payload.note,
                    searchBlob: payload.searchBlob,
                    updatedAt: payload.updatedAt,
                });
                toastSuccess('Folder updated');
            } else {
                await addDoc(collRef, {
                    ...payload,
                    createdAt: serverTimestamp(),
                    createdByUid: user?.uid || null,
                    createdByName: uploaderName,
                });
                toastSuccess('Folder created');
            }
            setFolderModal(null);
        } catch (e) {
            toastError(e?.message || 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const runUploads = async (fileList) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        const oversized = files.find((f) => f.size > MAX_FILE_LIBRARY_BYTES);
        if (oversized) {
            toastError(`"${oversized.name}" exceeds ${formatFileSize(MAX_FILE_LIBRARY_BYTES)} limit`);
            return;
        }

        setUploadModalOpen(false);
        setShowUploadQueue(true);
        const queue = files.map((f, idx) => ({
            id: `${Date.now()}-${idx}`,
            fileName: f.name,
            fileSize: f.size,
            progress: 0,
            status: 'pending',
        }));
        setUploadQueue(queue);

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const qid = queue[i].id;
            setUploadQueue((prev) =>
                prev.map((q) => (q.id === qid ? { ...q, status: 'uploading', progress: 2 } : q))
            );
            try {
                const docRef = await addDoc(collRef, {
                    franchiseId: fid,
                    type: 'file',
                    parentId: currentFolderId || '',
                    name: file.name,
                    fileName: file.name,
                    category: uploadCategory,
                    mimeType: file.type || '',
                    sizeBytes: file.size,
                    note: '',
                    storagePath: '',
                    uploadedByUid: user?.uid || null,
                    uploadedByName: uploaderName,
                    uploadedByEmail: user?.email || '',
                    searchBlob: `${file.name} ${categoryLabel(uploadCategory)} ${uploaderName}`.toLowerCase(),
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                });
                const path = storagePathFor(currentFolderId, docRef.id, file.name);
                const storageRef = ref(storage, path);
                await new Promise((resolve, reject) => {
                    const task = uploadBytesResumable(storageRef, file, {
                        contentType: file.type || undefined,
                    });
                    task.on(
                        'state_changed',
                        (snap) => {
                            const pct = snap.totalBytes
                                ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100)
                                : 0;
                            setUploadQueue((prev) =>
                                prev.map((q) =>
                                    q.id === qid ? { ...q, progress: pct, status: 'uploading' } : q
                                )
                            );
                        },
                        reject,
                        resolve
                    );
                });
                await updateDoc(docRef, {
                    storagePath: path,
                    updatedAt: serverTimestamp(),
                });
                setUploadQueue((prev) =>
                    prev.map((q) => (q.id === qid ? { ...q, progress: 100, status: 'done' } : q))
                );
            } catch (e) {
                console.error('[FilesView] upload', e);
                setUploadQueue((prev) =>
                    prev.map((q) =>
                        q.id === qid ? { ...q, status: 'error', error: e?.message || 'Upload failed' } : q
                    )
                );
            }
        }
        toastSuccess('Upload finished');
    };

    const openPreview = async (fileItem) => {
        if (!fileItem?.storagePath) {
            toastError('File path missing');
            return;
        }
        setBusy(true);
        try {
            const url = await getDownloadURL(ref(storage, fileItem.storagePath));
            setPreview({ ...fileItem, url });
        } catch (e) {
            toastError(e?.message || 'Preview failed');
        } finally {
            setBusy(false);
        }
    };

    const downloadFile = async (fileItem) => {
        if (!fileItem?.storagePath) return;
        setBusy(true);
        try {
            const url = await getDownloadURL(ref(storage, fileItem.storagePath));
            const a = document.createElement('a');
            a.href = url;
            a.download = fileItem.fileName || fileItem.name || 'download';
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        } catch (e) {
            toastError(e?.message || 'Download failed');
        } finally {
            setBusy(false);
        }
    };

    const itemById = useMemo(() => {
        const m = new Map();
        items.forEach((i) => m.set(i.id, i));
        return m;
    }, [items]);

    const resolveFilesForIds = useCallback(
        (ids) => {
            const fileMap = new Map();
            for (const id of ids) {
                const item = itemById.get(id);
                if (!item) continue;
                if (item.type === 'file' && item.storagePath) fileMap.set(item.id, item);
                if (item.type === 'folder') {
                    for (const f of collectFilesUnderFolder(item.id, items)) {
                        if (f.storagePath) fileMap.set(f.id, f);
                    }
                }
            }
            return [...fileMap.values()];
        },
        [itemById, items]
    );

    const selectedFileCount = useMemo(
        () => resolveFilesForIds(selectedIds).length,
        [selectedIds, resolveFilesForIds]
    );

    const toggleSelected = (id) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAllVisible = () => {
        const ids = [...foldersInView, ...filesInView].map((i) => i.id);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
        });
    };

    const clearSelection = () => setSelectedIds(new Set());

    const downloadFilesAsZip = async (filesToZip, zipName) => {
        if (!filesToZip.length) {
            toastError('No files to download');
            return;
        }
        setBusy(true);
        setBulkProgress({ done: 0, total: filesToZip.length });
        try {
            const zip = new JSZip();
            let done = 0;
            for (const fileItem of filesToZip) {
                const url = await getDownloadURL(ref(storage, fileItem.storagePath));
                const res = await fetch(url);
                const blob = await res.blob();
                const name = String(fileItem.fileName || fileItem.name || `file-${fileItem.id}`).replace(
                    /[/\\]/g,
                    '_'
                );
                zip.file(name, blob);
                done += 1;
                setBulkProgress({ done, total: filesToZip.length });
            }
            const zipBlob = await zip.generateAsync({ type: 'blob' }, (meta) => {
                setBulkProgress({ done: filesToZip.length, total: filesToZip.length, percent: meta.percent });
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(zipBlob);
            a.download = zipName.endsWith('.zip') ? zipName : `${zipName}.zip`;
            a.click();
            URL.revokeObjectURL(a.href);
            toastSuccess(`Downloaded ${filesToZip.length} file(s)`);
        } catch (e) {
            toastError(e?.message || 'Download failed');
        } finally {
            setBusy(false);
            setBulkProgress(null);
        }
    };

    const bulkDownloadSelected = () => {
        const filesToZip = resolveFilesForIds(selectedIds);
        const name = `files-selection-${new Date().toISOString().slice(0, 10)}`;
        downloadFilesAsZip(filesToZip, name);
    };

    const downloadFolderZip = (folder) => {
        const filesToZip = collectFilesUnderFolder(folder.id, items);
        if (!filesToZip.length) {
            toastError('This folder has no files to download');
            return;
        }
        const safeName = String(folder.name || 'folder').replace(/[/\\?%*:|"<>]/g, '_');
        downloadFilesAsZip(filesToZip, safeName);
    };

    const saveEdit = async () => {
        if (!editItem?.id) return;
        const nm = String(editItem.name || '').trim();
        if (!nm) {
            toastError('Name is required');
            return;
        }
        setBusy(true);
        try {
            const payload = {
                name: nm,
                note: String(editItem.note || '').trim(),
                updatedAt: serverTimestamp(),
            };
            if (editItem.type === 'file') {
                payload.category = editItem.category || 'other';
                payload.searchBlob = `${nm} ${editItem.fileName || ''} ${categoryLabel(payload.category)} ${editItem.uploadedByName || ''} ${payload.note}`.toLowerCase();
            } else {
                payload.searchBlob = `${nm} ${payload.note}`.toLowerCase();
            }
            await updateDoc(doc(collRef, editItem.id), payload);
            toastSuccess('Saved');
            setEditItem(null);
        } catch (e) {
            toastError(e?.message || 'Save failed');
        } finally {
            setBusy(false);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget?.id) return;
        setBusy(true);
        try {
            if (deleteTarget.type === 'folder') {
                const hasChildren = items.some((i) => (i.parentId || '') === deleteTarget.id);
                if (hasChildren) {
                    toastError('Remove or move items inside this folder first');
                    setBusy(false);
                    return;
                }
            }
            if (deleteTarget.type === 'file' && deleteTarget.storagePath) {
                try {
                    await deleteObject(ref(storage, deleteTarget.storagePath));
                } catch (e) {
                    console.warn('[FilesView] storage delete', e);
                }
            }
            await deleteDoc(doc(collRef, deleteTarget.id));
            toastSuccess('Deleted');
            setDeleteTarget(null);
            if (preview?.id === deleteTarget.id) setPreview(null);
        } catch (e) {
            toastError(e?.message || 'Delete failed');
        } finally {
            setBusy(false);
        }
    };

    const Row = ({ item }) => {
        const isFolder = item.type === 'folder';
        const isSelected = selectedIds.has(item.id);
        const subCount = isFolder
            ? items.filter((i) => (i.parentId || '') === item.id).length
            : 0;
        const folderFileCount = isFolder ? collectFilesUnderFolder(item.id, items).length : 0;

        return (
            <div
                className={`group flex items-center gap-3 px-4 py-3 border-b border-black/[0.06] dark:border-white/[0.06] hover:bg-[#f9f9f9] dark:hover:bg-[#2c2c2e]/60 transition-colors ${
                    isSelected ? 'bg-[var(--erpx-brand)]/10' : ''
                }`}
            >
                <button
                    type="button"
                    onClick={() => toggleSelected(item.id)}
                    className="shrink-0 p-1 rounded-md hover:bg-black/[0.06]"
                    title={isSelected ? 'Deselect' : 'Select'}
                >
                    {isSelected ? (
                        <CheckSquare size={20} className="text-[var(--erpx-brand)]" />
                    ) : (
                        <Square size={20} className="text-[var(--erpx-ink-muted)]" />
                    )}
                </button>
                <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                        isFolder ? 'bg-[var(--erpx-brand)]/12' : 'bg-[var(--erpx-subtle)]'
                    }`}
                >
                    <FileTypeIcon
                        type={item.type}
                        name={item.fileName || item.name}
                        mimeType={item.mimeType}
                        size={22}
                    />
                </div>
                <div className="flex-1 min-w-0">
                    {normalizedSearch && (
                        <p className="text-[10px] text-[#8E8E93] mb-0.5 truncate">{folderPathLabel(item)}</p>
                    )}
                    <button
                        type="button"
                        className="text-left w-full"
                        onClick={() => {
                            if (isFolder) {
                                setSearchQuery('');
                                setCurrentFolderId(item.id);
                            }
                        }}
                    >
                        <p className="text-[14px] font-semibold text-[#1d1d1f] dark:text-white truncate">
                            {item.name}
                            {isFolder && subCount > 0 && (
                                <span className="ml-2 text-[11px] font-normal text-[#8E8E93]">
                                    {subCount} item{subCount !== 1 ? 's' : ''}
                                </span>
                            )}
                        </p>
                    </button>
                    {item.note ? (
                        <p className="text-[12px] text-[#6e6e73] dark:text-[#98989d] truncate mt-0.5">{item.note}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                        {item.type === 'file' && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[var(--erpx-brand)]/12 text-[var(--erpx-brand)]">
                                {categoryLabel(item.category)}
                            </span>
                        )}
                        {item.type === 'file' && (
                            <span className="text-[10px] text-[#8E8E93] tabular-nums">
                                {formatFileSize(item.sizeBytes)}
                            </span>
                        )}
                        <span className="text-[10px] text-[#8E8E93]">{formatWhen(item.updatedAt || item.createdAt)}</span>
                    </div>
                </div>
                {item.uploadedByName && (
                    <div className="hidden sm:flex items-center gap-2 shrink-0 max-w-[140px]">
                        <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                            style={{ backgroundColor: avatarColorFromUid(item.uploadedByUid) }}
                            title={item.uploadedByEmail || item.uploadedByName}
                        >
                            {userInitials(item.uploadedByName, item.uploadedByEmail)}
                        </div>
                        <span className="text-[11px] text-[#3c3c43] dark:text-[#ebebf5] truncate">
                            {item.uploadedByName}
                        </span>
                    </div>
                )}
                <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    {item.type === 'file' && (
                        <>
                            {(item.mimeType?.includes('pdf') ||
                                String(item.fileName || item.name || '').toLowerCase().endsWith('.pdf')) && (
                                <button
                                    type="button"
                                    title="Preview"
                                    onClick={() => openPreview(item)}
                                    className="p-2 rounded-lg hover:bg-[var(--erpx-brand)]/10 text-[var(--erpx-brand)]"
                                >
                                    <Eye size={16} />
                                </button>
                            )}
                            <button
                                type="button"
                                title="Download"
                                onClick={() => downloadFile(item)}
                                className="p-2 rounded-lg hover:bg-[var(--erpx-green)]/10 text-[var(--erpx-green)]"
                            >
                                <Download size={16} />
                            </button>
                            {onOpenInExcel &&
                                /\.(xlsx|xls|csv)$/i.test(String(item.fileName || item.name || '')) && (
                                    <button
                                        type="button"
                                        title="Open in Excel"
                                        onClick={() =>
                                            onOpenInExcel({
                                                type: 'storage',
                                                storagePath: item.storagePath,
                                                name: item.fileName || item.name,
                                            })
                                        }
                                        className="p-2 rounded-lg hover:bg-[var(--erpx-green)]/15 text-[var(--erpx-green)]"
                                    >
                                        <FileSpreadsheet size={16} />
                                    </button>
                                )}
                        </>
                    )}
                    <button
                        type="button"
                        title="Edit"
                        onClick={() => {
                            if (isFolder) {
                                setFolderModal({
                                    mode: 'edit',
                                    editingId: item.id,
                                    name: item.name,
                                    note: item.note,
                                });
                            } else {
                                setEditItem({ ...item });
                            }
                        }}
                        className="p-2 rounded-lg hover:bg-black/[0.06] text-[#6e6e73]"
                    >
                        <Pencil size={16} />
                    </button>
                    <button
                        type="button"
                        title="Delete"
                        onClick={() => setDeleteTarget(item)}
                        className="p-2 rounded-lg hover:bg-[var(--erpx-red)]/10 text-[var(--erpx-red)]"
                    >
                        <Trash2 size={16} />
                    </button>
                    {isFolder && folderFileCount > 0 && (
                        <button
                            type="button"
                            title="Download folder as ZIP"
                            onClick={() => downloadFolderZip(item)}
                            className="p-2 rounded-lg hover:bg-[var(--erpx-amber)]/10 text-[var(--erpx-amber)]"
                        >
                            <Archive size={16} />
                        </button>
                    )}
                    {isFolder && (
                        <button
                            type="button"
                            title="Open folder"
                            onClick={() => {
                                setSearchQuery('');
                                setCurrentFolderId(item.id);
                            }}
                            className="p-2 rounded-lg hover:bg-[var(--erpx-brand)]/10 text-[var(--erpx-brand)]"
                        >
                            <ChevronRight size={16} />
                        </button>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="pal-files-page w-full pb-10 space-y-5">
            <div className="erpx-page-header pal-ops-header !mb-0 pb-4 border-b border-[var(--erpx-border)]">
                <h1 className="erpx-page-title flex items-center gap-2">
                    <PalantirPageIcon navKey="files" />
                    Files
                </h1>
                <p className="erpx-page-subtitle mt-1">
                    Franchise document library · {fid}
                </p>
            </div>

            <div className="pal-dash-panel">
                <div className="pal-dash-panel-body padded">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--erpx-ink-muted)]" />
                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search files, folders, notes, categories, uploaders..."
                                className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-[14px] text-[var(--erpx-ink)]"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={() => setFolderModal({ mode: 'create' })}
                            className="pal-btn"
                        >
                            <FolderPlus size={16} />
                            New folder
                        </button>
                        <button
                            type="button"
                            onClick={() => setUploadModalOpen(true)}
                            className="pal-btn pal-btn-primary"
                        >
                            <Upload size={16} />
                            Upload
                        </button>
                    </div>
                </div>
            </div>

            {(selectedIds.size > 0 || bulkProgress) && (
                <div className="pal-dash-panel">
                    <div className="pal-dash-panel-body padded flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold text-[var(--erpx-brand)]">
                        {selectedIds.size} selected
                        {selectedFileCount !== selectedIds.size
                            ? ` (${selectedFileCount} file${selectedFileCount !== 1 ? 's' : ''})`
                            : ''}
                    </span>
                    <button
                        type="button"
                        onClick={bulkDownloadSelected}
                        disabled={busy || selectedFileCount === 0}
                        className="pal-btn pal-btn-primary disabled:opacity-50"
                    >
                        <Download size={14} />
                        Download ZIP
                    </button>
                    <button
                        type="button"
                        onClick={selectAllVisible}
                        className="pal-btn"
                    >
                        Add all in view
                    </button>
                    <button
                        type="button"
                        onClick={clearSelection}
                        className="pal-btn"
                    >
                        Clear
                    </button>
                    {bulkProgress && (
                        <span className="text-[11px] text-[var(--erpx-ink-muted)] tabular-nums ml-auto">
                            {bulkProgress.percent != null
                                ? `${Math.round(bulkProgress.percent)}%`
                                : `${bulkProgress.done}/${bulkProgress.total}`}
                        </span>
                    )}
                    </div>
                </div>
            )}

            {!normalizedSearch && (
                <nav className="flex flex-wrap items-center gap-1 text-[13px] text-[var(--erpx-ink-muted)]">
                    <button
                        type="button"
                        onClick={() => setCurrentFolderId('')}
                        className="inline-flex items-center gap-1 hover:text-[var(--erpx-brand)] font-medium"
                    >
                        <Home size={14} />
                        Files
                    </button>
                    {breadcrumb.map((f) => (
                        <React.Fragment key={f.id}>
                            <ChevronRight size={14} className="opacity-50" />
                            <button
                                type="button"
                                onClick={() => setCurrentFolderId(f.id)}
                                className="hover:text-[var(--erpx-brand)] font-medium truncate max-w-[160px]"
                            >
                                {f.name}
                            </button>
                        </React.Fragment>
                    ))}
                </nav>
            )}

            <div className="pal-dash-panel overflow-hidden">
                {loading ? (
                    <div className="py-16 flex justify-center">
                        <Loader2 className="animate-spin text-[var(--erpx-brand)]" size={28} />
                    </div>
                ) : foldersInView.length === 0 && filesInView.length === 0 ? (
                    <div className="py-16 text-center px-6">
                        <p className="text-[var(--erpx-ink-muted)] text-sm">
                            {normalizedSearch ? 'No matches for your search.' : 'This folder is empty. Create a folder or upload files.'}
                        </p>
                    </div>
                ) : (
                    <>
                        {foldersInView.map((item) => (
                            <Row key={item.id} item={item} />
                        ))}
                        {filesInView.map((item) => (
                            <Row key={item.id} item={item} />
                        ))}
                    </>
                )}
            </div>

            {showUploadQueue && (
                <UploadProgressPanel queue={uploadQueue} onClose={() => setShowUploadQueue(false)} />
            )}

            {folderModal && (
                <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setFolderModal(null)}>
                    <div className="w-full max-w-md rounded-2xl bg-[var(--erpx-surface)] border border-[var(--erpx-border)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">
                            {folderModal.mode === 'edit' ? 'Edit folder' : 'New folder'}
                        </h3>
                        <FolderForm
                            initial={{
                                name: folderModal.name,
                                note: folderModal.note,
                                editingId: folderModal.mode === 'edit' ? folderModal.editingId : undefined,
                            }}
                            busy={busy}
                            onCancel={() => setFolderModal(null)}
                            onSave={saveFolder}
                        />
                    </div>
                </div>
            )}

            {uploadModalOpen && (
                <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => setUploadModalOpen(false)}>
                    <div className="w-full max-w-md rounded-2xl bg-[var(--erpx-surface)] border border-[var(--erpx-border)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-1">Upload files</h3>
                        <p className="text-xs text-[var(--erpx-ink-muted)] mb-4">
                            PDF, Word, Excel, ZIP, images · max {formatFileSize(MAX_FILE_LIBRARY_BYTES)} each
                        </p>
                        <label className="block text-xs font-medium mb-1">Category</label>
                        <select
                            value={uploadCategory}
                            onChange={(e) => setUploadCategory(e.target.value)}
                            className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        >
                            {FILE_LIBRARY_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.zip,.png,.jpg,.jpeg,.webp"
                            onChange={(e) => {
                                runUploads(e.target.files);
                                e.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="w-full py-8 rounded-lg border-2 border-dashed border-[var(--erpx-brand)]/40 hover:bg-[var(--erpx-brand)]/8 flex flex-col items-center gap-2 text-[var(--erpx-brand)] font-semibold"
                        >
                            <Upload size={24} />
                            Choose files
                        </button>
                        <button type="button" onClick={() => setUploadModalOpen(false)} className="pal-btn w-full mt-3">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {editItem && (
                <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setEditItem(null)}>
                    <div className="w-full max-w-md rounded-2xl bg-[var(--erpx-surface)] border border-[var(--erpx-border)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-4">Edit {editItem.type === 'folder' ? 'folder' : 'file'}</h3>
                        <label className="block text-xs font-medium mb-1">Name</label>
                        <input
                            value={editItem.name || ''}
                            onChange={(e) => setEditItem((p) => ({ ...p, name: e.target.value }))}
                            className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        />
                        {editItem.type === 'file' && (
                            <>
                                <label className="block text-xs font-medium mb-1">Category</label>
                                <select
                                    value={editItem.category || 'other'}
                                    onChange={(e) => setEditItem((p) => ({ ...p, category: e.target.value }))}
                                    className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                                >
                                    {FILE_LIBRARY_CATEGORIES.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.label}
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}
                        <label className="block text-xs font-medium mb-1">Note</label>
                        <textarea
                            value={editItem.note || ''}
                            onChange={(e) => setEditItem((p) => ({ ...p, note: e.target.value }))}
                            rows={3}
                            className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        />
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setEditItem(null)} className="pal-btn flex-1">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={saveEdit}
                                className="pal-btn pal-btn-primary flex-1 disabled:opacity-50"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setDeleteTarget(null)}>
                    <div className="w-full max-w-sm rounded-2xl bg-[var(--erpx-surface)] border border-[var(--erpx-border)] p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-lg font-semibold mb-2">Delete {deleteTarget.type}?</h3>
                        <p className="text-sm text-[var(--erpx-ink-muted)] mb-4 truncate">{deleteTarget.name}</p>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setDeleteTarget(null)} className="pal-btn flex-1">
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={busy}
                                onClick={confirmDelete}
                                className="pal-btn pal-btn-danger flex-1 disabled:opacity-50"
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {preview && (
                <div className="fixed inset-0 z-[75] bg-black/60 flex flex-col" onClick={() => setPreview(null)}>
                    <div className="flex items-center justify-between px-4 py-3 bg-[#1c1c1e] text-white" onClick={(e) => e.stopPropagation()}>
                        <span className="text-sm font-medium truncate">{preview.name}</span>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => downloadFile(preview)} className="p-2 rounded-lg hover:bg-white/10">
                                <Download size={18} />
                            </button>
                            <button type="button" onClick={() => setPreview(null)} className="p-2 rounded-lg hover:bg-white/10">
                                <X size={18} />
                            </button>
                        </div>
                    </div>
                    <div className="flex-1 bg-[#525252] p-2" onClick={(e) => e.stopPropagation()}>
                        <iframe title="PDF preview" src={preview.url} className="w-full h-full rounded-lg bg-white" />
                    </div>
                </div>
            )}
        </div>
    );
}

function FolderForm({ initial, busy, onCancel, onSave }) {
    const [name, setName] = useState(initial?.name || '');
    const [note, setNote] = useState(initial?.note || '');
    return (
        <>
            <label className="block text-xs font-medium mb-1">Folder name</label>
            <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                autoFocus
            />
            <label className="block text-xs font-medium mb-1">Note (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm" />
            <div className="flex gap-2">
                <button type="button" onClick={onCancel} className="pal-btn flex-1">
                    Cancel
                </button>
                <button
                    type="button"
                    disabled={busy}
                    onClick={() => onSave({ name, note, editingId: initial?.editingId })}
                    className="pal-btn pal-btn-primary flex-1 disabled:opacity-50"
                >
                    Save
                </button>
            </div>
        </>
    );
}
