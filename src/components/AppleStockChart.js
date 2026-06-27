"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import RangeSelector from './RangeSelector';
import Tooltip from './Tooltip';

const DEFAULT_SVG_WIDTH = 700;
const SVG_HEIGHT = 320;
const PADDING_X = 36;
const PADDING_Y = 28;

const formatLabelByRange = (date, range) => {
    if (range === '1D') return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (range === '1W' || range === '1M') return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

const bucketizeData = (series, range) => {
    if (!series.length) return [];
    const sorted = [...series]
        .filter((s) => s.date instanceof Date && !Number.isNaN(s.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (!sorted.length) return [];

    const now = new Date();
    const buckets = [];

    if (range === '1D') {
        for (let i = 23; i >= 0; i -= 1) {
            const start = new Date(now);
            start.setMinutes(0, 0, 0);
            start.setHours(start.getHours() - i);
            const end = new Date(start);
            end.setHours(end.getHours() + 1);
            const value = sorted.reduce((sum, item) => (item.date >= start && item.date < end ? sum + item.value : sum), 0);
            buckets.push({ date: start, label: formatLabelByRange(start, range), value });
        }
        return buckets;
    }

    if (range === '1W' || range === '1M') {
        const days = range === '1W' ? 7 : 30;
        for (let i = days - 1; i >= 0; i -= 1) {
            const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
            const end = new Date(start);
            end.setDate(end.getDate() + 1);
            const value = sorted.reduce((sum, item) => (item.date >= start && item.date < end ? sum + item.value : sum), 0);
            buckets.push({ date: start, label: formatLabelByRange(start, range), value });
        }
        return buckets;
    }

    if (range === '1Y') {
        for (let i = 11; i >= 0; i -= 1) {
            const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
            const value = sorted.reduce((sum, item) => (item.date >= start && item.date < end ? sum + item.value : sum), 0);
            buckets.push({ date: start, label: formatLabelByRange(start, range), value });
        }
        return buckets;
    }

    // ALL
    const first = sorted[0].date;
    const start = new Date(first.getFullYear(), first.getMonth(), 1);
    const endCursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const cursor = new Date(start);
    while (cursor <= endCursor) {
        const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        const value = sorted.reduce((sum, item) => (item.date >= cursor && item.date < next ? sum + item.value : sum), 0);
        buckets.push({
            date: new Date(cursor),
            label: formatLabelByRange(cursor, 'ALL'),
            value,
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }
    return buckets;
};

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

const buildSnippetIndexes = (length) => {
    if (length <= 1) return [0];
    const raw = [
        0,
        Math.floor((length - 1) * 0.25),
        Math.floor((length - 1) * 0.5),
        Math.floor((length - 1) * 0.75),
        length - 1,
    ];
    return [...new Set(raw)].filter((i) => i >= 0 && i < length);
};

export default function AppleStockChart({
    title,
    series = [],
    valuePrefix = '',
    valueFormatter = (v) => `${valuePrefix}${Math.round(v)}`,
    tooltipFormatter = (v) => `${valuePrefix}${Math.round(v)}`,
    lineGradientId = 'appleLineGradient',
    valueMode = 'latest', // latest | total
}) {
    const [range, setRange] = useState('1M');
    const [hoverIndex, setHoverIndex] = useState(null);
    const [chartWidth, setChartWidth] = useState(DEFAULT_SVG_WIDTH);
    const chartContainerRef = useRef(null);

    useEffect(() => {
        if (!chartContainerRef.current) return undefined;
        const container = chartContainerRef.current;
        const updateWidth = () => {
            const nextWidth = Math.max(container.clientWidth, 320);
            setChartWidth(nextWidth);
        };
        updateWidth();

        const resizeObserver = new ResizeObserver(updateWidth);
        resizeObserver.observe(container);
        return () => resizeObserver.disconnect();
    }, []);

    const bucketed = useMemo(() => bucketizeData(series, range), [series, range]);
    const values = bucketed.map((item) => item.value);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const spread = max - min || 1;
    const drawWidth = Math.max(chartWidth, 320);

    const stepX = bucketed.length > 1
        ? (drawWidth - PADDING_X * 2) / (bucketed.length - 1)
        : 0;

    const toY = (v) => SVG_HEIGHT - PADDING_Y - ((v - min) / spread) * (SVG_HEIGHT - PADDING_Y * 2);

    const points = bucketed.map((d, i) => ({
        x: PADDING_X + i * stepX,
        y: toY(d.value),
    }));

    const linePath = smoothPath(points);
    const areaPath = points.length
        ? `${linePath} L ${points[points.length - 1].x} ${SVG_HEIGHT - PADDING_Y} L ${points[0].x} ${SVG_HEIGHT - PADDING_Y} Z`
        : '';

    const latestValue = bucketed[bucketed.length - 1]?.value || 0;
    const totalValue = bucketed.reduce((sum, item) => sum + (item.value || 0), 0);
    const displayValue = valueMode === 'total' ? totalValue : latestValue;
    const hoverPoint = hoverIndex != null ? points[hoverIndex] : null;
    const hoverData = hoverIndex != null ? bucketed[hoverIndex] : null;
    const snippetIndexes = buildSnippetIndexes(bucketed.length);
    const hoverSummary = hoverData
        ? `${tooltipFormatter(hoverData.value)} • ${hoverData.label}`
        : (bucketed.length ? `Range total: ${tooltipFormatter(totalValue)}` : 'No data in this range');

    return (
        <div className="relative rounded-[28px] p-7 shadow-[0_8px_28px_rgba(15,15,20,0.08)] bg-[#ffffff] dark:bg-sap-bgDark-card border border-black/5 dark:border-white/10">
            <div className="text-[13px] tracking-[0.01em] text-[#6e6e73] dark:text-[#98989d]">{title}</div>
            <div className="text-[38px] leading-tight font-semibold text-[#1d1d1f] dark:text-white mt-1">
                {valueFormatter(displayValue)}
            </div>
            <div className="text-[12px] text-[#6e6e73] dark:text-[#98989d] mt-1">
                {hoverSummary}
            </div>

            <RangeSelector range={range} setRange={setRange} />

            <div className="relative mt-6 w-full" ref={chartContainerRef}>
                <svg
                    viewBox={`0 0 ${drawWidth} ${SVG_HEIGHT}`}
                    className="w-full h-[320px]"
                    onMouseLeave={() => setHoverIndex(null)}
                    onMouseMove={(event) => {
                        if (!bucketed.length) return;
                        const rect = event.currentTarget.getBoundingClientRect();
                        const relativeX = ((event.clientX - rect.left) / rect.width) * drawWidth;
                        const idx = Math.min(
                            bucketed.length - 1,
                            Math.max(0, Math.round((relativeX - PADDING_X) / (stepX || 1)))
                        );
                        setHoverIndex(idx);
                    }}
                >
                    <defs>
                        <linearGradient id={`${lineGradientId}-line`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#0A84FF" />
                            <stop offset="100%" stopColor="#5AC8FA" />
                        </linearGradient>
                        <linearGradient id={`${lineGradientId}-area`} x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#5AC8FA" stopOpacity="0.02" />
                        </linearGradient>
                    </defs>

                    {[0.2, 0.4, 0.6, 0.8].map((p) => (
                        <line
                            key={p}
                            x1={PADDING_X}
                            y1={PADDING_Y + (SVG_HEIGHT - PADDING_Y * 2) * p}
                            x2={drawWidth - PADDING_X}
                            y2={PADDING_Y + (SVG_HEIGHT - PADDING_Y * 2) * p}
                            stroke="currentColor"
                            className="text-black/7 dark:text-white/10"
                            strokeWidth="1"
                        />
                    ))}

                    {areaPath && (
                        <motion.path
                            d={areaPath}
                            fill={`url(#${lineGradientId}-area)`}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.55, ease: 'easeOut' }}
                        />
                    )}

                    {linePath && (
                        <motion.path
                            d={linePath}
                            fill="none"
                            stroke={`url(#${lineGradientId}-line)`}
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            initial={{ pathLength: 0 }}
                            animate={{ pathLength: 1 }}
                            transition={{ duration: 1.2, ease: 'easeOut' }}
                        />
                    )}

                    {hoverPoint && (
                        <>
                            <line
                                x1={hoverPoint.x}
                                y1={PADDING_Y}
                                x2={hoverPoint.x}
                                y2={SVG_HEIGHT - PADDING_Y}
                                stroke="#0A84FF"
                                strokeOpacity="0.35"
                                strokeWidth="1"
                            />
                            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="4.5" fill="#0A84FF" />
                            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="8" fill="#0A84FF" fillOpacity="0.18" />
                        </>
                    )}
                </svg>

                {hoverPoint && hoverData && (
                    <Tooltip
                        x={`${Math.min(Math.max(hoverPoint.x + 12, 8), drawWidth - 96)}px`}
                        y="12px"
                        value={tooltipFormatter(hoverData.value)}
                        label={hoverData.label}
                    />
                )}
            </div>
            <div className="mt-2 px-1 flex items-center justify-between text-[11px] text-[#6e6e73] dark:text-[#98989d]">
                {snippetIndexes.map((idx) => (
                    <span key={`${bucketed[idx]?.date?.toISOString?.() || idx}-${idx}`}>
                        {bucketed[idx]?.label || '-'}
                    </span>
                ))}
            </div>
        </div>
    );
}
