import React, { useMemo, useState } from 'react';
import {
    sentinelFormatCurrencyCompact,
    coerceSentinelDate,
    sentinelFormatShortDate,
    sentinelFormatDateTime,
    sentinelRelativeTime,
    initialsFromName,
} from '../../utilities/sentinelFormat';

function getExitBookingCode(exit) {
    return exit?.navKodu || exit?.resKodu || '';
}

function statusBadgeVariant(status) {
    const s = String(status || 'Pending').toLowerCase();
    if (s.includes('complete')) return 'success';
    if (s.includes('park')) return 'warning';
    if (s.includes('process') || s.includes('active')) return 'primary';
    if (s.includes('disput') || s.includes('cancel')) return 'danger';
    return 'neutral';
}

function activityDotClass(type, description) {
    const t = `${type || ''} ${description || ''}`.toLowerCase();
    if (t.includes('hasar') || t.includes('damage') || t.includes('silindi') || t.includes('delete')) return 'danger';
    if (t.includes('iade') || t.includes('return') || t.includes('fulfill') || t.includes('complete')) return 'success';
    if (t.includes('warn') || t.includes('park')) return 'warning';
    return 'primary';
}

function categoryBarClass(index) {
    const classes = ['', ' stripe', ' success', ' warning', ' danger'];
    return classes[index % classes.length];
}

export function SentinelDashboardView({
    cars = [],
    services = [],
    returns = [],
    activities = [],
    officeOperations = [],
    exitIslemleri = [],
    setCurrentView,
    canViewFinancials = true,
    effectiveFranchiseId,
}) {
    const now = new Date();
    const syncLabel = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const monthlyOfficeOperations = officeOperations.filter((op) => {
        const opDate = coerceSentinelDate(op.date);
        return opDate && opDate >= currentMonthStart && opDate <= currentMonthEnd;
    });

    const monthlyPosTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'POS Daily Closing')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyAdditionalSalesTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Additional Sales')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyBankingTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Banking Transaction')
        .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);
    const monthlyRevenueTotal =
        monthlyPosTotal +
        monthlyAdditionalSalesTotal +
        monthlyBankingTotal +
        monthlyOfficeOperations
            .filter((op) => op.type === 'Fuel Receipt' && op.isCompleted)
            .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);

    const monthlyCheckouts = exitIslemleri.filter((exit) => {
        if (exit.isDeleted) return false;
        const exitDate = coerceSentinelDate(exit.exitTarihi);
        return exitDate && exitDate >= currentMonthStart && exitDate <= currentMonthEnd;
    }).length;

    const fleetCount = cars.length;

    const allDamages = cars.flatMap((car) => (car.hasarKayitlari || []).filter((h) => !h.isDeleted));
    const todayDamageCount = allDamages.filter((hasar) => {
        const d = coerceSentinelDate(hasar.tarih || hasar.handoverTarihi || hasar.date);
        return d && d >= todayStart && d < tomorrowStart;
    }).length;

    const pendingCheckouts = exitIslemleri.filter((exit) => {
        if (exit.isDeleted) return false;
        const status = String(exit.status || '').toLowerCase();
        return status !== 'completed';
    }).length;

    const kpiFourValue = todayDamageCount > 0 ? todayDamageCount : pendingCheckouts;
    const kpiFourLabel = todayDamageCount > 0 ? "Today's Damages" : 'Pending Check-outs';
    const kpiFourCompare =
        todayDamageCount > 0
            ? `${pendingCheckouts} pending check-out${pendingCheckouts === 1 ? '' : 's'}`
            : 'Open checkout queue';

    const recentExits = useMemo(() => {
        return [...exitIslemleri]
            .filter((exit) => !exit.isDeleted)
            .sort((a, b) => {
                const da = coerceSentinelDate(a.exitTarihi)?.getTime() || 0;
                const db = coerceSentinelDate(b.exitTarihi)?.getTime() || 0;
                return db - da;
            })
            .slice(0, 6);
    }, [exitIslemleri]);

    const [selectedExitId, setSelectedExitId] = useState(null);
    const selectedExit = useMemo(() => {
        if (!recentExits.length) return null;
        const id = selectedExitId ?? recentExits[0].documentId ?? recentExits[0].id;
        return recentExits.find((e) => (e.documentId || e.id) === id) || recentExits[0];
    }, [recentExits, selectedExitId]);

    const chartBars = useMemo(() => {
        const days = [];
        for (let i = 29; i >= 0; i -= 1) {
            const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 0, 0, 0, 0);
            const dayEnd = new Date(dayStart);
            dayEnd.setDate(dayEnd.getDate() + 1);
            const count = exitIslemleri.filter((exit) => {
                if (exit.isDeleted) return false;
                const d = coerceSentinelDate(exit.exitTarihi);
                return d && d >= dayStart && d < dayEnd;
            }).length;
            days.push({ date: dayStart, count });
        }
        const max = Math.max(1, ...days.map((d) => d.count));
        return days.map((d) => ({
            ...d,
            heightPct: Math.round((d.count / max) * 100),
            isPeak: d.count === max && d.count > 0,
        }));
    }, [exitIslemleri, now]);

    const chartAxisLabels = useMemo(() => {
        if (!chartBars.length) return [];
        const picks = [0, 5, 11, 17, 23, 29].filter((i) => i < chartBars.length);
        return picks.map((i) => ({
            label: chartBars[i].date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
            key: i,
        }));
    }, [chartBars]);

    const fleetByCategory = useMemo(() => {
        const total = Math.max(cars.length, 1);
        const counts = {};
        cars.forEach((car) => {
            const name = String(car.kategori || 'Uncategorized').trim() || 'Uncategorized';
            counts[name] = (counts[name] || 0) + 1;
        });
        return Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([name, count], index) => ({
                name,
                count,
                pct: Math.round((count / total) * 100),
                barClass: categoryBarClass(index),
            }));
    }, [cars]);

    const topVehicles = useMemo(() => {
        const scores = {};
        const bump = (plate) => {
            const key = String(plate || '').trim();
            if (!key) return;
            scores[key] = (scores[key] || 0) + 1;
        };
        exitIslemleri.forEach((exit) => {
            if (!exit.isDeleted) bump(exit.aracPlaka);
        });
        returns.forEach((ret) => {
            if (!ret.isDeleted) bump(ret.aracPlaka || ret.plaka);
        });
        return Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([plate, count], index) => {
                const tiers = ['success', 'primary', 'primary', 'neutral', 'neutral'];
                return { plate, count, tier: tiers[index] || 'neutral' };
            });
    }, [exitIslemleri, returns]);

    const feedActivities = activities.slice(0, 6);

    const selectedCode = selectedExit ? getExitBookingCode(selectedExit) : '';
    const selectedCustomer = selectedExit?.musteriAdi || '—';
    const selectedPlate = selectedExit?.aracPlaka || '—';
    const selectedStatus = selectedExit?.status || selectedExit?.durum || 'Pending';
    const selectedVariant = statusBadgeVariant(selectedStatus);

    return (
        <>
            <div className="page-header">
                <div className="page-title-group">
                    <div className="page-breadcrumb">Sentinel / <span>Dashboard</span></div>
                    <div className="page-title">Operations Overview</div>
                    <div className="page-subtitle">
                        {String(effectiveFranchiseId || 'LIVE').toUpperCase()} · Last synced {syncLabel}
                    </div>
                </div>
                <div className="page-actions">
                    <button type="button" className="btn btn-stripe" onClick={() => setCurrentView('checkout')}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New checkout
                    </button>
                </div>
            </div>

            <div className="content">

                <div className="kpi-grid">
                    <div className="kpi-card">
                        <div className="kpi-icon cobalt">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <line x1="12" y1="1" x2="12" y2="23" />
                                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                            </svg>
                        </div>
                        <div className="kpi-label">Monthly Revenue</div>
                        <div className="kpi-value">{canViewFinancials ? sentinelFormatCurrencyCompact(monthlyRevenueTotal) : '—'}</div>
                        <div className="kpi-compare">{monthlyOfficeOperations.length} office ops this month</div>
                    </div>

                    <div className="kpi-card">
                        <div className="kpi-icon green">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                            </svg>
                        </div>
                        <div className="kpi-label">Monthly Check-outs</div>
                        <div className="kpi-value">{monthlyCheckouts.toLocaleString()}</div>
                        <div className="kpi-compare">{exitIslemleri.filter((e) => !e.isDeleted).length} total records</div>
                    </div>

                    <div className="kpi-card">
                        <div className="kpi-icon amber">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                            </svg>
                        </div>
                        <div className="kpi-label">Fleet Size</div>
                        <div className="kpi-value">{fleetCount.toLocaleString()}</div>
                        <div className="kpi-compare">{services.length} services · {returns.filter((r) => !r.isDeleted).length} returns</div>
                    </div>

                    <div className="kpi-card">
                        <div className="kpi-icon red">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                            </svg>
                        </div>
                        <div className="kpi-label">{kpiFourLabel}</div>
                        <div className="kpi-value">{kpiFourValue.toLocaleString()}</div>
                        <div className="kpi-compare">{kpiFourCompare}</div>
                    </div>
                </div>

                <div className="two-col">
                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                                </svg>
                                Recent Check-outs
                            </div>
                            <span className="panel-meta">Showing {recentExits.length} of {exitIslemleri.filter((e) => !e.isDeleted).length} total</span>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th className="sorted">Res code</th>
                                    <th>Customer</th>
                                    <th>Plate</th>
                                    <th>Status</th>
                                    <th>Date</th>
                                </tr>
                            </thead>
                            <tbody>
                                {recentExits.map((exit) => {
                                    const rowId = exit.documentId || exit.id;
                                    const code = getExitBookingCode(exit) || '—';
                                    const customer = exit.musteriAdi || '—';
                                    const plate = exit.aracPlaka || '—';
                                    const status = exit.status || exit.durum || 'Pending';
                                    const variant = statusBadgeVariant(status);
                                    const isSelected = selectedExit && (selectedExit.documentId || selectedExit.id) === rowId;
                                    return (
                                        <tr
                                            key={rowId}
                                            onClick={() => setSelectedExitId(rowId)}
                                            style={{ cursor: 'pointer', background: isSelected ? 'var(--intent-primary-bg)' : undefined }}
                                        >
                                            <td className="mono primary">{code}</td>
                                            <td>
                                                <div className="td-entity">
                                                    <div
                                                        className="entity-icon"
                                                        style={{ background: 'rgba(45,114,210,0.12)', color: 'var(--cobalt-300)' }}
                                                    >
                                                        {initialsFromName(customer)}
                                                    </div>
                                                    <div>
                                                        <div className="entity-name">{customer}</div>
                                                        <div className="entity-sub">{plate}</div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="mono">{plate}</td>
                                            <td>
                                                <span className={`badge ${variant}`}>
                                                    <span className="badge-dot" />
                                                    {status}
                                                </span>
                                            </td>
                                            <td className="mono" style={{ color: 'var(--text-muted)' }}>
                                                {sentinelFormatShortDate(exit.exitTarihi)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' }}>
                        <div className="detail-panel">
                            <div className="detail-hero">
                                <div className="detail-id">
                                    {selectedCode || '—'} · {selectedCustomer}
                                </div>
                                <div className="detail-amount">{selectedPlate}</div>
                                <div className="detail-meta-row">
                                    <span className={`badge ${selectedVariant}`}>
                                        <span className="badge-dot" />
                                        {selectedStatus}
                                    </span>
                                    {selectedExit?.aracId ? <span className="tag">Vehicle linked</span> : null}
                                </div>
                            </div>
                            <div className="detail-fields">
                                <div className="detail-field">
                                    <span className="detail-field-key">Customer</span>
                                    <span className="detail-field-val primary">{selectedCustomer}</span>
                                </div>
                                <div className="detail-field">
                                    <span className="detail-field-key">Plate</span>
                                    <span className="detail-field-val mono">{selectedPlate}</span>
                                </div>
                                <div className="detail-field">
                                    <span className="detail-field-key">Exit date</span>
                                    <span className="detail-field-val mono">
                                        {selectedExit ? sentinelFormatDateTime(selectedExit.exitTarihi) : '—'}
                                    </span>
                                </div>
                                <div className="detail-field">
                                    <span className="detail-field-key">Reservation</span>
                                    <span className="detail-field-val mono" style={{ color: 'var(--cobalt-300)' }}>
                                        {selectedCode || '—'}
                                    </span>
                                </div>
                                <div className="detail-field">
                                    <span className="detail-field-key">Franchise</span>
                                    <span className="detail-field-val">{String(effectiveFranchiseId || '—').toUpperCase()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="two-col">
                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                </svg>
                                Check-out Trend
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                                <button type="button" className="filter-chip active">30D</button>
                            </div>
                        </div>
                        <div className="panel-body">
                            <div className="chart-legend">
                                <div className="legend-item">
                                    <div className="legend-swatch" style={{ background: 'var(--intent-primary)' }} />
                                    Daily check-outs
                                </div>
                            </div>
                            <div className="chart-area">
                                <div className="chart-placeholder">
                                    {chartBars.map((bar, idx) => (
                                        <div
                                            key={bar.date.toISOString()}
                                            className={bar.isPeak ? 'chart-bar highlight' : 'chart-bar'}
                                            style={{ height: `${Math.max(bar.heightPct, 4)}%` }}
                                            title={`${bar.count} check-outs`}
                                            data-val={bar.count}
                                        ></div>
                                    ))}
                                </div>
                            </div>
                            <div className="chart-axis">
                                {chartAxisLabels.map((item) => (
                                    <span key={item.key}>{item.label}</span>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                                </svg>
                                Live Activity
                            </div>
                            <span className="panel-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span className="env-dot" style={{ background: 'var(--intent-success)' }} />
                                Live
                            </span>
                        </div>
                        <div className="activity-feed">
                            {feedActivities.length ? (
                                feedActivities.map((activity, index) => {
                                    const title = activity.description || activity.aciklama || activity.type || 'Activity';
                                    const actor = activity.type || activity.tip || 'System';
                                    const dot = activityDotClass(activity.type, title);
                                    return (
                                        <div className="activity-item" key={activity.id || index}>
                                            <div className="activity-dot-wrap">
                                                <div className={`activity-dot ${dot}`} />
                                                {index < feedActivities.length - 1 ? <div className="activity-line" /> : null}
                                            </div>
                                            <div className="activity-content">
                                                <div className="activity-title">{title}</div>
                                                <div className="activity-meta">
                                                    <span>{actor}</span>
                                                    <span className="activity-meta-dot">·</span>
                                                    <span>{sentinelRelativeTime(activity.tarih)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="activity-item">
                                    <div className="activity-content">
                                        <div className="activity-title muted">No recent activity</div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="three-col">
                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                                </svg>
                                Fleet by Category
                            </div>
                        </div>
                        <div className="panel-body">
                            <div className="stat-row">
                                {fleetByCategory.map((cat) => (
                                    <div className="stat-item" key={cat.name}>
                                        <div className="stat-header">
                                            <span className="stat-name">{cat.name}</span>
                                            <span className="stat-pct">{cat.pct}%</span>
                                        </div>
                                        <div className="stat-bar-track">
                                            <div className={`stat-bar-fill${cat.barClass}`} style={{ width: `${cat.pct}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87m-4-12a4 4 0 0 1 0 7.75" />
                                </svg>
                                Top Vehicles
                            </div>
                        </div>
                        <div className="activity-feed">
                            {topVehicles.map((row, index) => (
                                <div
                                    className="activity-item"
                                    key={row.plate}
                                    style={{ gap: 'var(--sp-3)', border: index === topVehicles.length - 1 ? 'none' : undefined }}
                                >
                                    <div
                                        className="entity-icon"
                                        style={{
                                            background: 'rgba(45,114,210,0.12)',
                                            color: 'var(--cobalt-300)',
                                            fontSize: 9,
                                            width: 26,
                                            height: 26,
                                            flexShrink: 0,
                                        }}
                                    >
                                        {row.plate.slice(0, 2).toUpperCase()}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>{row.plate}</div>
                                        <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                            {row.count} events
                                        </div>
                                    </div>
                                    <span className={`badge ${row.tier}`}>Active</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="panel">
                        <div className="panel-header">
                            <div className="panel-title">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                                    <line x1="8" y1="21" x2="16" y2="21" />
                                    <line x1="12" y1="17" x2="12" y2="21" />
                                </svg>
                                System Status
                            </div>
                            <span className="badge success">
                                <span className="badge-dot" />
                                All Systems Nominal
                            </span>
                        </div>
                        <div className="detail-fields">
                            <div className="detail-field">
                                <span className="detail-field-key">Firebase</span>
                                <span className="badge success" style={{ fontSize: 9 }}>Operational</span>
                            </div>
                            <div className="detail-field">
                                <span className="detail-field-key">Auth</span>
                                <span className="badge success" style={{ fontSize: 9 }}>Operational</span>
                            </div>
                            <div className="detail-field">
                                <span className="detail-field-key">Storage</span>
                                <span className="badge success" style={{ fontSize: 9 }}>Operational</span>
                            </div>
                            <div className="detail-field">
                                <span className="detail-field-key">Sync</span>
                                <span className="badge success" style={{ fontSize: 9 }}>Operational</span>
                            </div>
                            <div className="detail-field">
                                <span className="detail-field-key">Franchise scope</span>
                                <span className="detail-field-val mono" style={{ fontSize: 11 }}>
                                    {String(effectiveFranchiseId || 'LIVE').toUpperCase()}
                                </span>
                            </div>
                        </div>
                        <div className="panel-body" style={{ paddingTop: 'var(--sp-3)' }}>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)', marginBottom: 'var(--sp-2)', letterSpacing: '0.06em' }}>
                                UPTIME · 30 DAYS
                            </div>
                            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>
                                {Array.from({ length: 30 }, (_, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            width: 7,
                                            height: 24,
                                            borderRadius: 2,
                                            background: 'var(--intent-success)',
                                            opacity: 0.9,
                                        }}
                                    />
                                ))}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>
                                99.9% uptime
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
