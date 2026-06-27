import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Timestamp } from 'firebase/firestore';
import { Trash2, X } from 'lucide-react';
import { isSwissFranchiseId } from '../utilities/fileLibraryHelpers';
import {
    billingMinutesForFranchise,
    computeRawWorkMinutes,
    swissBreakWasApplied,
} from '../utilities/workTimeSwiss';
import { applyTimeOnDayKey, formatDuration } from '../utilities/workTimeFormat';

/**
 * Log / edit hours — portaled modal so it never overlaps page chrome.
 */
export function WorkTimeLogHoursModal({
    editor,
    franchiseId,
    isSwiss,
    saving,
    removing,
    onClose,
    onChange,
    onSave,
    onDelete,
}) {
    const preview = useMemo(() => {
        if (!editor || editor.isHoliday) return { billed: 0, breakApplied: false };
        const clockInTs = applyTimeOnDayKey(editor.dayKey, editor.clockIn, Timestamp);
        const clockOutTs = applyTimeOnDayKey(editor.dayKey, editor.clockOut, Timestamp);
        const raw = computeRawWorkMinutes(clockInTs, clockOutTs);
        const billed = billingMinutesForFranchise(raw, franchiseId, { ohnePause: editor.ohnePause });
        const breakApplied =
            isSwissFranchiseId(franchiseId) &&
            !editor.ohnePause &&
            swissBreakWasApplied(
                { clockIn: clockInTs, clockOut: clockOutTs, isHoliday: false, ohnePause: false },
                franchiseId
            );
        return { billed, breakApplied, raw };
    }, [editor, franchiseId]);

    if (!editor) return null;

    const content = (
        <div className="pal-detail-overlay pal-tt-log-overlay" onClick={onClose} role="presentation">
            <div
                className="pal-detail-shell pal-detail-shell-sm pal-tt-log-shell"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="wt-log-title"
            >
                <header className="pal-detail-header">
                    <div>
                        <h2 id="wt-log-title" className="pal-detail-title">
                            {editor.existing ? 'Edit hours' : 'Log hours'}
                        </h2>
                        <p className="pal-detail-subtitle">{editor.dayKey}</p>
                    </div>
                    <button type="button" className="pal-btn pal-btn-sm !p-2" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </header>

                <div className="pal-detail-body pal-tt-log-body">
                    <div className="pal-tt-log-field">
                        <label htmlFor="wt-day">Day</label>
                        <input
                            id="wt-day"
                            value={editor.dayKey}
                            onChange={(e) => onChange({ dayKey: e.target.value })}
                            className="pal-tt-log-input font-mono"
                        />
                    </div>
                    <div className="pal-tt-log-grid-2">
                        <div className="pal-tt-log-field">
                            <label htmlFor="wt-in">Clock in</label>
                            <input
                                id="wt-in"
                                type="time"
                                value={editor.clockIn}
                                onChange={(e) => onChange({ clockIn: e.target.value })}
                                className="pal-tt-log-input"
                            />
                        </div>
                        <div className="pal-tt-log-field">
                            <label htmlFor="wt-out">Clock out</label>
                            <input
                                id="wt-out"
                                type="time"
                                value={editor.clockOut}
                                onChange={(e) => onChange({ clockOut: e.target.value })}
                                className="pal-tt-log-input"
                            />
                        </div>
                    </div>

                    {!editor.isHoliday && (
                        <div className="pal-tt-log-billed">
                            <span className="pal-tt-log-billed-label">Billed</span>
                            <strong>{formatDuration(preview.billed)}</strong>
                            {isSwiss && preview.breakApplied && (
                                <span className="pal-tt-log-billed-hint">incl. 30m break</span>
                            )}
                        </div>
                    )}

                    <label className="pal-tt-log-check">
                        <input
                            type="checkbox"
                            checked={editor.isHoliday}
                            onChange={(e) => onChange({ isHoliday: e.target.checked })}
                        />
                        Holiday / day off (0 hours)
                    </label>

                    {isSwiss && !editor.isHoliday && (
                        <label className="pal-tt-log-check">
                            <input
                                type="checkbox"
                                checked={!!editor.ohnePause}
                                onChange={(e) => onChange({ ohnePause: e.target.checked })}
                            />
                            Ohne Pause (no 30m break deduction)
                        </label>
                    )}

                    <div className="pal-tt-log-field">
                        <label htmlFor="wt-notes">Notes</label>
                        <textarea
                            id="wt-notes"
                            value={editor.notes}
                            onChange={(e) => onChange({ notes: e.target.value })}
                            rows={3}
                            className="pal-tt-log-input"
                        />
                    </div>
                </div>

                <footer className="pal-detail-footer pal-tt-log-footer">
                    <div>
                        {editor.existing && (
                            <button
                                type="button"
                                onClick={onDelete}
                                disabled={saving || removing}
                                className="pal-btn pal-btn-danger pal-btn-sm"
                            >
                                <Trash2 size={14} />
                                {removing ? 'Deleting…' : 'Delete'}
                            </button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button type="button" className="pal-btn pal-btn-sm" onClick={onClose} disabled={saving}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="pal-btn pal-btn-primary pal-btn-sm"
                            onClick={onSave}
                            disabled={saving}
                        >
                            {saving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );

    return createPortal(content, document.body);
}
