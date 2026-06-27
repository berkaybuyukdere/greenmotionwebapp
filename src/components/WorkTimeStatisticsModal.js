import React, { useMemo } from 'react';
import { BarChart3, X } from 'lucide-react';
import { computeWorkTimeStatistics } from '../utilities/workTimeAnalytics';
import { formatDayKeyWithWeekday, formatDuration } from '../utilities/workTimeFormat';
import { WorkTimeWeekdayChart } from './WorkTimeWeekdayChart';
import { WorkTimeModalShell } from './WorkTimeModalShell';

export function WorkTimeStatisticsModal({
    open,
    onClose,
    entries,
    franchiseId,
    loading,
    rangeLabel,
}) {
    const stats = useMemo(
        () => (entries?.length ? computeWorkTimeStatistics(entries, franchiseId) : null),
        [entries, franchiseId]
    );

    const maxWeekday = stats?.byWeekday?.length
        ? Math.max(...stats.byWeekday.map((w) => w.minutes), 1)
        : 1;

    const header = (
        <header className="pal-detail-header">
            <div className="min-w-0">
                <h2 id="wt-stats-title" className="pal-detail-title flex items-center gap-2">
                    <BarChart3 size={20} className="text-[var(--pal-tt-accent,#a78bfa)]" />
                    Statistics
                </h2>
                <p className="pal-detail-subtitle">
                    {rangeLabel || 'Historical work hours'} · billed hours
                </p>
            </div>
            <button type="button" className="pal-btn pal-btn-sm !p-2 shrink-0" onClick={onClose} aria-label="Close">
                <X size={18} />
            </button>
        </header>
    );

    return (
        <WorkTimeModalShell
            open={open}
            onClose={onClose}
            size="lg"
            header={header}
            ariaLabelledBy="wt-stats-title"
        >
            {loading ? (
                <p className="text-sm text-[var(--erpx-ink-muted)] py-8 text-center">Loading history…</p>
            ) : !stats || stats.entryCount === 0 ? (
                <p className="text-sm text-[var(--erpx-ink-muted)] py-8 text-center">No work entries in this period.</p>
            ) : (
                <div className="space-y-5 pb-2">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="pal-timetable-kpi">
                            <div className="pal-timetable-kpi-label">Total hours</div>
                            <div className="pal-timetable-kpi-value">{formatDuration(stats.totalMinutes)}</div>
                        </div>
                        <div className="pal-timetable-kpi">
                            <div className="pal-timetable-kpi-label">Days logged</div>
                            <div className="pal-timetable-kpi-value">{stats.uniqueDays}</div>
                        </div>
                        <div className="pal-timetable-kpi">
                            <div className="pal-timetable-kpi-label">Avg / day</div>
                            <div className="pal-timetable-kpi-value">{formatDuration(stats.avgPerDay)}</div>
                        </div>
                        <div className="pal-timetable-kpi">
                            <div className="pal-timetable-kpi-label">Entries</div>
                            <div className="pal-timetable-kpi-value">{stats.entryCount}</div>
                        </div>
                    </div>

                    <div className="pal-dash-panel">
                        <div className="pal-dash-panel-header">
                            <span className="pal-dash-panel-title">Hours by weekday (team)</span>
                        </div>
                        <div className="pal-dash-panel-body padded">
                            <WorkTimeWeekdayChart byWeekday={stats.byWeekday} maxMinutes={maxWeekday} />
                            <div className="mt-3 pal-tt-stat-list">
                                {stats.busiestWeekdays.slice(0, 3).map((w) => (
                                    <div key={w.weekday} className="pal-tt-stat-list-item">
                                        <span>Busiest: {w.label}</span>
                                        <strong>{formatDuration(w.minutes)}</strong>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="pal-dash-panel">
                        <div className="pal-dash-panel-header">
                            <span className="pal-dash-panel-title">Highest-hour days (all staff)</span>
                        </div>
                        <div className="pal-dash-panel-body padded">
                            <div className="pal-tt-stat-list">
                                {stats.topDays.map((d) => (
                                    <div key={d.dayKey} className="pal-tt-stat-list-item">
                                        <span className="font-mono text-xs">{formatDayKeyWithWeekday(d.dayKey)}</span>
                                        <strong>{formatDuration(d.minutes)}</strong>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {stats.byUser.length > 0 && (
                        <div className="pal-dash-panel">
                            <div className="pal-dash-panel-header">
                                <span className="pal-dash-panel-title">By person</span>
                            </div>
                            <div className="pal-dash-panel-body padded space-y-4">
                                {stats.byUser.map((u) => (
                                    <div
                                        key={u.userId}
                                        className="border border-[var(--erpx-border)] rounded-lg p-3 bg-[var(--erpx-canvas)]"
                                    >
                                        <div className="flex flex-wrap justify-between gap-2 mb-2">
                                            <span className="font-semibold text-[var(--erpx-ink)]">{u.displayName}</span>
                                            <span className="text-sm text-[var(--erpx-ink-muted)]">
                                                {formatDuration(u.totalMinutes)} · {u.daysWorked} days
                                            </span>
                                        </div>
                                        {u.busiestWeekdays[0] && (
                                            <p className="text-xs text-[var(--erpx-ink-muted)] mb-2">
                                                Strongest weekday: <strong>{u.busiestWeekdays[0].label}</strong> (
                                                {formatDuration(u.busiestWeekdays[0].minutes)})
                                            </p>
                                        )}
                                        <div className="pal-tt-stat-list">
                                            {u.topDays.map((d) => (
                                                <div key={d.dayKey} className="pal-tt-stat-list-item">
                                                    <span className="font-mono text-xs">
                                                        {formatDayKeyWithWeekday(d.dayKey)}
                                                    </span>
                                                    <strong>{formatDuration(d.minutes)}</strong>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </WorkTimeModalShell>
    );
}
