import React, { useMemo, useState, useCallback } from 'react';
import {
    ChevronLeft,
    ChevronRight,
    Printer,
    RefreshCw,
    Search,
    LogOut,
    ArrowLeft,
    Car,
} from 'lucide-react';
import {
    parseRecordDate,
    isSameCalendarDay,
    startOfDay,
    customerDisplayName,
    formatJournalTime,
    formatJournalDate,
} from '../utilities/parseRecordDate';

const SEGMENTS = [
    { id: 'checkout', label: 'Check out', icon: LogOut },
    { id: 'return', label: 'Return', icon: ArrowLeft },
    { id: 'fleet', label: 'On-site fleet', icon: Car },
];

function exitProcessDate(exit) {
    return parseRecordDate(exit?.exitTarihi) || parseRecordDate(exit?.createdAt);
}

function returnProcessDate(ret) {
    return parseRecordDate(ret?.iadeTarihi) || parseRecordDate(ret?.createdAt);
}

function stationLabel(record, fallback = 'ZRH') {
    const branch = String(
        record?.pickUpBranch || record?.dropOffBranch || record?.bayiAdi || record?.station || '',
    ).trim();
    if (!branch) return fallback;
    if (branch.length <= 4) return branch.toUpperCase();
    return branch.slice(0, 3).toUpperCase();
}

function formatResCode(record) {
    const raw = String(record?.resKodu || record?.navKodu || '').trim();
    if (!raw) return '—';
    if (/^(RES|NAV|RNT)-/i.test(raw)) return raw.toUpperCase();
    return `RES-${raw}`;
}

function plateDisplay(value) {
    const p = String(value || '').trim();
    return p || '—';
}

function isUnassignedPlate(plate) {
    const p = String(plate || '').trim();
    return !p || p === '—' || p === '-';
}

export default function SwissOpsJournalView({ exits = [], returns = [], cars = [], onRefresh }) {
    const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
    const [segment, setSegment] = useState('checkout');
    const [searchText, setSearchText] = useState('');
    const [collapsedGroups, setCollapsedGroups] = useState({});

    const dayInputValue = useMemo(() => {
        const y = selectedDay.getFullYear();
        const m = String(selectedDay.getMonth() + 1).padStart(2, '0');
        const d = String(selectedDay.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }, [selectedDay]);

    const formattedDayLabel = useMemo(
        () => formatJournalDate(selectedDay),
        [selectedDay],
    );

    const shiftDay = useCallback((delta) => {
        setSelectedDay((prev) => {
            const next = new Date(prev);
            next.setDate(next.getDate() + delta);
            return startOfDay(next);
        });
    }, []);

    const goToday = useCallback(() => {
        setSelectedDay(startOfDay(new Date()));
    }, []);

    const activeExits = useMemo(
        () => (exits || []).filter((e) => !e.isDeleted),
        [exits],
    );

    const activeReturns = useMemo(
        () => (returns || []).filter((r) => !r.isDeleted),
        [returns],
    );

    const q = searchText.trim().toLowerCase();

    const matchesSearch = useCallback(
        (row) => {
            if (!q) return true;
            return (
                row.resCode.toLowerCase().includes(q)
                || row.plate.toLowerCase().includes(q)
                || row.customer.toLowerCase().includes(q)
            );
        },
        [q],
    );

    const checkoutRows = useMemo(() => {
        return activeExits
            .filter((exit) => {
                const when = exitProcessDate(exit);
                return when && isSameCalendarDay(when, selectedDay);
            })
            .sort((a, b) => (exitProcessDate(a)?.getTime() || 0) - (exitProcessDate(b)?.getTime() || 0))
            .map((exit, index) => {
                const when = exitProcessDate(exit);
                const plate = plateDisplay(exit.aracPlaka);
                return {
                    key: exit.id || `exit-${index}`,
                    time: formatJournalTime(when),
                    resCode: formatResCode(exit),
                    customer: customerDisplayName(exit),
                    plate,
                    station: stationLabel(exit),
                    unassigned: isUnassignedPlate(plate),
                };
            })
            .filter(matchesSearch);
    }, [activeExits, selectedDay, matchesSearch]);

    const returnRows = useMemo(() => {
        return activeReturns
            .filter((ret) => {
                const when = returnProcessDate(ret);
                return when && isSameCalendarDay(when, selectedDay);
            })
            .sort((a, b) => (returnProcessDate(a)?.getTime() || 0) - (returnProcessDate(b)?.getTime() || 0))
            .map((ret, index) => {
                const when = returnProcessDate(ret);
                const plate = plateDisplay(ret.aracPlaka);
                return {
                    key: ret.id || `ret-${index}`,
                    time: formatJournalTime(when),
                    resCode: formatResCode(ret),
                    customer: customerDisplayName(ret),
                    plate,
                    station: stationLabel(ret),
                    unassigned: false,
                };
            })
            .filter(matchesSearch);
    }, [activeReturns, selectedDay, matchesSearch]);

    const fleetGroups = useMemo(() => {
        const groups = new Map();
        (cars || []).forEach((car) => {
            const cat = String(car.kategori || 'Uncategorized').trim() || 'Uncategorized';
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push({
                key: car.id || car.plaka,
                plate: car.plaka || '—',
                group: cat,
                model: [car.marka, car.model].filter(Boolean).join(' ') || '—',
                station: String(car.bayiAdi || car.station || 'ZRH').slice(0, 3).toUpperCase(),
            });
        });
        const filtered = Array.from(groups.entries())
            .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
            .map(([category, items]) => ({
                category,
                items: items
                    .filter((item) => {
                        if (!q) return true;
                        return (
                            item.plate.toLowerCase().includes(q)
                            || item.model.toLowerCase().includes(q)
                            || item.group.toLowerCase().includes(q)
                        );
                    })
                    .sort((a, b) => a.plate.localeCompare(b.plate)),
            }))
            .filter((g) => g.items.length > 0);
        return filtered;
    }, [cars, q]);

    const toggleGroup = (category) => {
        setCollapsedGroups((prev) => ({ ...prev, [category]: !prev[category] }));
    };

    const activeRows = segment === 'checkout' ? checkoutRows : segment === 'return' ? returnRows : [];
    const activeCount = segment === 'checkout'
        ? checkoutRows.length
        : segment === 'return'
            ? returnRows.length
            : fleetGroups.reduce((n, g) => n + g.items.length, 0);

    const renderJournalRow = (row) => (
        <div
            key={row.key}
            className={`pal-ops-journal-row${row.unassigned ? ' pal-ops-journal-row--unassigned' : ''}`}
        >
            <span className="pal-ops-journal-time">{row.time}</span>
            <span className="pal-ops-journal-res">{row.resCode}</span>
            <span className="pal-ops-journal-plate">{row.plate}</span>
            <span className="pal-ops-journal-group">{row.station}</span>
            <span className="pal-ops-journal-customer">{row.customer}</span>
        </div>
    );

    return (
        <div className="erpx-page pal-ops-journal-page space-y-4">
            <div className="erpx-page-header !mb-2">
                <div>
                    <h1 className="erpx-page-title">OPS Journal</h1>
                    <p className="erpx-page-subtitle">
                        Daily check-outs, returns and on-site fleet · {formattedDayLabel}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="pal-ops-journal-icon-btn"
                        title="Refresh"
                        onClick={() => onRefresh?.()}
                    >
                        <RefreshCw size={16} />
                    </button>
                    <button
                        type="button"
                        className="pal-ops-journal-icon-btn"
                        title="Print"
                        onClick={() => window.print()}
                    >
                        <Printer size={16} />
                    </button>
                </div>
            </div>

            <div className="pal-ops-journal-shell">
                <div className="pal-ops-journal-date-bar">
                    <button type="button" className="pal-ops-journal-icon-btn" onClick={() => shiftDay(-1)} aria-label="Previous day">
                        <ChevronLeft size={18} />
                    </button>
                    <input
                        type="date"
                        className="pal-ops-journal-date-input pal-ops-journal-date-input--center"
                        value={dayInputValue}
                        onChange={(e) => {
                            if (!e.target.value) return;
                            setSelectedDay(startOfDay(new Date(`${e.target.value}T12:00:00`)));
                        }}
                    />
                    <button type="button" className="pal-ops-journal-icon-btn" onClick={() => shiftDay(1)} aria-label="Next day">
                        <ChevronRight size={18} />
                    </button>
                    <button type="button" className="pal-ops-journal-today-btn" onClick={goToday}>
                        Today
                    </button>
                </div>

                <div className="pal-ops-journal-segments">
                    {SEGMENTS.map(({ id, label, icon: Icon }) => (
                        <button
                            key={id}
                            type="button"
                            className={`pal-ops-journal-segment${segment === id ? ' is-active' : ''}`}
                            onClick={() => setSegment(id)}
                        >
                            <Icon size={15} />
                            <span>{label}</span>
                            <span className="pal-ops-journal-segment-count">
                                {id === 'checkout'
                                    ? checkoutRows.length
                                    : id === 'return'
                                        ? returnRows.length
                                        : fleetGroups.reduce((n, g) => n + g.items.length, 0)}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="pal-ops-journal-search">
                    <Search size={16} className="pal-ops-journal-search-icon" />
                    <input
                        type="search"
                        placeholder="RES, plate, driver…"
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                    />
                </div>

                {segment !== 'fleet' ? (
                    <div className="pal-ops-journal-list">
                        <div className="pal-ops-journal-list-head">
                            <span>Time</span>
                            <span>RES</span>
                            <span>Plate</span>
                            <span>Stn</span>
                            <span>Customer</span>
                        </div>
                        {activeRows.length === 0 ? (
                            <div className="pal-ops-journal-empty">
                                No {segment === 'checkout' ? 'check-outs' : 'returns'} for this day.
                            </div>
                        ) : (
                            activeRows.map(renderJournalRow)
                        )}
                    </div>
                ) : (
                    <div className="pal-ops-journal-fleet">
                        {fleetGroups.length === 0 ? (
                            <div className="pal-ops-journal-empty">No vehicles match your search.</div>
                        ) : (
                            fleetGroups.map(({ category, items }) => {
                                const collapsed = collapsedGroups[category] === true;
                                return (
                                    <div key={category} className="pal-ops-journal-fleet-group">
                                        <button
                                            type="button"
                                            className="pal-ops-journal-fleet-head"
                                            onClick={() => toggleGroup(category)}
                                        >
                                            <span className="pal-ops-journal-fleet-cat">{category}</span>
                                            <span className="pal-ops-journal-fleet-count">{items.length}</span>
                                            <span className="pal-ops-journal-fleet-chevron">{collapsed ? '+' : '−'}</span>
                                        </button>
                                        {!collapsed && (
                                            <div className="pal-ops-journal-fleet-grid">
                                                {items.map((item) => (
                                                    <div key={item.key} className="pal-ops-journal-fleet-card">
                                                        <span className="pal-ops-journal-plate">{item.plate}</span>
                                                        <span className="pal-ops-journal-fleet-meta">{item.model}</span>
                                                        <span className="pal-ops-journal-fleet-station">{item.station}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                <div className="pal-ops-journal-footer">
                    <span>{activeCount} {segment === 'fleet' ? 'vehicles' : 'entries'}</span>
                    <span>ZRH · Switzerland OPS</span>
                </div>
            </div>
        </div>
    );
}
