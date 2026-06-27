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
        <div className="erpx-page space-y-4 sm:space-y-6">
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
            <div className={`pal-dash-kpi-row${dataHydrating && !hasLiveFleet ? ' opacity-90' : ''}`}>
                <StatCard
                    title="Total Vehicles"
                    value={metrics.vehicleCount ?? vehicleDisplay}
                    icon={<Car size={18} />}
                    onClick={() => setCurrentView('cars')}
                    previousMonthRecords={String(metrics.prevMonthFleetAdds)}
                />
                <StatCard
                    title="Today's Returns"
                    value={metrics.dailyCheckouts}
                    icon={<ArrowLeft size={18} />}
                    onClick={() => setCurrentView('returns')}
                    previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                />
                <StatCard
                    title="Today's Check-outs"
                    value={metrics.dailyCheckins}
                    icon={<LogOut size={18} />}
                    onClick={() => setCurrentView('checkout')}
                    previousMonthRecords={String(metrics.prevMonthExitsCount)}
                />
                {canViewFinancials ? (
                    <StatCard
                        title="Today's Damages"
                        value={metrics.todayDamageReportsCount}
                        icon={<AlertCircle size={18} />}
                        trend={metrics.damageReportsChangeMetric}
                        onClick={() => setCurrentView('damage')}
                        previousMonthRecords={String(metrics.prevMonthDamageReportsTotal)}
                    />
                ) : (
                    <StatCard
                        title="Monthly Returns"
                        value={metrics.monthlyReturnReports}
                        icon={<ArrowLeft size={18} />}
                        onClick={() => setCurrentView('returns')}
                        previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                    />
                )}
            </div>

            <div className={`pal-dash-kpi-row${dataHydrating && !hasLiveFleet ? ' opacity-90' : ''}`}>
                <StatCard
                    title="Monthly Services"
                    value={metrics.monthlyServiceReports}
                    icon={<Package size={18} />}
                    onClick={() => setCurrentView('service')}
                    previousMonthRecords={String(metrics.prevMonthServicesTotalCount)}
                />
                <StatCard
                    title="Monthly Damages"
                    value={metrics.monthlyDamageReports}
                    icon={<AlertCircle size={16} />}
                    onClick={() => setCurrentView('damage')}
                    previousMonthRecords={String(metrics.previousMonthDamageReports)}
                />
                <StatCard
                    title="Monthly Returns"
                    value={metrics.monthlyReturnReports}
                    icon={<ArrowLeft size={18} />}
                    onClick={() => setCurrentView('returns')}
                    previousMonthRecords={String(metrics.prevMonthReturnsCount)}
                />
                <StatCard
                    title="Today's Services"
                    value={metrics.dailyServices}
                    icon={<Package size={18} />}
                    onClick={() => setCurrentView('service')}
                    previousMonthRecords={String(metrics.prevMonthServicesTotalCount)}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 items-stretch">
                <div className="lg:col-span-2 h-full min-h-[280px] lg:min-h-[360px] pal-dash-panel flex flex-col">
                    <div className="pal-dash-panel-header">
                        <h3 className="pal-dash-panel-title">
                            <Activity size={14} className="text-[var(--erpx-ink-muted)]" />
                            Recent Activities
                        </h3>
                        <span className="gm-badge gm-badge-neutral">{activities.length}</span>
                    </div>
                    <div className="pal-dash-panel-body flex-1">
                        {activities.length > 0 ? (
                            <div className="h-full min-h-[36rem] lg:min-h-[44rem] max-h-[44rem] overflow-y-auto">
                                {activities.slice(0, 10).map((activity) => (
                                    <div key={activity.id} className="pal-dash-list-row items-start">
                                        <div className={`p-2 rounded-full flex-shrink-0 ${
                                            activity.tip === 'Araç Eklendi'  ? 'bg-[var(--erpx-info-bg)] text-[var(--erpx-info)]' :
                                            activity.tip === 'Hasar Eklendi' ? 'bg-[var(--erpx-red-bg)] text-[var(--erpx-red)]' :
                                            activity.tip === 'İade İşlemi'   ? 'bg-[var(--erpx-green-bg)] text-[var(--erpx-green)]' :
                                            'bg-[var(--erpx-neutral-bg)] text-[var(--erpx-neutral)]'
                                        }`}>
                                            {activity.tip === 'Araç Eklendi'  && <Car size={12} />}
                                            {activity.tip === 'Hasar Eklendi' && <AlertCircle size={12} />}
                                            {activity.tip === 'İade İşlemi'   && <ArrowLeft size={12} />}
                                            {!['Araç Eklendi','Hasar Eklendi','İade İşlemi'].includes(activity.tip) && <Activity size={12} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-[var(--erpx-ink)] truncate">{activity.aciklama || activity.description || activity.tip}</p>
                                            <p className="text-xs text-[var(--erpx-ink-muted)] flex items-center gap-1 mt-0.5">
                                                <Clock size={10} />
                                                {formatDateTime(activity.tarih)}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full min-h-[12rem] text-[var(--erpx-ink-muted)]">
                                <Activity size={32} className="mb-2 opacity-40" />
                                <p className="text-sm">{dataHydrating ? 'Loading activities…' : 'No recent activities'}</p>
                            </div>
                        )}
                    </div>
                </div>

                {canViewFinancials && (
                    <div className="pal-dash-panel h-full">
                        <div className="pal-dash-panel-header">
                            <h3 className="pal-dash-panel-title">
                                <DollarSign size={14} className="text-[var(--erpx-ink-muted)]" />
                                Monthly Office Summary
                            </h3>
                        </div>
                        <div className="pal-dash-panel-body space-y-3">
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
        <div className="flex items-center justify-between gap-3 py-1.5 border-b border-[var(--erpx-border)] last:border-0">
            <div className="flex items-center gap-2 text-sm text-[var(--erpx-ink-muted)]">
                {icon}
                <span>{label}</span>
            </div>
            <span className={`text-sm font-semibold tabular-nums ${highlight ? 'text-[var(--erpx-green)]' : 'text-[var(--erpx-ink)]'}`}>
                {value}
            </span>
        </div>
    );
}

function StatCard({ title, value, icon, onClick, trend, previousMonthRecords }) {
    const trendTone = trend
        ? (String(trend).includes('+') ? 'tone-up' : String(trend).includes('-') ? 'tone-down' : '')
        : '';

    return (
        <button type="button" onClick={onClick} className="pal-dash-kpi w-full text-left">
            <div className="pal-dash-kpi-head">
                <span className="pal-dash-kpi-icon">{icon}</span>
                {previousMonthRecords != null && (
                    <span className="pal-dash-kpi-prev ml-auto">
                        PM <strong>{previousMonthRecords}</strong>
                    </span>
                )}
            </div>
            <p className="pal-dash-kpi-label">{title}</p>
            <p className="pal-dash-kpi-value tabular-nums">{value}</p>
            {trend ? (
                <p className="pal-dash-kpi-trend">
                    <span className={trendTone}>{trend}</span>
                </p>
            ) : null}
        </button>
    );
}
