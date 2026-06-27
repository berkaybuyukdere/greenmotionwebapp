import React, { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { WorkTimeModalShell } from './WorkTimeModalShell';
import { effectiveWorkMinutes, swissBreakWasApplied } from '../utilities/workTimeSwiss';
import { formatDayKeyWithWeekday, formatDuration, monthTitle, pad2, tsToTimeInput } from '../utilities/workTimeFormat';
import { computeWorkTimeStatistics } from '../utilities/workTimeAnalytics';
import { WorkTimeWeekdayChart } from './WorkTimeWeekdayChart';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PersonMonthGrid({ year, monthIndex, rowsByDay, franchiseId, isSwiss, onDayClick }) {
    const today = new Date();
    const first = new Date(year, monthIndex, 1);
    const startPad = first.getDay();
    const dim = new Date(year, monthIndex + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) cells.push({ kind: 'pad' });
    for (let d = 1; d <= dim; d += 1) {
        const dayKey = `${year}-${pad2(monthIndex + 1)}-${pad2(d)}`;
        cells.push({ kind: 'day', d, dayKey, entry: rowsByDay[dayKey] });
    }

    return (
        <div className="pal-timetable-calendar pal-timetable-calendar--detail">
            <div className="pal-timetable-cal-head">
                {WEEKDAY_LABELS.map((lb) => (
                    <span key={lb}>{lb}</span>
                ))}
            </div>
            <div className="pal-timetable-cal-grid pal-timetable-cal-grid--detail">
                {cells.map((cell, idx) => {
                    if (cell.kind === 'pad') return <div key={`pad-${idx}`} aria-hidden />;
                    const { d, dayKey, entry } = cell;
                    const isToday =
                        today.getFullYear() === year &&
                        today.getMonth() === monthIndex &&
                        today.getDate() === d;
                    const holiday = entry?.isHoliday;
                    const mins = entry ? effectiveWorkMinutes(entry, franchiseId) : 0;
                    const cls = [
                        'pal-timetable-day',
                        'pal-timetable-day--detail',
                        isToday ? 'is-today' : '',
                        entry && !holiday ? 'has-work' : '',
                        holiday ? 'is-off' : '',
                    ]
                        .filter(Boolean)
                        .join(' ');
                    return (
                        <button
                            key={dayKey}
                            type="button"
                            className={cls}
                            onClick={() => onDayClick(dayKey, entry)}
                        >
                            <span className="pal-timetable-day-num">{d}</span>
                            {holiday ? (
                                <span className="pal-timetable-day-detail-meta">off</span>
                            ) : entry ? (
                                <>
                                    <span className="pal-timetable-day-detail-times">
                                        {tsToTimeInput(entry.clockIn)} – {tsToTimeInput(entry.clockOut)}
                                    </span>
                                    <span className="pal-timetable-day-detail-meta">
                                        {formatDuration(mins)}
                                        {isSwiss && swissBreakWasApplied(entry, franchiseId) ? ' · −30m' : ''}
                                    </span>
                                </>
                            ) : (
                                <span className="pal-timetable-day-detail-meta pal-timetable-day-detail-meta--muted">
                                    —
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Full-screen person month view: stats + calendar with in/out per day.
 */
export function WorkTimePersonDetailView({
    person,
    franchiseId,
    isSwiss,
    monthDate,
    canGoNextMonth,
    onPrevMonth,
    onNextMonth,
    onClose,
    onDayClick,
    onAddDay,
    canEdit,
}) {
    const rows = person?.rows || [];
    const rowsByDay = useMemo(() => {
        const m = {};
        rows.forEach((r) => {
            if (r.dayKey) m[r.dayKey] = r;
        });
        return m;
    }, [rows]);

    const totalMinutes = useMemo(
        () => rows.reduce((s, e) => s + effectiveWorkMinutes(e, franchiseId), 0),
        [rows, franchiseId]
    );

    const stats = useMemo(
        () => computeWorkTimeStatistics(rows, franchiseId),
        [rows, franchiseId]
    );

    const maxWeekday = stats?.byWeekday?.length
        ? Math.max(...stats.byWeekday.map((w) => w.minutes), 1)
        : 1;

    const workedDays = rows.filter((r) => !r.isHoliday && effectiveWorkMinutes(r, franchiseId) > 0).length;

    const header = (
        <header className="pal-detail-header">
            <div className="min-w-0">
                <h2 className="pal-detail-title truncate">{person?.displayName || 'Team member'}</h2>
                <p className="pal-detail-subtitle">
                    {monthTitle(monthDate)} · {formatDuration(totalMinutes)} billed · {workedDays} work days
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                <button type="button" className="pal-btn pal-btn-sm !p-2" onClick={onPrevMonth} aria-label="Previous month">
                    <ChevronLeft size={18} />
                </button>
                <span className="text-sm font-semibold min-w-[8rem] text-center">{monthTitle(monthDate)}</span>
                <button
                    type="button"
                    className="pal-btn pal-btn-sm !p-2"
                    onClick={onNextMonth}
                    disabled={!canGoNextMonth}
                    aria-label="Next month"
                >
                    <ChevronRight size={18} />
                </button>
                {canEdit && (
                    <button type="button" className="pal-btn pal-btn-primary pal-btn-sm" onClick={onAddDay}>
                        <Plus size={14} />
                        Log day
                    </button>
                )}
                <button type="button" className="pal-btn pal-btn-sm !p-2" onClick={onClose} aria-label="Close">
                    <X size={18} />
                </button>
            </div>
        </header>
    );

    return (
        <WorkTimeModalShell open size="lg" onClose={onClose} header={header}>
            <div className="pal-tt-person-stats-grid">
                        <div className="pal-dash-panel">
                            <div className="pal-dash-panel-header">
                                <span className="pal-dash-panel-title">Hours by weekday</span>
                            </div>
                            <div className="pal-dash-panel-body padded">
                                <WorkTimeWeekdayChart byWeekday={stats.byWeekday} maxMinutes={maxWeekday} />
                            </div>
                        </div>
                        <div className="pal-dash-panel">
                            <div className="pal-dash-panel-header">
                                <span className="pal-dash-panel-title">Top days (hours)</span>
                            </div>
                            <div className="pal-dash-panel-body padded">
                                <div className="pal-tt-stat-list">
                                    {(stats.topDays.length ? stats.topDays : []).slice(0, 6).map((d) => (
                                        <div key={d.dayKey} className="pal-tt-stat-list-item">
                                            <span className="font-mono text-xs">{formatDayKeyWithWeekday(d.dayKey)}</span>
                                            <strong>{formatDuration(d.minutes)}</strong>
                                        </div>
                                    ))}
                                    {!stats.topDays.length && (
                                        <p className="text-sm text-[var(--erpx-ink-muted)]">—</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pal-dash-panel pal-tt-person-calendar-panel">
                        <div className="pal-dash-panel-header">
                            <span className="pal-dash-panel-title">Month calendar</span>
                        </div>
                        <div className="pal-dash-panel-body padded">
                            <PersonMonthGrid
                                year={monthDate.getFullYear()}
                                monthIndex={monthDate.getMonth()}
                                rowsByDay={rowsByDay}
                                franchiseId={franchiseId}
                                isSwiss={isSwiss}
                                onDayClick={onDayClick}
                            />
                            <p className="text-xs text-[var(--erpx-ink-muted)] mt-3">
                                Tap a day to edit. Times show clock-in → clock-out; billed hours follow CH rules unless
                                &quot;Ohne Pause&quot; is set on that day.
                            </p>
                        </div>
                    </div>
        </WorkTimeModalShell>
    );
}
