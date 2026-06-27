import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    Building2, Users, Plus, Search,
    CheckCircle, Clock, Globe, ChevronRight
} from 'lucide-react';
import { collection, updateDoc, doc, setDoc, Timestamp, onSnapshot, getDocs } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { useToast } from './ToastNotification';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import { FRANCHISE_DEFAULTS_BY_COUNTRY_ID, ISO_CURRENCY_OPTIONS } from '../franchiseCountryDefaults';
import { canManageFranchises } from '../utilities/userAccess';
import { resolveOperationalFranchiseId } from '../utilities/franchiseIdResolve';
import { defaultCapabilitiesForCountry } from '../utilities/franchiseCapabilities';

// European Countries with flags and plate patterns
export const EUROPEAN_COUNTRIES = [
    { id: 'at', name: 'Austria', flag: '🇦🇹', countryCode: 'AT', platePattern: '^[A-Z]{1,2}[0-9]{1,6}[A-Z]?$' },
    { id: 'be', name: 'Belgium', flag: '🇧🇪', countryCode: 'BE', platePattern: '^[0-9][A-Z]{3}[0-9]{3}$' },
    { id: 'bg', name: 'Bulgaria', flag: '🇧🇬', countryCode: 'BG', platePattern: '^[A-Z]{1,2}[0-9]{4}[A-Z]{2}$' },
    { id: 'hr', name: 'Croatia', flag: '🇭🇷', countryCode: 'HR', platePattern: '^[A-Z]{2}[0-9]{3,4}[A-Z]{2}$' },
    { id: 'cz', name: 'Czech Republic', flag: '🇨🇿', countryCode: 'CZ', platePattern: '^[0-9][A-Z][0-9][0-9]{4}$' },
    { id: 'dk', name: 'Denmark', flag: '🇩🇰', countryCode: 'DK', platePattern: '^[A-Z]{2}[0-9]{5}$' },
    { id: 'fi', name: 'Finland', flag: '🇫🇮', countryCode: 'FI', platePattern: '^[A-Z]{3}[0-9]{3}$' },
    { id: 'fr', name: 'France', flag: '🇫🇷', countryCode: 'FR', platePattern: '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' },
    { id: 'de', name: 'Germany', flag: '🇩🇪', countryCode: 'DE', platePattern: '^[A-ZÄÖÜ]{1,3}[A-Z]{0,2}[0-9]{1,4}[EH]?$' },
    { id: 'gr', name: 'Greece', flag: '🇬🇷', countryCode: 'GR', platePattern: '^[A-Z]{3}[0-9]{4}$' },
    { id: 'hu', name: 'Hungary', flag: '🇭🇺', countryCode: 'HU', platePattern: '^[A-Z]{3}[0-9]{3}$' },
    { id: 'ie', name: 'Ireland', flag: '🇮🇪', countryCode: 'IE', platePattern: '^[0-9]{2,3}[A-Z]{1,2}[0-9]{1,6}$' },
    { id: 'it', name: 'Italy', flag: '🇮🇹', countryCode: 'IT', platePattern: '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' },
    { id: 'lu', name: 'Luxembourg', flag: '🇱🇺', countryCode: 'LU', platePattern: '^[A-Z]{2}[0-9]{4}$' },
    { id: 'nl', name: 'Netherlands', flag: '🇳🇱', countryCode: 'NL', platePattern: '^[A-Z0-9]{2}[A-Z0-9]{2}[A-Z0-9]{2}$' },
    { id: 'no', name: 'Norway', flag: '🇳🇴', countryCode: 'NO', platePattern: '^[A-Z]{2}[0-9]{5}$' },
    { id: 'pl', name: 'Poland', flag: '🇵🇱', countryCode: 'PL', platePattern: '^[A-Z]{2,3}[A-Z0-9]{4,5}$' },
    { id: 'pt', name: 'Portugal', flag: '🇵🇹', countryCode: 'PT', platePattern: '^[A-Z]{2}[0-9]{2}[A-Z]{2}$' },
    { id: 'ro', name: 'Romania', flag: '🇷🇴', countryCode: 'RO', platePattern: '^[A-Z]{1,2}[0-9]{2,3}[A-Z]{3}$' },
    { id: 'sk', name: 'Slovakia', flag: '🇸🇰', countryCode: 'SK', platePattern: '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' },
    { id: 'si', name: 'Slovenia', flag: '🇸🇮', countryCode: 'SI', platePattern: '^[A-Z]{2}[0-9]{2,3}[A-Z]{2}$' },
    { id: 'es', name: 'Spain', flag: '🇪🇸', countryCode: 'ES', platePattern: '^[0-9]{4}[A-Z]{3}$' },
    { id: 'se', name: 'Sweden', flag: '🇸🇪', countryCode: 'SE', platePattern: '^[A-Z]{3}[0-9]{3}$' },
    { id: 'ch', name: 'Switzerland', flag: '🇨🇭', countryCode: 'CH', platePattern: '^[A-Z]{1,2}[0-9]{1,6}$' },
    { id: 'tr', name: 'Turkey', flag: '🇹🇷', countryCode: 'TR', platePattern: '^[0-9]{2}[A-Z]{1,3}[0-9]{2,4}$' },
    { id: 'uk', name: 'United Kingdom', flag: '🇬🇧', countryCode: 'UK', platePattern: '^[A-Z]{2}[0-9]{2}[A-Z]{3}$' }
];

// Subscription Plans
export const SUBSCRIPTION_PLANS = [
    { id: 'demo', name: 'Demo', maxUsers: 5, description: '30 days trial', color: 'yellow' },
    { id: 'basic', name: 'Basic', maxUsers: 5, description: 'Small franchise', color: 'gray' },
    { id: 'standard', name: 'Standard', maxUsers: 15, description: 'Medium franchise', color: 'blue' },
    { id: 'premium', name: 'Premium', maxUsers: 50, description: 'Large franchise', color: 'purple' },
    { id: 'enterprise', name: 'Enterprise', maxUsers: 999, description: 'Unlimited', color: 'green' }
];

export function AdminFranchiseDashboard({ db, onViewFranchise, onCreateFranchise, userProfile = null }) {
    const toast = useToast();
    const [franchises, setFranchises] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all'); // all, active, inactive, demo
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [stats, setStats] = useState({ totalFranchises: 0, totalUsers: 0, demoCount: 0, activeCount: 0 });

    // Sync user counts for all franchises
    const syncUserCounts = useCallback(async (franchiseList) => {
        try {
            const usersSnap = await getDocs(collection(db, 'users'));
            const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            let totalUsersReal = 0;
            
            for (const franchise of franchiseList) {
                const franchiseUsers = allUsers.filter(u => 
                    u.isActive !== false && 
                    (u.franchiseId === franchise.franchiseId || u.franchiseId === franchise.id)
                );
                const realCount = franchiseUsers.length;
                totalUsersReal += realCount;
                
                // Auto-correct if mismatch
                if ((franchise.currentUserCount || 0) !== realCount) {
                    updateDoc(doc(db, 'franchises', franchise.id), {
                        currentUserCount: realCount,
                        updatedAt: Timestamp.now()
                    }).catch(err => console.warn('Failed to sync count for', franchise.country, err));
                }
            }
            
            return totalUsersReal;
        } catch (error) {
            console.warn('Failed to sync user counts:', error);
            return null;
        }
    }, [db]);

    // Load franchises with real-time listener
    useEffect(() => {
        const unsubscribe = onSnapshot(
            collection(db, 'franchises'), 
            (snapshot) => {
                const franchiseList = snapshot.docs.map(d => ({
                    id: d.id,
                    ...d.data()
                }));
                const visibleFranchises = franchiseList.filter(f => f.status !== 'closed');
                setFranchises(visibleFranchises);
                
                // Calculate stats
                const totalUsers = visibleFranchises.reduce((sum, f) => sum + (f.currentUserCount || 0), 0);
                const demoCount = visibleFranchises.filter(f => f.isDemo).length;
                const activeCount = visibleFranchises.filter(f => f.isActive).length;
                
                setStats({
                    totalFranchises: visibleFranchises.length,
                    totalUsers,
                    demoCount,
                    activeCount
                });
                
                setLoading(false);

                // Sync real user counts in background
                syncUserCounts(visibleFranchises).then(realTotal => {
                    if (realTotal !== null && realTotal !== totalUsers) {
                        setStats(prev => ({ ...prev, totalUsers: realTotal }));
                    }
                });
            }, 
            (error) => {
                console.error('Error loading franchises:', error);
                toast.error('Failed to load franchises: ' + error.message);
                setLoading(false);
            }
        );

        return () => unsubscribe();
    }, [db, toast, syncUserCounts]);

    // Filter franchises
    const filteredFranchises = franchises.filter(franchise => {
        const matchesSearch = franchise.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             franchise.country?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                             String(franchise.franchiseId || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                             String(franchise.branchName || '').toLowerCase().includes(searchTerm.toLowerCase());
        
        if (filterStatus === 'all') return matchesSearch;
        if (filterStatus === 'active') return matchesSearch && franchise.isActive && !franchise.isDemo;
        if (filterStatus === 'inactive') return matchesSearch && !franchise.isActive;
        if (filterStatus === 'demo') return matchesSearch && franchise.isDemo;
        return matchesSearch;
    });

    // Calculate days remaining for demo
    const getDaysRemaining = (expiresAt) => {
        if (!expiresAt) return null;
        const expDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
        const now = new Date();
        const diffTime = expDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    // Get progress bar color based on usage
    const getProgressColor = (current, max) => {
        const percentage = (current / max) * 100;
        if (percentage >= 90) return 'bg-red-500';
        if (percentage >= 70) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    // Get subscription plan info
    const getPlanInfo = (planId) => {
        return SUBSCRIPTION_PLANS.find(p => p.id === planId) || SUBSCRIPTION_PLANS[0];
    };

    if (!canManageFranchises(userProfile)) {
        return (
            <div className="erpx-page">
                <p className="text-sap-text-secondary dark:text-sap-textDark-secondary">
                    You do not have permission to manage franchises.
                </p>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#635BFF]"></div>
            </div>
        );
    }

    return (
        <div className="erpx-page space-y-6">
            <div className="erpx-page-toolbar">
                <p className="erpx-page-subtitle max-w-measure-narrow">
                    Manage all franchises and their user licenses
                </p>
                <button
                    type="button"
                    onClick={() => setShowCreateModal(true)}
                    className="pal-btn pal-btn-primary"
                >
                    <Plus size={18} />
                    New Franchise
                </button>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Total Franchises</p>
                    <p className="gm-dash-stat-value">{stats.totalFranchises}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Total Users</p>
                    <p className="gm-dash-stat-value">{stats.totalUsers}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Active</p>
                    <p className="gm-dash-stat-value">{stats.activeCount}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Demo</p>
                    <p className="gm-dash-stat-value">{stats.demoCount}</p>
                </div>
            </div>

            {/* Search and Filter */}
            <div className="flex flex-col md:flex-row gap-4">
                <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 z-10" style={{ color: 'var(--erpx-ink-muted)' }} size={18} />
                    <input
                        type="text"
                        placeholder="Search franchises..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="gm-field pl-10"
                    />
                </div>
                <div className="flex gap-2 flex-wrap">
                    {['all', 'active', 'demo', 'inactive'].map((status) => (
                        <button
                            type="button"
                            key={status}
                            onClick={() => setFilterStatus(status)}
                            className={`gm-filter-tab capitalize ${filterStatus === status ? 'gm-filter-tab-active' : ''}`}
                        >
                            {status}
                        </button>
                    ))}
                </div>
            </div>

            {/* Franchise Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <AnimatePresence>
                    {filteredFranchises.map((franchise) => {
                        const daysRemaining = franchise.isDemo ? getDaysRemaining(franchise.subscriptionEndDate) : null;
                        const usagePercentage = Math.round((franchise.currentUserCount || 0) / (franchise.maxUsers || 1) * 100);
                        const planInfo = getPlanInfo(franchise.subscriptionType);
                        
                        return (
                            <motion.div
                                key={franchise.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -20 }}
                                className={`pal-dash-panel border-2 ${
                                    !franchise.isActive 
                                        ? 'opacity-60' 
                                        : franchise.isDemo 
                                            ? '!border-[var(--erpx-amber-border)]' 
                                            : '!border-[var(--erpx-green-border)]'
                                } hover:shadow-md transition-shadow cursor-pointer`}
                                onClick={() => onViewFranchise && onViewFranchise(franchise)}
                            >
                                {/* Header */}
                                <div className="pal-dash-panel-header">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-3">
                                            <span className="text-3xl">{franchise.flag}</span>
                                            <div>
                                                <h3 className="pal-dash-panel-title">
                                                    {franchise.country}
                                                </h3>
                                                <p className="text-sm" style={{ color: 'var(--erpx-ink-muted)' }}>
                                                    {franchise.name}
                                                </p>
                                            </div>
                                        </div>
                                        <ChevronRight style={{ color: 'var(--erpx-ink-muted)' }} size={20} />
                                    </div>
                                </div>

                                {/* User Progress */}
                                <div className="pal-dash-panel-body !pt-0">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary flex items-center gap-1">
                                            <Users size={14} />
                                            Users
                                        </span>
                                        <span className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                                            {franchise.currentUserCount || 0}/{franchise.maxUsers || 0}
                                        </span>
                                    </div>
                                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 mb-1">
                                        <div 
                                            className={`h-2.5 rounded-full transition-all ${getProgressColor(franchise.currentUserCount || 0, franchise.maxUsers || 1)}`}
                                            style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                                        ></div>
                                    </div>
                                    <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary text-right">
                                        {usagePercentage}% used
                                    </p>
                                </div>

                                {/* Footer */}
                                <div className="px-4 pb-4 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        {/* Status Badge */}
                                        {!franchise.isActive ? (
                                            <span className="gm-badge gm-badge-neutral">
                                                Inactive
                                            </span>
                                        ) : franchise.isDemo ? (
                                            <span className="gm-badge gm-badge-warning flex items-center gap-1">
                                                <Clock size={12} />
                                                Demo {daysRemaining !== null && `(${daysRemaining}d)`}
                                            </span>
                                        ) : (
                                            <span className="gm-badge gm-badge-success flex items-center gap-1">
                                                <CheckCircle size={12} />
                                                Production
                                            </span>
                                        )}
                                    </div>
                                    {/* Plan Badge */}
                                    <span className={`gm-badge ${
                                        planInfo.color === 'purple' ? 'gm-badge-purple' :
                                        planInfo.color === 'yellow' ? 'gm-badge-warning' :
                                        planInfo.color === 'gray' ? 'gm-badge-neutral' :
                                        'gm-badge-info'
                                    }`}>
                                        {planInfo.name}
                                    </span>
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>

            {filteredFranchises.length === 0 && (
                <div className="text-center py-12">
                    <Globe className="mx-auto text-sap-text-secondary dark:text-sap-textDark-secondary mb-4" size={48} />
                    <p className="text-sap-text-secondary dark:text-sap-textDark-secondary">
                        No franchises found
                    </p>
                </div>
            )}

            {/* Create Franchise Modal */}
            <AnimatePresence>
                {showCreateModal && (
                    <CreateFranchiseModal
                        db={db}
                        onClose={() => setShowCreateModal(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

// Create Franchise Modal Component
function CreateFranchiseModal({ db, onClose, toast }) {
    const [formData, setFormData] = useState({
        countryId: '',
        branchName: '',
        name: '',
        subscriptionType: 'demo',
        maxUsers: 5,
        isDemo: true,
        isActive: true,
        currency: 'CHF',
        timezone: 'Europe/Zurich'
    });
    const [saving, setSaving] = useState(false);

    const selectedCountry = EUROPEAN_COUNTRIES.find(c => c.id === formData.countryId);
    const selectedPlan = SUBSCRIPTION_PLANS.find(p => p.id === formData.subscriptionType);

    useEffect(() => {
        if (!formData.countryId) return;
        const defs = FRANCHISE_DEFAULTS_BY_COUNTRY_ID[formData.countryId];
        if (defs) {
            setFormData((prev) => ({
                ...prev,
                currency: defs.currency,
                timezone: defs.timezone
            }));
        }
    }, [formData.countryId]);

    const normalizeBranchSegment = (value) => {
        if (!value) return '';
        return value
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '');
    };

    const buildUniqueFranchiseId = (baseId, existingIds) => {
        if (!existingIds.has(baseId)) return baseId;
        let suffix = 2;
        while (existingIds.has(`${baseId}_${suffix}`)) {
            suffix += 1;
        }
        return `${baseId}_${suffix}`;
    };

    // Update maxUsers when subscription type changes
    useEffect(() => {
        if (selectedPlan) {
            setFormData(prev => ({
                ...prev,
                maxUsers: selectedPlan.maxUsers,
                isDemo: selectedPlan.id === 'demo'
            }));
        }
    }, [formData.subscriptionType, selectedPlan]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedCountry) {
            toast.error('Please select a country');
            return;
        }

        setSaving(true);
        try {
            const branchNameClean = (formData.branchName || '').trim();
            const branchCode = normalizeBranchSegment(branchNameClean);
            const countryBaseCode = selectedCountry.countryCode.toUpperCase();
            let franchiseBaseId = branchCode ? `${countryBaseCode}_${branchCode}` : countryBaseCode;
            franchiseBaseId = resolveOperationalFranchiseId(franchiseBaseId);

            const existingSnap = await getDocs(collection(db, 'franchises'));
            const existingIds = new Set();
            existingSnap.docs.forEach((d) => {
                const data = d.data() || {};
                if (d.id) existingIds.add(String(d.id).toUpperCase());
                if (data.franchiseId) existingIds.add(String(data.franchiseId).toUpperCase());
            });

            const uniqueFranchiseId = buildUniqueFranchiseId(franchiseBaseId, existingIds);
            const franchiseData = {
                franchiseId: uniqueFranchiseId,
                countryBaseCode,
                branchName: branchNameClean || null,
                name: formData.name || (branchNameClean
                    ? `${selectedCountry.name} — ${branchNameClean}`
                    : `${selectedCountry.name} franchise`),
                country: selectedCountry.name,
                countryCode: selectedCountry.countryCode,
                flag: selectedCountry.flag,
                plateFormat: selectedCountry.id,
                maxUsers: formData.maxUsers,
                currentUserCount: 0,
                subscriptionType: formData.subscriptionType,
                subscriptionStartDate: Timestamp.now(),
                subscriptionEndDate: formData.isDemo 
                    ? Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
                    : null,
                isDemo: formData.isDemo,
                isActive: formData.isActive,
                createdAt: Timestamp.now(),
                createdBy: getAuth().currentUser?.email || 'unknown',
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'unknown',
                currency: String(formData.currency || 'EUR').trim().toUpperCase(),
                timezone: formData.timezone || 'Europe/Berlin',
                language: selectedCountry.id,
                capabilities: defaultCapabilitiesForCountry(selectedCountry.countryCode),
            };

            await setDoc(doc(db, 'franchises', uniqueFranchiseId), franchiseData);
            toast.success(
                `Franchise "${uniqueFranchiseId}" created. Customer QR (return + checkout) is enabled for this branch.`,
                { duration: 7000 }
            );
            onClose();
        } catch (error) {
            console.error('Error creating franchise:', error);
            toast.error('Failed to create franchise');
        } finally {
            setSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="pal-dash-panel shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="pal-dash-panel-header">
                    <h2 className="pal-dash-panel-title text-base">
                        Create New Franchise
                    </h2>
                </div>

                <form onSubmit={handleSubmit} className="pal-dash-panel-body pal-form-stack space-y-5">
                    {/* Country Selection */}
                    <div>
                        <label className="gm-label">
                            Country *
                        </label>
                        <select
                            value={formData.countryId}
                            onChange={(e) => setFormData({ ...formData, countryId: e.target.value })}
                            className="gm-field"
                            required
                        >
                            <option value="">Select a country...</option>
                            {EUROPEAN_COUNTRIES.map((country) => (
                                <option key={country.id} value={country.id}>
                                    {country.flag} {country.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Currency (stored on franchise; used for web + iOS amounts) */}
                    <div>
                        <label className="gm-label">
                            Currency *
                        </label>
                        <select
                            value={formData.currency}
                            onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                            className="gm-field"
                            required
                        >
                            {ISO_CURRENCY_OPTIONS.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                            Defaults from country when you pick a country; you can override before create.
                        </p>
                    </div>

                    {/* Franchise Name */}
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Franchise Name
                        </label>
                        <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            placeholder={selectedCountry ? `${selectedCountry.name} franchise` : 'Franchise display name'}
                            className="gm-field"
                        />
                    </div>

                    {/* Branch Name */}
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Branch / City Name (optional)
                        </label>
                        <input
                            type="text"
                            value={formData.branchName}
                            onChange={(e) => setFormData({ ...formData, branchName: e.target.value })}
                            placeholder="Zurich"
                            className="gm-field"
                        />
                        <p className="mt-1 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                            Code preview: {selectedCountry ? `${selectedCountry.countryCode.toUpperCase()}${formData.branchName ? `_${normalizeBranchSegment(formData.branchName) || 'BRANCH'}` : ''}` : 'Select country first'}
                        </p>
                    </div>

                    {/* Subscription Plan */}
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Subscription Plan *
                        </label>
                        <div className="space-y-2">
                            {SUBSCRIPTION_PLANS.map((plan) => (
                                <label
                                    key={plan.id}
                                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                                        formData.subscriptionType === plan.id
                                            ? 'border-[#635BFF] bg-[var(--erpx-brand-light)]'
                                            : 'border-[var(--erpx-border)] hover:bg-[var(--erpx-subtle)]'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="subscriptionType"
                                            value={plan.id}
                                            checked={formData.subscriptionType === plan.id}
                                            onChange={(e) => setFormData({ ...formData, subscriptionType: e.target.value })}
                                            className="text-sap-blue-500"
                                        />
                                        <div>
                                            <p className="font-medium text-sap-text-primary dark:text-sap-textDark-primary">
                                                {plan.name}
                                            </p>
                                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                                                {plan.description}
                                            </p>
                                        </div>
                                    </div>
                                    <span className="text-sm font-medium text-sap-text-secondary dark:text-sap-textDark-secondary">
                                        {plan.maxUsers === 999 ? 'Unlimited' : `${plan.maxUsers} users`}
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Custom User Limit */}
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Custom User Limit (override)
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="999"
                            value={formData.maxUsers}
                            onChange={(e) => setFormData({ ...formData, maxUsers: parseInt(e.target.value) || 5 })}
                            className="gm-field"
                        />
                    </div>

                    {/* Active Status */}
                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isActive"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="rounded text-sap-blue-500"
                        />
                        <label htmlFor="isActive" className="text-sm text-sap-text-primary dark:text-sap-textDark-primary">
                            Active immediately
                        </label>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 pal-btn"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !formData.countryId}
                            className="flex-1 pal-btn pal-btn-primary"
                        >
                            {saving ? 'Creating...' : 'Create Franchise'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

export default AdminFranchiseDashboard;
