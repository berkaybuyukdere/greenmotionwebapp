import React from 'react';

/**
 * Input Component — Stripe gm-field (#E3E8EE border, #635BFF focus)
 */
export function SapInput({
    label,
    error,
    helperText,
    className = '',
    ...props
}) {
    return (
        <div className={`mb-4 ${className}`}>
            {label && (
                <label className="gm-label">
                    {label}
                </label>
            )}
            <input
                className={`gm-field disabled:opacity-50 disabled:cursor-not-allowed ${
                    error ? '!border-[var(--erpx-red-border)] focus:!shadow-[0_0_0_3px_rgba(192,18,60,0.15)]' : ''
                }`}
                {...props}
            />
            {error && (
                <p className="mt-1 text-xs" style={{ color: 'var(--erpx-red)' }}>{error}</p>
            )}
            {helperText && !error && (
                <p className="mt-1 text-xs" style={{ color: 'var(--erpx-ink-muted)' }}>{helperText}</p>
            )}
        </div>
    );
}
