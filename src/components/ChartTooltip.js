import React from 'react';

export function ChartTooltip({ x, y, value, label }) {
    return (
        <div
            className="pointer-events-none absolute z-20 rounded-xl px-2.5 py-1.5 text-[11px] text-[#1D1D1F] dark:text-white border border-black/[0.04] dark:border-white/[0.08] bg-white/90 dark:bg-sap-bgDark-card/90 backdrop-blur-[10px] shadow-[0_6px_20px_rgba(0,0,0,0.1)]"
            style={{ left: x, top: y }}
        >
            <div className="font-semibold">{value}</div>
            <div className="text-[#6E6E73] dark:text-[#98989D]">{label}</div>
        </div>
    );
}

