import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChartTooltip } from './ChartTooltip';

const WIDTH = 280;
const HEIGHT = 70;
const PADDING_X = 8;
const PADDING_Y = 6;

const smoothPath = (points) => {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i += 1) {
        const xMid = (points[i].x + points[i + 1].x) / 2;
        const yMid = (points[i].y + points[i + 1].y) / 2;
        d += ` Q ${points[i].x} ${points[i].y} ${xMid} ${yMid}`;
    }
    d += ` T ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return d;
};

export function MiniStockChart({ data = [], id = 'chart', formatValue = (v) => `${v}` }) {
    const [hoverIndex, setHoverIndex] = useState(null);

    const prepared = useMemo(() => {
        const values = data.map((d) => d.value || 0);
        const rawMax = Math.max(...values, 0);
        const rawMin = Math.min(...values, 0);
        const pad = Math.max((rawMax - rawMin) * 0.18, 1);
        const max = rawMax + pad;
        const min = rawMin - pad;
        const spread = max - min || 1;
        const stepX = (WIDTH - PADDING_X * 2) / Math.max(1, data.length - 1);

        const points = data.map((item, idx) => {
            const x = PADDING_X + idx * stepX;
            const y = HEIGHT - PADDING_Y - ((item.value - min) / spread) * (HEIGHT - PADDING_Y * 2);
            return { x, y };
        });

        const linePath = smoothPath(points);
        const areaPath = points.length
            ? `${linePath} L ${points[points.length - 1].x} ${HEIGHT - PADDING_Y} L ${points[0].x} ${HEIGHT - PADDING_Y} Z`
            : '';

        return { points, stepX, linePath, areaPath };
    }, [data]);

    const hoverPoint = hoverIndex != null ? prepared.points[hoverIndex] : null;
    const hoverData = hoverIndex != null ? data[hoverIndex] : null;

    return (
        <div className="relative">
            <svg
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="w-full h-[70px]"
                onMouseLeave={() => setHoverIndex(null)}
                onMouseMove={(event) => {
                    if (!data.length) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    const relativeX = ((event.clientX - rect.left) / rect.width) * WIDTH;
                    const idx = Math.min(
                        data.length - 1,
                        Math.max(0, Math.round((relativeX - PADDING_X) / (prepared.stepX || 1)))
                    );
                    setHoverIndex(idx);
                }}
            >
                <defs>
                    <linearGradient id={`${id}-line`} x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#0A84FF" />
                        <stop offset="100%" stopColor="#5AC8FA" />
                    </linearGradient>
                    <linearGradient id={`${id}-area`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="rgba(10,132,255,0.25)" />
                        <stop offset="100%" stopColor="rgba(10,132,255,0.00)" />
                    </linearGradient>
                </defs>

                {[0.33, 0.66].map((p) => (
                    <line
                        key={`${id}-${p}`}
                        x1={PADDING_X}
                        y1={PADDING_Y + (HEIGHT - PADDING_Y * 2) * p}
                        x2={WIDTH - PADDING_X}
                        y2={PADDING_Y + (HEIGHT - PADDING_Y * 2) * p}
                        stroke="currentColor"
                        className="text-black/[0.06] dark:text-white/[0.08]"
                        strokeWidth="1"
                    />
                ))}

                {prepared.areaPath && (
                    <motion.path
                        d={prepared.areaPath}
                        fill={`url(#${id}-area)`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
                    />
                )}
                {prepared.linePath && (
                    <motion.path
                        d={prepared.linePath}
                        fill="none"
                        stroke={`url(#${id}-line)`}
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ filter: 'drop-shadow(0 0 6px rgba(10,132,255,0.22))' }}
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.8, ease: [0.4, 0, 0.2, 1] }}
                    />
                )}

                {hoverPoint && (
                    <>
                        <line
                            x1={hoverPoint.x}
                            y1={PADDING_Y}
                            x2={hoverPoint.x}
                            y2={HEIGHT - PADDING_Y}
                            stroke="#0A84FF"
                            strokeOpacity="0.35"
                            strokeWidth="1"
                        />
                        <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4" fill="#0A84FF" />
                        <circle cx={hoverPoint.x} cy={hoverPoint.y} r="8" fill="#0A84FF" fillOpacity="0.18" />
                    </>
                )}
            </svg>

            {hoverPoint && hoverData && (
                <ChartTooltip
                    x={`${Math.min(Math.max(hoverPoint.x + 10, 6), WIDTH - 96)}px`}
                    y="-8px"
                    value={formatValue(hoverData.value)}
                    label={hoverData.label}
                />
            )}
        </div>
    );
}

