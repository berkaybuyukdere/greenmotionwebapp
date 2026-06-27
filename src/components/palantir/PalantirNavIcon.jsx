import React from 'react';
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    BarChart3,
    Building2,
    CalendarDays,
    Car,
    Clock,
    Database,
    DollarSign,
    FileBarChart,
    FileText,
    FolderOpen,
    Home,
    LayoutDashboard,
    LogOut,
    MapPin,
    Package,
    Phone,
    Shield,
    Table2,
    TestTube,
    Users,
} from 'lucide-react';
import { PAL_NAV_TONES } from './palantirChartPalette';

const NAV_ICONS = {
    dashboard: Home,
    cars: Car,
    checkout: ArrowRight,
    parkedCheckout: Car,
    operations: CalendarDays,
    returns: ArrowLeft,
    damage: AlertCircle,
    service: Package,
    serviceFirms: Building2,
    office: DollarSign,
    officeReturns: ArrowLeft,
    frontDeskCustomers: Users,
    files: FolderOpen,
    excel: Table2,
    workingTimetable: Clock,
    protocols: FileText,
    shuttle: MapPin,
    analytics: BarChart3,
    reports: FileBarChart,
    assistantNumbers: Phone,
    adminUserManagement: Users,
    chOperationsPanel: LayoutDashboard,
    swissOps: CalendarDays,
    adminFranchises: Building2,
    adminSecurityOps: Shield,
    adminProcessOperations: Activity,
    adminFirebaseConnection: Database,
    adminPhoneFormat: Phone,
    adminABTesting: TestTube,
    adminActivityLog: FileText,
    adminFormatValidation: AlertTriangle,
    signOut: LogOut,
};

export function PalantirNavIcon({ navKey = 'dashboard', size = 14, className = '' }) {
    const Icon = NAV_ICONS[navKey] || Home;
    const tone = PAL_NAV_TONES[navKey] || PAL_NAV_TONES.dashboard;
    return (
        <span
            className={`pal-nav-icon-tile ${className}`.trim()}
            style={{ '--pal-nav-tile-bg': tone.bg, '--pal-nav-tile-fg': tone.fg }}
            aria-hidden
        >
            <Icon size={size} strokeWidth={2.25} />
        </span>
    );
}

export function PalantirPageIcon({ navKey, size = 18, className = '' }) {
    return <PalantirNavIcon navKey={navKey} size={size} className={`pal-page-icon ${className}`.trim()} />;
}
