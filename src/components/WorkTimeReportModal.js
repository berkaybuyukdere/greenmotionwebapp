import React, { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, X } from 'lucide-react';
import { exportWorkTimeMonthReport } from '../utilities/workTimeExport';
import { groupEntriesByUser } from '../utilities/workTimeAnalytics';
import { monthTitle } from '../utilities/workTimeFormat';
import { WorkTimeModalShell } from './WorkTimeModalShell';

export function WorkTimeReportModal({
    open,
    onClose,
    entries,
    franchiseId,
    franchiseLabel,
    monthDate,
    teamMembers,
    scope,
    toastSuccess,
    toastError,
}) {
    const [format, setFormat] = useState('csv');
    const [mode, setMode] = useState('all');
    const [selected, setSelected] = useState(() => new Set());
    const [busy, setBusy] = useState(false);

    const people = useMemo(() => {
        if (teamMembers?.length) return teamMembers;
        return groupEntriesByUser(entries).map((g) => ({
            userId: g.userId,
            displayName: g.displayName,
        }));
    }, [teamMembers, entries]);

    useEffect(() => {
        if (!open) return;
        setSelected(new Set(people.map((p) => p.userId)));
        setMode(scope === 'team' && people.length > 1 ? 'selected' : 'all');
    }, [open, people, scope]);

    const togglePerson = (uid) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(uid)) next.delete(uid);
            else next.add(uid);
            return next;
        });
    };

    const runExport = async () => {
        setBusy(true);
        try {
            const userIds = mode === 'all' ? null : Array.from(selected);
            if (mode === 'selected' && (!userIds || userIds.length === 0)) {
                throw new Error('Select at least one person.');
            }
            const base = `work_hours_${franchiseId}_${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
            exportWorkTimeMonthReport({
                entries,
                franchiseId,
                monthDate,
                franchiseLabel,
                userIds,
                format: format === 'pdf' ? 'pdf' : 'csv',
                filenameBase: base,
            });
            toastSuccess?.(format === 'pdf' ? 'PDF downloaded.' : 'Excel (CSV) downloaded.');
            onClose();
        } catch (e) {
            toastError?.(e.message || 'Export failed');
        } finally {
            setBusy(false);
        }
    };

    const header = (
        <header className="pal-detail-header">
            <div className="min-w-0">
                <h2 id="wt-report-title" className="pal-detail-title">
                    Monthly report
                </h2>
                <p className="pal-detail-subtitle">{monthTitle(monthDate)}</p>
            </div>
            <button type="button" className="pal-btn pal-btn-sm !p-2 shrink-0" onClick={onClose} aria-label="Close">
                <X size={18} />
            </button>
        </header>
    );

    const footer = (
        <>
            <button type="button" className="pal-btn" onClick={onClose} disabled={busy}>
                Cancel
            </button>
            <button type="button" className="pal-btn pal-btn-primary" onClick={runExport} disabled={busy}>
                {busy ? 'Exporting…' : 'Download report'}
            </button>
        </>
    );

    return (
        <WorkTimeModalShell
            open={open}
            onClose={onClose}
            size="sm"
            header={header}
            footer={footer}
            ariaLabelledBy="wt-report-title"
        >
            <div className="pal-tt-report-section">
                <div className="pal-tt-report-section-title">
                    People {people.length > 0 ? `(${people.length})` : ''}
                </div>
                <div className="flex flex-wrap gap-2 mb-3">
                    <button
                        type="button"
                        className={mode === 'all' ? 'pal-btn pal-btn-primary pal-btn-sm' : 'pal-btn pal-btn-sm'}
                        onClick={() => setMode('all')}
                    >
                        Everyone
                    </button>
                    {people.length > 1 && (
                        <button
                            type="button"
                            className={mode === 'selected' ? 'pal-btn pal-btn-primary pal-btn-sm' : 'pal-btn pal-btn-sm'}
                            onClick={() => setMode('selected')}
                        >
                            Selected only
                        </button>
                    )}
                </div>
                {mode === 'all' ? (
                    <p className="text-sm text-[var(--erpx-ink-muted)]">
                        Report includes all {people.length} team member{people.length === 1 ? '' : 's'} for this month.
                    </p>
                ) : (
                    <div className="pal-tt-report-people-grid">
                        {people.map((p) => (
                            <label
                                key={p.userId}
                                className={`pal-tt-report-person ${selected.has(p.userId) ? 'is-selected' : ''}`}
                            >
                                <input
                                    type="checkbox"
                                    checked={selected.has(p.userId)}
                                    onChange={() => togglePerson(p.userId)}
                                />
                                <span className="text-sm font-medium truncate">{p.displayName}</span>
                            </label>
                        ))}
                    </div>
                )}
            </div>

            <div className="pal-tt-report-section">
                <div className="pal-tt-report-section-title">Format</div>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        className={`inline-flex items-center gap-1.5 ${format === 'csv' ? 'pal-btn pal-btn-primary pal-btn-sm' : 'pal-btn pal-btn-sm'}`}
                        onClick={() => setFormat('csv')}
                    >
                        <FileSpreadsheet size={14} />
                        Excel (CSV)
                    </button>
                    <button
                        type="button"
                        className={`inline-flex items-center gap-1.5 ${format === 'pdf' ? 'pal-btn pal-btn-primary pal-btn-sm' : 'pal-btn pal-btn-sm'}`}
                        onClick={() => setFormat('pdf')}
                    >
                        <FileText size={14} />
                        PDF
                    </button>
                </div>
            </div>
        </WorkTimeModalShell>
    );
}
