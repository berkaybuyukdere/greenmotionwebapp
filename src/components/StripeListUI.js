import React from 'react';
import { Search, MoreHorizontal, ChevronDown, ChevronRight, Mail, User } from 'lucide-react';

const BADGE_CLASS = {
    success: 'gm-badge gm-badge-success',
    warning: 'gm-badge gm-badge-warning',
    danger: 'gm-badge gm-badge-danger',
    failed: 'gm-badge gm-badge-danger',
    info: 'gm-badge gm-badge-info',
    neutral: 'gm-badge gm-badge-neutral',
    purple: 'gm-badge gm-badge-purple',
    deposit: 'gm-badge gm-badge-deposit',
    wheelsys: 'gm-badge gm-badge-wheelsys',
    paid: 'gm-badge pal-fin-badge-paid',
    unpaid: 'gm-badge pal-fin-badge-unpaid',
    traffic_fine: 'gm-badge pal-fin-badge-traffic',
    damage: 'gm-badge pal-fin-badge-damage',
    hold: 'gm-badge pal-fin-badge-hold',
    increased: 'gm-badge pal-fin-badge-increased',
    captured: 'gm-badge pal-fin-badge-captured',
    captured_increased: 'gm-badge pal-fin-badge-captured-increased',
};

/** Stripe transactions.html / accounting.html status pill */
export function StripeStatusBadge({ variant = 'neutral', label, showDot = true, sharp = false }) {
    const cls = `${BADGE_CLASS[variant] || BADGE_CLASS.neutral}${sharp ? ' pal-fin-badge-sharp' : ''}`;
    return (
        <span className={cls}>
            {showDot && <span className="gm-badge-dot" aria-hidden="true" />}
            {label}
        </span>
    );
}

/** Filter chips row — ERPXDashboard FilterChip */
export function StripeFilterChips({ options = [], value, onChange, variant = 'row' }) {
    const wrapClass = variant === 'strip' ? 'gm-filter-strip' : 'gm-filter-row';
    return (
        <div className={wrapClass} role="tablist">
            {options.map((opt) => (
                <button
                    key={opt.id}
                    type="button"
                    role="tab"
                    aria-selected={value === opt.id}
                    className={value === opt.id ? 'gm-filter-chip gm-filter-chip-active' : 'gm-filter-chip'}
                    onClick={() => onChange(opt.id)}
                >
                    {opt.dotColor ? (
                        <span className="gm-filter-dot" style={{ background: opt.dotColor }} aria-hidden="true" />
                    ) : null}
                    {opt.label}
                    {typeof opt.count === 'number' ? (
                        <span className="gm-filter-count">{opt.count}</span>
                    ) : null}
                </button>
            ))}
        </div>
    );
}

/** Toolbar: search + optional filters slot (accounting.html .toolbar) */
export function StripeListToolbar({
    searchValue,
    onSearchChange,
    searchPlaceholder = 'Search…',
    children,
    trailing,
}) {
    return (
        <div className="gm-toolbar">
            <div className="gm-toolbar-group">
                <label className="gm-search-box gm-search-box-pal">
                    <Search size={16} className="shrink-0 text-[var(--erpx-ink-muted)]" aria-hidden="true" />
                    <input
                        type="search"
                        value={searchValue}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder}
                    />
                </label>
                {children}
            </div>
            {trailing ? <div className="gm-toolbar-actions">{trailing}</div> : null}
        </div>
    );
}

export function StripeFilterBtn({ active, children, onClick, type = 'button' }) {
    return (
        <button type={type} className={active ? 'gm-filter-btn gm-filter-btn-active' : 'gm-filter-btn'} onClick={onClick}>
            {children}
        </button>
    );
}

/** Primary column — Res Kodu / protocol id (like Amount in transactions.html) */
export function StripeResCode({ code, sublabel }) {
    return (
        <div className="gm-res-code-cell">
            <span className="gm-res-code">{code || '—'}</span>
            {sublabel ? <span className="gm-res-code-sub">{sublabel}</span> : null}
        </div>
    );
}

/** Customer column with avatar (accounting.html .customer-cell) */
export function StripeCustomerCell({ name, email, plate, showIcons = false }) {
    const display = String(name || plate || '—').trim();
    const emailStr = String(email || '').trim();
    let initials = display
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    if (!initials && emailStr) {
        const local = emailStr.split('@')[0] || '';
        initials = local.slice(0, 2).toUpperCase() || '?';
    }
    if (!initials) initials = '?';
    const hue = display.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
    const secondary = email || plate;

    return (
        <div className="gm-customer-cell">
            {showIcons ? (
                <span className="gm-avatar" aria-hidden="true">
                    <User size={13} className="gm-customer-cell-icon" />
                </span>
            ) : (
                <span
                    className="gm-avatar"
                    style={{ background: `hsl(${hue}, 52%, 88%)`, color: `hsl(${hue}, 45%, 32%)` }}
                    aria-hidden="true"
                >
                    {initials}
                </span>
            )}
            <div className="gm-customer-info">
                <span className="gm-customer-name flex items-center gap-1.5 min-w-0">
                    {showIcons ? <User size={12} className="gm-customer-cell-icon shrink-0" aria-hidden /> : null}
                    <span className="truncate">{display}</span>
                </span>
                {secondary ? (
                    <span className="gm-customer-email flex items-center gap-1.5 min-w-0">
                        {showIcons ? <Mail size={11} className="gm-customer-cell-icon shrink-0" aria-hidden /> : null}
                        <span className="truncate">{secondary}</span>
                    </span>
                ) : null}
            </div>
        </div>
    );
}

/** Map front-desk / customer row status to Stripe badge label */
export function mapFrontDeskStatusBadge(status) {
    if (status === 'completed') {
        return { variant: 'success', label: 'Succeeded' };
    }
    if (status === 'awaiting_staff') {
        return { variant: 'info', label: 'Recorded' };
    }
    return { variant: 'warning', label: 'Pending' };
}

/** Colored count chip for photos / icons */
export function StripeIconChip({ icon: Icon, count, tone = 'info', onClick }) {
    const toneClass =
        tone === 'success'
            ? 'gm-icon-chip gm-icon-chip-success'
            : tone === 'warning'
              ? 'gm-icon-chip gm-icon-chip-warning'
              : tone === 'purple'
                ? 'gm-icon-chip gm-icon-chip-purple'
                : 'gm-icon-chip gm-icon-chip-info';

    const inner = (
        <>
            {Icon ? <Icon size={12} aria-hidden="true" /> : null}
            <span>{count}</span>
        </>
    );

    if (onClick) {
        return (
            <button type="button" className={toneClass} onClick={onClick}>
                {inner}
            </button>
        );
    }
    return <span className={toneClass}>{inner}</span>;
}

export function StripeRowAction({ onClick }) {
    return (
        <button type="button" className="gm-row-action" onClick={onClick} aria-label="More actions">
            <MoreHorizontal size={14} />
        </button>
    );
}

export function StripeTableFooter({ itemCount, totalLabel, rowsPerPage = 25 }) {
    return (
        <div className="gm-table-footer pal-table-pager">
            <span className="pal-table-pager-count">
                <strong>{itemCount}</strong> {itemCount === 1 ? 'item' : 'items'}
                {totalLabel ? ` · ${totalLabel}` : ''}
            </span>
            <span className="gm-table-footer-controls pal-table-pager-controls">
                <span className="gm-table-footer-meta pal-table-pager-size">
                    Rows per page: <strong>{rowsPerPage}</strong>
                </span>
                <span className="gm-table-footer-page pal-table-pager-page">Page 1</span>
            </span>
        </div>
    );
}

export function StripeSummaryRow({ cards = [] }) {
    return (
        <div className="gm-summary-row">
            {cards.map((card) => (
                <div key={card.id || card.label} className={`gm-summary-card ${card.tone ? `gm-summary-${card.tone}` : ''}`}>
                    <div className="gm-summary-label">{card.label}</div>
                    <div className="gm-summary-value">{card.value}</div>
                    {card.count != null ? <div className="gm-summary-count">{card.count}</div> : null}
                </div>
            ))}
        </div>
    );
}

/** List panel — card shell matching ERPXDashboard transactions table block */
export function StripeListPanel({ header, tabs, filterStrip, toolbar, footer, children, className = '' }) {
    return (
        <div className={`gm-table-wrap gm-list-panel ${className}`.trim()}>
            {header ? <div className="gm-panel-header">{header}</div> : null}
            {tabs ? <div className="gm-tabs gm-tabs-counted gm-tabs-inset">{tabs}</div> : null}
            {filterStrip}
            {toolbar}
            {children}
            {footer}
        </div>
    );
}

export function StripeTabsWithCounts({ tabs, activeId, onChange, inset = true }) {
    return (
        <div className={inset ? 'gm-tabs gm-tabs-counted gm-tabs-inset' : 'gm-tabs gm-tabs-counted'}>
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    className={activeId === tab.id ? 'gm-tab gm-tab-active' : 'gm-tab'}
                    onClick={() => onChange(tab.id)}
                >
                    {tab.label}
                    {typeof tab.count === 'number' ? <span className="gm-tab-count">{tab.count}</span> : null}
                </button>
            ))}
        </div>
    );
}

export function getBookingCode(record) {
    return record?.navKodu || record?.resKodu || record?.resCode || record?.referenceNumber || '';
}

export function mapParkedStatusVariant(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('park')) return 'info';
    if (s === 'active' || s.includes('complete') || s.includes('success')) return 'success';
    if (s.includes('cancel') || s.includes('fail')) return 'danger';
    if (s.includes('pending') || s.includes('wait')) return 'warning';
    return 'purple';
}

export function mapPaymentStatusVariant(status) {
    const s = String(status || 'pending').toLowerCase();
    if (s === 'paid') return 'success';
    if (s === 'unpaid') return 'danger';
    return 'warning';
}

export function mapReminderToneToVariant(tone) {
    if (tone === 'success') return 'success';
    if (tone === 'danger') return 'danger';
    if (tone === 'info') return 'info';
    return 'warning';
}

/** Stripe dashboard metric row — large tiles with trend beside value */
export function StripeMetricRow({ children, className = '' }) {
    return <div className={['gm-stripe-metric-row', className].filter(Boolean).join(' ')}>{children}</div>;
}

export function StripeMetricTile({
    label,
    value,
    count,
    delta,
    deltaTone = 'neutral',
    selected = false,
    onClick,
}) {
    const deltaClass =
        deltaTone === 'positive'
            ? 'gm-office-metric-delta-positive'
            : deltaTone === 'negative'
              ? 'gm-office-metric-delta-negative'
              : 'gm-office-metric-delta-neutral';

    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                'gm-stripe-metric-tile',
                selected ? 'gm-stripe-metric-tile-selected' : '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div className="gm-stripe-metric-tile-label">{label}</div>
            <div className="gm-stripe-metric-tile-body">
                <span className="gm-stripe-metric-tile-value">{value}</span>
                {delta ? <span className={`gm-stripe-metric-tile-delta ${deltaClass}`}>{delta}</span> : null}
            </div>
            {count ? <div className="gm-stripe-metric-tile-count">{count}</div> : null}
        </button>
    );
}

/** Compact KPI tile — accounting.html .summary-card (Office Operations) */
export function OfficeMetricsGrid({ children }) {
    return <div className="gm-stripe-metric-row gm-office-metrics">{children}</div>;
}

export function OfficeMetricCard({
    label,
    icon = null,
    amount,
    count,
    delta,
    deltaTone = 'neutral',
    selected = false,
    onClick,
    tone = 'default',
}) {
    const deltaClass =
        deltaTone === 'positive'
            ? 'gm-office-metric-delta-positive'
            : deltaTone === 'negative'
              ? 'gm-office-metric-delta-negative'
              : 'gm-office-metric-delta-neutral';

    return (
        <button
            type="button"
            onClick={onClick}
            className={[
                'gm-office-metric',
                `gm-office-metric-tone-${tone}`,
                selected ? 'gm-office-metric-selected' : '',
            ]
                .filter(Boolean)
                .join(' ')}
        >
            <div className="gm-office-metric-label">
                {icon ? <span className="gm-office-metric-icon">{icon}</span> : null}
                <span title={label}>{label}</span>
            </div>
            <div className="gm-office-metric-value">{amount}</div>
            {delta ? <div className={`gm-office-metric-delta ${deltaClass}`}>{delta}</div> : null}
            {count ? <div className="gm-office-metric-count">{count}</div> : null}
        </button>
    );
}

/** Stripe-style expandable operation row */
export function OfficeOperationRow({
    icon,
    iconTone = 'info',
    title,
    amountBadge,
    meta,
    expanded,
    onToggle,
    onContextMenu,
    children,
    detailMode = false,
}) {
    return (
        <div className="gm-op-item">
            <div
                className="gm-op-row-header"
                role="button"
                tabIndex={0}
                onClick={onToggle}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle();
                    }
                }}
                onContextMenu={onContextMenu}
            >
                <div className={`gm-op-icon gm-op-icon-${iconTone}`}>{icon}</div>
                <div className="gm-op-main">
                    <div className="gm-op-title-row">
                        <span className="gm-op-title">{title}</span>
                        {amountBadge}
                    </div>
                    {meta ? <div className="gm-op-meta">{meta}</div> : null}
                </div>
                {detailMode ? (
                    <ChevronRight className="gm-op-chevron" size={18} aria-hidden />
                ) : (
                    <ChevronDown className={`gm-op-chevron ${expanded ? 'gm-op-chevron-open' : ''}`} size={18} aria-hidden />
                )}
            </div>
            {!detailMode && expanded && children ? <div className="gm-op-row-body">{children}</div> : null}
        </div>
    );
}

/** Generic data table for Stripe financial views */
export function StripeDataTable({
    columns = [],
    rows = [],
    loading = false,
    emptyMessage = 'No records',
    onRowClick,
    selectedRowId = null,
    dense = false,
}) {
    const wrapClass = dense ? 'pal-fin-table-wrap' : 'gm-card overflow-hidden';
    const tableClass = dense ? 'pal-fin-table pal-fin-table-dense w-full' : 'gm-table w-full text-sm';
    const thClass = dense
        ? undefined
        : 'text-left px-4 py-3 font-medium text-[var(--erpx-ink-muted)]';
    const tdClass = dense ? undefined : 'px-4 py-3 align-middle';
    const emptyCellClass = dense
        ? 'pal-fin-empty'
        : 'px-4 py-10 text-center text-[var(--erpx-ink-muted)]';

    return (
        <div className={wrapClass}>
            <div className={dense ? undefined : 'overflow-x-auto'}>
                <table className={tableClass}>
                    <thead>
                        <tr>
                            {columns.map((col) => (
                                <th key={col.key} className={thClass}>
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={columns.length} className={emptyCellClass}>
                                    Loading…
                                </td>
                            </tr>
                        ) : rows.length === 0 ? (
                            <tr>
                                <td colSpan={columns.length} className={emptyCellClass}>
                                    {emptyMessage}
                                </td>
                            </tr>
                        ) : (
                            rows.map((row) => {
                                const rowId = row.id || JSON.stringify(row);
                                const isSelected = selectedRowId != null && String(selectedRowId) === String(row.id);
                                return (
                                <tr
                                    key={rowId}
                                    className={`${onRowClick ? 'pal-fin-table-row-clickable' : ''}${isSelected ? ' pal-fin-row-selected' : ''}`}
                                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                                >
                                    {columns.map((col) => (
                                        <td key={col.key} className={tdClass}>
                                            {col.render ? col.render(row) : row[col.key]}
                                        </td>
                                    ))}
                                </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
