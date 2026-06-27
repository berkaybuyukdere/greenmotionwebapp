import React from 'react';
import { formatDuration } from '../utilities/workTimeFormat';

/** Bar chart for hours by weekday (portal-safe CSS in work-time-timetable-palantir.css). */
export function WorkTimeWeekdayChart({ byWeekday, maxMinutes }) {
    const max = Math.max(maxMinutes, 1);
    const hasData = (byWeekday || []).some((w) => w.minutes > 0);
    if (!hasData) {
        return <p className="text-sm text-[var(--erpx-ink-muted)]">No billed hours in this period.</p>;
    }
    return (
        <div className="pal-tt-stat-bar-chart" role="img" aria-label="Hours by weekday">
            {byWeekday.map((w) => {
                const pct = Math.round((w.minutes / max) * 100);
                const barPct = w.minutes > 0 ? Math.max(10, pct) : 0;
                return (
                    <div key={w.weekday} className="pal-tt-stat-bar-col">
                        <div className="pal-tt-stat-bar-track" title={`${w.label}: ${formatDuration(w.minutes)}`}>
                            <div className="pal-tt-stat-bar-fill" style={{ height: `${barPct}%` }} />
                        </div>
                        <span className="pal-tt-stat-bar-label">{w.label}</span>
                        {w.minutes > 0 ? (
                            <span className="pal-tt-stat-bar-value">{formatDuration(w.minutes)}</span>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}
