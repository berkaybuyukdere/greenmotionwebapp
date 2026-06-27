import React, { useMemo, useState } from 'react';
import { PAL_CHART_SERIES } from './palantirChartPalette';

/**
 * @param {{ label: string, value: number, sublabel?: string }[]} slices
 */
export default function PalantirPieChart({ slices = [], size = 200, className = '' }) {
    const [hoverIdx, setHoverIdx] = useState(null);

    const total = useMemo(() => slices.reduce((s, x) => s + (x.value || 0), 0), [slices]);
    const cx = 50;
    const cy = 50;
    const r = 42;
    const ir = 24;

    const arcs = useMemo(() => {
        if (!total) return [];
        let angle = -90;
        return slices.map((slice, i) => {
            const pct = slice.value / total;
            const sweep = pct * 360;
            const start = angle;
            angle += sweep;
            const end = angle;
            const large = sweep > 180 ? 1 : 0;
            const startRad = (start * Math.PI) / 180;
            const endRad = (end * Math.PI) / 180;
            const x1 = cx + r * Math.cos(startRad);
            const y1 = cy + r * Math.sin(startRad);
            const x2 = cx + r * Math.cos(endRad);
            const y2 = cy + r * Math.sin(endRad);
            const xi1 = cx + ir * Math.cos(endRad);
            const yi1 = cy + ir * Math.sin(endRad);
            const xi2 = cx + ir * Math.cos(startRad);
            const yi2 = cy + ir * Math.sin(startRad);
            const d =
                pct >= 0.999
                    ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} L ${cx} ${cy - ir} A ${ir} ${ir} 0 1 0 ${cx - 0.01} ${cy - ir} Z`
                    : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${ir} ${ir} 0 ${large} 0 ${xi2} ${yi2} Z`;
            return {
                d,
                color: PAL_CHART_SERIES[i % PAL_CHART_SERIES.length],
                slice,
                pct,
                i,
            };
        });
    }, [slices, total]);

    const active = hoverIdx != null ? arcs[hoverIdx] : null;

    if (!total) {
        return (
            <div className={`pal-chart-empty ${className}`.trim()} style={{ minHeight: size }}>
                No data
            </div>
        );
    }

    return (
        <div className={`pal-pie-chart ${className}`.trim()}>
            <div className="pal-pie-chart-visual" style={{ width: size, height: size }}>
                <svg viewBox="0 0 100 100" className="pal-pie-chart-svg" aria-hidden>
                    {arcs.map((arc) => (
                        <path
                            key={arc.slice.label}
                            d={arc.d}
                            fill={arc.color}
                            className={hoverIdx === arc.i ? 'is-hover' : ''}
                            opacity={hoverIdx == null || hoverIdx === arc.i ? 1 : 0.45}
                            onMouseEnter={() => setHoverIdx(arc.i)}
                            onMouseLeave={() => setHoverIdx(null)}
                        />
                    ))}
                </svg>
                <div className="pal-pie-chart-center">
                    {active ? (
                        <>
                            <span className="pal-pie-chart-center-value">
                                {Math.round(active.pct * 100)}%
                            </span>
                            <span className="pal-pie-chart-center-label">{active.slice.label}</span>
                        </>
                    ) : (
                        <>
                            <span className="pal-pie-chart-center-value">{total}</span>
                            <span className="pal-pie-chart-center-label">vehicles</span>
                        </>
                    )}
                </div>
            </div>
            <ul className="pal-pie-legend">
                {arcs.map((arc) => (
                    <li
                        key={arc.slice.label}
                        className={hoverIdx === arc.i ? 'is-hover' : ''}
                        onMouseEnter={() => setHoverIdx(arc.i)}
                        onMouseLeave={() => setHoverIdx(null)}
                    >
                        <span className="pal-pie-legend-swatch" style={{ background: arc.color }} />
                        <span className="pal-pie-legend-label">{arc.slice.label}</span>
                        <span className="pal-pie-legend-value">{arc.slice.value}</span>
                        <span className="pal-pie-legend-pct">{Math.round(arc.pct * 100)}%</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}
