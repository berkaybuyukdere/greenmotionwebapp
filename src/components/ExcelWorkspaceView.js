import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    addDoc,
    deleteDoc,
    deleteField,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
} from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { Workbook } from '@fortune-sheet/react';
import '@fortune-sheet/react/dist/index.css';
import {
    FortuneExcelHelper,
    importToolBarItem,
    exportToolBarItem,
    transformFortuneToExcel,
    transformExcelToFortune,
} from '@corbe30/fortune-excel';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FileSpreadsheet,
    FolderOpen,
    Save,
    Download,
    FilePlus2,
    CloudUpload,
    Loader2,
    Trash2,
    X,
    Eye,
    FolderInput,
} from 'lucide-react';
import { getCollectionRef } from '../utilities/firebaseHelpers';
import { useToast } from './ToastNotification';
import {
    FILE_LIBRARY_CATEGORIES,
    formatFileSize,
    MAX_FILE_LIBRARY_BYTES,
    isSpreadsheetLibraryFile,
} from '../utilities/fileLibraryHelpers';
import { uploadBlobToFileLibrary } from '../utilities/fileLibraryUpload';
import { patchFortuneSheetLocale } from '../utilities/patchFortuneSheetLocale';
import {
    sheetsFromFirestoreDoc,
    sheetsToFirestorePayload,
} from '../utilities/excelWorkbookFirestore';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';

const DEFAULT_SHEETS = [
    {
        name: 'Sheet1',
        status: 1,
        order: 0,
        row: 84,
        column: 60,
        showGridLines: 1,
        celldata: [],
        config: { columnlen: {}, rowlen: {} },
    },
];

function draftTitleFromSheets(sheets) {
    const first = sheets?.[0]?.name;
    return first && first !== 'Sheet1' ? first : 'Workbook';
}

export function ExcelWorkspaceView({
    db,
    storage,
    user,
    userProfile,
    franchiseId,
    bootstrap,
    onBootstrapConsumed,
    onSavedToFiles,
}) {
    const { success: toastSuccess, error: toastError } = useToast();
    const fid = String(franchiseId || 'CH').trim().toUpperCase();
    const fileCollRef = useMemo(
        () => getCollectionRef(db, 'fileLibrary', user, userProfile, fid),
        [db, user, userProfile, fid]
    );
    const draftCollRef = useMemo(
        () => getCollectionRef(db, 'excelWorkbooks', user, userProfile, fid),
        [db, user, userProfile, fid]
    );

    const sheetRef = useRef(null);
    const sheetPanelRef = useRef(null);
    const contextMenuRef = useRef(null);
    const [workbookKey, setWorkbookKey] = useState(0);
    const [sheets, setSheets] = useState(DEFAULT_SHEETS);
    const [docTitle, setDocTitle] = useState('Untitled workbook');
    const [activeDraftId, setActiveDraftId] = useState(null);
    const [activeLibraryFileId, setActiveLibraryFileId] = useState(null);
    const [drafts, setDrafts] = useState([]);
    const [libraryFiles, setLibraryFiles] = useState([]);
    const [folders, setFolders] = useState([]);
    const [loadingBootstrap, setLoadingBootstrap] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveToFilesOpen, setSaveToFilesOpen] = useState(false);
    const [saveFileName, setSaveFileName] = useState('');
    const [saveCategory, setSaveCategory] = useState('calculation');
    const [saveFolderId, setSaveFolderId] = useState('');
    const [saveNote, setSaveNote] = useState('');
    const [saveProgress, setSaveProgress] = useState(0);
    const [contextMenu, setContextMenu] = useState(null);
    const [previewReadOnly, setPreviewReadOnly] = useState(false);

    const uploaderName = useMemo(() => {
        const fn = userProfile?.firstName || '';
        const ln = userProfile?.lastName || '';
        const full = `${fn} ${ln}`.trim();
        return full || userProfile?.nickname || userProfile?.username || user?.email || 'User';
    }, [userProfile, user]);

    useEffect(() => {
        patchFortuneSheetLocale();
    }, []);

    useEffect(() => {
        if (!user) return undefined;
        const unsubFiles = onSnapshot(query(fileCollRef, orderBy('updatedAt', 'desc')), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            const inFranchise = rows.filter(
                (r) => String(r.franchiseId || '').toUpperCase() === fid
            );
            setFolders(inFranchise.filter((r) => r.type === 'folder'));
            setLibraryFiles(
                inFranchise.filter((r) => r.type === 'file' && isSpreadsheetLibraryFile(r))
            );
        });
        const unsubDrafts = onSnapshot(
            query(draftCollRef, orderBy('updatedAt', 'desc')),
            (snap) => {
                const rows = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((r) => r.userId === user.uid);
                setDrafts(rows);
            },
            (err) => console.warn('[Excel] drafts', err?.message)
        );
        return () => {
            unsubFiles();
            unsubDrafts();
        };
    }, [fileCollRef, draftCollRef, fid, user]);

    useEffect(() => {
        const closeMenu = (e) => {
            if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
                setContextMenu(null);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setContextMenu(null);
        };
        document.addEventListener('mousedown', closeMenu);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', closeMenu);
            document.removeEventListener('keydown', onKey);
        };
    }, []);

    const loadFromStorage = useCallback(
        async (fileItem, { preview = false } = {}) => {
            if (!fileItem?.storagePath) {
                toastError('File has no storage path');
                return;
            }
            setLoadingBootstrap(true);
            try {
                const url = await getDownloadURL(ref(storage, fileItem.storagePath));
                const res = await fetch(url);
                const blob = await res.blob();
                const fname = fileItem.fileName || fileItem.name || 'imported.xlsx';
                const file = new File([blob], fname, {
                    type:
                        blob.type ||
                        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                });
                await transformExcelToFortune(file, setSheets, setWorkbookKey, sheetRef);
                const title = fname.replace(/\.(xlsx|xls|csv)$/i, '');
                setDocTitle(title);
                setActiveDraftId(null);
                setActiveLibraryFileId(fileItem.id);
                setPreviewReadOnly(preview);
                setWorkbookKey((k) => k + 1);
                toastSuccess(preview ? 'Preview loaded (read-only)' : 'File loaded');
            } catch (e) {
                toastError(e?.message || 'Could not open file');
            } finally {
                setLoadingBootstrap(false);
            }
        },
        [storage, toastError, toastSuccess]
    );

    const downloadLibraryFile = useCallback(
        async (fileItem) => {
            if (!fileItem?.storagePath) {
                toastError('File has no storage path');
                return;
            }
            try {
                const url = await getDownloadURL(ref(storage, fileItem.storagePath));
                const a = document.createElement('a');
                a.href = url;
                a.download = fileItem.fileName || fileItem.name || 'download.xlsx';
                a.rel = 'noopener';
                a.click();
                toastSuccess('Download started');
            } catch (e) {
                toastError(e?.message || 'Download failed');
            }
        },
        [storage, toastError, toastSuccess]
    );

    const applyBootstrap = useCallback(async () => {
        if (!bootstrap) return;
        setLoadingBootstrap(true);
        try {
            if (bootstrap.type === 'sheets' && Array.isArray(bootstrap.sheets)) {
                setSheets(bootstrap.sheets);
                setWorkbookKey((k) => k + 1);
                setDocTitle(bootstrap.title || draftTitleFromSheets(bootstrap.sheets));
                setPreviewReadOnly(false);
            } else if (bootstrap.type === 'storage' && bootstrap.storagePath) {
                await loadFromStorage(
                    {
                        storagePath: bootstrap.storagePath,
                        fileName: bootstrap.name,
                        name: bootstrap.name,
                    },
                    { preview: false }
                );
            } else if (bootstrap.type === 'draft' && bootstrap.draftId) {
                const d = drafts.find((x) => x.id === bootstrap.draftId);
                const restored = sheetsFromFirestoreDoc(d);
                if (restored) {
                    setSheets(restored);
                    setWorkbookKey((k) => k + 1);
                    setDocTitle(d.title || 'Workbook');
                    setActiveDraftId(d.id);
                    setActiveLibraryFileId(null);
                    setPreviewReadOnly(false);
                }
            }
        } catch (e) {
            toastError(e?.message || 'Could not open file');
        } finally {
            setLoadingBootstrap(false);
            onBootstrapConsumed?.();
        }
    }, [bootstrap, drafts, loadFromStorage, onBootstrapConsumed, toastError]);

    useEffect(() => {
        applyBootstrap();
    }, [bootstrap]);

    useEffect(() => {
        const el = sheetPanelRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const notifyResize = () => window.dispatchEvent(new Event('resize'));
        const ro = new ResizeObserver(() => {
            notifyResize();
        });
        ro.observe(el);
        const t1 = window.setTimeout(notifyResize, 80);
        const t2 = window.setTimeout(notifyResize, 400);
        return () => {
            ro.disconnect();
            window.clearTimeout(t1);
            window.clearTimeout(t2);
        };
    }, [workbookKey]);

    const handleChange = useCallback(
        (data) => {
            if (!previewReadOnly) setSheets(data);
        },
        [previewReadOnly]
    );

    const openContextMenu = (e, item, kind) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            item,
            kind,
        });
    };

    const newWorkbook = () => {
        setSheets(DEFAULT_SHEETS);
        setWorkbookKey((k) => k + 1);
        setDocTitle('Untitled workbook');
        setActiveDraftId(null);
        setActiveLibraryFileId(null);
        setPreviewReadOnly(false);
    };

    const saveDraft = async () => {
        if (!user?.uid) return;
        setSaving(true);
        try {
            const payload = {
                franchiseId: fid,
                userId: user.uid,
                title: docTitle.trim() || 'Workbook',
                ...sheetsToFirestorePayload(sheets),
                sheets: deleteField(),
                updatedAt: serverTimestamp(),
            };
            if (activeDraftId) {
                await setDoc(doc(draftCollRef, activeDraftId), payload, { merge: true });
            } else {
                const { sheets: _omit, ...createPayload } = payload;
                const refDoc = await addDoc(draftCollRef, {
                    ...createPayload,
                    createdAt: serverTimestamp(),
                });
                setActiveDraftId(refDoc.id);
            }
            toastSuccess('Draft saved');
        } catch (e) {
            toastError(e?.message || 'Draft save failed');
        } finally {
            setSaving(false);
        }
    };

    const loadDraft = (d) => {
        const restored = sheetsFromFirestoreDoc(d);
        if (!restored) return;
        setSheets(restored);
        setWorkbookKey((k) => k + 1);
        setDocTitle(d.title || 'Workbook');
        setActiveDraftId(d.id);
        setActiveLibraryFileId(null);
        setPreviewReadOnly(false);
        toastSuccess('Draft opened');
    };

    const deleteDraft = async (id) => {
        try {
            await deleteDoc(doc(draftCollRef, id));
            if (activeDraftId === id) setActiveDraftId(null);
            toastSuccess('Draft deleted');
        } catch (e) {
            toastError(e?.message || 'Delete failed');
        }
    };

    const exportXlsxBlob = async () => {
        const blob = await transformFortuneToExcel(sheetRef, 'xlsx', false);
        if (!(blob instanceof Blob)) {
            throw new Error('Export failed');
        }
        return blob;
    };

    const downloadXlsx = async () => {
        setSaving(true);
        try {
            const name = `${(docTitle || 'workbook').replace(/[/\\?%*:|"<>]/g, '_')}.xlsx`;
            const blob = await exportXlsxBlob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            a.click();
            URL.revokeObjectURL(a.href);
            toastSuccess('Downloaded');
        } catch (e) {
            toastError(e?.message || 'Export failed');
        } finally {
            setSaving(false);
        }
    };

    const saveToFiles = async () => {
        const name = String(saveFileName || docTitle || 'workbook').trim();
        if (!name) {
            toastError('File name is required');
            return;
        }
        const fileName = name.toLowerCase().endsWith('.xlsx') ? name : `${name}.xlsx`;
        setSaving(true);
        setSaveProgress(0);
        try {
            const blob = await exportXlsxBlob();
            if (blob.size > MAX_FILE_LIBRARY_BYTES) {
                toastError(`File exceeds ${formatFileSize(MAX_FILE_LIBRARY_BYTES)} limit`);
                return;
            }
            const file = new File([blob], fileName, {
                type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            });
            await uploadBlobToFileLibrary({
                collRef: fileCollRef,
                storage,
                franchiseId: fid,
                parentId: saveFolderId,
                file,
                fileName,
                category: saveCategory,
                note: saveNote,
                user,
                uploaderName,
                onProgress: setSaveProgress,
            });
            toastSuccess('Saved to Files');
            setSaveToFilesOpen(false);
            onSavedToFiles?.();
        } catch (e) {
            toastError(e?.message || 'Save to Files failed');
        } finally {
            setSaving(false);
            setSaveProgress(0);
        }
    };

    const openSaveToFilesModal = () => {
        setSaveFileName(`${(docTitle || 'workbook').replace(/[/\\?%*:|"<>]/g, '_')}.xlsx`);
        setSaveCategory('calculation');
        setSaveFolderId('');
        setSaveNote('');
        setSaveToFilesOpen(true);
    };

    const runContextAction = async (action) => {
        const { item, kind } = contextMenu || {};
        setContextMenu(null);
        if (!item) return;
        if (kind === 'draft') {
            if (action === 'open') loadDraft(item);
            if (action === 'delete') deleteDraft(item.id);
            return;
        }
        if (action === 'open') await loadFromStorage(item, { preview: false });
        if (action === 'preview') await loadFromStorage(item, { preview: true });
        if (action === 'download') await downloadLibraryFile(item);
    };

    const sidebarItemClass = (active) =>
        `w-full text-left px-2 py-2 rounded-lg text-[12px] truncate flex items-center gap-1.5 ${
            active
                ? 'bg-[var(--erpx-brand)]/15 text-[var(--erpx-brand)] font-semibold'
                : 'hover:bg-[var(--erpx-subtle)] text-[var(--erpx-ink)]'
        }`;

    return (
        <div className="flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden space-y-4">
            <div className="erpx-page-header pal-ops-header !mb-0 pb-4 border-b border-[var(--erpx-border)] px-2 sm:px-3 lg:px-5">
                <h1 className="erpx-page-title flex items-center gap-2">
                    <PalantirPageIcon navKey="excel" />
                    Excel workspace
                </h1>
                <p className="erpx-page-subtitle mt-1">Cloud drafts, spreadsheet library, and workbook editing in one panel.</p>
            </div>

            <div className="pal-dash-panel shrink-0 mx-2 sm:mx-3 lg:mx-5">
                <div className="pal-dash-panel-body padded flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 mr-2">
                    <FileSpreadsheet size={20} className="text-[var(--erpx-green)]" />
                    <input
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        className="text-sm font-semibold bg-transparent border-b border-transparent hover:border-[var(--erpx-border-strong)] focus:border-[var(--erpx-brand)] outline-none min-w-[140px] max-w-[220px] text-[var(--erpx-ink)]"
                        placeholder="Workbook title"
                    />
                    {previewReadOnly && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--erpx-amber)] bg-[var(--erpx-amber)]/15 px-2 py-0.5 rounded-md">
                            Preview
                        </span>
                    )}
                </div>
                <button type="button" onClick={newWorkbook} className="pal-btn">
                    <FilePlus2 size={14} />
                    New
                </button>
                <button type="button" onClick={saveDraft} disabled={saving || previewReadOnly} className="pal-btn disabled:opacity-50">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Save draft
                </button>
                <button type="button" onClick={downloadXlsx} disabled={saving} className="pal-btn disabled:opacity-50">
                    <Download size={14} />
                    Download .xlsx
                </button>
                <button
                    type="button"
                    onClick={openSaveToFilesModal}
                    disabled={saving || previewReadOnly}
                    className="pal-btn pal-btn-primary disabled:opacity-50"
                >
                    <CloudUpload size={14} />
                    Save to Files
                </button>
            </div>
            </div>

            <div className="flex flex-1 min-h-0 overflow-hidden gap-3 px-2 sm:px-3 lg:px-5 pb-2">
                <aside className="w-56 shrink-0 pal-dash-panel overflow-y-auto hidden md:flex md:flex-col min-h-0 bg-[var(--erpx-canvas)]">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--erpx-ink-muted)] px-3 pt-3 pb-1">
                        Cloud drafts
                    </p>
                    {drafts.length === 0 ? (
                        <p className="text-[11px] text-[var(--erpx-ink-muted)] px-3 pb-2">No saved drafts yet</p>
                    ) : (
                        <ul className="pb-2">
                            {drafts.map((d) => (
                                <li key={d.id} className="px-2">
                                    <button
                                        type="button"
                                        onClick={() => loadDraft(d)}
                                        onContextMenu={(e) => openContextMenu(e, d, 'draft')}
                                        className={sidebarItemClass(activeDraftId === d.id)}
                                        title={d.title || 'Workbook'}
                                    >
                                        <FileSpreadsheet size={12} className="shrink-0 opacity-70" />
                                        <span className="truncate">{d.title || 'Workbook'}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}

                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--erpx-ink-muted)] px-3 pt-2 pb-1 border-t border-[var(--erpx-border)]">
                        Saved files
                    </p>
                    {libraryFiles.length === 0 ? (
                        <p className="text-[11px] text-[var(--erpx-ink-muted)] px-3 pb-3">No spreadsheets in Files yet</p>
                    ) : (
                        <ul className="pb-3 flex-1 min-h-0 overflow-y-auto">
                            {libraryFiles.map((f) => (
                                <li key={f.id} className="px-2">
                                    <button
                                        type="button"
                                        onClick={() => loadFromStorage(f, { preview: false })}
                                        onContextMenu={(e) => openContextMenu(e, f, 'file')}
                                        className={sidebarItemClass(activeLibraryFileId === f.id)}
                                        title={f.fileName || f.name}
                                    >
                                        <FolderInput size={12} className="shrink-0 text-[var(--erpx-green)]" />
                                        <span className="truncate">{f.fileName || f.name}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <p className="text-[10px] text-[var(--erpx-ink-muted)] px-3 mt-auto pb-3 leading-relaxed border-t border-[var(--erpx-border)] pt-2">
                        Right-click a file for Preview, Open, or Download.
                    </p>
                </aside>

                <div
                    ref={sheetPanelRef}
                    className="flex-1 min-w-0 min-h-0 flex flex-col pal-dash-panel overflow-hidden relative erpx-excel-sheet-panel bg-[var(--erpx-surface)]"
                >
                    {loadingBootstrap && (
                        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--erpx-surface)]/80">
                            <Loader2 className="animate-spin text-[var(--erpx-brand)]" size={32} />
                        </div>
                    )}
                    <FortuneExcelHelper
                        setKey={setWorkbookKey}
                        setSheets={setSheets}
                        sheetRef={sheetRef}
                        config={{ import: { xlsx: true, csv: true }, export: { xlsx: true, csv: true } }}
                    />
                    <div className="erpx-fortune-workbook flex-1 min-h-0 w-full overflow-hidden">
                        <Workbook
                            key={workbookKey}
                            ref={sheetRef}
                            data={sheets}
                            onChange={handleChange}
                            showToolbar
                            showFormulaBar
                            showSheetTabs
                            allowEdit={!previewReadOnly}
                            row={84}
                            column={60}
                            customToolbarItems={[importToolBarItem(), exportToolBarItem()]}
                        />
                    </div>
                </div>
            </div>

            <AnimatePresence>
                {contextMenu && (
                    <motion.div
                        ref={contextMenuRef}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        className="fixed z-[90] min-w-[168px] rounded-xl border border-[var(--erpx-border)] bg-[var(--erpx-surface)] shadow-xl py-1 text-[13px]"
                        style={{ left: contextMenu.x, top: contextMenu.y }}
                    >
                        {contextMenu.kind === 'file' && (
                            <>
                                <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-[var(--erpx-subtle)] flex items-center gap-2"
                                    onClick={() => runContextAction('preview')}
                                >
                                    <Eye size={14} />
                                    Preview
                                </button>
                                <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-[var(--erpx-subtle)] flex items-center gap-2"
                                    onClick={() => runContextAction('open')}
                                >
                                    <FolderInput size={14} />
                                    Open
                                </button>
                                <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-[var(--erpx-subtle)] flex items-center gap-2"
                                    onClick={() => runContextAction('download')}
                                >
                                    <Download size={14} />
                                    Download
                                </button>
                            </>
                        )}
                        {contextMenu.kind === 'draft' && (
                            <>
                                <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-[var(--erpx-subtle)] flex items-center gap-2"
                                    onClick={() => runContextAction('open')}
                                >
                                    <FolderInput size={14} />
                                    Open
                                </button>
                                <button
                                    type="button"
                                    className="w-full px-3 py-2 text-left hover:bg-[var(--erpx-red)]/10 text-[var(--erpx-red)] flex items-center gap-2"
                                    onClick={() => runContextAction('delete')}
                                >
                                    <Trash2 size={14} />
                                    Delete draft
                                </button>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>

            {saveToFilesOpen && (
                <div
                    className="fixed inset-0 z-[80] bg-black/45 flex items-center justify-center p-4"
                    onClick={() => !saving && setSaveToFilesOpen(false)}
                >
                    <motion.div
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="w-full max-w-md rounded-2xl bg-[var(--erpx-surface)] border border-[var(--erpx-border)] p-5 shadow-xl"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold flex items-center gap-2 text-[var(--erpx-ink)]">
                                <FolderOpen size={18} className="text-[var(--erpx-brand)]" />
                                Save to Files
                            </h3>
                            <button type="button" onClick={() => setSaveToFilesOpen(false)} className="text-[var(--erpx-ink-muted)]">
                                <X size={18} />
                            </button>
                        </div>
                        <label className="block text-xs font-medium mb-1">File name</label>
                        <input
                            value={saveFileName}
                            onChange={(e) => setSaveFileName(e.target.value)}
                            className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        />
                        <label className="block text-xs font-medium mb-1">Category</label>
                        <select
                            value={saveCategory}
                            onChange={(e) => setSaveCategory(e.target.value)}
                            className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        >
                            {FILE_LIBRARY_CATEGORIES.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.label}
                                </option>
                            ))}
                        </select>
                        <label className="block text-xs font-medium mb-1">Folder</label>
                        <select
                            value={saveFolderId}
                            onChange={(e) => setSaveFolderId(e.target.value)}
                            className="w-full mb-3 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        >
                            <option value="">Files (root)</option>
                            {folders.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.name}
                                </option>
                            ))}
                        </select>
                        <label className="block text-xs font-medium mb-1">Note (optional)</label>
                        <textarea
                            value={saveNote}
                            onChange={(e) => setSaveNote(e.target.value)}
                            rows={2}
                            className="w-full mb-4 px-3 py-2 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-canvas)] text-sm"
                        />
                        {saving && saveProgress > 0 && (
                            <div className="mb-4">
                                <div className="h-2 rounded-full bg-[var(--erpx-border)] overflow-hidden">
                                    <motion.div
                                        className="h-full bg-[var(--erpx-green)]"
                                        animate={{ width: `${saveProgress}%` }}
                                    />
                                </div>
                                <p className="text-[11px] text-[var(--erpx-ink-muted)] mt-1 tabular-nums">{saveProgress}%</p>
                            </div>
                        )}
                        <button
                            type="button"
                            disabled={saving}
                            onClick={saveToFiles}
                            className="pal-btn pal-btn-primary w-full py-3 text-sm disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {saving ? <Loader2 size={16} className="animate-spin" /> : <CloudUpload size={16} />}
                            {saving ? 'Uploading…' : 'Save to Files library'}
                        </button>
                    </motion.div>
                </div>
            )}

            <style>{`
                .erpx-excel-sheet-panel {
                    display: flex;
                    flex-direction: column;
                    flex: 1 1 auto;
                    min-height: 0;
                }
                .erpx-fortune-workbook {
                    flex: 1 1 auto;
                    min-height: 0;
                    width: 100%;
                    height: 100%;
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }
                .erpx-fortune-workbook .fortune-container {
                    flex: 1 1 auto !important;
                    min-height: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    max-height: 100% !important;
                    display: flex !important;
                    flex-direction: column !important;
                    overflow: hidden !important;
                }
                /* Toolbar + formula only — must NOT grow (was causing white gap) */
                .erpx-fortune-workbook .fortune-workarea {
                    flex: 0 0 auto !important;
                    width: 100% !important;
                    height: auto !important;
                }
                /* Grid fills remaining space */
                .erpx-fortune-workbook .fortune-sheet-container {
                    flex: 1 1 auto !important;
                    min-height: 0 !important;
                    height: auto !important;
                    overflow: hidden !important;
                    position: relative !important;
                }
                .erpx-fortune-workbook .fortune-sheet-canvas-placeholder {
                    position: absolute !important;
                    inset: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }
                .erpx-fortune-workbook .fortune-sheet-canvas {
                    position: absolute !important;
                    inset: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                }
                .erpx-fortune-workbook .fortune-sheet-overlay {
                    position: absolute !important;
                    top: 0 !important;
                    left: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    width: 100% !important;
                    height: 100% !important;
                    max-width: none !important;
                    max-height: none !important;
                }
                .erpx-fortune-workbook .fortune-col-body,
                .erpx-fortune-workbook .fortune-sheet-area {
                    height: 100% !important;
                }
                .erpx-fortune-workbook .luckysheet-sheet-area {
                    flex: 0 0 auto !important;
                }
                .erpx-fortune-workbook .fortune-toolbar .fortune-toolbar-combo:first-of-type .fortune-toolbar-combo-button {
                    min-width: 168px;
                    max-width: 220px;
                }
                .erpx-fortune-workbook .fortune-toolbar .fortune-toolbar-combo:first-of-type .fortune-toolbar-combo-text {
                    max-width: 200px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .erpx-fortune-workbook .fortune-toolbar-select {
                    min-width: 200px;
                    max-width: min(320px, 90vw);
                }
                .erpx-fortune-workbook .fortune-toolbar-select-option {
                    font-size: 13px;
                    padding: 8px 14px;
                    white-space: nowrap;
                }
            `}</style>
        </div>
    );
}
