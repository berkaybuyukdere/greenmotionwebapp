import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import DOMPurify from 'dompurify';
import { doc, getDoc } from 'firebase/firestore';
import { format, parseISO, isValid } from 'date-fns';
import {
    Inbox,
    Send,
    SquarePen,
    RefreshCw,
    Search,
    Circle,
    CheckCheck,
    Paperclip,
    Clock,
    User,
    Eye,
    Sparkles,
    RotateCw,
    Star,
    Trash2,
    RotateCcw,
    FolderPlus,
    ChevronRight,
    X,
    GripVertical,
    LayoutTemplate,
    Archive,
    File,
    FileText,
    FileImage,
    FileArchive,
    Download,
    Expand,
} from 'lucide-react';
import { useToast } from './ToastNotification';
import { MailComposeRichEditor } from './MailComposeRichEditor';

const READ_IDS_KEY = 'greenmotion_mail_read_ids';
const LS_TRASH = 'greenmotion_mail_trash';
const LS_FAVORITES = 'greenmotion_mail_favorites';
const LS_GROUPS = 'greenmotion_mail_groups';
const LS_HIDDEN_INBOX = 'greenmotion_mail_hidden_inbox';
const LS_HIDDEN_SENT = 'greenmotion_mail_hidden_sent';
const LS_ARCHIVE = 'greenmotion_mail_archive_ids';
const LS_DRAFTS = 'greenmotion_mail_drafts';
const LS_SIGNATURE = 'greenmotion_mail_signature_html';
const LS_TEMPLATES = 'greenmotion_mail_templates';
const LS_CRM_CONTACTS = 'greenmotion_mail_crm_contacts';
const MAX_TRASH = 80;

function subscribeDarkMode(callback) {
    const el = document.documentElement;
    const obs = new MutationObserver(() => callback());
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
}

function getDarkSnapshot() {
    return document.documentElement.classList.contains('dark');
}

function useAppDarkMode() {
    return useSyncExternalStore(subscribeDarkMode, getDarkSnapshot, () => false);
}

function loadReadIdSet() {
    try {
        const raw = localStorage.getItem(READ_IDS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(arr) ? arr : []);
    } catch {
        return new Set();
    }
}

function persistReadIds(set) {
    try {
        localStorage.setItem(READ_IDS_KEY, JSON.stringify([...set]));
    } catch {
        /* ignore */
    }
}

function loadJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function saveJson(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        /* ignore */
    }
}

function getMessageId(msg, idx) {
    if (msg?.id != null) return String(msg.id);
    if (msg?.uid != null) return String(msg.uid);
    if (typeof idx === 'number' && idx >= 0) return `idx-${idx}`;
    return `msg-${Math.random().toString(36).slice(2, 9)}`;
}

function stableMessageKey(msg) {
    if (msg?._trashRowId) return msg._trashRowId;
    return getMessageId(msg, 0);
}

function cleanSnapshot(msg) {
    if (!msg) return msg;
    const { _trashRowId, _deletedAt, _restoreSource, ...rest } = msg;
    return { ...rest };
}

function formatMailWhen(isoOrStr) {
    if (!isoOrStr || isoOrStr === '-') return '';
    try {
        const d = typeof isoOrStr === 'string' ? parseISO(isoOrStr) : new Date(isoOrStr);
        if (!isValid(d)) return String(isoOrStr);
        return format(d, 'MMM d, h:mm a');
    } catch {
        return String(isoOrStr);
    }
}

function initialsFromAddress(str) {
    if (!str) return '?';
    const m = String(str).match(/([a-zA-Z])/);
    if (m) return m[1].toUpperCase();
    return '?';
}

function sanitizeMailHtml(html) {
    if (!html || !String(html).trim()) return '';
    return DOMPurify.sanitize(String(html), {
        USE_PROFILES: { html: true },
        ADD_ATTR: ['target', 'rel'],
    });
}

function formatFileSize(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentMeta(att) {
    const name = String(att?.name || 'Attachment');
    const type = String(att?.type || '').toLowerCase();
    const isImage = type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)$/i.test(name);
    const isArchive = /(zip|rar|7z|tar|gzip|x-zip)/i.test(type) || /\.(zip|rar|7z|tar|gz)$/i.test(name);
    const isText = type.startsWith('text/') || /\.(txt|md|csv|json|xml)$/i.test(name);
    const isPdf = type === 'application/pdf' || /\.pdf$/i.test(name);
    const Icon = isImage ? FileImage : isArchive ? FileArchive : isText ? FileText : File;
    return { name, type, isImage, isPdf, Icon };
}

function buildPreviewSrcDoc(sanitizedBody, isDark, placeholder) {
    const bg = isDark ? '#0f172a' : '#ffffff';
    const fg = isDark ? '#e2e8f0' : '#0f172a';
    const muted = isDark ? '#94a3b8' : '#64748b';
    const link = isDark ? '#60a5fa' : '#2563eb';
    const body = sanitizedBody || `<p style="color:${muted};font-size:14px;">${placeholder || '…'}</p>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>
      *{box-sizing:border-box;}
      html,body{height:100%;margin:0;padding:0;}
      body{padding:14px 16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;font-size:15px;line-height:1.55;color:${fg};background:${bg};overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;}
      a{color:${link};}
      img,video,iframe{max-width:100%!important;height:auto!important;}
      table{max-width:100%;display:block;overflow-x:auto;}
      pre{overflow-x:auto;max-width:100%;}
      blockquote{border-left:3px solid ${muted};margin:8px 0;padding-left:12px;color:${muted};}
      pre,code{font-family:ui-monospace,monospace;font-size:12px;background:${isDark ? '#1e293b' : '#f1f5f9'};border-radius:6px;}
      pre{padding:10px;}
    </style></head><body>${body}</body></html>`;
}

function stripHtmlToPlain(html) {
    if (!html || !String(html).trim()) return '';
    try {
        const d = document.createElement('div');
        d.innerHTML = String(html);
        return (d.textContent || d.innerText || '').replace(/\s+/g, ' ').trim();
    } catch {
        return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }
}

function parseAddressToken(token) {
    const raw = String(token || '').trim();
    if (!raw) return null;
    const angle = raw.match(/^\s*"?([^"]*?)"?\s*<([^>]+)>\s*$/);
    if (angle) {
        const email = String(angle[2] || '').trim().toLowerCase();
        if (!email || !email.includes('@')) return null;
        const name = String(angle[1] || '').trim();
        return { email, name };
    }
    const plain = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (!plain) return null;
    return { email: plain[0].toLowerCase(), name: '' };
}

function splitAddresses(value) {
    return String(value || '')
        .split(/[;,]/)
        .map(parseAddressToken)
        .filter(Boolean);
}

function mergeCrmContacts(prevContacts, entries) {
    const now = new Date().toISOString();
    const map = new Map(
        (Array.isArray(prevContacts) ? prevContacts : [])
            .filter((c) => c && c.email)
            .map((c) => [
                String(c.email).toLowerCase(),
                {
                    email: String(c.email).toLowerCase(),
                    name: String(c.name || ''),
                    count: Number(c.count || 0),
                    lastSeenAt: String(c.lastSeenAt || ''),
                },
            ])
    );

    for (const item of entries || []) {
        if (!item?.email) continue;
        const email = String(item.email).toLowerCase();
        const current = map.get(email) || { email, name: '', count: 0, lastSeenAt: '' };
        map.set(email, {
            email,
            name: item.name ? String(item.name) : current.name,
            count: Number(current.count || 0) + 1,
            lastSeenAt: now,
        });
    }

    return [...map.values()].sort((a, b) => {
        const aa = new Date(a.lastSeenAt || 0).getTime();
        const bb = new Date(b.lastSeenAt || 0).getTime();
        return bb - aa;
    });
}

/** Trash first (like Gmail): deleted sent/inbox resolves from Recently deleted, not stale folder copy. */
function findMessageById(fid, inboxVisible, sentMessages, trashItems) {
    const id = String(fid);
    for (const t of trashItems) {
        const s = t?.snapshot;
        if (!s) continue;
        const sid = String(s.id ?? s.uid ?? '');
        if (sid === id || String(s.uid) === id) {
            return {
                ...s,
                _trashRowId: t.rowId,
                _deletedAt: t.deletedAt,
                _restoreSource: t.source,
            };
        }
    }
    for (const m of inboxVisible) {
        if (m && (String(m.id) === id || String(m.uid) === id)) return m;
    }
    for (const m of sentMessages) {
        if (m && (String(m.id) === id || String(m.uid) === id)) return m;
    }
    return null;
}

function resolveSource(msg, inboxVisible, sentMessages) {
    if (msg._restoreSource === 'sent' || msg._restoreSource === 'inbox') return msg._restoreSource;
    const id = String(msg.id ?? msg.uid ?? '');
    if (!id) return 'inbox';
    if (sentMessages.some((m) => String(m.id) === id || String(m.uid) === id)) return 'sent';
    return 'inbox';
}

export function MailCenterView({ db, franchiseId: franchiseIdProp }) {
    const toast = useToast();
    const isDark = useAppDarkMode();
    const [franchiseSmtp, setFranchiseSmtp] = useState(null);
    /** inbox | sent | drafts | archive | compose | trash | favorites | group:<id> */
    const [folder, setFolder] = useState('inbox');
    const [inboxFilter, setInboxFilter] = useState('all');
    const [listQuery, setListQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [messages, setMessages] = useState([]);
    const [sentMessages, setSentMessages] = useState([]);
    const [selectedMessage, setSelectedMessage] = useState(null);
    const [readIds, setReadIds] = useState(() => loadReadIdSet());
    const [hiddenInboxIds, setHiddenInboxIds] = useState(() => new Set(loadJson(LS_HIDDEN_INBOX, [])));
    const [hiddenSentIds, setHiddenSentIds] = useState(() => new Set(loadJson(LS_HIDDEN_SENT, [])));
    const [archivedIds, setArchivedIds] = useState(() => new Set(loadJson(LS_ARCHIVE, [])));
    const [trashItems, setTrashItems] = useState(() => loadJson(LS_TRASH, []));
    const [drafts, setDrafts] = useState(() => loadJson(LS_DRAFTS, []));
    const [favoriteIds, setFavoriteIds] = useState(() => loadJson(LS_FAVORITES, []));
    const [groups, setGroups] = useState(() => loadJson(LS_GROUPS, []));
    const [groupsOpen, setGroupsOpen] = useState(true);
    const [showNewGroupModal, setShowNewGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [showAddToGroup, setShowAddToGroup] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showComposeModal, setShowComposeModal] = useState(false);
    const [showDraftExitConfirm, setShowDraftExitConfirm] = useState(false);
    const [showComposePreview, setShowComposePreview] = useState(false);
    const [showHtmlCodeInput, setShowHtmlCodeInput] = useState(false);
    const [composeHtmlCode, setComposeHtmlCode] = useState('');
    const [previewAttachment, setPreviewAttachment] = useState(null);
    const [previewItems, setPreviewItems] = useState([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewZoom, setPreviewZoom] = useState(1);
    const [showSignatureModal, setShowSignatureModal] = useState(false);
    const [showTemplatesModal, setShowTemplatesModal] = useState(false);
    const [signatureDraft, setSignatureDraft] = useState(() => loadJson(LS_SIGNATURE, ''));
    const [templates, setTemplates] = useState(() => loadJson(LS_TEMPLATES, []));
    const [crmContacts, setCrmContacts] = useState(() => loadJson(LS_CRM_CONTACTS, []));
    const [newTemplateName, setNewTemplateName] = useState('');
    const [deleteGroupId, setDeleteGroupId] = useState(null);
    const [draggingGroupId, setDraggingGroupId] = useState(null);
    const [draggingMessage, setDraggingMessage] = useState(null);
    const [isDropActive, setIsDropActive] = useState(false);

    const [compose, setCompose] = useState({
        draftId: '',
        to: '',
        cc: '',
        subject: '',
        from: 'admin-d@greenmotioncarrental.ch',
        text: '',
        html: '',
        attachments: [],
    });

    const apiBase = process.env.REACT_APP_MAIL_API_BASE || '';

    const franchiseIdUpper = useMemo(
        () => String(franchiseIdProp || 'CH').trim().toUpperCase() || 'CH',
        [franchiseIdProp]
    );

    useEffect(() => {
        if (!db || !franchiseIdUpper) return undefined;
        let cancelled = false;
        (async () => {
            try {
                const snap = await getDoc(doc(db, 'smtpConfigurations', franchiseIdUpper));
                if (cancelled) return;
                if (snap.exists()) {
                    setFranchiseSmtp(snap.data());
                    const from = snap.data()?.senderEmail || snap.data()?.senderName;
                    if (from) {
                        setCompose((prev) => ({ ...prev, from: String(from) }));
                    }
                } else {
                    setFranchiseSmtp(null);
                }
            } catch (e) {
                if (e?.code !== 'permission-denied') {
                    console.warn('MailCenter: could not load SMTP config', e);
                }
                setFranchiseSmtp(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [db, franchiseIdUpper]);

    const persistHiddenInbox = useCallback((set) => {
        saveJson(LS_HIDDEN_INBOX, [...set]);
        setHiddenInboxIds(new Set(set));
    }, []);

    const persistHiddenSent = useCallback((set) => {
        saveJson(LS_HIDDEN_SENT, [...set]);
        setHiddenSentIds(new Set(set));
    }, []);

    const persistArchived = useCallback((set) => {
        saveJson(LS_ARCHIVE, [...set]);
        setArchivedIds(new Set(set));
    }, []);

    const persistTrash = useCallback((updater) => {
        setTrashItems((prev) => {
            const next = (typeof updater === 'function' ? updater(prev) : updater).slice(0, MAX_TRASH);
            saveJson(LS_TRASH, next);
            return next;
        });
    }, []);

    const persistDrafts = useCallback((arr) => {
        saveJson(LS_DRAFTS, arr);
        setDrafts(arr);
    }, []);

    const persistFavorites = useCallback((arr) => {
        saveJson(LS_FAVORITES, arr);
        setFavoriteIds(arr);
    }, []);

    const persistGroups = useCallback((arr) => {
        saveJson(LS_GROUPS, arr);
        setGroups(arr);
    }, []);

    const persistCrmContacts = useCallback((arr) => {
        saveJson(LS_CRM_CONTACTS, arr);
        setCrmContacts(arr);
    }, []);

    const inboxVisible = useMemo(
        () =>
            messages.filter((m) => {
                const id = getMessageId(m, messages.indexOf(m));
                return !hiddenInboxIds.has(id) && !archivedIds.has(id);
            }),
        [messages, hiddenInboxIds, archivedIds]
    );

    /** Sent items that are in Recently deleted stay out of Sent (modern mail UX, even if API lags). */
    const trashSentIds = useMemo(
        () =>
            new Set(
                trashItems
                    .filter((t) => t.source === 'sent')
                    .map((t) => String(t.snapshot?.id ?? t.snapshot?.uid ?? ''))
                    .filter(Boolean)
            ),
        [trashItems]
    );

    const sentVisible = useMemo(
        () =>
            sentMessages.filter((m) => {
                const mid = String(m?.id ?? m?.uid ?? '');
                return mid && !trashSentIds.has(mid) && !hiddenSentIds.has(mid) && !archivedIds.has(mid);
            }),
        [sentMessages, trashSentIds, hiddenSentIds, archivedIds]
    );

    const folderMessages = useMemo(() => {
        if (folder === 'inbox') return inboxVisible;
        if (folder === 'sent') return sentVisible;
        if (folder === 'drafts') return drafts;
        if (folder === 'archive') {
            return [...archivedIds]
                .map((fid) => findMessageById(fid, inboxVisible, sentMessages, trashItems))
                .filter(Boolean);
        }
        if (folder === 'trash') {
            return trashItems.map((t) => ({
                ...t.snapshot,
                _trashRowId: t.rowId,
                _deletedAt: t.deletedAt,
                _restoreSource: t.source,
            }));
        }
        if (folder === 'favorites') {
            return favoriteIds
                .map((fid) => findMessageById(fid, inboxVisible, sentMessages, trashItems))
                .filter(Boolean);
        }
        if (folder.startsWith('group:')) {
            const gid = folder.slice(6);
            const g = groups.find((x) => x.id === gid);
            if (!g) return [];
            return g.messageIds
                .map((fid) => findMessageById(fid, inboxVisible, sentMessages, trashItems))
                .filter(Boolean);
        }
        return [];
    }, [folder, inboxVisible, sentVisible, sentMessages, trashItems, favoriteIds, groups, archivedIds, drafts]);

    const loadInbox = useCallback(async () => {
        if (!apiBase) return [];
        setLoading(true);
        try {
            const response = await fetch(`${apiBase}/mail/inbox`, { method: 'GET' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const items = Array.isArray(payload?.messages) ? payload.messages : [];
            setMessages(items);
            return items;
        } catch (error) {
            console.error('Inbox load failed:', error);
            toast.error('Could not load inbox. Check that the mail API is running.');
            return [];
        } finally {
            setLoading(false);
        }
    }, [apiBase, toast]);

    const loadSent = useCallback(async () => {
        if (!apiBase) return [];
        setLoading(true);
        try {
            const response = await fetch(`${apiBase}/mail/sent`, { method: 'GET' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const items = Array.isArray(payload?.messages) ? payload.messages : [];
            setSentMessages(items);
            return items;
        } catch (error) {
            console.error('Sent load failed:', error);
            toast.error('Could not load sent mail.');
            return [];
        } finally {
            setLoading(false);
        }
    }, [apiBase, toast]);

    const refreshFolder = useCallback(() => {
        if (folder === 'sent' || folder === 'inbox') {
            if (folder === 'sent') return loadSent();
            return loadInbox();
        }
        return Promise.all([loadInbox(), loadSent()]);
    }, [folder, loadInbox, loadSent]);

    useEffect(() => {
        if (!apiBase) return;
        loadInbox();
        loadSent();
    }, [apiBase, loadInbox, loadSent]);

    const isUnread = useCallback(
        (msg, idx) => {
            const id = getMessageId(msg, idx);
            if (readIds.has(id)) return false;
            if (msg.read === true || msg.unread === false) return false;
            if (msg.unread === true) return true;
            return true;
        },
        [readIds]
    );

    const markRead = useCallback((msg, idx) => {
        const id = getMessageId(msg, idx);
        setReadIds((prev) => {
            if (prev.has(id)) return prev;
            const next = new Set(prev);
            next.add(id);
            persistReadIds(next);
            return next;
        });
    }, []);

    const markAllInboxRead = useCallback(() => {
        setReadIds((prev) => {
            const next = new Set(prev);
            inboxVisible.forEach((m, i) => next.add(getMessageId(m, i)));
            persistReadIds(next);
            return next;
        });
        toast.success('All messages marked as read');
    }, [inboxVisible, toast]);

    const selectedKey = selectedMessage ? stableMessageKey(selectedMessage) : null;

    const isFavorite = useCallback(
        (msg) => {
            const id = String(msg?.id ?? msg?.uid ?? '');
            return id && favoriteIds.includes(id);
        },
        [favoriteIds]
    );

    const toggleFavorite = useCallback(
        (msg, e) => {
            if (e) e.stopPropagation();
            const id = String(msg?.id ?? msg?.uid ?? '');
            if (!id) return;
            if (favoriteIds.includes(id)) {
                persistFavorites(favoriteIds.filter((x) => x !== id));
                toast.success('Removed from favorites');
            } else {
                persistFavorites([id, ...favoriteIds.filter((x) => x !== id)]);
                toast.success('Added to favorites');
            }
        },
        [favoriteIds, persistFavorites, toast]
    );

    const createGroup = useCallback(() => {
        const name = newGroupName.trim();
        if (!name) {
            toast.warning('Enter a group name');
            return;
        }
        const id = `grp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        persistGroups([...groups, { id, name, messageIds: [] }]);
        setNewGroupName('');
        setShowNewGroupModal(false);
        setFolder(`group:${id}`);
        toast.success('Group created');
    }, [newGroupName, groups, persistGroups, toast]);

    const addSelectedToGroup = useCallback(
        (groupId) => {
            if (!selectedMessage) return;
            const mid = String(selectedMessage.id ?? selectedMessage.uid ?? '');
            if (!mid) return;
            const next = groups.map((g) => {
                if (g.id !== groupId) return g;
                if (g.messageIds.includes(mid)) return g;
                return { ...g, messageIds: [...g.messageIds, mid] };
            });
            persistGroups(next);
            setShowAddToGroup(false);
            toast.success('Added to group');
        },
        [selectedMessage, groups, persistGroups, toast]
    );

    const deleteFromServerSent = useCallback(
        async (id) => {
            if (!apiBase || !id) return false;
            try {
                const res = await fetch(`${apiBase}/mail/sent/${encodeURIComponent(id)}`, { method: 'DELETE' });
                if (res.ok || res.status === 404) return true;
                console.error('[mail] DELETE sent failed', res.status);
                return false;
            } catch (e) {
                console.error(e);
                return false;
            }
        },
        [apiBase]
    );

    const restoreToServerSent = useCallback(
        async (snapshot) => {
            if (!apiBase) return;
            try {
                await fetch(`${apiBase}/mail/sent/restore`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(snapshot),
                });
            } catch (e) {
                console.error(e);
            }
        },
        [apiBase]
    );

    const performMoveToTrash = useCallback(
        async (msg) => {
            const snap = cleanSnapshot(msg);
            const mid = String(snap.id ?? snap.uid ?? '');
            if (!mid) {
                toast.error('Cannot delete this message (no id)');
                return;
            }
            const source = resolveSource(msg, inboxVisible, sentMessages);
            const rowId = `tr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const row = { rowId, snapshot: snap, source, deletedAt: new Date().toISOString() };
            persistTrash((prev) => [row, ...prev]);

            if (source === 'inbox') {
                const next = new Set(hiddenInboxIds);
                next.add(mid);
                persistHiddenInbox(next);
            } else {
                const nextSent = new Set(hiddenSentIds);
                nextSent.add(mid);
                persistHiddenSent(nextSent);
                await deleteFromServerSent(mid);
                setSentMessages((prev) => prev.filter((m) => String(m.id) !== mid));
                await loadSent();
            }

            persistFavorites(favoriteIds.filter((x) => x !== mid));
            persistGroups(
                groups.map((g) => ({
                    ...g,
                    messageIds: g.messageIds.filter((x) => x !== mid),
                }))
            );

            setSelectedMessage(null);
            setShowDeleteConfirm(false);
            toast.success('Moved to Recently deleted');
            await loadInbox();
        },
        [
            hiddenInboxIds,
            inboxVisible,
            sentMessages,
            favoriteIds,
            groups,
            persistTrash,
            persistHiddenInbox,
            persistFavorites,
            persistGroups,
            deleteFromServerSent,
            loadSent,
            loadInbox,
            toast,
            hiddenSentIds,
            persistHiddenSent,
        ]
    );

    const performRestoreFromTrash = useCallback(
        async (msg) => {
            const rowId = msg._trashRowId;
            const row = trashItems.find((t) => t.rowId === rowId);
            if (!row) return;
            const snap = cleanSnapshot(row.snapshot);
            const mid = String(snap.id ?? snap.uid ?? '');

            if (row.source === 'inbox') {
                const next = new Set(hiddenInboxIds);
                next.delete(mid);
                persistHiddenInbox(next);
            } else {
                const nextSent = new Set(hiddenSentIds);
                nextSent.delete(mid);
                persistHiddenSent(nextSent);
                await restoreToServerSent(snap);
                await loadSent();
            }

            persistTrash((prev) => prev.filter((t) => t.rowId !== rowId));
            setSelectedMessage(null);
            toast.success('Restored');
            await loadInbox();
        },
        [
            trashItems,
            hiddenInboxIds,
            hiddenSentIds,
            persistTrash,
            persistHiddenInbox,
            persistHiddenSent,
            restoreToServerSent,
            loadSent,
            loadInbox,
            toast,
        ]
    );

    const performPermanentDelete = useCallback(
        async (msg) => {
            const rowId = msg._trashRowId;
            if (!rowId) return;
            const row = trashItems.find((t) => t.rowId === rowId);
            if (row?.source === 'sent') {
                const mid = String(row.snapshot?.id ?? row.snapshot?.uid ?? '');
                if (mid) await deleteFromServerSent(mid);
            }
            persistTrash((prev) => prev.filter((t) => t.rowId !== rowId));
            const mid = String(msg.id ?? msg.uid ?? '');
            persistFavorites(favoriteIds.filter((x) => x !== mid));
            persistGroups(
                groups.map((g) => ({
                    ...g,
                    messageIds: g.messageIds.filter((x) => x !== mid),
                }))
            );
            setSentMessages((prev) => prev.filter((m) => String(m.id) !== mid));
            await loadSent();
            setSelectedMessage(null);
            setShowDeleteConfirm(false);
            toast.success('Permanently deleted');
        },
        [
            trashItems,
            favoriteIds,
            groups,
            persistTrash,
            persistFavorites,
            persistGroups,
            toast,
            deleteFromServerSent,
            loadSent,
        ]
    );

    useEffect(() => {
        const onKey = (e) => {
            if (showComposeModal || showDeleteConfirm) return;
            const el = e.target;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
            if (el?.closest?.('.ql-editor') || el?.closest?.('.ql-toolbar')) return;
            if (el?.isContentEditable) return;
            if (!selectedMessage) return;
            if (e.key !== 'Delete' && e.key !== 'Backspace') return;
            if (e.repeat) return;
            e.preventDefault();
            if (folder === 'trash') setShowDeleteConfirm(true);
            else void performMoveToTrash(selectedMessage);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [showComposeModal, selectedMessage, showDeleteConfirm, folder, performMoveToTrash]);

    useEffect(() => {
        const onShortcut = (e) => {
            const isMeta = e.metaKey || e.ctrlKey;
            if (!isMeta) return;
            if (e.key.toLowerCase() === 'n') {
                e.preventDefault();
                setShowComposeModal(true);
                return;
            }
            if ((e.key === 'Backspace' || e.key === 'Delete') && selectedMessage && !showComposeModal) {
                e.preventDefault();
                if (folder === 'trash') setShowDeleteConfirm(true);
                else void performMoveToTrash(selectedMessage);
            }
        };
        window.addEventListener('keydown', onShortcut);
        return () => window.removeEventListener('keydown', onShortcut);
    }, [selectedMessage, showComposeModal, folder, performMoveToTrash]);

    useEffect(() => {
        if (!showComposeModal) return undefined;
        const onEsc = (e) => {
            if (e.key !== 'Escape') return;
            if (showComposePreview || showDraftExitConfirm) return;
            e.preventDefault();
            const dirty =
                !!(
                    String(compose.to || '').trim() ||
                    String(compose.cc || '').trim() ||
                    String(compose.subject || '').trim() ||
                    String(compose.text || '').trim() ||
                    String(compose.html || '').trim() ||
                    String(composeHtmlCode || '').trim() ||
                    (Array.isArray(compose.attachments) && compose.attachments.length)
                );
            if (dirty) setShowDraftExitConfirm(true);
            else {
                setShowComposeModal(false);
                setShowComposePreview(false);
                setShowHtmlCodeInput(false);
                setShowDraftExitConfirm(false);
            }
        };
        window.addEventListener('keydown', onEsc);
        return () => window.removeEventListener('keydown', onEsc);
    }, [showComposeModal, showComposePreview, showDraftExitConfirm, compose, composeHtmlCode]);

    useEffect(() => {
        if (!previewAttachment) return undefined;
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                setPreviewAttachment(null);
                return;
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                setPreviewIndex((prev) => {
                    if (!previewItems.length) return prev;
                    const next = (prev + 1 + previewItems.length) % previewItems.length;
                    setPreviewAttachment(previewItems[next]);
                    setPreviewZoom(1);
                    return next;
                });
                return;
            }
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setPreviewIndex((prev) => {
                    if (!previewItems.length) return prev;
                    const next = (prev - 1 + previewItems.length) % previewItems.length;
                    setPreviewAttachment(previewItems[next]);
                    setPreviewZoom(1);
                    return next;
                });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [previewAttachment, previewItems]);

    useEffect(() => {
        const list = folderMessages;
        if (!list.length) {
            setSelectedMessage(null);
            return;
        }
        if (!selectedMessage) {
            setSelectedMessage(list[0]);
            return;
        }
        const stillThere = list.some(
            (m) =>
                stableMessageKey(m) === selectedKey ||
                (selectedMessage.id != null && m.id === selectedMessage.id) ||
                (selectedMessage.uid != null && m.uid === selectedMessage.uid)
        );
        if (!stillThere) setSelectedMessage(list[0]);
    }, [folderMessages, selectedMessage, selectedKey]);

    const filteredInbox = useMemo(() => {
        let list = folderMessages;
        const q = listQuery.trim().toLowerCase();
        const crmMap = new Map(
            (crmContacts || []).map((c) => [String(c.email || '').toLowerCase(), String(c.name || '').toLowerCase()])
        );
        if (q) {
            list = list.filter((m) => {
                const subj = (m.subject || '').toLowerCase();
                const from = (m.from || '').toLowerCase();
                const to = (m.to || '').toLowerCase();
                const cc = (m.cc || '').toLowerCase();
                const text = (m.text || '').toLowerCase();
                const participants = splitAddresses(`${m.from || ''};${m.to || ''};${m.cc || ''}`);
                const crmNames = participants.map((p) => crmMap.get(p.email) || '').join(' ');
                return (
                    subj.includes(q) ||
                    from.includes(q) ||
                    to.includes(q) ||
                    cc.includes(q) ||
                    text.includes(q) ||
                    crmNames.includes(q)
                );
            });
        }
        if (folder === 'inbox' && inboxFilter === 'unread') {
            list = list.filter((m) => {
                const oi = inboxVisible.indexOf(m);
                return isUnread(m, oi >= 0 ? oi : 0);
            });
        }
        return list;
    }, [folderMessages, folder, inboxFilter, listQuery, isUnread, inboxVisible, crmContacts]);

    const crmRecipientSuggestions = useMemo(
        () =>
            (crmContacts || [])
                .filter((c) => c && c.email)
                .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
                .slice(0, 40),
        [crmContacts]
    );

    useEffect(() => {
        const harvested = [];
        for (const m of [...messages, ...sentMessages]) {
            harvested.push(...splitAddresses(m?.from));
            harvested.push(...splitAddresses(m?.to));
            harvested.push(...splitAddresses(m?.cc));
        }
        if (!harvested.length) return;
        const existing = new Map((crmContacts || []).map((c) => [String(c.email || '').toLowerCase(), c]));
        let next = Array.isArray(crmContacts) ? [...crmContacts] : [];
        let changed = false;

        for (const entry of harvested) {
            const email = String(entry.email || '').toLowerCase();
            if (!email) continue;
            const current = existing.get(email);
            if (!current) {
                next = mergeCrmContacts(next, [entry]);
                existing.set(email, next.find((c) => String(c.email).toLowerCase() === email));
                changed = true;
                continue;
            }
            if (!String(current.name || '').trim() && String(entry.name || '').trim()) {
                next = next.map((c) =>
                    String(c.email || '').toLowerCase() === email ? { ...c, name: String(entry.name || '').trim() } : c
                );
                existing.set(email, { ...current, name: String(entry.name || '').trim() });
                changed = true;
            }
        }

        if (changed) persistCrmContacts(next);
    }, [messages, sentMessages, crmContacts, persistCrmContacts]);

    const unreadCount = useMemo(
        () => inboxVisible.reduce((n, m, i) => n + (isUnread(m, i) ? 1 : 0), 0),
        [inboxVisible, isUnread]
    );

    const handleSelectMessage = (msg) => {
        setSelectedMessage(msg);
        if (folder === 'inbox') {
            const idx = inboxVisible.indexOf(msg);
            markRead(msg, idx >= 0 ? idx : 0);
        }
    };

    const insertSavedSignature = useCallback(() => {
        const raw = loadJson(LS_SIGNATURE, '');
        if (!String(raw).trim()) {
            toast.warning('Save a signature first (Signature… in compose toolbar)');
            return;
        }
        setCompose((p) => ({
            ...p,
            html: `${p.html || ''}${p.html && !String(p.html).endsWith('<p><br></p>') ? '<br/><br/>' : ''}${raw}`,
        }));
        toast.success('Signature inserted');
    }, [toast]);

    const saveTemplateFromCompose = useCallback(() => {
        const name = newTemplateName.trim();
        if (!name) {
            toast.warning('Enter a template name');
            return;
        }
        const html = String(compose.html || '').trim();
        if (!html) {
            toast.warning('Write something in the message body first');
            return;
        }
        const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const next = [...(Array.isArray(templates) ? templates : []), { id, name, html }];
        saveJson(LS_TEMPLATES, next);
        setTemplates(next);
        setNewTemplateName('');
        toast.success('Template saved');
    }, [newTemplateName, compose.html, templates, toast]);

    const applyTemplate = useCallback(
        (tpl) => {
            if (!tpl?.html) return;
            setCompose((p) => ({ ...p, html: tpl.html }));
            setShowTemplatesModal(false);
            toast.success(`Template “${tpl.name}” applied`);
        },
        [toast]
    );

    const removeTemplate = useCallback(
        (id) => {
            const next = (Array.isArray(templates) ? templates : []).filter((t) => t.id !== id);
            saveJson(LS_TEMPLATES, next);
            setTemplates(next);
            toast.success('Template removed');
        },
        [templates, toast]
    );

    const reorderGroups = useCallback(
        (fromId, toId) => {
            if (!fromId || !toId || fromId === toId) return;
            const fromIdx = groups.findIndex((g) => g.id === fromId);
            const toIdx = groups.findIndex((g) => g.id === toId);
            if (fromIdx < 0 || toIdx < 0) return;
            const next = [...groups];
            const [item] = next.splice(fromIdx, 1);
            next.splice(toIdx, 0, item);
            persistGroups(next);
        },
        [groups, persistGroups]
    );

    const confirmDeleteGroup = useCallback(() => {
        if (!deleteGroupId) return;
        if (folder === `group:${deleteGroupId}`) setFolder('inbox');
        persistGroups(groups.filter((g) => g.id !== deleteGroupId));
        setDeleteGroupId(null);
        toast.success('Group deleted');
    }, [deleteGroupId, folder, groups, persistGroups, toast]);

    const addFilesToCompose = useCallback(
        async (files) => {
            const list = Array.from(files || []).filter(Boolean);
            if (!list.length) return;
            const maxBytes = 8 * 1024 * 1024;
            const accepted = list.filter((f) => f.size <= maxBytes);
            const skipped = list.length - accepted.length;
            if (!accepted.length) {
                toast.warning('Each file must be under 8MB');
                return;
            }
            const mapped = await Promise.all(
                accepted.map(
                    (file) =>
                        new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onload = () =>
                                resolve({
                                    id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                                    name: file.name,
                                    type: file.type || 'application/octet-stream',
                                    size: file.size,
                                    dataUrl: String(reader.result || ''),
                                });
                            reader.onerror = () => resolve(null);
                            reader.readAsDataURL(file);
                        })
                )
            );
            const valid = mapped.filter((x) => x && x.dataUrl);
            if (valid.length) {
                setCompose((p) => ({ ...p, attachments: [...(p.attachments || []), ...valid] }));
                toast.success(`${valid.length} file${valid.length > 1 ? 's' : ''} attached`);
            }
            if (skipped > 0) toast.warning(`${skipped} file skipped (over 8MB)`);
        },
        [toast]
    );

    const removeAttachment = useCallback((id) => {
        setCompose((p) => ({ ...p, attachments: (p.attachments || []).filter((a) => a.id !== id) }));
    }, []);

    const buildDraftFromCompose = useCallback(() => {
        const htmlBody = /<([a-z][\w-]*)(\s[^>]*)?>/i.test(String(composeHtmlCode || '').trim())
            ? String(composeHtmlCode || '').trim()
            : String(compose.html || '').trim();
        const textBody = String(compose.text || '').trim() || stripHtmlToPlain(htmlBody);
        return {
            id: compose.draftId || `dr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            from: 'admin-d@greenmotioncarrental.ch',
            to: String(compose.to || '').trim(),
            cc: String(compose.cc || '').trim(),
            subject: String(compose.subject || '').trim() || '(No subject)',
            text: textBody,
            html: htmlBody,
            attachments: Array.isArray(compose.attachments) ? compose.attachments : [],
            updatedAt: new Date().toISOString(),
            direction: 'draft',
        };
    }, [compose, composeHtmlCode]);

    const closeCompose = useCallback(() => {
        setShowComposeModal(false);
        setShowComposePreview(false);
        setShowHtmlCodeInput(false);
        setShowDraftExitConfirm(false);
    }, []);

    const requestCloseCompose = useCallback(() => {
        const dirty =
            !!(
                String(compose.to || '').trim() ||
                String(compose.cc || '').trim() ||
                String(compose.subject || '').trim() ||
                String(compose.text || '').trim() ||
                String(compose.html || '').trim() ||
                String(composeHtmlCode || '').trim() ||
                (Array.isArray(compose.attachments) && compose.attachments.length)
            );
        if (dirty) {
            setShowDraftExitConfirm(true);
            return;
        }
        closeCompose();
    }, [compose, composeHtmlCode, closeCompose]);

    const saveDraftAndClose = useCallback(() => {
        const nextDraft = buildDraftFromCompose();
        persistDrafts([
            nextDraft,
            ...drafts.filter((d) => String(d.id) !== String(nextDraft.id)),
        ]);
        setCompose({
            draftId: '',
            to: '',
            cc: '',
            subject: '',
            from: 'admin-d@greenmotioncarrental.ch',
            text: '',
            html: '',
            attachments: [],
        });
        setComposeHtmlCode('');
        closeCompose();
        toast.success('Draft saved');
    }, [buildDraftFromCompose, drafts, persistDrafts, closeCompose, toast]);

    const discardComposeAndClose = useCallback(() => {
        setShowDraftExitConfirm(false);
        setCompose({
            draftId: '',
            to: '',
            cc: '',
            subject: '',
            from: 'admin-d@greenmotioncarrental.ch',
            text: '',
            html: '',
            attachments: [],
        });
        setComposeHtmlCode('');
        closeCompose();
    }, [closeCompose]);

    const openDraftForEdit = useCallback((draft) => {
        if (!draft) return;
        setCompose({
            draftId: String(draft.id || ''),
            to: String(draft.to || ''),
            cc: String(draft.cc || ''),
            subject: String(draft.subject || ''),
            from: 'admin-d@greenmotioncarrental.ch',
            text: String(draft.text || ''),
            html: String(draft.html || ''),
            attachments: Array.isArray(draft.attachments) ? draft.attachments : [],
        });
        setComposeHtmlCode(String(draft.html || ''));
        setShowHtmlCodeInput(/<([a-z][\w-]*)(\s[^>]*)?>/i.test(String(draft.html || '')));
        setShowComposeModal(true);
    }, []);

    const downloadAttachment = useCallback((att) => {
        const dataUrl = att?.dataUrl || att?.previewDataUrl;
        if (!dataUrl) {
            toast.info('Preview/download data is not available for this attachment.');
            return;
        }
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = String(att?.name || 'attachment');
        document.body.appendChild(a);
        a.click();
        a.remove();
    }, [toast]);

    const openAttachmentPreview = useCallback((attachments, startIndex = 0) => {
        const items = (attachments || [])
            .map((att, idx) => {
                const meta = attachmentMeta(att);
                return {
                    index: idx,
                    name: meta.name,
                    type: meta.type,
                    isImage: meta.isImage,
                    isPdf: meta.isPdf,
                    dataUrl: att?.dataUrl || att?.previewDataUrl || '',
                };
            })
            .filter((x) => x.dataUrl);
        if (!items.length) return;
        const mappedStart = Math.max(0, items.findIndex((x) => x.index === startIndex));
        setPreviewItems(items);
        setPreviewIndex(mappedStart < 0 ? 0 : mappedStart);
        setPreviewZoom(1);
        setPreviewAttachment(items[mappedStart < 0 ? 0 : mappedStart]);
    }, []);

    const navigatePreview = useCallback((delta) => {
        setPreviewIndex((prev) => {
            if (!previewItems.length) return prev;
            const next = (prev + delta + previewItems.length) % previewItems.length;
            setPreviewAttachment(previewItems[next]);
            setPreviewZoom(1);
            return next;
        });
    }, [previewItems]);

    const composeCodeLooksLikeHtml = useMemo(
        () => /<([a-z][\w-]*)(\s[^>]*)?>/i.test(String(composeHtmlCode || '').trim()),
        [composeHtmlCode]
    );

    const archiveMessage = useCallback(
        (msg) => {
            const mid = String(msg?.id ?? msg?.uid ?? '');
            if (!mid) return;
            const next = new Set(archivedIds);
            next.add(mid);
            persistArchived(next);
            if (selectedMessage && String(selectedMessage.id ?? selectedMessage.uid ?? '') === mid) {
                setSelectedMessage(null);
            }
            toast.success('Archived');
        },
        [archivedIds, persistArchived, selectedMessage, toast]
    );

    const unarchiveMessage = useCallback(
        (msg) => {
            const mid = String(msg?.id ?? msg?.uid ?? '');
            if (!mid) return;
            const next = new Set(archivedIds);
            next.delete(mid);
            persistArchived(next);
            toast.success('Moved to inbox');
        },
        [archivedIds, persistArchived, toast]
    );

    const handleDropToFolder = useCallback(
        async (targetFolder) => {
            const msg = draggingMessage;
            if (!msg) return;
            if (targetFolder === 'trash') {
                await performMoveToTrash(msg);
            } else if (targetFolder === 'favorites') {
                if (!isFavorite(msg)) {
                    const id = String(msg?.id ?? msg?.uid ?? '');
                    if (id) persistFavorites([id, ...favoriteIds.filter((x) => x !== id)]);
                }
                toast.success('Added to favorites');
            } else if (targetFolder === 'archive') {
                archiveMessage(msg);
            }
            setDraggingMessage(null);
        },
        [draggingMessage, performMoveToTrash, isFavorite, persistFavorites, favoriteIds, toast, archiveMessage]
    );

    const handleSend = async () => {
        const htmlBody = composeCodeLooksLikeHtml
            ? String(composeHtmlCode || '').trim()
            : String(compose.html || '').trim();
        const textBody = String(compose.text || '').trim() || stripHtmlToPlain(htmlBody);
        if (!compose.to || !compose.subject || (!textBody && !htmlBody)) {
            toast.warning('Recipient, subject, and a message body are required');
            return;
        }
        if (!apiBase) {
            toast.error('REACT_APP_MAIL_API_BASE is not set');
            return;
        }
        setLoading(true);
        try {
            const smtpPayload =
                franchiseSmtp && franchiseSmtp.host && franchiseSmtp.username && franchiseSmtp.password
                    ? {
                          host: franchiseSmtp.host,
                          port: Number(franchiseSmtp.port || 587),
                          secure: franchiseSmtp.useTLS === true || Number(franchiseSmtp.port) === 465,
                          user: franchiseSmtp.username,
                          pass: franchiseSmtp.password,
                          from:
                              franchiseSmtp.senderEmail ||
                              franchiseSmtp.senderName ||
                              compose.from,
                      }
                    : undefined;

            const response = await fetch(`${apiBase}/mail/send`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...compose,
                    text: textBody,
                    html: htmlBody,
                    attachments: Array.isArray(compose.attachments) ? compose.attachments : [],
                    franchiseId: franchiseIdUpper,
                    smtp: smtpPayload,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }
            toast.success('Message sent');
            const composeRecipients = [...splitAddresses(compose.to), ...splitAddresses(compose.cc)];
            if (composeRecipients.length) {
                const nextCrm = mergeCrmContacts(crmContacts, composeRecipients);
                persistCrmContacts(nextCrm);
            }
            if (compose.draftId) {
                persistDrafts(drafts.filter((d) => String(d.id) !== String(compose.draftId)));
            }
            setCompose({
                draftId: '',
                to: '',
                cc: '',
                subject: '',
                from: 'admin-d@greenmotioncarrental.ch',
                text: '',
                html: '',
                attachments: [],
            });
            setComposeHtmlCode('');
            setShowHtmlCodeInput(false);
            const items = await loadSent();
            const newId = payload?.id;
            const pick = newId ? items.find((m) => m.id === newId) : items[0];
            if (pick) {
                setSelectedMessage({
                    ...pick,
                    attachments:
                        Array.isArray(pick.attachments) && pick.attachments.length > 0
                            ? pick.attachments
                            : (compose.attachments || []).map((a) => ({
                                  name: a.name,
                                  type: a.type,
                                  size: a.size,
                                  dataUrl: a.dataUrl,
                              })),
                });
            }
            closeCompose();
            setFolder('sent');
        } catch (error) {
            console.error('Mail send failed:', error);
            toast.error(error?.message || 'Send failed');
        } finally {
            setLoading(false);
        }
    };

    const folderTitle = useMemo(() => {
        if (folder === 'inbox') return 'Inbox';
        if (folder === 'sent') return 'Sent';
        if (folder === 'drafts') return 'Drafts';
        if (folder === 'archive') return 'Archive';
        if (folder === 'trash') return 'Recently deleted';
        if (folder === 'favorites') return 'Favorites';
        if (folder.startsWith('group:')) {
            const g = groups.find((x) => x.id === folder.slice(6));
            return g ? g.name : 'Group';
        }
        return '';
    }, [folder, groups]);

    const shellClass =
        'w-full h-full max-w-[min(100%,1880px)] mx-auto rounded-none sm:rounded-[20px] border-0 sm:border border-slate-200/90 dark:border-white/[0.08] bg-white/90 dark:bg-[#17171a]/90 backdrop-blur-xl sm:shadow-[0_10px_48px_-16px_rgba(0,0,0,0.18)] dark:sm:shadow-[0_14px_56px_-14px_rgba(0,0,0,0.56)] overflow-hidden flex flex-col lg:flex-row min-h-0';

    const mailListUi = true;

    return (
        <div className="w-full h-full flex-1 flex flex-col min-h-0 erpx-page text-[15px] leading-snug">
            <datalist id="mail-recipient-suggestions">
                {crmRecipientSuggestions.map((contact) => (
                    <option
                        key={contact.email}
                        value={contact.email}
                        label={contact.name ? `${contact.name} <${contact.email}>` : contact.email}
                    />
                ))}
            </datalist>
            <div className={`${shellClass} flex-1 min-h-0`}>
                <aside className="w-full lg:w-[240px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.06] bg-slate-50/70 dark:bg-sap-bgDark-card/95 flex flex-col max-h-[48vh] lg:max-h-none overflow-y-auto lg:overflow-visible">
                    <div className="p-4 sm:p-5 border-b border-slate-200/60 dark:border-white/[0.06] shrink-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400 mb-3">
                            Mailbox
                        </p>
                        <button
                            type="button"
                            onClick={() => setShowComposeModal(true)}
                            className="w-full gm-btn gm-btn-primary gm-btn-md"
                        >
                            <SquarePen size={18} strokeWidth={2} />
                            New message
                        </button>
                    </div>

                    <nav className="p-2 sm:p-3 flex flex-col gap-0.5 flex-1 min-h-0">
                        <button
                            type="button"
                            onClick={() => setFolder('inbox')}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'inbox'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Inbox size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Inbox</span>
                            {unreadCount > 0 ? (
                                <span className="gm-badge gm-badge-purple min-w-[24px] justify-center tabular-nums">
                                    {unreadCount > 99 ? '99+' : unreadCount}
                                </span>
                            ) : null}
                        </button>
                        <button
                            type="button"
                            onClick={() => setFolder('sent')}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'sent'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Send size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Sent</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setFolder('drafts')}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'drafts'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Clock size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Drafts</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setFolder('archive')}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                void handleDropToFolder('archive');
                            }}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'archive'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Archive size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Archive</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setFolder('favorites')}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                void handleDropToFolder('favorites');
                            }}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'favorites'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Star size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Favorites</span>
                            {favoriteIds.length > 0 ? (
                                <span className="text-[12px] tabular-nums text-slate-400">{favoriteIds.length}</span>
                            ) : null}
                        </button>
                        <button
                            type="button"
                            onClick={() => setFolder('trash')}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => {
                                e.preventDefault();
                                void handleDropToFolder('trash');
                            }}
                            className={`flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-left text-[15px] font-medium transition-colors ${
                                folder === 'trash'
                                    ? 'bg-white dark:bg-white/[0.08] text-slate-900 dark:text-white shadow-sm ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                    : 'text-slate-600 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04]'
                            }`}
                        >
                            <Trash2 size={19} className="shrink-0 opacity-85" strokeWidth={1.75} />
                            <span className="flex-1">Recently deleted</span>
                            {trashItems.length > 0 ? (
                                <span className="text-[12px] tabular-nums text-slate-400">{trashItems.length}</span>
                            ) : null}
                        </button>

                        <div className="pt-2 mt-1 border-t border-slate-200/60 dark:border-white/[0.06]">
                            <button
                                type="button"
                                onClick={() => setGroupsOpen((o) => !o)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-slate-500 dark:text-slate-400"
                            >
                                <ChevronRight size={16} className={`transition-transform ${groupsOpen ? 'rotate-90' : ''}`} />
                                Groups
                            </button>
                            {groupsOpen && (
                                <div className="flex flex-col gap-0.5 pl-1">
                                    <button
                                        type="button"
                                        onClick={() => setShowNewGroupModal(true)}
                                        className="flex items-center gap-2 rounded-[10px] px-3 py-2 text-left text-[14px] text-[#007aff] dark:text-[#0a84ff] hover:bg-[#007aff]/8"
                                    >
                                        <FolderPlus size={16} />
                                        New group
                                    </button>
                                    {groups.map((g) => (
                                        <div
                                            key={g.id}
                                            draggable
                                            onDragStart={(e) => {
                                                e.dataTransfer.setData('application/x-greenmotion-group', g.id);
                                                e.dataTransfer.effectAllowed = 'move';
                                                setDraggingGroupId(g.id);
                                            }}
                                            onDragEnd={() => setDraggingGroupId(null)}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'move';
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                const fromId = e.dataTransfer.getData('application/x-greenmotion-group');
                                                reorderGroups(fromId, g.id);
                                                setDraggingGroupId(null);
                                            }}
                                            className={`flex items-center gap-0.5 rounded-[10px] pl-1 pr-1 transition-colors ${
                                                draggingGroupId === g.id ? 'opacity-60' : ''
                                            } ${
                                                folder === `group:${g.id}`
                                                    ? 'bg-white dark:bg-white/[0.08] ring-1 ring-slate-200/80 dark:ring-white/[0.08]'
                                                    : 'hover:bg-white/60 dark:hover:bg-white/[0.04]'
                                            }`}
                                        >
                                            <span
                                                className="p-1.5 cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 shrink-0"
                                                title="Drag to reorder"
                                                role="presentation"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <GripVertical size={16} strokeWidth={1.75} />
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => setFolder(`group:${g.id}`)}
                                                className={`flex flex-1 items-center gap-2 min-w-0 rounded-[8px] px-2 py-2 text-left text-[14px] transition-colors ${
                                                    folder === `group:${g.id}`
                                                        ? 'text-slate-900 dark:text-white'
                                                        : 'text-slate-600 dark:text-slate-400'
                                                }`}
                                            >
                                                <span className="truncate flex-1">{g.name}</span>
                                                <span className="text-[11px] text-slate-400 tabular-nums shrink-0">
                                                    {g.messageIds.length}
                                                </span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteGroupId(g.id);
                                                }}
                                                className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-500/10 shrink-0"
                                                title="Delete group"
                                            >
                                                <Trash2 size={15} strokeWidth={1.75} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div className="mt-auto pt-3 border-t border-slate-200/60 dark:border-white/[0.06] shrink-0">
                            <button
                                type="button"
                                onClick={() => refreshFolder()}
                                disabled={loading || !apiBase || showComposeModal}
                                className="w-full flex items-center gap-2 rounded-[10px] px-2 py-2.5 text-[13px] text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-white/[0.04] disabled:opacity-35"
                            >
                                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} strokeWidth={1.75} />
                                Refresh
                            </button>
                        </div>
                    </nav>
                </aside>

                <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-slate-50/40 dark:bg-[#0a0a0c]/50">
                    {showNewGroupModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl">
                                <div className="flex items-center justify-between mb-4">
                                    <h4 className="text-lg font-semibold text-slate-900 dark:text-white">New group</h4>
                                    <button type="button" onClick={() => setShowNewGroupModal(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                                        <X size={20} />
                                    </button>
                                </div>
                                <input
                                    className="w-full h-11 px-3 rounded-xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-[#0e0e10] text-slate-900 dark:text-white mb-4"
                                    placeholder="Group name"
                                    value={newGroupName}
                                    onChange={(e) => setNewGroupName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && createGroup()}
                                />
                                <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setShowNewGroupModal(false)} className="px-4 py-2 rounded-xl text-[14px] text-slate-600 dark:text-slate-300">
                                        Cancel
                                    </button>
                                    <button type="button" onClick={createGroup} className="px-4 py-2 rounded-xl text-[14px] font-semibold text-white bg-[#007aff] dark:bg-[#0a84ff]">
                                        Create
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showAddToGroup && selectedMessage && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl max-h-[70vh] overflow-y-auto">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-base font-semibold text-slate-900 dark:text-white">Add to group</h4>
                                    <button type="button" onClick={() => setShowAddToGroup(false)} className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10">
                                        <X size={18} />
                                    </button>
                                </div>
                                {groups.length === 0 ? (
                                    <p className="text-sm text-slate-500">Create a group first.</p>
                                ) : (
                                    <ul className="space-y-1">
                                        {groups.map((g) => (
                                            <li key={g.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => addSelectedToGroup(g.id)}
                                                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] text-[14px] text-slate-800 dark:text-slate-100"
                                                >
                                                    {g.name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {deleteGroupId && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl">
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Delete group?</h4>
                                <p className="text-[14px] text-slate-500 dark:text-slate-400 mb-4">
                                    Messages stay in Inbox / Sent; only the group label is removed.
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setDeleteGroupId(null)}
                                        className="px-4 py-2 rounded-xl text-[14px] text-slate-600 dark:text-slate-300"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={confirmDeleteGroup}
                                        className="px-4 py-2 rounded-xl text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500"
                                    >
                                        Delete group
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showSignatureModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl max-h-[85vh] flex flex-col">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Email signature</h4>
                                    <button
                                        type="button"
                                        onClick={() => setShowSignatureModal(false)}
                                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                                <p className="text-[13px] text-slate-500 dark:text-slate-400 mb-2">
                                    HTML allowed (e.g. name, title, link). Use “Insert signature” in compose to append it.
                                </p>
                                <textarea
                                    className="gm-field w-full flex-1 min-h-[160px] rounded-xl font-mono text-[12px] leading-relaxed resize-y mb-4"
                                    value={signatureDraft}
                                    onChange={(e) => setSignatureDraft(e.target.value)}
                                    placeholder="<p>— Name</p>"
                                />
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowSignatureModal(false)}
                                        className="px-4 py-2 rounded-xl text-[14px] text-slate-600 dark:text-slate-300"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            saveJson(LS_SIGNATURE, signatureDraft);
                                            setShowSignatureModal(false);
                                            toast.success('Signature saved');
                                        }}
                                        className="px-4 py-2 rounded-xl text-[14px] font-semibold text-white bg-[#007aff] dark:bg-[#0a84ff]"
                                    >
                                        Save
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showTemplatesModal && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl max-h-[80vh] overflow-y-auto">
                                <div className="flex items-center justify-between mb-3">
                                    <h4 className="text-lg font-semibold text-slate-900 dark:text-white">Templates</h4>
                                    <button
                                        type="button"
                                        onClick={() => setShowTemplatesModal(false)}
                                        className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10"
                                    >
                                        <X size={20} />
                                    </button>
                                </div>
                                <div className="space-y-2 mb-4 pb-4 border-b border-slate-200/80 dark:border-white/[0.08]">
                                    <label className="text-[12px] font-semibold text-slate-500 dark:text-slate-400">Save current body as template</label>
                                    <input
                                        className="gm-field w-full rounded-xl h-10 mb-2"
                                        placeholder="Template name"
                                        value={newTemplateName}
                                        onChange={(e) => setNewTemplateName(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => saveTemplateFromCompose()}
                                        className="w-full py-2.5 rounded-xl text-[14px] font-medium bg-slate-100 dark:bg-white/[0.08] text-slate-800 dark:text-slate-100"
                                    >
                                        Save template
                                    </button>
                                </div>
                                {(Array.isArray(templates) ? templates : []).length === 0 ? (
                                    <p className="text-sm text-slate-500">No templates yet.</p>
                                ) : (
                                    <ul className="space-y-2">
                                        {(Array.isArray(templates) ? templates : []).map((t) => (
                                            <li
                                                key={t.id}
                                                className="flex items-center gap-2 rounded-xl border border-slate-200/80 dark:border-white/[0.08] p-2"
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-[14px] font-medium text-slate-900 dark:text-white truncate">{t.name}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => applyTemplate(t)}
                                                    className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-[#007aff] dark:text-[#0a84ff]"
                                                >
                                                    Apply
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => removeTemplate(t.id)}
                                                    className="p-2 rounded-lg text-slate-400 hover:text-red-500"
                                                    title="Remove"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    )}

                    {showDeleteConfirm && selectedMessage && (
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl">
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
                                    {folder === 'trash' ? 'Delete permanently?' : 'Move to Recently deleted?'}
                                </h4>
                                <p className="text-[14px] text-slate-500 dark:text-slate-400 mb-4">
                                    {folder === 'trash'
                                        ? 'This cannot be undone.'
                                        : 'You can restore from Recently deleted later.'}
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowDeleteConfirm(false)}
                                        className="px-4 py-2 rounded-xl text-[14px] text-slate-600 dark:text-slate-300"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            void (folder === 'trash'
                                                ? performPermanentDelete(selectedMessage)
                                                : performMoveToTrash(selectedMessage));
                                        }}
                                        className="px-4 py-2 rounded-xl text-[14px] font-semibold text-white bg-red-600 hover:bg-red-500"
                                    >
                                        {folder === 'trash' ? 'Delete' : 'Move to trash'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {showComposeModal && (
                        <div
                            className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/35 backdrop-blur-sm"
                            onClick={requestCloseCompose}
                        >
                            <div
                                className="w-full sm:w-[min(100%,980px)] h-[85dvh] sm:h-[min(88dvh,760px)] rounded-t-2xl sm:rounded-2xl border border-slate-200/90 dark:border-white/[0.08] bg-white/95 dark:bg-[#141416]/95 shadow-2xl flex flex-col overflow-hidden"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="h-11 px-4 flex items-center justify-between border-b border-slate-200/80 dark:border-white/[0.08] bg-white/75 dark:bg-sap-bgDark-card/70 backdrop-blur-xl">
                                    <p className="mail-headline text-slate-900 dark:text-white">New Message</p>
                                    <button
                                        type="button"
                                        onClick={requestCloseCompose}
                                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.08]"
                                    >
                                        <X size={17} />
                                    </button>
                                </div>
                                <div className="flex-1 min-h-0 flex flex-col rounded-[18px] border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-[#121214]/85 overflow-hidden">
                                    <div className="border-b border-slate-200/80 dark:border-white/[0.08]">
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">To</span>
                                            <input
                                                className="mail-line-input text-[14px] text-slate-900 dark:text-slate-100"
                                                value={compose.to}
                                                onChange={(e) => setCompose((p) => ({ ...p, to: e.target.value }))}
                                                placeholder="name@company.com"
                                                list="mail-recipient-suggestions"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">Cc</span>
                                            <input
                                                className="mail-line-input text-[14px] text-slate-900 dark:text-slate-100"
                                                value={compose.cc || ''}
                                                onChange={(e) => setCompose((p) => ({ ...p, cc: e.target.value }))}
                                                placeholder="optional@company.com"
                                                list="mail-recipient-suggestions"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">Subject</span>
                                            <input
                                                className="mail-line-input text-[14px] text-slate-900 dark:text-slate-100"
                                                value={compose.subject}
                                                onChange={(e) => setCompose((p) => ({ ...p, subject: e.target.value }))}
                                                placeholder="Subject line"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">From</span>
                                            <span className="text-[13px] text-slate-700 dark:text-slate-300">
                                                {compose.from || 'admin-d@greenmotioncarrental.ch'}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="p-3 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowSignatureModal(true)}
                                                className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                Signature…
                                            </button>
                                            <button
                                                type="button"
                                                onClick={insertSavedSignature}
                                                className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                Insert signature
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setShowTemplatesModal(true)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                <LayoutTemplate size={13} />
                                                Templates
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setShowHtmlCodeInput((v) => !v)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                HTML code
                                            </button>
                                            {composeCodeLooksLikeHtml && (
                                                <button
                                                    type="button"
                                                    onClick={() => setShowComposePreview(true)}
                                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-[#007aff] dark:text-[#0a84ff] hover:bg-[#0a84ff]/10"
                                                >
                                                    <Eye size={13} />
                                                    Preview
                                                </button>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={requestCloseCompose}
                                                className="gm-btn gm-btn-secondary gm-btn-sm"
                                                disabled={loading}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSend}
                                                className="gm-btn gm-btn-primary gm-btn-md"
                                                disabled={loading}
                                            >
                                                {loading ? <RotateCw size={16} className="animate-spin" /> : <Send size={16} />}
                                                {loading ? 'Sending…' : 'Send'}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex-1 min-h-0 p-3 overflow-y-auto">
                                        {showHtmlCodeInput && (
                                            <div className="mb-3">
                                                <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500 mb-1.5">
                                                    HTML code
                                                </label>
                                                <textarea
                                                    value={composeHtmlCode}
                                                    onChange={(e) => setComposeHtmlCode(e.target.value)}
                                                    placeholder="<h2>Hello</h2><p>Paste raw HTML here (optional)</p>"
                                                    className="w-full min-h-[96px] rounded-xl border border-slate-200/90 dark:border-white/[0.1] bg-white dark:bg-[#0f0f11] p-3 text-[12px] font-mono leading-relaxed text-slate-700 dark:text-slate-200"
                                                />
                                            </div>
                                        )}
                                        <div
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                if (!isDropActive) setIsDropActive(true);
                                            }}
                                            onDragLeave={(e) => {
                                                e.preventDefault();
                                                setIsDropActive(false);
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                setIsDropActive(false);
                                                void addFilesToCompose(e.dataTransfer?.files);
                                            }}
                                            className={`mb-3 rounded-xl border border-dashed px-3 py-2.5 text-[12px] transition-colors ${
                                                isDropActive
                                                    ? 'border-[#0a84ff] bg-[#0a84ff]/10 text-[#0a84ff]'
                                                    : 'border-slate-300/80 dark:border-white/[0.15] text-slate-500 dark:text-slate-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Drag files here to attach</span>
                                                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.08] text-slate-700 dark:text-slate-200 cursor-pointer">
                                                    <Paperclip size={13} />
                                                    Add files
                                                    <input
                                                        type="file"
                                                        multiple
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            void addFilesToCompose(e.target.files);
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                        {Array.isArray(compose.attachments) && compose.attachments.length > 0 ? (
                                            <div className="mb-3 flex flex-wrap gap-2.5">
                                                {compose.attachments.map((att) => {
                                                    const meta = attachmentMeta(att);
                                                    const Icon = meta.Icon;
                                                    return (
                                                        <div
                                                            key={att.id}
                                                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200/90 dark:border-white/[0.12] bg-white/90 dark:bg-[#222226]/85 px-2.5 py-1.5 shadow-sm"
                                                        >
                                                            <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/[0.08] flex items-center justify-center">
                                                                <Icon size={14} className="text-slate-500 dark:text-slate-300" />
                                                            </span>
                                                            <div className="min-w-0">
                                                                <p className="text-[12px] text-slate-800 dark:text-slate-100 max-w-[210px] truncate">
                                                                    {meta.name}
                                                                </p>
                                                                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                                                    {formatFileSize(att.size) || 'Attachment'}
                                                                </p>
                                                            </div>
                                                            <button
                                                                type="button"
                                                                className="text-slate-400 hover:text-red-500"
                                                                onClick={() => removeAttachment(att.id)}
                                                                title="Remove attachment"
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : null}
                                        <MailComposeRichEditor
                                            value={composeCodeLooksLikeHtml ? composeHtmlCode : compose.html}
                                            onChange={(html) =>
                                                composeCodeLooksLikeHtml
                                                    ? setComposeHtmlCode(html)
                                                    : setCompose((p) => ({ ...p, html, text: stripHtmlToPlain(html) }))
                                            }
                                            isDark={isDark}
                                            className="h-full"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {showComposePreview && (
                        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/35 backdrop-blur-sm">
                            <div className="w-full max-w-4xl h-[80vh] rounded-2xl border border-slate-200/90 dark:border-white/[0.1] bg-white dark:bg-[#141416] shadow-2xl overflow-hidden flex flex-col">
                                <div className="h-11 px-4 border-b border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between">
                                    <p className="mail-headline text-slate-900 dark:text-white">HTML Preview</p>
                                    <button
                                        type="button"
                                        onClick={() => setShowComposePreview(false)}
                                        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.08]"
                                    >
                                        <X size={17} />
                                    </button>
                                </div>
                                <iframe
                                    title="Compose HTML preview"
                                    className="w-full h-full border-0"
                                    sandbox="allow-same-origin"
                                    srcDoc={buildPreviewSrcDoc(
                                        sanitizeMailHtml(composeCodeLooksLikeHtml ? composeHtmlCode : compose.html),
                                        isDark
                                    )}
                                />
                            </div>
                        </div>
                    )}

                    {showDraftExitConfirm && (
                        <div className="fixed inset-0 z-[132] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
                            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-white/[0.1] bg-white dark:bg-sap-bgDark-card p-5 shadow-xl">
                                <h4 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">Save as draft?</h4>
                                <p className="text-[14px] text-slate-500 dark:text-slate-400 mb-4">
                                    You have unsaved changes. Save this message in Drafts before closing?
                                </p>
                                <div className="flex justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setShowDraftExitConfirm(false)}
                                        className="px-4 py-2 rounded-xl text-[14px] text-slate-600 dark:text-slate-300"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="button"
                                        onClick={discardComposeAndClose}
                                        className="px-4 py-2 rounded-xl text-[14px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-white/[0.08]"
                                    >
                                        Discard
                                    </button>
                                    <button
                                        type="button"
                                        onClick={saveDraftAndClose}
                                        className="px-4 py-2 rounded-xl text-[14px] font-semibold text-white bg-[#0a84ff]"
                                    >
                                        Save Draft
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {previewAttachment && (
                        <div className="fixed inset-0 z-[135] flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm">
                            <div className="w-full max-w-5xl h-[84vh] rounded-2xl border border-slate-200/90 dark:border-white/[0.1] bg-white dark:bg-[#141416] shadow-2xl overflow-hidden flex flex-col">
                                <div className="h-11 px-4 border-b border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between">
                                    <p className="mail-headline text-slate-900 dark:text-white truncate pr-3">
                                        {previewAttachment.name || 'Attachment'}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        {previewItems.length > 1 ? (
                                            <span className="text-[12px] text-slate-500 dark:text-slate-400">
                                                {previewIndex + 1}/{previewItems.length}
                                            </span>
                                        ) : null}
                                        {previewAttachment.isImage ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewZoom((z) => Math.max(0.5, z - 0.1))}
                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                >
                                                    -
                                                </button>
                                                <span className="text-[12px] text-slate-500 dark:text-slate-400 w-10 text-center">
                                                    {Math.round(previewZoom * 100)}%
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => setPreviewZoom((z) => Math.min(3, z + 0.1))}
                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                >
                                                    +
                                                </button>
                                            </>
                                        ) : null}
                                        {previewItems.length > 1 ? (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => navigatePreview(-1)}
                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                >
                                                    ◀
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => navigatePreview(1)}
                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                >
                                                    ▶
                                                </button>
                                            </>
                                        ) : null}
                                        <button
                                            type="button"
                                            onClick={() => downloadAttachment(previewAttachment)}
                                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                        >
                                            <Download size={13} />
                                            Download
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setPreviewAttachment(null)}
                                            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/[0.08]"
                                        >
                                            <X size={17} />
                                        </button>
                                    </div>
                                </div>
                                {String(previewAttachment.type || '').toLowerCase().includes('pdf') ? (
                                    <iframe
                                        title="Attachment PDF preview"
                                        src={previewAttachment.dataUrl}
                                        className="w-full h-full border-0 bg-white"
                                    />
                                ) : (
                                    <div className="w-full h-full bg-black/90 flex items-center justify-center p-4 overflow-auto">
                                        <img
                                            src={previewAttachment.dataUrl}
                                            alt={previewAttachment.name || 'Attachment preview'}
                                            className="max-w-full max-h-full object-contain transition-transform duration-150"
                                            style={{ transform: `scale(${previewZoom})` }}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {mailListUi ? (
                        <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
                            <div className="px-4 sm:px-5 pt-4 pb-3 flex flex-col lg:flex-row lg:items-center gap-3 border-b border-slate-200/80 dark:border-white/[0.06] shrink-0">
                                <div className="relative flex-1 min-w-0">
                                    <Search
                                        size={16}
                                        className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500 pointer-events-none"
                                        strokeWidth={2}
                                    />
                                    <input
                                        type="search"
                                        value={listQuery}
                                        onChange={(e) => setListQuery(e.target.value)}
                                        placeholder="Search"
                                        className="w-full h-11 pl-10 pr-4 rounded-[10px] text-[15px] text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 bg-white dark:bg-[#141416] border border-slate-200/90 dark:border-white/[0.08] focus:outline-none focus:ring-2 focus:ring-[#007aff]/35 dark:focus:ring-[#0a84ff]/35"
                                    />
                                </div>
                                {folder === 'inbox' && (
                                    <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                        <div className="inline-flex rounded-[10px] border border-slate-200/90 dark:border-white/[0.08] p-0.5 bg-white/80 dark:bg-[#141416]/80">
                                            <button
                                                type="button"
                                                onClick={() => setInboxFilter('all')}
                                                className={`px-3 py-1.5 rounded-[8px] text-[13px] font-medium transition-colors ${
                                                    inboxFilter === 'all'
                                                        ? 'bg-slate-100 dark:bg-white/[0.1] text-slate-900 dark:text-white'
                                                        : 'text-slate-500 dark:text-slate-400'
                                                }`}
                                            >
                                                All
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setInboxFilter('unread')}
                                                className={`px-3 py-1.5 rounded-[8px] text-[13px] font-medium inline-flex items-center gap-1.5 transition-colors ${
                                                    inboxFilter === 'unread'
                                                        ? 'bg-slate-100 dark:bg-white/[0.1] text-slate-900 dark:text-white'
                                                        : 'text-slate-500 dark:text-slate-400'
                                                }`}
                                            >
                                                <Circle size={7} className="fill-[#007aff] text-[#007aff] dark:fill-[#0a84ff]" />
                                                Unread
                                                {unreadCount > 0 ? (
                                                    <span className="tabular-nums opacity-80">({unreadCount})</span>
                                                ) : null}
                                            </button>
                                        </div>
                                        {unreadCount > 0 && (
                                            <button
                                                type="button"
                                                onClick={markAllInboxRead}
                                                className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[13px] font-medium text-[#007aff] dark:text-[#0a84ff] hover:bg-[#007aff]/10 dark:hover:bg-[#0a84ff]/10"
                                            >
                                                <CheckCheck size={15} strokeWidth={2} />
                                                Mark all read
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="flex-1 h-full grid items-stretch grid-cols-1 lg:grid-cols-[minmax(320px,380px)_1fr] min-h-0 overflow-hidden">
                                <div className="border-b lg:border-b-0 lg:border-r border-slate-200/80 dark:border-white/[0.06] h-full flex flex-col min-h-0 overflow-hidden bg-white/60 dark:bg-[#0e0e10]/60">
                                    <div className="px-4 py-2.5 flex items-center gap-2 border-b border-slate-100 dark:border-white/[0.04] shrink-0">
                                        <span className="text-[12px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-[0.08em]">
                                            {folderTitle} · {filteredInbox.length}
                                        </span>
                                    </div>
                                    <div
                                        className="mail-pane-scroll flex-1 h-0"
                                        style={{ overflowY: 'auto', minHeight: 0, height: '100%' }}
                                    >
                                        {loading && !filteredInbox.length ? (
                                            <div className="p-10 flex flex-col items-center justify-center text-slate-400 gap-3">
                                                <RotateCw size={26} className="animate-spin opacity-60" strokeWidth={1.75} />
                                                <span className="text-[15px]">Loading…</span>
                                            </div>
                                        ) : null}
                                        {!loading && filteredInbox.length === 0 ? (
                                            <div className="p-10 text-center">
                                                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-[18px] bg-slate-100/90 dark:bg-white/[0.06] text-slate-400 dark:text-slate-500">
                                                    {folder === 'trash' ? (
                                                        <Trash2 size={28} strokeWidth={1.5} />
                                                    ) : folder === 'favorites' ? (
                                                        <Star size={28} strokeWidth={1.5} />
                                                    ) : folder === 'drafts' ? (
                                                        <Clock size={28} strokeWidth={1.5} />
                                                    ) : folder === 'archive' ? (
                                                        <Archive size={28} strokeWidth={1.5} />
                                                    ) : folder.startsWith('group:') ? (
                                                        <FolderPlus size={28} strokeWidth={1.5} />
                                                    ) : folder === 'sent' ? (
                                                        <Send size={28} strokeWidth={1.5} />
                                                    ) : (
                                                        <Inbox size={28} strokeWidth={1.5} />
                                                    )}
                                                </div>
                                                <p className="text-[17px] font-semibold text-slate-900 dark:text-white tracking-tight">
                                                    {folder === 'trash'
                                                        ? 'Trash is empty'
                                                        : folder === 'favorites'
                                                          ? 'No favorites'
                                                          : folder === 'drafts'
                                                            ? 'No drafts'
                                                            : folder === 'archive'
                                                              ? 'Archive is empty'
                                                          : folder.startsWith('group:')
                                                            ? 'No messages in this group'
                                                            : folder === 'sent'
                                                              ? 'No sent messages'
                                                              : 'No messages'}
                                                </p>
                                                <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-2 max-w-[280px] mx-auto leading-relaxed">
                                                    {folder === 'favorites'
                                                        ? 'Star a message from the reading pane.'
                                                        : folder === 'drafts'
                                                          ? 'Saved drafts will appear here.'
                                                          : folder === 'archive'
                                                            ? 'Archived messages will appear here.'
                                                        : folder.startsWith('group:')
                                                          ? 'Use “Add to group” on any message.'
                                                          : folder === 'trash'
                                                            ? 'Deleted messages appear here.'
                                                            : folder === 'sent'
                                                              ? 'Sent mail will appear here after you send.'
                                                              : 'New messages will appear in this list.'}
                                                </p>
                                            </div>
                                        ) : null}
                                        {filteredInbox.map((msg) => {
                                            const realIdx = folderMessages.indexOf(msg);
                                            const id = stableMessageKey(msg);
                                            const active =
                                                !!selectedMessage &&
                                                (stableMessageKey(selectedMessage) === id ||
                                                    (selectedMessage.id != null && msg.id === selectedMessage.id) ||
                                                    (selectedMessage.uid != null && msg.uid === selectedMessage.uid));
                                            const unread =
                                                folder === 'inbox' && isUnread(msg, realIdx >= 0 ? realIdx : 0);
                                            const line2 =
                                                folder === 'sent' || msg.direction === 'sent'
                                                    ? msg.to || 'Recipient'
                                                    : msg.from || 'Sender';
                                            const snippet = (msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 72);
                                            const when = formatMailWhen(
                                                msg.sentAt || msg.date || msg.receivedAt || msg._deletedAt
                                            );
                                            const fav = isFavorite(msg);
                                            return (
                                                <div
                                                    key={id}
                                                    draggable
                                                    onDragStart={() => setDraggingMessage(msg)}
                                                    onDragEnd={() => setDraggingMessage(null)}
                                                    className={`flex border-b border-slate-100 dark:border-white/[0.04] transition-colors ${
                                                        active
                                                            ? 'bg-[#007aff]/8 dark:bg-[#0a84ff]/12'
                                                            : 'hover:bg-slate-50/90 dark:hover:bg-white/[0.03]'
                                                    }`}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSelectMessage(msg)}
                                                        className="flex-1 text-left px-4 py-3.5 min-w-0"
                                                    >
                                                        <div className="flex gap-3">
                                                            <div
                                                                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
                                                                    folder === 'sent' || msg.direction === 'sent'
                                                                        ? 'bg-slate-200/90 dark:bg-white/[0.08] text-slate-700 dark:text-slate-200'
                                                                        : unread
                                                                          ? 'bg-[#007aff]/18 dark:bg-[#0a84ff]/22 text-[#0060c9] dark:text-[#64b5ff]'
                                                                          : 'bg-slate-200/70 dark:bg-white/[0.06] text-slate-600 dark:text-slate-300'
                                                                }`}
                                                            >
                                                                {initialsFromAddress(line2)}
                                                            </div>
                                                            <div className="min-w-0 flex-1">
                                                                <div className="flex items-start justify-between gap-2">
                                                                    <p
                                                                        className={`text-[15px] leading-snug truncate tracking-tight ${unread ? 'font-semibold text-slate-900 dark:text-white' : 'font-medium text-slate-800 dark:text-slate-100'}`}
                                                                    >
                                                                        {msg.subject || '(No subject)'}
                                                                    </p>
                                                                    {when ? (
                                                                        <span className="text-[12px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums pt-0.5">
                                                                            {when}
                                                                        </span>
                                                                    ) : null}
                                                                </div>
                                                                <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                                                                    {line2}
                                                                </p>
                                                                {snippet ? (
                                                                    <p className="text-[12px] text-slate-400 dark:text-slate-500 truncate mt-1 leading-snug">
                                                                        {snippet}
                                                                    </p>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => toggleFavorite(msg, e)}
                                                        className="shrink-0 px-2 flex items-center text-amber-500 hover:opacity-80"
                                                        title={fav ? 'Remove favorite' : 'Favorite'}
                                                    >
                                                        <Star size={18} className={fav ? 'fill-current' : ''} strokeWidth={1.75} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="flex flex-col h-full bg-white/70 dark:bg-[#0c0c0e]/70 min-h-0 overflow-hidden">
                                    {selectedMessage ? (
                                        <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
                                            <div className="flex flex-wrap items-center gap-2 px-5 pt-4 pb-2 border-b border-slate-100 dark:border-white/[0.06] shrink-0">
                                                <button
                                                    type="button"
                                                    onClick={(e) => toggleFavorite(selectedMessage, e)}
                                                    className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                                                >
                                                    <Star size={16} className={isFavorite(selectedMessage) ? 'fill-current' : ''} />
                                                    {isFavorite(selectedMessage) ? 'Unfavorite' : 'Favorite'}
                                                </button>
                                                {groups.length > 0 && folder !== 'trash' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowAddToGroup(true)}
                                                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                                                    >
                                                        <FolderPlus size={16} />
                                                        Add to group
                                                    </button>
                                                )}
                                                {folder === 'trash' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => performRestoreFromTrash(selectedMessage)}
                                                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[#007aff] dark:text-[#0a84ff] hover:bg-[#007aff]/10"
                                                    >
                                                        <RotateCcw size={16} />
                                                        Restore
                                                    </button>
                                                )}
                                                {folder === 'drafts' && (
                                                    <button
                                                        type="button"
                                                        onClick={() => openDraftForEdit(selectedMessage)}
                                                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[#007aff] dark:text-[#0a84ff] hover:bg-[#007aff]/10"
                                                    >
                                                        <SquarePen size={16} />
                                                        Edit draft
                                                    </button>
                                                )}
                                                {folder === 'archive' ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => unarchiveMessage(selectedMessage)}
                                                        className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-[#007aff] dark:text-[#0a84ff] hover:bg-[#007aff]/10"
                                                    >
                                                        <RotateCcw size={16} />
                                                        Move to inbox
                                                    </button>
                                                ) : (
                                                    folder !== 'trash' && (
                                                        <button
                                                            type="button"
                                                            onClick={() => archiveMessage(selectedMessage)}
                                                            className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.06]"
                                                        >
                                                            <Archive size={16} />
                                                            Archive
                                                        </button>
                                                    )
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        folder === 'trash'
                                                            ? setShowDeleteConfirm(true)
                                                            : void performMoveToTrash(selectedMessage)
                                                    }
                                                    className="inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 ml-auto"
                                                >
                                                    <Trash2 size={16} />
                                                    {folder === 'trash' ? 'Delete permanently' : 'Delete'}
                                                </button>
                                            </div>
                                            <div className="mail-pane-scroll-force flex-1 h-0 p-5 sm:p-6 space-y-5 pb-24">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] px-2 py-1 rounded-lg bg-slate-200/80 dark:bg-white/[0.08] text-slate-600 dark:text-slate-300">
                                                        {folder === 'trash'
                                                            ? 'Deleted'
                                                            : folder === 'favorites'
                                                              ? 'Favorite'
                                                              : folder.startsWith('group:')
                                                                ? 'Group'
                                                                : folder === 'sent'
                                                                  ? 'Sent'
                                                                  : 'Inbox'}
                                                    </span>
                                                </div>
                                                <h3 className="text-[1.375rem] sm:text-[1.5rem] font-semibold text-slate-900 dark:text-white tracking-[-0.02em] leading-tight pr-2">
                                                    {selectedMessage.subject || '(No subject)'}
                                                </h3>
                                                <div className="space-y-2.5 text-[14px]">
                                                    <div className="flex items-start gap-2.5 text-slate-600 dark:text-slate-300">
                                                        <User size={16} className="shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" strokeWidth={1.75} />
                                                        <div>
                                                            <span className="text-slate-400 dark:text-slate-500">From </span>
                                                            <span className="text-slate-900 dark:text-white font-medium">
                                                                {selectedMessage.from || '—'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-start gap-2.5 text-slate-600 dark:text-slate-300">
                                                        <Send size={16} className="shrink-0 mt-0.5 text-slate-400 dark:text-slate-500" strokeWidth={1.75} />
                                                        <div>
                                                            <span className="text-slate-400 dark:text-slate-500">To </span>
                                                            <span className="text-slate-900 dark:text-white font-medium">
                                                                {selectedMessage.to || '—'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex items-center gap-2.5 text-slate-500 dark:text-slate-400">
                                                        <Clock size={16} className="shrink-0 text-slate-400 dark:text-slate-500" strokeWidth={1.75} />
                                                        {formatMailWhen(
                                                            selectedMessage.sentAt ||
                                                                selectedMessage.date ||
                                                                selectedMessage.receivedAt ||
                                                                selectedMessage._deletedAt
                                                        ) || '—'}
                                                    </div>
                                                </div>
                                                <div className="rounded-[14px] border border-slate-200/90 dark:border-white/[0.08] bg-slate-50/80 dark:bg-[#141416]/90 p-4 flex flex-col min-h-[160px]">
                                                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500 mb-3 shrink-0">
                                                        Message
                                                    </p>
                                                    {selectedMessage.html ? (
                                                        <div
                                                            className="mail-rendered-content text-[15px] text-slate-800 dark:text-slate-100 leading-relaxed break-words max-w-full overflow-x-auto"
                                                            dangerouslySetInnerHTML={{
                                                                __html: sanitizeMailHtml(selectedMessage.html),
                                                            }}
                                                        />
                                                    ) : (
                                                        <div className="text-[15px] text-slate-800 dark:text-slate-100 whitespace-pre-wrap leading-relaxed">
                                                            {selectedMessage.text || 'No plain text.'}
                                                        </div>
                                                    )}
                                                </div>
                                                {Array.isArray(selectedMessage.attachments) &&
                                                selectedMessage.attachments.length > 0 ? (
                                                    <div>
                                                        <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                                                            Attachments
                                                        </p>
                                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                            {selectedMessage.attachments.map((att, i) => {
                                                                const meta = attachmentMeta(att);
                                                                const Icon = meta.Icon;
                                                                return (
                                                                    <div
                                                                        key={`${att.name || 'a'}-${i}`}
                                                                        onClick={() =>
                                                                            (meta.isImage || meta.isPdf) &&
                                                                            (att.dataUrl || att.previewDataUrl)
                                                                                ? openAttachmentPreview(
                                                                                      selectedMessage.attachments,
                                                                                      i
                                                                                  )
                                                                                : undefined
                                                                        }
                                                                        className={`group rounded-lg border border-slate-200/90 dark:border-white/[0.08] bg-white dark:bg-white/[0.03] p-2 shadow-sm ${
                                                                            (meta.isImage || meta.isPdf) &&
                                                                            (att.dataUrl || att.previewDataUrl)
                                                                                ? 'cursor-zoom-in hover:border-[#0a84ff]/50'
                                                                                : ''
                                                                        }`}
                                                                    >
                                                                        <div className="flex items-center gap-2.5">
                                                                            <span className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-white/[0.08] flex items-center justify-center">
                                                                                <Icon size={16} className="text-slate-500 dark:text-slate-300" />
                                                                            </span>
                                                                            <div className="min-w-0 flex-1">
                                                                                <p className="text-[13px] font-medium text-slate-800 dark:text-slate-100 truncate">
                                                                                    {meta.name || `File ${i + 1}`}
                                                                                </p>
                                                                                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                                                                    {formatFileSize(att.size) || meta.type || 'Attachment'}
                                                                                </p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="mt-2 flex items-center justify-end gap-1.5">
                                                                            {(meta.isImage || meta.isPdf) && (att.dataUrl || att.previewDataUrl) ? (
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => openAttachmentPreview(selectedMessage.attachments, i)}
                                                                                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                                                >
                                                                                    <Expand size={12} />
                                                                                    Quick look
                                                                                </button>
                                                                            ) : null}
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => downloadAttachment(att)}
                                                                                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                                                            >
                                                                                <Download size={12} />
                                                                                Download
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex-1 flex flex-col items-center justify-center p-10 text-center text-slate-400 dark:text-slate-500">
                                            <Sparkles size={36} className="mb-3 opacity-35" strokeWidth={1.25} />
                                            <p className="text-[16px] font-medium text-slate-600 dark:text-slate-300">
                                                Select a message
                                            </p>
                                            <p className="text-[14px] mt-2 max-w-[260px] leading-relaxed">
                                                Pick a conversation from the list.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex-1 flex flex-col min-h-0 overflow-hidden p-4 sm:p-6">
                            <div className="max-w-[min(100%,1200px)] mx-auto w-full flex flex-col flex-1 min-h-0 space-y-5">
                                <div className="pb-4 border-b border-slate-200/80 dark:border-white/[0.06] shrink-0">
                                    <h3 className="text-[1.375rem] font-semibold text-slate-900 dark:text-white tracking-[-0.02em]">
                                        New message
                                    </h3>
                                    <p className="text-[14px] text-slate-500 dark:text-slate-400 mt-1">
                                        A copy is saved in Sent after you send.
                                    </p>
                                </div>

                                <div className="flex flex-col flex-1 min-h-0 rounded-[18px] border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-[#121214]/85 overflow-hidden">
                                    <div className="border-b border-slate-200/80 dark:border-white/[0.08]">
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">To</span>
                                            <input
                                                className="bg-transparent text-[14px] text-slate-900 dark:text-slate-100 outline-none"
                                                value={compose.to}
                                                onChange={(e) => setCompose((p) => ({ ...p, to: e.target.value }))}
                                                placeholder="name@company.com"
                                                list="mail-recipient-suggestions"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">Cc</span>
                                            <input
                                                className="bg-transparent text-[14px] text-slate-900 dark:text-slate-100 outline-none"
                                                value={compose.cc || ''}
                                                onChange={(e) => setCompose((p) => ({ ...p, cc: e.target.value }))}
                                                placeholder="optional@company.com"
                                                list="mail-recipient-suggestions"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5 border-b border-slate-100 dark:border-white/[0.06]">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">Subject</span>
                                            <input
                                                className="bg-transparent text-[14px] text-slate-900 dark:text-slate-100 outline-none"
                                                value={compose.subject}
                                                onChange={(e) => setCompose((p) => ({ ...p, subject: e.target.value }))}
                                                placeholder="Subject line"
                                            />
                                        </div>
                                        <div className="grid grid-cols-[64px_1fr] items-center gap-2 px-4 py-2.5">
                                            <span className="text-[12px] text-slate-400 dark:text-slate-500">From</span>
                                            <span className="text-[13px] text-slate-700 dark:text-slate-300">
                                                {compose.from || 'admin-d@greenmotioncarrental.ch'}
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-3 border-b border-slate-200/80 dark:border-white/[0.08] flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-1">
                                            <button
                                                type="button"
                                                onClick={() => setShowSignatureModal(true)}
                                                className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                Signature…
                                            </button>
                                            <button
                                                type="button"
                                                onClick={insertSavedSignature}
                                                className="px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                Insert signature
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setShowTemplatesModal(true)}
                                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/[0.08]"
                                            >
                                                <LayoutTemplate size={13} />
                                                Templates
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setFolder('inbox')}
                                                className="gm-btn gm-btn-secondary gm-btn-sm"
                                                disabled={loading}
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleSend}
                                                className="gm-btn gm-btn-primary gm-btn-md"
                                                disabled={loading}
                                            >
                                                {loading ? <RotateCw size={16} className="animate-spin" /> : <Send size={16} />}
                                                {loading ? 'Sending…' : 'Send'}
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex-1 min-h-0 p-3">
                                        <div
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                if (!isDropActive) setIsDropActive(true);
                                            }}
                                            onDragLeave={(e) => {
                                                e.preventDefault();
                                                setIsDropActive(false);
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                setIsDropActive(false);
                                                void addFilesToCompose(e.dataTransfer?.files);
                                            }}
                                            className={`mb-3 rounded-xl border border-dashed px-3 py-2.5 text-[12px] transition-colors ${
                                                isDropActive
                                                    ? 'border-[#0a84ff] bg-[#0a84ff]/10 text-[#0a84ff]'
                                                    : 'border-slate-300/80 dark:border-white/[0.15] text-slate-500 dark:text-slate-400'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Drag files here to attach</span>
                                                <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-white/[0.08] text-slate-700 dark:text-slate-200 cursor-pointer">
                                                    <Paperclip size={13} />
                                                    Add files
                                                    <input
                                                        type="file"
                                                        multiple
                                                        className="hidden"
                                                        onChange={(e) => {
                                                            void addFilesToCompose(e.target.files);
                                                            e.target.value = '';
                                                        }}
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                        {Array.isArray(compose.attachments) && compose.attachments.length > 0 ? (
                                            <div className="mb-3 flex flex-wrap gap-2">
                                                {compose.attachments.map((att) => (
                                                    <div
                                                        key={att.id}
                                                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/[0.1] bg-slate-50 dark:bg-white/[0.04] px-2.5 py-1.5"
                                                    >
                                                        <Paperclip size={13} className="text-slate-400" />
                                                        <span className="text-[12px] text-slate-700 dark:text-slate-200 max-w-[220px] truncate">
                                                            {att.name}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="text-slate-400 hover:text-red-500"
                                                            onClick={() => removeAttachment(att.id)}
                                                        >
                                                            <X size={13} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : null}
                                        <MailComposeRichEditor
                                            value={compose.html}
                                            onChange={(html) =>
                                                setCompose((p) => ({ ...p, html, text: stripHtmlToPlain(html) }))
                                            }
                                            isDark={isDark}
                                            className="h-full"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
