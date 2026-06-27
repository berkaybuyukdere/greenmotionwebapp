import React, { useMemo, useState } from 'react';

/**
 * Interactive Palantir bar chart with hover KPI tooltip.
 * @param {{ value: number, label?: string }[]} bars
 */
export default function PalantirBarChart({
    bars = [],
    height = 140,
    valueFormatter = (v) => String(v),
    className = '',
    tone = 'brand',
}) {
    const [hoverIdx, setHoverIdx] = useState(null);

    const values = useMemo(
        () => bars.map((b) => (Number.isFinite(Number(b.value)) ? Number(b.value) : 0)),
        [bars],
    );
    const max = useMemo(() => Math.max(...values, 1), [values]);

    const hovered = hoverIdx != null ? bars[hoverIdx] : null;

    if (!values.length || values.every((v) => v === 0)) {
        return (
            <div className={`pal-chart-empty ${className}`.trim()} style={{ height }}>
                No data in range
            </div>
        );
    }

    return (
        <div className={`pal-bar-chart pal-bar-chart-${tone} ${className}`.trim()} style={{ height }}>
            {hovered && (
                <div className="pal-bar-chart-tooltip" role="status">
                    <span className="pal-bar-chart-tooltip-value">{valueFormatter(hovered.value)}</span>
                    {hovered.label ? (
                        <span className="pal-bar-chart-tooltip-label">{hovered.label}</span>
                    ) : null}
                </div>
            )}
            <div className="pal-bar-chart-grid" aria-hidden>
                {[0.25, 0.5, 0.75, 1].map((t) => (
                    <div key={t} className="pal-bar-chart-gridline" style={{ bottom: `${t * 100}%` }} />
                ))}
            </div>
            <div className="pal-bar-chart-bars">
                {bars.map((bar, i) => {
                    const v = values[i];
                    const pct = Math.max(v > 0 ? 6 : 2, Math.round((v / max) * 100));
                    return (
                        <div
                            key={`bar-${i}-${bar.label || i}`}
                            className={`pal-bar-chart-col ${hoverIdx === i ? 'is-hover' : ''}`}
                            onMouseEnter={() => setHoverIdx(i)}
                            onMouseLeave={() => setHoverIdx(null)}
                        >
                            <div className="pal-bar-chart-bar-track">
                                <div className="pal-bar-chart-bar-fill" style={{ height: `${pct}%` }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
