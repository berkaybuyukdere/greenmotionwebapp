import React from 'react';

/** Single Palantir-style loading indicator — use instead of yellow/blue spinners. */
export default function PalantirLoader({ label = 'Loading…', size = 'md', className = '' }) {
    const dim = size === 'sm' ? 22 : size === 'lg' ? 40 : 30;
    return (
        <div className={`pal-loader ${className}`.trim()} role="status" aria-live="polite">
            <div className="pal-loader-ring" style={{ width: dim, height: dim }} aria-hidden />
            {label ? <span className="pal-loader-label">{label}</span> : null}
        </div>
    );
}

export function PalantirLoaderOverlay({ label = 'Loading…' }) {
    return (
        <div className="pal-loader-overlay">
            <div className="pal-loader-panel">
                <PalantirLoader label={label} size="lg" />
            </div>
        </div>
    );
}
