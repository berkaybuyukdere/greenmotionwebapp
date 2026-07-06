import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { reactListKey } from '../../utils/reactListKey';

export function usePalantirEsc(onClose, enabled = true) {
    useEffect(() => {
        if (!enabled || !onClose) return undefined;
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [onClose, enabled]);
}

/** Near-fullscreen Palantir operations workbench shell */
export function PalantirWorkbench({ onClose, children, size = 'full', embedded = false }) {
    usePalantirEsc(onClose, !embedded);
    const isDrawer = size === 'drawer';
    if (embedded) {
        return (
            <div
                className={`pal-wb-shell pal-wb-shell-embedded ${size === 'large' ? 'pal-wb-shell-lg' : ''} ${size === 'fit' ? 'pal-wb-shell-fit' : ''}`}
            >
                {children}
            </div>
        );
    }
    return (
        <div
            className={`pal-wb-overlay ${isDrawer ? 'pal-wb-overlay-drawer' : ''}`}
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
            role="dialog"
            aria-modal="true"
        >
            <div
                className={`pal-wb-shell ${size === 'large' ? 'pal-wb-shell-lg' : ''} ${size === 'fit' ? 'pal-wb-shell-fit' : ''} ${isDrawer ? 'pal-wb-shell-drawer' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                {children}
            </div>
        </div>
    );
}

export function PalantirCommandBar({ eyebrow, title, subtitle, badges, actions, onClose }) {
    return (
        <header className="pal-wb-command">
            <div className="pal-wb-command-main">
                {eyebrow && <p className="pal-wb-eyebrow">{eyebrow}</p>}
                <h2 className="pal-wb-title">{title}</h2>
                {subtitle && <p className="pal-wb-subtitle">{subtitle}</p>}
                {badges?.length > 0 && (
                    <div className="pal-wb-badges">
                        {badges.map((b) => (
                            <span
                                key={b.key || b.label}
                                className={`pal-wb-badge ${b.accent ? 'pal-wb-badge-accent' : ''} ${b.tone ? `pal-wb-badge-${b.tone}` : ''}`}
                            >
                                {b.label}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            <div className="pal-wb-command-actions">
                {actions}
                {onClose && (
                    <button type="button" onClick={onClose} className="gm-btn gm-btn-ghost gm-btn-sm pal-wb-close" aria-label="Close">
                        <X size={18} />
                    </button>
                )}
            </div>
        </header>
    );
}

export function PalantirWorkbenchGrid({ children }) {
    return <div className="pal-wb-grid">{children}</div>;
}

/** Left column — dense field list + optional nav */
export function PalantirInspector({ title, children, footer }) {
    return (
        <aside className="pal-wb-inspector">
            {title && <p className="pal-wb-inspector-title">{title}</p>}
            <div className="pal-wb-inspector-body">{children}</div>
            {footer && <div className="pal-wb-inspector-footer">{footer}</div>}
        </aside>
    );
}

export function PalantirInspectorRow({ label, value, mono, tone }) {
    return (
        <div className="pal-wb-field">
            <span className="pal-wb-field-label">{label}</span>
            <span className={`pal-wb-field-value ${mono ? 'mono' : ''} ${tone ? `tone-${tone}` : ''}`}>
                {value ?? '—'}
            </span>
        </div>
    );
}

/** Center — visual evidence / primary content */
export function PalantirCanvas({ title, meta, children, empty }) {
    return (
        <main className="pal-wb-canvas">
            {(title || meta) && (
                <div className="pal-wb-canvas-head">
                    {title && <p className="pal-wb-canvas-title">{title}</p>}
                    {meta && <p className="pal-wb-canvas-meta">{meta}</p>}
                </div>
            )}
            <div className="pal-wb-canvas-body">
                {children || (
                    <div className="pal-wb-canvas-empty">{empty || 'Select a record or attach evidence'}</div>
                )}
            </div>
        </main>
    );
}

/** Hero image + horizontal filmstrip — Palantir evidence viewer */
export function PalantirPhotoCanvas({
    images = [],
    onOpenAt,
    openGalleryOnClick = false,
    emptyLabel = 'No visual evidence',
}) {
    const [active, setActive] = useState(0);
    const safe = Array.isArray(images) ? images.filter(Boolean) : [];

    useEffect(() => {
        if (active >= safe.length) setActive(0);
    }, [safe.length, active]);

    if (safe.length === 0) {
        return <div className="pal-wb-canvas-empty">{emptyLabel}</div>;
    }

    const open = (index) => {
        setActive(index);
        if (openGalleryOnClick) onOpenAt?.(index);
    };

    const StageTag = openGalleryOnClick && onOpenAt ? 'button' : 'div';

    return (
        <div className="pal-wb-photo-viewer">
            <StageTag
                type={StageTag === 'button' ? 'button' : undefined}
                className="pal-wb-photo-stage"
                onClick={StageTag === 'button' ? () => onOpenAt?.(active) : undefined}
                aria-label={StageTag === 'button' ? 'Open full gallery' : undefined}
            >
                <img src={safe[active]} alt={`Evidence ${active + 1}`} />
                <span className="pal-wb-photo-counter">
                    {active + 1} / {safe.length}
                </span>
            </StageTag>
            {safe.length > 1 && (
                <div className="pal-wb-filmstrip" role="list">
                    {safe.map((url, i) => (
                        <button
                            key={reactListKey('film', i, url)}
                            type="button"
                            role="listitem"
                            className={`pal-wb-filmstrip-item ${i === active ? 'active' : ''}`}
                            onClick={() => open(i)}
                        >
                            <img src={url} alt="" />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

/** Right column — signals / KPIs / actions */
export function PalantirContextRail({ title, children }) {
    return (
        <aside className="pal-wb-rail">
            {title && <p className="pal-wb-rail-title">{title}</p>}
            <div className="pal-wb-rail-body">{children}</div>
        </aside>
    );
}

export function PalantirSignal({ label, value, tone }) {
    return (
        <div className={`pal-wb-signal ${tone ? `pal-wb-signal-${tone}` : ''}`}>
            <span className="pal-wb-signal-label">{label}</span>
            <span className="pal-wb-signal-value">{value}</span>
        </div>
    );
}

export function PalantirRecordNav({ items, selectedKey, onSelect, emptyLabel, selectionBanner }) {
    if (!items?.length) {
        return <p className="pal-wb-nav-empty">{emptyLabel || 'No records'}</p>;
    }
    const selected = items.find((item) => item.key === selectedKey);
    return (
        <nav className="pal-wb-record-nav">
            {(selectionBanner || selected) && (
                <p className="pal-wb-record-selection-banner">
                    {selectionBanner || `Selected · ${selected?.primary || '—'}`}
                </p>
            )}
            {items.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    className={`pal-wb-record-item ${selectedKey === item.key ? 'active' : ''}`}
                    onClick={() => onSelect?.(item)}
                >
                    <span className="pal-wb-record-primary">{item.primary}</span>
                    {item.secondary && <span className="pal-wb-record-secondary">{item.secondary}</span>}
                    {item.badge && <span className={`pal-wb-record-badge tone-${item.badgeTone || 'neutral'}`}>{item.badge}</span>}
                </button>
            ))}
        </nav>
    );
}

export function PalantirTabRail({ tabs, active, onChange }) {
    return (
        <div className="pal-wb-tab-rail">
            {tabs.map((t) => (
                <button
                    key={t.id}
                    type="button"
                    className={`pal-wb-tab ${active === t.id ? 'active' : ''}`}
                    onClick={() => onChange(t.id)}
                >
                    {t.label}
                    {t.count != null && <span className="pal-wb-tab-count">{t.count}</span>}
                </button>
            ))}
        </div>
    );
}

export function PalantirActionBar({ children }) {
    return <footer className="pal-wb-action-bar">{children}</footer>;
}
