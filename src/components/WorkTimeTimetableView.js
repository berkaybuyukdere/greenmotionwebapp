import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    deleteDoc,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    Timestamp,
    where,
} from 'firebase/firestore';
import { getCollectionRef } from '../utilities/firebaseHelpers';
import { isSwissFranchiseId } from '../utilities/fileLibraryHelpers';
import {
    billingMinutesForFranchise,
    computeRawWorkMinutes,
} from '../utilities/workTimeSwiss';
import {
    applyTimeOnDayKey,
    dayKeyRangeForMonth,
    formatDuration,
    isManagerRole,
    monthKeyFromDate,
    monthTitle,
    pad2,
    tsToTimeInput,
} from '../utilities/workTimeFormat';
import { groupEntriesByUser } from '../utilities/workTimeAnalytics';
import { effectiveWorkMinutes } from '../utilities/workTimeSwiss';
import {
    BarChart3,
    ChevronLeft,
    ChevronRight,
    Download,
    FileText,
    Plus,
    Users,
} from 'lucide-react';
import { useToast } from './ToastNotification';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import { WorkTimeReportModal } from './WorkTimeReportModal';
import { WorkTimeStatisticsModal } from './WorkTimeStatisticsModal';
import { WorkTimeLogHoursModal } from './WorkTimeLogHoursModal';
import { WorkTimePersonDetailView } from './WorkTimePersonDetailView';

export function WorkTimeTimetableView({ db, user, userProfile, franchiseIdOverride = null }) {
    const { success: toastSuccess, error: toastError } = useToast();
    const [cursor, setCursor] = useState(() => {
        const n = new Date();
        return new Date(n.getFullYear(), n.getMonth(), 1);
    });
    const [scope, setScope] = useState('my');
    const [entries, setEntries] = useState([]);
    const [planDoc, setPlanDoc] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editor, setEditor] = useState(null);
    const [editorTargetUserId, setEditorTargetUserId] = useState(null);
    const [saving, setSaving] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);
    const [statsOpen, setStatsOpen] = useState(false);
    const [statsEntries, setStatsEntries] = useState([]);
    const [statsLoading, setStatsLoading] = useState(false);
    const [personDetail, setPersonDetail] = useState(null);

    const franchiseId = String(
        franchiseIdOverride || userProfile?.franchiseId || userProfile?.countryCode || 'CH'
    ).toUpperCase();
    const isSwiss = isSwissFranchiseId(franchiseId);
    const manager = isManagerRole(userProfile);

    const collRef = useMemo(
        () => getCollectionRef(db, 'workTimeEntries', user, userProfile, franchiseIdOverride),
        [db, user, userProfile, franchiseIdOverride]
    );

    const { startKey, endKey } = useMemo(
        () => dayKeyRangeForMonth(cursor.getFullYear(), cursor.getMonth()),
        [cursor]
    );

    const planDocId = `${franchiseId}_${monthKeyFromDate(cursor)}`;
    const plansColl = useMemo(
        () => getCollectionRef(db, 'workTimePlans', user, userProfile, franchiseIdOverride),
        [db, user, userProfile, franchiseIdOverride]
    );

    useEffect(() => {
        const unsub = onSnapshot(
            doc(plansColl, planDocId),
            (snap) => {
                if (snap.exists()) setPlanDoc({ id: snap.id, ...snap.data() });
                else setPlanDoc(null);
            },
            () => setPlanDoc(null)
        );
        return unsub;
    }, [plansColl, planDocId]);

    useEffect(() => {
        setLoading(true);
        const qy = query(collRef, where('dayKey', '>=', startKey), where('dayKey', '<=', endKey), orderBy('dayKey', 'asc'));
        const unsub = onSnapshot(
            qy,
            (snap) => {
                const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                const filtered =
                    manager && scope === 'team' ? list : list.filter((e) => e.userId === user?.uid);
                setEntries(filtered);
                setLoading(false);
            },
            (err) => {
                console.error(err);
                toastError(err.message || 'Could not load work hours');
                setEntries([]);
                setLoading(false);
            }
        );
        return unsub;
    }, [collRef, startKey, endKey, scope, manager, user?.uid, toastError]);

    const monthTotal = useMemo(
        () => entries.reduce((s, e) => s + effectiveWorkMinutes(e, franchiseId), 0),
        [entries, franchiseId]
    );

    const entriesByUser = useMemo(() => {
        if (!manager || scope !== 'team') return null;
        return groupEntriesByUser(entries).map((g) => ({
            ...g,
            totalMinutes: g.rows.reduce((s, e) => s + effectiveWorkMinutes(e, franchiseId), 0),
        }));
    }, [entries, manager, scope, franchiseId]);

    const rosterGroups = useMemo(() => {
        if (entriesByUser) return entriesByUser;
        const uid = user?.uid;
        if (!uid) return [];
        return [
            {
                userId: uid,
                displayName:
                    userProfile?.displayName || userProfile?.name || user?.email || 'My hours',
                rows: entries,
                totalMinutes: monthTotal,
            },
        ];
    }, [entriesByUser, user, userProfile, entries, monthTotal]);

    const teamMembers = useMemo(
        () => rosterGroups.map((g) => ({ userId: g.userId, displayName: g.displayName })),
        [rosterGroups]
    );

    const personDetailLive = useMemo(() => {
        if (!personDetail) return null;
        const fresh = rosterGroups.find((g) => g.userId === personDetail.userId);
        return fresh || personDetail;
    }, [personDetail, rosterGroups]);

    const loadStatsHistory = useCallback(async () => {
        setStatsLoading(true);
        try {
            const end = new Date();
            const start = new Date(end.getFullYear() - 1, end.getMonth(), end.getDate());
            const sk = `${start.getFullYear()}-${pad2(start.getMonth() + 1)}-${pad2(start.getDate())}`;
            const ek = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
            const qy = query(collRef, where('dayKey', '>=', sk), where('dayKey', '<=', ek), orderBy('dayKey', 'asc'));
            const snap = await getDocs(qy);
            setStatsEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Could not load statistics');
            setStatsEntries([]);
        } finally {
            setStatsLoading(false);
        }
    }, [collRef, toastError]);

    useEffect(() => {
        if (statsOpen) loadStatsHistory();
    }, [statsOpen, loadStatsHistory]);

    const goPrevMonth = () => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1));

    const goNextMonth = () => {
        setCursor((c) => {
            const n = new Date();
            const next = new Date(c.getFullYear(), c.getMonth() + 1, 1);
            if (next.getFullYear() > n.getFullYear() || (next.getFullYear() === n.getFullYear() && next.getMonth() > n.getMonth())) {
                return c;
            }
            return next;
        });
    };

    const openEditorBlank = (dayKey, targetUserId) => {
        setEditorTargetUserId(targetUserId || user?.uid || null);
        setEditor({
            dayKey,
            clockIn: '09:00',
            clockOut: '17:00',
            notes: '',
            isHoliday: false,
            ohnePause: false,
            existing: null,
        });
    };

    const openEdit = (row) => {
        setEditorTargetUserId(row.userId || user?.uid || null);
        setEditor({
            dayKey: row.dayKey,
            clockIn: tsToTimeInput(row.clockIn),
            clockOut: tsToTimeInput(row.clockOut),
            notes: row.notes || '',
            isHoliday: !!row.isHoliday,
            ohnePause: row.ohnePause === true,
            existing: row,
        });
    };

    const openNew = () => {
        const today = new Date();
        const y = cursor.getFullYear();
        const m = cursor.getMonth();
        const inMonth = today.getFullYear() === y && today.getMonth() === m;
        const dayKey = inMonth ? `${y}-${pad2(m + 1)}-${pad2(today.getDate())}` : startKey;
        openEditorBlank(dayKey, user?.uid);
    };

    const patchEditor = (patch) => setEditor((ed) => (ed ? { ...ed, ...patch } : ed));

    const saveEntry = async () => {
        if (!user?.uid || !editor) return;
        const { dayKey, clockIn, clockOut, notes, isHoliday, ohnePause, existing } = editor;

        const targetUid = existing?.userId || editorTargetUserId || user.uid;
        if (targetUid !== user.uid && !manager) {
            toastError('You can only edit your own entries.');
            return;
        }

        const docId = `${targetUid}_${dayKey}`;
        const clockInTs = applyTimeOnDayKey(dayKey, clockIn, Timestamp);
        const clockOutTs = applyTimeOnDayKey(dayKey, clockOut, Timestamp);
        const rawMinutes = isHoliday ? 0 : computeRawWorkMinutes(clockInTs, clockOutTs);
        const totalMinutes = isHoliday
            ? 0
            : billingMinutesForFranchise(rawMinutes, franchiseId, { ohnePause: !!ohnePause });

        setSaving(true);
        try {
            const payload = {
                franchiseId,
                userId: targetUid,
                dayKey,
                clockIn: clockInTs,
                clockOut: clockOutTs,
                totalMinutes,
                userDisplayName:
                    existing?.userDisplayName ||
                    userProfile?.displayName ||
                    userProfile?.name ||
                    user?.email ||
                    '',
                userEmail: existing?.userEmail || user?.email || '',
                notes: String(notes || '').slice(0, 2000),
                isHoliday: !!isHoliday,
                ohnePause: isSwiss && !!ohnePause,
                updatedAt: Timestamp.now(),
            };
            if (isSwiss) {
                payload.rawTotalMinutes = rawMinutes;
                payload.swissBreakApplied = !isHoliday && !ohnePause && rawMinutes > 240;
            }
            await setDoc(doc(collRef, docId), payload, { merge: true });
            toastSuccess('Work hours saved.');
            setEditor(null);
            setEditorTargetUserId(null);
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const deleteEntry = async () => {
        if (!editor?.existing?.id) return;
        const targetUid = editor.existing.userId;
        if (targetUid !== user.uid && !manager) {
            toastError('You can only delete your own entries.');
            return;
        }
        if (!window.confirm(`Delete work hours for ${editor.dayKey}?`)) return;
        setRemoving(true);
        try {
            await deleteDoc(doc(collRef, editor.existing.id));
            toastSuccess('Entry deleted.');
            setEditor(null);
            setEditorTargetUserId(null);
        } catch (e) {
            console.error(e);
            toastError(e.message || 'Delete failed');
        } finally {
            setRemoving(false);
        }
    };

    const handlePersonDayClick = (dayKey, entry) => {
        const uid = personDetailLive?.userId;
        if (entry) openEdit(entry);
        else openEditorBlank(dayKey, uid);
    };

    const now = new Date();
    const canGoNext =
        cursor.getFullYear() < now.getFullYear() ||
        (cursor.getFullYear() === now.getFullYear() && cursor.getMonth() < now.getMonth());

    const canEditPerson = (uid) => uid === user?.uid || manager;

    return (
        <div className="w-full min-w-0 erpx-page pal-ops-page pal-timetable-page space-y-4 text-[var(--erpx-ink)]">
            <div className="erpx-page-header pal-ops-header !mb-0 pb-3 border-b border-[var(--erpx-border)]">
                <h1 className="erpx-page-title flex items-center gap-2">
                    <PalantirPageIcon navKey="workingTimetable" />
                    Working timetable
                </h1>
                <p className="erpx-page-subtitle">Team work hours · {franchiseId}</p>
            </div>

            <div className="pal-timetable-toolbar">
                <div className="flex items-center gap-2">
                    <button type="button" onClick={goPrevMonth} className="pal-btn pal-btn-sm !p-2" aria-label="Previous month">
                        <ChevronLeft size={20} />
                    </button>
                    <span className="pal-timetable-month-label">{monthTitle(cursor)}</span>
                    <button
                        type="button"
                        onClick={goNextMonth}
                        disabled={!canGoNext}
                        className="pal-btn pal-btn-sm !p-2 disabled:opacity-30"
                        aria-label="Next month"
                    >
                        <ChevronRight size={20} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {manager && (
                        <>
                            <button
                                type="button"
                                onClick={() => setScope('my')}
                                className={scope === 'my' ? 'pal-btn pal-btn-primary pal-btn-sm' : 'pal-btn pal-btn-sm'}
                            >
                                My hours
                            </button>
                            <button
                                type="button"
                                onClick={() => setScope('team')}
                                className={`inline-flex items-center gap-1 pal-btn pal-btn-sm ${scope === 'team' ? 'pal-btn-primary' : ''}`}
                            >
                                <Users size={14} />
                                Team
                            </button>
                            <button
                                type="button"
                                onClick={() => setStatsOpen(true)}
                                className="pal-btn pal-btn-sm inline-flex items-center gap-1"
                            >
                                <BarChart3 size={14} />
                                Statistics
                            </button>
                        </>
                    )}
                    <button type="button" onClick={() => setReportOpen(true)} className="pal-btn pal-btn-sm inline-flex items-center gap-1">
                        <Download size={14} />
                        Reports
                    </button>
                    <button type="button" onClick={openNew} className="pal-btn pal-btn-primary pal-btn-sm inline-flex items-center gap-1">
                        <Plus size={14} />
                        Log day
                    </button>
                </div>
            </div>

            {planDoc?.fileURL && (
                <div className="pal-dash-panel">
                    <div className="pal-dash-panel-body padded flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2">
                            <FileText size={16} />
                            Plan: <strong>{planDoc.originalFileName || 'File'}</strong>
                        </span>
                        <a href={planDoc.fileURL} target="_blank" rel="noopener noreferrer" className="pal-btn pal-btn-sm">
                            Open
                        </a>
                    </div>
                </div>
            )}

            <div className="pal-timetable-kpi-row">
                <div className="pal-timetable-kpi">
                    <div className="pal-timetable-kpi-label">Month total</div>
                    <div className="pal-timetable-kpi-value text-xl">{formatDuration(monthTotal)}</div>
                </div>
                <div className="pal-timetable-kpi">
                    <div className="pal-timetable-kpi-label">People</div>
                    <div className="pal-timetable-kpi-value text-xl">{rosterGroups.length}</div>
                </div>
            </div>

            <div className="pal-tt-roster-panel">
                <div className="pal-tt-roster-head">
                    <span>{scope === 'team' ? 'Team' : 'Your profile'}</span>
                    <span className="text-[var(--erpx-ink-muted)] font-normal">Tap a row for calendar & stats</span>
                </div>
                {loading ? (
                    <p className="p-4 text-sm text-[var(--erpx-ink-muted)]">Loading…</p>
                ) : rosterGroups.length === 0 ? (
                    <p className="p-4 text-sm text-[var(--erpx-ink-muted)]">No entries this month.</p>
                ) : (
                    <ul className="pal-tt-roster-list">
                        {rosterGroups.map((g) => (
                            <li key={g.userId}>
                                <button
                                    type="button"
                                    className="pal-tt-roster-row"
                                    onClick={() => setPersonDetail(g)}
                                >
                                    <span className="pal-tt-roster-name">{g.displayName}</span>
                                    <span className="pal-tt-roster-meta">{g.rows.length} days</span>
                                    <span className="pal-tt-roster-hours">{formatDuration(g.totalMinutes)}</span>
                                    <ChevronRight size={16} className="pal-tt-roster-chevron shrink-0" />
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <WorkTimeReportModal
                open={reportOpen}
                onClose={() => setReportOpen(false)}
                entries={entries}
                franchiseId={franchiseId}
                franchiseLabel={franchiseId}
                monthDate={cursor}
                teamMembers={teamMembers}
                scope={scope}
                toastSuccess={toastSuccess}
                toastError={toastError}
            />

            <WorkTimeStatisticsModal
                open={statsOpen}
                onClose={() => setStatsOpen(false)}
                entries={statsEntries}
                franchiseId={franchiseId}
                loading={statsLoading}
                rangeLabel="Last 12 months · all team members"
            />

            {personDetailLive && (
                <WorkTimePersonDetailView
                    person={personDetailLive}
                    franchiseId={franchiseId}
                    isSwiss={isSwiss}
                    monthDate={cursor}
                    canGoNextMonth={canGoNext}
                    onPrevMonth={goPrevMonth}
                    onNextMonth={goNextMonth}
                    onClose={() => setPersonDetail(null)}
                    onDayClick={handlePersonDayClick}
                    onAddDay={() => {
                        const y = cursor.getFullYear();
                        const m = cursor.getMonth();
                        const dk = `${y}-${pad2(m + 1)}-01`;
                        openEditorBlank(dk, personDetailLive.userId);
                    }}
                    canEdit={canEditPerson(personDetailLive.userId)}
                />
            )}

            <WorkTimeLogHoursModal
                editor={editor}
                franchiseId={franchiseId}
                isSwiss={isSwiss}
                saving={saving}
                removing={removing}
                onClose={() => {
                    setEditor(null);
                    setEditorTargetUserId(null);
                }}
                onChange={patchEditor}
                onSave={saveEntry}
                onDelete={deleteEntry}
            />
        </div>
    );
}
