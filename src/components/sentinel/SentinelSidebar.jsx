import React from 'react';
import { signOut } from 'firebase/auth';
import {
    Home,
    Car,
    ArrowRight,
    ArrowLeft,
    AlertCircle,
    Package,
    Building2,
    CalendarDays,
    DollarSign,
    Users,
    Clock,
    FileText,
    MapPin,
    BarChart3,
    FileBarChart,
    Phone,
    Mail,
    Shield,
    Database,
    TestTube,
    AlertTriangle,
    Activity,
    LogOut,
} from 'lucide-react';

function NavItem({ icon, label, active, onClick, badge, badgeVariant }) {
    const badgeClass = badgeVariant ? ` nav-badge ${badgeVariant}` : ' nav-badge';
    return (
        <button
            type="button"
            className={active ? 'nav-item active' : 'nav-item'}
            onClick={onClick}
        >
            {icon}
            {label}
            {badge != null && badge !== '' ? <span className={badgeClass.trim()}>{badge}</span> : null}
        </button>
    );
}

export function SentinelSidebar({
    auth,
    currentView,
    setCurrentView,
    userProfile,
    user,
    canViewFinancials = true,
    canUseOperations = false,
    canAccessFrontDeskCustomers = true,
}) {
    const isAdmin = () => {
        const r = String(userProfile?.role || '').toLowerCase().trim();
        return r === 'globaladmin' || r === 'global admin' || r === 'global_admin';
    };

    const go = (view) => () => setCurrentView(view);

    return (
        <nav className="sidebar">
            <div className="sidebar-section">
                <div className="sidebar-label">Core operations</div>
                <NavItem icon={<Home size={14} />} label="Dashboard" active={currentView === 'dashboard'} onClick={go('dashboard')} />
                <NavItem icon={<Car size={14} />} label="Vehicles" active={currentView === 'cars'} onClick={go('cars')} />
                <NavItem icon={<ArrowRight size={14} />} label="Checkout" active={currentView === 'checkout'} onClick={go('checkout')} />
                {canUseOperations ? (
                    <NavItem icon={<Car size={14} />} label="Parked Checkout" active={currentView === 'parkedCheckout'} onClick={go('parkedCheckout')} />
                ) : null}
                {canUseOperations ? (
                    <NavItem icon={<CalendarDays size={14} />} label="Operations" active={currentView === 'operations'} onClick={go('operations')} />
                ) : null}
                <NavItem icon={<ArrowLeft size={14} />} label="Returns" active={currentView === 'returns'} onClick={go('returns')} />
                <NavItem icon={<AlertCircle size={14} />} label="Damage" active={currentView === 'damage'} onClick={go('damage')} />
                <NavItem icon={<Package size={14} />} label="Service" active={currentView === 'service'} onClick={go('service')} />
                <NavItem icon={<Building2 size={14} />} label="Service Firms" active={currentView === 'serviceFirms'} onClick={go('serviceFirms')} />
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
                <div className="sidebar-label">Finance &amp; office</div>
                <NavItem icon={<DollarSign size={14} />} label="Office Operations" active={currentView === 'office'} onClick={go('office')} />
                <NavItem icon={<ArrowLeft size={14} />} label="Office Returns" active={currentView === 'officeReturns'} onClick={go('officeReturns')} />
                {canAccessFrontDeskCustomers ? (
                    <NavItem icon={<Users size={14} />} label="Front-desk customers" active={currentView === 'frontDeskCustomers'} onClick={go('frontDeskCustomers')} />
                ) : null}
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
                <div className="sidebar-label">Planning</div>
                <NavItem icon={<Clock size={14} />} label="Working timetable" active={currentView === 'workingTimetable'} onClick={go('workingTimetable')} />
                <NavItem icon={<FileText size={14} />} label="Protocols" active={currentView === 'protocols'} onClick={go('protocols')} />
                <NavItem icon={<MapPin size={14} />} label="Shuttle" active={currentView === 'shuttle'} onClick={go('shuttle')} />
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
                <div className="sidebar-label">Insights</div>
                {canViewFinancials ? (
                    <NavItem icon={<BarChart3 size={14} />} label="Analytics" active={currentView === 'analytics'} onClick={go('analytics')} />
                ) : null}
                {canViewFinancials ? (
                    <NavItem icon={<FileBarChart size={14} />} label="Reports" active={currentView === 'reports'} onClick={go('reports')} />
                ) : null}
            </div>

            <div className="sidebar-divider" />

            <div className="sidebar-section">
                <div className="sidebar-label">Communications</div>
                <NavItem icon={<Phone size={14} />} label="Assistant Numbers" active={currentView === 'assistantNumbers'} onClick={go('assistantNumbers')} />
                <NavItem icon={<Mail size={14} />} label="Mail Center" active={currentView === 'mailCenter'} onClick={go('mailCenter')} />
            </div>

            {isAdmin() ? (
                <>
                    <div className="sidebar-divider" />
                    <div className="sidebar-section">
                        <div className="sidebar-label">Admin</div>
                        <NavItem icon={<Building2 size={14} />} label="Franchises" active={currentView === 'adminFranchises' || currentView === 'adminFranchiseDetail'} onClick={go('adminFranchises')} />
                        <NavItem icon={<Users size={14} />} label="User Management" active={currentView === 'adminUserManagement'} onClick={go('adminUserManagement')} />
                        <NavItem icon={<Shield size={14} />} label="Roles &amp; Rules" active={currentView === 'adminSecurityOps'} onClick={go('adminSecurityOps')} />
                        <NavItem icon={<Activity size={14} />} label="Process Ops" active={currentView === 'adminProcessOperations'} onClick={go('adminProcessOperations')} />
                        <NavItem icon={<Database size={14} />} label="Firebase" active={currentView === 'adminFirebaseConnection'} onClick={go('adminFirebaseConnection')} />
                        <NavItem icon={<Phone size={14} />} label="Phone Format" active={currentView === 'adminPhoneFormat'} onClick={go('adminPhoneFormat')} />
                        <NavItem icon={<TestTube size={14} />} label="A/B Testing" active={currentView === 'adminABTesting'} onClick={go('adminABTesting')} />
                        <NavItem icon={<FileText size={14} />} label="Activity Log" active={currentView === 'adminActivityLog'} onClick={go('adminActivityLog')} />
                        <NavItem icon={<AlertTriangle size={14} />} label="Format Validation" active={currentView === 'adminFormatValidation'} onClick={go('adminFormatValidation')} />
                    </div>
                </>
            ) : null}

            <div className="sidebar-divider" />

            <div style={{ padding: '0 var(--sp-4)', marginTop: 'auto' }}>
                <button type="button" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={() => signOut(auth)}>
                    <LogOut size={14} />
                    Sign out
                </button>
            </div>
        </nav>
    );
}
