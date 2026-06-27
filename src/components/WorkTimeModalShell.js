import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Portaled Palantir modal with a fixed header/footer and scrollable body.
 * Escapes `erpx-main` overflow; locks page scroll while open.
 */
export function WorkTimeModalShell({
    open,
    onClose,
    size = 'md',
    header,
    footer,
    children,
    className = '',
    ariaLabelledBy,
}) {
    useEffect(() => {
        if (!open) return undefined;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [open]);

    if (!open) return null;

    const sizeClass =
        size === 'lg' ? 'pal-tt-modal-shell--lg' : size === 'sm' ? 'pal-tt-modal-shell--sm' : 'pal-tt-modal-shell--md';

    return createPortal(
        <div
            className="pal-detail-overlay pal-tt-modal-overlay pal-tt-person-overlay"
            onClick={onClose}
            role="presentation"
        >
            <div
                className={`pal-detail-shell pal-tt-modal-shell ${sizeClass} ${className}`.trim()}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
            >
                {header}
                <div className="pal-tt-modal-scroll">{children}</div>
                {footer ? <footer className="pal-tt-modal-footer">{footer}</footer> : null}
            </div>
        </div>,
        document.body
    );
}
