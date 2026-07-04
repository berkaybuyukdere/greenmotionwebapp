import React, { useMemo, useEffect } from 'react';
import {
    Car, LogOut, ArrowLeft, AlertCircle, Package, Activity, Clock, DollarSign,
    ShoppingCart, FileBarChart, Fuel, CreditCard, Droplet,
} from 'lucide-react';
import { PalantirPageIcon } from '../components/palantir/PalantirNavIcon';
import { formatDate, formatDateTime, formatCurrency, getDateFromTimestamp } from '../utilities/dateFormatters';

function computeDashboardMetrics(cars, services, returns, exitIslemleri, officeOperations) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const prevCalendarMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const prevCalendarMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    const dailyCheckins = exitIslemleri.filter((exit) => {
        if (exit.isDeleted) return false;
        const exitDate = getDateFromTimestamp(exit.exitTarihi);
        return exitDate && exitDate >= todayStart && exitDate <= todayEnd;
    }).length;

    const dailyCheckouts = returns.filter((ret) => {
        if (ret.isDeleted) return false;
        const returnDate = getDateFromTimestamp(ret.iadeTarihi);
        return returnDate && returnDate >= todayStart && returnDate <= todayEnd;
    }).length;

    const dailyServices = services.filter((service) => {
        const serviceDate = getDateFromTimestamp(service.tarih);
        return serviceDate && serviceDate >= todayStart && serviceDate <= todayEnd;
    }).length;

    const monthlyDamageReports = cars.reduce((count, car) => {
        if (!car.hasarKayitlari) return count;
        const monthDamages = car.hasarKayitlari.filter((hasar) => {
            if (hasar.isDeleted) return false;
            const damageDate = getDateFromTimestamp(hasar.tarih);
            return damageDate && damageDate >= currentMonthStart && damageDate <= currentMonthEnd;
        });
        return count + monthDamages.length;
    }, 0);

    const previousMonthDamageReports = cars.reduce((count, car) => {
        if (!car.hasarKayitlari) return count;
        const monthDamages = car.hasarKayitlari.filter((hasar) => {
            if (hasar.isDeleted) return false;
            const damageDate = getDateFromTimestamp(hasar.tarih);
            return damageDate && damageDate >= prevCalendarMonthStart && damageDate <= prevCalendarMonthEnd;
        });
        return count + monthDamages.length;
    }, 0);

    const monthlyServiceReports = services.filter((service) => {
        const serviceDate = getDateFromTimestamp(service.tarih);
        return serviceDate && serviceDate >= currentMonthStart && serviceDate <= currentMonthEnd;
    }).length;

    const monthlyReturnReports = returns.filter((ret) => {
        if (ret.isDeleted) return false;
        const returnDate = getDateFromTimestamp(ret.iadeTarihi);
        return returnDate && returnDate >= currentMonthStart && returnDate <= currentMonthEnd;
    }).length;

    const monthlyOfficeOperations = officeOperations.filter((op) => {
        const opDate = getDateFromTimestamp(op.date);
        return opDate && opDate >= currentMonthStart && opDate <= currentMonthEnd;
    });

    const monthlyCreditCardTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Credit Card Receipt')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyPosTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'POS Daily Closing')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyWashingTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Washing Expense')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyAdditionalSalesTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Additional Sales')
        .reduce((sum, op) => sum + (op.amount || 0), 0);
    const monthlyBankingTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Banking Transaction')
        .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);
    const monthlyTrafficFineTotal = monthlyOfficeOperations
        .filter((op) => op.type === 'Traffic Fine')
        .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);

    const monthlyRevenueTotal =
        monthlyPosTotal +
        monthlyAdditionalSalesTotal +
        monthlyBankingTotal +
        monthlyOfficeOperations
            .filter((op) => op.type === 'Fuel Receipt' && op.isCompleted)
            .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);

    const monthlyExpenseTotal =
        monthlyCreditCardTotal +
        monthlyWashingTotal +
        monthlyOfficeOperations
            .filter((op) => op.type === 'Fuel Receipt' && !op.isCompleted)
            .reduce((sum, op) => sum + (parseFloat(op.amount) || 0), 0);

    const monthlyNetOfficeResult = monthlyRevenueTotal - monthlyExpenseTotal;

    const today = new Date();
    const todayDayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const tomorrowDayStart = new Date(todayDayStart);
    tomorrowDayStart.setDate(tomorrowDayStart.getDate() + 1);
    const yesterdayDayStart = new Date(todayDayStart);
    yesterdayDayStart.setDate(yesterdayDayStart.getDate() - 1);

    const allDamages = cars.flatMap((car) =>
        (car.hasarKayitlari || []).filter((h) => !h.isDeleted),
    );
    const getDamageDate = (damage) =>
        getDateFromTimestamp(damage.tarih || damage.handoverTarihi || damage.date);

    const todayDamageReportsCount = allDamages.filter((hasar) => {
        const d = getDamageDate(hasar);
        return d && d >= todayDayStart && d < tomorrowDayStart;
    }).length;

    const yesterdayDamageReportsCount = allDamages.filter((hasar) => {
        const d = getDamageDate(hasar);
        return d && d >= yesterdayDayStart && d < todayDayStart;
    }).length;

    const damageReportsChange = todayDamageReportsCount - yesterdayDamageReportsCount;
    const damageReportsChangeMetric =
        damageReportsChange === 0
            ? '0 vs yesterday'
            : `${damageReportsChange > 0 ? `+${damageReportsChange}` : damageReportsChange} vs yesterday`;

    const prevMonthReturnsCount = returns.filter((ret) => {
        if (ret.isDeleted) return false;
        const returnDate = getDateFromTimestamp(ret.iadeTarihi);
        return returnDate && returnDate >= prevCalendarMonthStart && returnDate <= prevCalendarMonthEnd;
    }).length;

    const prevMonthExitsCount = exitIslemleri.filter((exit) => {
        if (exit.isDeleted) return false;
        const exitDate = getDateFromTimestamp(exit.exitTarihi);
        return exitDate && exitDate >= prevCalendarMonthStart && exitDate <= prevCalendarMonthEnd;
    }).length;

    const prevMonthServicesTotalCount = services.filter((service) => {
        const serviceDate = getDateFromTimestamp(service.tarih);
        return serviceDate && serviceDate >= prevCalendarMonthStart && serviceDate <= prevCalendarMonthEnd;
    }).length;

    const prevMonthFleetAdds = cars.filter((car) => {
        const d = getDateFromTimestamp(car.createdAt);
        return d && d >= prevCalendarMonthStart && d <= prevCalendarMonthEnd;
    }).length;

    const prevMonthDamageReportsTotal = allDamages.filter((hasar) => {
        const d = getDamageDate(hasar);
        return d && d >= prevCalendarMonthStart && d <= prevCalendarMonthEnd;
    }).length;

    return {
        vehicleCount: cars.length,
        dailyCheckins,
        dailyCheckouts,
        dailyServices,
        monthlyDamageReports,
        previousMonthDamageReports,
        monthlyServiceReports,
        monthlyReturnReports,
        monthlyCreditCardTotal,
        monthlyPosTotal,
        monthlyWashingTotal,
        monthlyAdditionalSalesTotal,
        monthlyBankingTotal,
        monthlyTrafficFineTotal,
        monthlyRevenueTotal,
        monthlyExpenseTotal,
        monthlyNetOfficeResult,
        todayDamageReportsCount,
        damageReportsChangeMetric,
        prevMonthReturnsCount,
        prevMonthExitsCount,
        prevMonthServicesTotalCount,
        prevMonthFleetAdds,
        prevMonthDamageReportsTotal,
    };
}

export function Dashboard({
    cars,
    services,
    returns,
    activities,
    officeOperations,
    exitIslemleri = [],
    setCurrentView,
    canViewFinancials = true,
    bootstrapKpis = null,
    dataHydrating = false,
    onBootstrapSnapshot,
}) {
    const liveMetrics = useMemo(
        () => computeDashboardMetrics(cars, services, returns, exitIslemleri, officeOperations),
        [cars, services, returns, exitIslemleri, officeOperations],
    );

    const hasLiveFleet = cars.length > 0;
    const metrics = useMemo(() => {
        if (hasLiveFleet || !bootstrapKpis) return liveMetrics;
        return { ...liveMetrics, ...bootstrapKpis };
    }, [hasLiveFleet, bootstrapKpis, liveMetrics]);

    useEffect(() => {
        if (!onBootstrapSnapshot || !hasLiveFleet) return;
        onBootstrapSnapshot(liveMetrics);
    }, [onBootstrapSnapshot, hasLiveFleet, liveMetrics]);

    const vehicleDisplay = hasLiveFleet ? cars.length : (metrics.vehicleCount ?? 0);
    const activityDisplay = activities.length > 0 ? activities.length : (bootstrapKpis?.activityCount ?? activities.length);

    return (
        <div className="erpx-page fd-dash space-y-3">
            <style>{`
                .fd-dash .fd-kpi-cell { cursor: pointer; transition: background .12s ease; }
                .fd-dash .fd-kpi-cell:hover { background: var(--fd-high); }
                .fd-dash-feed-row { display: flex; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--fd-border); align-items: center; }
                .fd-dash-feed-row:hover { background: var(--fd-high); }
            `}</style>
            <div className="erpx-page-header !mb-0">
                <div>
                    <h1 className="erpx-page-title flex items-center gap-2">
                        <PalantirPageIcon navKey="dashboard" />
                        Dashboard
                    </h1>
                    <p className="erpx-page-subtitle">
                        {vehicleDisplay} vehicles · {activityDisplay} activities in workspace
                        {dataHydrating && !hasLiveFleet ? (
                            <span className="text-[var(--erpx-ink-muted)]"> · Updating…</span>
                        ) : null}
                    </p>
                </div>
            </div>
            <div className={`fd-kpi-strip grid-cols-2 sm:grid-cols-4 xl:grid-cols-8${dataHydrating && !hasLiveFleet ? ' opacity-90' : ''}`}>
                <StatCard
                    title="Total Vehicles"
                    value={metrics.vehicleCount ?? vehicleDisplay}
                    icon={<Car size={11} />}
                    tone="var(--fd-accent)"
                    onClick={() => setCurrentView('cars')}
                    previousMonthRecords={String(metrics.prevMonthFleetAdds)}
                />
                <StatCard
                    title="Today's Returns"
                    value={metrics.dailyCheckouts}
                    icon={<ArrowLeft size={11} />}
                    tone="var(--fd-purple)"
                    onClick={() => setCurrentView('returns')}
                    previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                />
                <StatCard
                    title="Today's Check-outs"
                    value={metrics.dailyCheckins}
                    icon={<LogOut size={11} />}
                    tone="var(--fd-accent)"
                    onClick={() => setCurrentView('checkout')}
                    previousMonthRecords={String(metrics.prevMonthExitsCount)}
                />
                {canViewFinancials ? (
                    <StatCard
                        title="Today's Damages"
                        value={metrics.todayDamageReportsCount}
                        icon={<AlertCircle size={11} />}
                        tone={metrics.todayDamageReportsCount > 0 ? 'var(--fd-red)' : 'var(--fd-green)'}
                        trend={metrics.damageReportsChangeMetric}
                        onClick={() => setCurrentView('damage')}
                        previousMonthRecords={String(metrics.prevMonthDamageReportsTotal)}
                    />
                ) : (
                    <StatCard
                        title="Monthly Returns"
                        value={metrics.monthlyReturnReports}
                        icon={<ArrowLeft size={11} />}
                        tone="var(--fd-purple)"
                        onClick={() => setCurrentView('returns')}
                        previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                    />
                )}
                <StatCard
                    title="Monthly Services"
                    value={metrics.monthlyServiceReports}
                    icon={<Package size={11} />}
                    tone="var(--fd-amber)"
                    onClick={() => setCurrentView('service')}
                    previousMonthRecords={String(metrics.prevMonthServicesTotalCount)}
                />
                <StatCard
                    title="Monthly Damages"
                    value={metrics.monthlyDamageReports}
                    icon={<AlertCircle size={11} />}
                    tone={metrics.monthlyDamageReports > 0 ? 'var(--fd-red)' : 'var(--fd-green)'}
                    onClick={() => setCurrentView('damage')}
                    previousMonthRecords={String(metrics.previousMonthDamageReports)}
                />
                <StatCard
                    title="Monthly Returns"
                    value={metrics.monthlyReturnReports}
                    icon={<ArrowLeft size={11} />}
                    tone="var(--fd-purple)"
                    onClick={() => setCurrentView('returns')}
                    previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                />
                <StatCard
                    title="Today's Services"
                    value={metrics.dailyServices}
                    icon={<Package size={11} />}
                    tone="var(--fd-amber)"
                    onClick={() => setCurrentView('service')}
                    previousMonthRecords={String(metrics.prevMonthServicesTotalCount)}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-stretch">
                <div className="lg:col-span-2 h-full min-h-[280px] lg:min-h-[360px] fd-panel flex flex-col">
                    <div className="fd-section-head">
                        <Activity size={12} style={{ color: 'var(--fd-muted)' }} />
                        Recent Activities
                        <span className="fd-pulse-dot" />
                        <span className="fd-section-head-meta">{activityDisplay} EVENTS · LIVE</span>
                    </div>
                    <div className="flex-1">
                        {activities.length > 0 ? (
                            <div className="h-full min-h-[36rem] lg:min-h-[44rem] max-h-[44rem] overflow-y-auto">
                                {activities.slice(0, 10).map((activity) => {
                                    const feedTone =
                                        activity.tip === 'Araç Eklendi'  ? { pill: 'fd-pill fd-pill-accent', tag: 'VEHICLE' } :
                                        activity.tip === 'Hasar Eklendi' ? { pill: 'fd-pill fd-pill-red', tag: 'DAMAGE' } :
                                        activity.tip === 'İade İşlemi'   ? { pill: 'fd-pill fd-pill-green', tag: 'RETURN' } :
                                        { pill: 'fd-pill', tag: 'EVENT' };
                                    return (
                                        <div key={activity.id} className="fd-dash-feed-row">
                                            <span className="fd-cell-muted flex-none inline-flex items-center gap-1">
                                                <Clock size={10} />
                                                {formatDateTime(activity.tarih)}
                                            </span>
                                            <span className={feedTone.pill} style={{ width: 62, textAlign: 'center', flex: 'none' }}>
                                                {feedTone.tag}
                                            </span>
                                            <span className="flex-1 truncate" style={{ fontSize: '11.5px', color: 'var(--fd-text2)' }}>
                                                {activity.aciklama || activity.description || activity.tip}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="fd-table-empty flex items-center justify-center h-full min-h-[12rem]">
                                {dataHydrating ? 'Loading activities…' : 'No recent activities'}
                            </div>
                        )}
                    </div>
                    <div className="fd-footnote" style={{ padding: '8px 12px', borderTop: '1px solid var(--fd-border)' }}>
                        Showing last 10 workspace events · feed updates live
                    </div>
                </div>

                {canViewFinancials && (
                    <div className="fd-panel h-full flex flex-col">
                        <div className="fd-section-head">
                            <DollarSign size={12} style={{ color: 'var(--fd-muted)' }} />
                            Monthly Office Summary
                            <span className="fd-section-head-meta">CURRENT MONTH</span>
                        </div>
                        <div style={{ padding: '4px 12px 8px' }}>
                            <FinancialRow icon={<ShoppingCart size={14} />} label="POS Closing" value={formatCurrency(metrics.monthlyPosTotal)} />
                            <FinancialRow icon={<CreditCard size={14} />} label="Credit Card" value={formatCurrency(metrics.monthlyCreditCardTotal)} />
                            <FinancialRow icon={<Droplet size={14} />} label="Washing" value={formatCurrency(metrics.monthlyWashingTotal)} />
                            <FinancialRow icon={<Fuel size={14} />} label="Additional Sales" value={formatCurrency(metrics.monthlyAdditionalSalesTotal)} />
                            <FinancialRow icon={<FileBarChart size={14} />} label="Net Result" value={formatCurrency(metrics.monthlyNetOfficeResult)} highlight />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function FinancialRow({ icon, label, value, highlight = false }) {
    return (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--fd-border)] last:border-0" style={{ padding: '8px 0' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--fd-muted)' }}>
                {icon}
                <span style={{ fontFamily: 'var(--fd-sans)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {label}
                </span>
            </div>
            <span className="fd-cell-mono tabular-nums" style={{ color: highlight ? 'var(--fd-green)' : 'var(--fd-text)' }}>
                {value}
            </span>
        </div>
    );
}

function StatCard({ title, value, icon, onClick, trend, previousMonthRecords, tone }) {
    const trendTone = trend
        ? (String(trend).includes('+') ? 'var(--fd-red)' : String(trend).includes('-') ? 'var(--fd-green)' : 'var(--fd-muted)')
        : null;

    return (
        <button type="button" onClick={onClick} className="fd-kpi-cell w-full text-left">
            <div className="fd-kpi-label flex items-center gap-1.5">
                <span className="inline-flex flex-none" style={{ color: 'var(--fd-muted)' }}>{icon}</span>
                <span className="truncate">{title}</span>
            </div>
            <div className="flex items-baseline gap-2">
                <span className="fd-kpi-value" style={tone ? { color: tone } : undefined}>{value}</span>
                {trend ? (
                    <span style={{ fontFamily: 'var(--fd-mono)', fontSize: 10, fontWeight: 600, color: trendTone }}>
                        {trend}
                    </span>
                ) : null}
            </div>
            {previousMonthRecords != null && (
                <p className="fd-kpi-sub">PM {previousMonthRecords}</p>
            )}
        </button>
    );
}
