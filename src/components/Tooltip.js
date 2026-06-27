import React from 'react';

export default function Tooltip({ x, y, value, label }) {
    return (
        <div
            style={{ position: 'absolute', left: x, top: y }}
            className="pointer-events-none z-20 bg-black/90 text-white text-xs px-2 py-1 rounded-md shadow-lg whitespace-nowrap"
        >
            <div className="font-medium">{value}</div>
            {label ? <div className="text-white/75">{label}</div> : null}
        </div>
    );
}
