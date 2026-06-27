"use client";

import React from 'react';

export const CHART_RANGES = ['1D', '1W', '1M', '1Y', 'ALL'];

export default function RangeSelector({ range, setRange }) {
    return (
        <div className="flex items-center gap-2 mt-6">
            {CHART_RANGES.map((r) => (
                <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`px-3 py-1 rounded-full text-xs transition ${
                        range === r
                            ? 'bg-[#0A84FF] text-white shadow-sm'
                            : 'text-[#6e6e73] dark:text-[#98989d] hover:text-[#1d1d1f] dark:hover:text-white'
                    }`}
                >
                    {r}
                </button>
            ))}
        </div>
    );
}
