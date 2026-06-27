import React from 'react';

/**
 * Card Component — Stripe gm-panel design system
 */
export function SapCard({
    children,
    title,
    subtitle,
    headerAction,
    className = '',
    elevated = false,
    ...props
}) {
    return (
        <div
            className={`gm-panel ${elevated ? 'shadow-md' : ''} ${className}`}
            {...props}
        >
            {(title || subtitle || headerAction) && (
                <div className="gm-panel-header">
                    <div>
                        {title && (
                            <h3 className="gm-panel-title">
                                {title}
                            </h3>
                        )}
                        {subtitle && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--erpx-ink-muted)' }}>
                                {subtitle}
                            </p>
                        )}
                    </div>
                    {headerAction && <div>{headerAction}</div>}
                </div>
            )}
            <div className="gm-panel-body">
                {children}
            </div>
        </div>
    );
}
