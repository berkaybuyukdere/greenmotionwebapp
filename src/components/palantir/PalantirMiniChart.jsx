import React, { useMemo } from 'react';

/**
 * Palantir-style mini bar chart or sparkline from a numeric array.
 * Pure CSS/div bars or lightweight inline SVG — no AppleStockChart.
 *
 * @param {number[]} data - Values to plot
 * @param {'bar'|'sparkline'} variant
 * @param {number} height - Chart height in px
 * @param {string} className - Extra wrapper classes
 * @param {string} barClassName - Per-bar tone: '', 'positive', 'negative', 'muted'
 * @param {boolean} showArea - Sparkline fill under line
 */
export default function PalantirMiniChart({
    data = [],
    variant = 'bar',
    height = 50,
    className = '',
    barClassName = '',
    showArea = true,
    'aria-label': ariaLabel = 'Mini chart',
}) {
    const values = useMemo(
        () => (Array.isArray(data) ? data.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0)) : []),
        [data],
    );

    const max = useMemo(() => Math.max(...values, 1), [values]);
    const min = useMemo(() => Math.min(...values, 0), [values]);
    const range = max - min || 1;

    if (values.length === 0) {
        return (
            <div
                className={`pal-mini-chart pal-mini-chart-empty ${className}`.trim()}
                style={{ '--pal-mini-chart-h': `${height}px` }}
                role="img"
                aria-label={ariaLabel}
            />
        );
    }

    if (variant === 'sparkline') {
        const w = Math.max(values.length - 1, 1);
        const h = height;
        const pad = 2;
        const innerH = h - pad * 2;

        const points = values.map((v, i) => {
            const x = values.length === 1 ? 50 : (i / w) * 100;
            const y = pad + innerH - ((v - min) / range) * innerH;
            return { x, y };
        });

        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
        const areaPath =
            showArea && points.length > 0
                ? `${linePath} L ${points[points.length - 1].x} ${h - pad} L ${points[0].x} ${h - pad} Z`
                : null;

        return (
            <div
                className={`pal-sparkline ${className}`.trim()}
                style={{ '--pal-mini-chart-h': `${height}px`, height }}
                role="img"
                aria-label={ariaLabel}
            >
                <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" aria-hidden="true">
                    {areaPath && <path className="pal-sparkline-area" d={areaPath} />}
                    <path className="pal-sparkline-line" d={linePath} />
                    {values.length === 1 && (
                        <circle className="pal-sparkline-dot" cx={points[0].x} cy={points[0].y} r="2" />
                    )}
                </svg>
            </div>
        );
    }

    return (
        <div
            className={`pal-mini-chart ${className}`.trim()}
            style={{ '--pal-mini-chart-h': `${height}px`, height }}
            role="img"
            aria-label={ariaLabel}
        >
            <div className="pal-mini-chart-bars">
                {values.map((v, i) => {
                    const pct = Math.max(4, Math.round(((v - min) / range) * 100));
                    return (
                        <div
                            key={`bar-${i}`}
                            className={`pal-mini-chart-bar ${barClassName}`.trim()}
                            style={{ height: `${pct}%` }}
                            title={String(v)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

export function PalantirSparklineBars({ data = [], height = 32, className = '' }) {
    return (
        <PalantirMiniChart
            data={data}
            variant="bar"
            height={height}
            className={`pal-sparkline-bars ${className}`.trim()}
        />
    );
}
