import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Users, Search, Edit, Mail, LogIn, Trash2, AlertTriangle,
    CheckCircle, XCircle, Clock, Plus, Globe, Building, KeyRound
} from 'lucide-react';
import { collection, updateDoc, doc, Timestamp, onSnapshot, query, where, getDocs, deleteField } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useToast } from './ToastNotification';
import { EUROPEAN_COUNTRIES } from './AdminFranchiseDashboard';
import { FranchiseAddUserModal } from './AdminFranchiseDetailView';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import {
    profileDisplayHandle,
    assignableRolesForActor,
    canAssignRole,
    buildProfileUsernameSaveParts,
    normalizeRoleKey,
    isGlobalAdmin as isGlobalAdminProfile,
} from '../utilities/userAccess';
import {
    resolveRoleScope,
    userFranchiseIdList,
    legacyScopeLevelFromScope,
} from '../utilities/roleScope';

// Safe date formatting helper - handles Firestore Timestamp, Date, number (seconds), and string
const safeFormatDate = (timestamp, includeTime = true) => {
    if (!timestamp) return 'N/A';
    
    let date;
    try {
        if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
            // Firestore Timestamp
            date = timestamp.toDate();
        } else if (timestamp?.seconds) {
            // Firestore Timestamp-like object
            date = new Date(timestamp.seconds * 1000);
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else if (typeof timestamp === 'number') {
            // Unix timestamp (seconds or milliseconds)
            date = new Date(timestamp > 9999999999 ? timestamp : timestamp * 1000);
        } else if (typeof timestamp === 'string') {
            date = new Date(timestamp);
        } else {
            return 'N/A';
        }
        
        if (isNaN(date.getTime())) return 'N/A';
        
        const options = { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric'
        };
        
        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }
        
        return date.toLocaleDateString('en-US', options);
    } catch (error) {
        console.error('Error formatting date:', error, timestamp);
        return 'N/A';
    }
};

// Calculate relative time (e.g., "2 hours ago", "3 days ago")
const getRelativeTime = (timestamp) => {
    if (!timestamp) return null;
    
    let date;
    try {
        if (timestamp?.toDate && typeof timestamp.toDate === 'function') {
            date = timestamp.toDate();
        } else if (timestamp?.seconds) {
            date = new Date(timestamp.seconds * 1000);
        } else if (timestamp instanceof Date) {
            date = timestamp;
        } else if (typeof timestamp === 'number') {
            date = new Date(timestamp > 9999999999 ? timestamp : timestamp * 1000);
        } else if (typeof timestamp === 'string') {
            date = new Date(timestamp);
        } else {
            return null;
        }
        
        if (isNaN(date.getTime())) return null;
        
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        return `${Math.floor(diffDays / 30)}mo ago`;
    } catch (error) {
        return null;
    }
};

export function AdminUserManagementView({ db, functionsApp, userProfile = null, scopedFranchiseId = null }) {
    const toast = useToast();
    const franchiseScope = scopedFranchiseId
        ? String(scopedFranchiseId).trim().toUpperCase()
        : null;
    const isScopedFranchiseAdmin = Boolean(franchiseScope);
    const isPlatformAdmin = isGlobalAdminProfile(userProfile);
    const assignableRoles = assignableRolesForActor(userProfile);
    const [users, setUsers] = useState([]);
    const [franchises, setFranchises] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterFranchise, setFilterFranchise] = useState(franchiseScope || 'all');
    const [filterCountry, setFilterCountry] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all'); // all, active, inactive
    const [filterType, setFilterType] = useState('all'); // all, demo, regular
    const [sortBy, setSortBy] = useState('lastLogin'); // lastLogin, createdAt, email, name
    const [sortOrder, setSortOrder] = useState('desc');
    const [editingUser, setEditingUser] = useState(null);
    const [showConvertModal, setShowConvertModal] = useState(null);
    const [showDeleteModal, setShowDeleteModal] = useState(null);
    const [passwordChangeUser, setPasswordChangeUser] = useState(null);
    // Two distinct flows: legacy franchise-admin AddUserModal (single franchise) vs
    // platform-admin scope-aware modal (any country / multi-franchise).
    const [showAddUserModal, setShowAddUserModal] = useState(false);
    const [showPlatformAddUser, setShowPlatformAddUser] = useState(false);
    const scopedFranchise = isScopedFranchiseAdmin ? franchises[0] : null;
    const scopedSlots =
        scopedFranchise && Number(scopedFranchise.maxUsers || 0) > 0
            ? Number(scopedFranchise.maxUsers || 0) - users.filter((u) => u.isActive !== false).length
            : null;

    const distinctCountryCodes = useMemo(() => {
        const set = new Set();
        for (const f of franchises) {
            const cc = String(f.countryCode || '').trim().toUpperCase();
            if (cc) set.add(cc);
        }
        return Array.from(set).sort();
    }, [franchises]);

    // Load users and franchises
    useEffect(() => {
        const usersRef = franchiseScope
            ? query(collection(db, 'users'), where('franchiseId', '==', franchiseScope))
            : collection(db, 'users');

        const unsubUsers = onSnapshot(
            usersRef,
            (snapshot) => {
                const userList = snapshot.docs.map((d) => ({
                    id: d.id,
                    ...d.data(),
                }));
                setUsers(userList);
                setLoading(false);
            },
            (error) => {
                console.error('Error loading users:', error);
                toast.error('Failed to load users: ' + error.message);
                setLoading(false);
            }
        );

        const unsubFranchises = isScopedFranchiseAdmin
            ? onSnapshot(
                  doc(db, 'franchises', franchiseScope),
                  (snap) => {
                      if (snap.exists()) {
                          setFranchises([{ id: snap.id, ...snap.data() }]);
                      } else {
                          setFranchises([]);
                      }
                  },
                  (error) => console.error('Error loading franchise:', error)
              )
            : onSnapshot(
                  collection(db, 'franchises'),
                  (snapshot) => {
                      const franchiseList = snapshot.docs.map((d) => ({
                          id: d.id,
                          ...d.data(),
                      }));
                      setFranchises(franchiseList);
                  },
                  (error) => console.error('Error loading franchises:', error)
              );

        return () => {
            unsubUsers();
            unsubFranchises();
        };
    }, [db, toast, franchiseScope, isScopedFranchiseAdmin]);

    // Helper to get timestamp value for sorting
    const getTimestampValue = (timestamp) => {
        if (!timestamp) return 0;
        if (timestamp?.seconds) return timestamp.seconds;
        if (timestamp?.toDate) return timestamp.toDate().getTime() / 1000;
        if (timestamp instanceof Date) return timestamp.getTime() / 1000;
        if (typeof timestamp === 'number') return timestamp > 9999999999 ? timestamp / 1000 : timestamp;
        if (typeof timestamp === 'string') return new Date(timestamp).getTime() / 1000 || 0;
        return 0;
    };

    // Filter and sort users
    const filteredUsers = users
        .filter(user => {
            const normalizedSearch = searchTerm.trim().toLowerCase();
            const matchesSearch = normalizedSearch === '' ||
                (user.email || '').toLowerCase().includes(normalizedSearch) ||
                (profileDisplayHandle(user) || '').toLowerCase().includes(normalizedSearch) ||
                (user.firstName || '').toLowerCase().includes(normalizedSearch) ||
                (user.lastName || '').toLowerCase().includes(normalizedSearch);

            const scope = resolveRoleScope(user);
            const userCountry = (scope.countryCode || user.countryCode || '').toUpperCase();

            const matchesFranchise = filterFranchise === 'all'
                || (scope.franchiseIds || []).map((x) => String(x).toUpperCase()).includes(filterFranchise)
                || user.franchiseId === filterFranchise;
            const matchesCountry = filterCountry === 'all' || userCountry === filterCountry;
            const matchesStatus = filterStatus === 'all' ||
                (filterStatus === 'active' && user.isActive !== false) ||
                (filterStatus === 'inactive' && user.isActive === false);
            const matchesType = filterType === 'all' ||
                (filterType === 'demo' && user.isDemo) ||
                (filterType === 'regular' && !user.isDemo);

            return matchesSearch && matchesFranchise && matchesCountry && matchesStatus && matchesType;
        })
        .sort((a, b) => {
            let compareA, compareB;
            
            switch (sortBy) {
                case 'email':
                    compareA = a.email || '';
                    compareB = b.email || '';
                    break;
                case 'name':
                    compareA =
                        profileDisplayHandle(a) ||
                        `${a.firstName || ''} ${a.lastName || ''}`.trim();
                    compareB =
                        profileDisplayHandle(b) ||
                        `${b.firstName || ''} ${b.lastName || ''}`.trim();
                    break;
                case 'lastLogin':
                    compareA = getTimestampValue(a.lastLogin || a.lastLoginAt);
                    compareB = getTimestampValue(b.lastLogin || b.lastLoginAt);
                    break;
                case 'createdAt':
                default:
                    compareA = getTimestampValue(a.createdAt);
                    compareB = getTimestampValue(b.createdAt);
                    break;
            }
            
            if (sortOrder === 'asc') {
                return compareA > compareB ? 1 : -1;
            }
            return compareA < compareB ? 1 : -1;
        });

    // Get franchise info
    const getFranchiseInfo = (franchiseId) => {
        const franchise = franchises.find(f => f.franchiseId === franchiseId || f.id === franchiseId);
        if (franchise) return franchise;
        
        const country = EUROPEAN_COUNTRIES.find(c => c.id === franchiseId);
        if (country) return { flag: country.flag, country: country.name };
        
        return { flag: '🌍', country: franchiseId || 'Unknown' };
    };

    // Calculate days remaining for demo
    const getDaysRemaining = (expiresAt) => {
        if (!expiresAt) return null;
        const expDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
        const now = new Date();
        const diffTime = expDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    // Handle user status toggle
    const handleToggleStatus = async (user) => {
        const activating = user.isActive === false;
        if (activating && isScopedFranchiseAdmin && franchises[0]) {
            const activeCount = users.filter((u) => u.isActive !== false).length;
            const maxUsers = Number(franchises[0].maxUsers || 0);
            if (maxUsers > 0 && activeCount >= maxUsers) {
                toast.error(`User limit reached (${activeCount}/${maxUsers})`);
                return;
            }
        }
        try {
            await updateDoc(doc(db, 'users', user.id), {
                isActive: !user.isActive,
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'unknown'
            });
            toast.success(`User ${user.isActive ? 'deactivated' : 'activated'} successfully`);
        } catch (error) {
            console.error('Error updating user:', error);
            toast.error('Failed to update user');
        }
    };

    // Handle convert demo to regular
    const handleConvertToRegular = async (user) => {
        try {
            await updateDoc(doc(db, 'users', user.id), {
                isDemo: false,
                isDemoAccount: false,  // iOS compatibility field
                demoExpiresAt: null,
                convertedFromDemo: true,
                convertedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'unknown'
            });
            toast.success(`User "${user.email}" converted to regular account`);
            setShowConvertModal(null);
        } catch (error) {
            console.error('Error converting user:', error);
            toast.error('Failed to convert user');
        }
    };

    // Handle user deletion — globaladmin only; falls back to legacy callable
    // for older deployments that still expose `adminDeleteUserCompletely`.
    const handleDeleteUser = async (user, { confirmGlobalAdminDelete = false } = {}) => {
        try {
            if (!functionsApp) {
                throw new Error('Functions client is not available');
            }
            const targetScope = resolveRoleScope(user);
            const isTargetGlobal =
                normalizeRoleKey(user.role) === 'globaladmin' || targetScope.level === 'global';
            if (isTargetGlobal && !confirmGlobalAdminDelete) {
                toast.error('Global admins must be deleted with explicit confirmation.');
                return;
            }
            const callableName = 'adminDeleteUserScope';
            const fn = httpsCallable(functionsApp, callableName);
            await fn({
                uid: user.id,
                email: user.email || null,
                confirmGlobalAdminDelete: isTargetGlobal,
            });
            toast.success(`User "${user.email || user.id}" deleted from Auth and Firestore`);
            setShowDeleteModal(null);
        } catch (error) {
            console.error('Error deleting user:', error);
            toast.error('Failed to delete user: ' + (error.message || 'Unknown error'));
        }
    };

    // Stats
    const stats = {
        total: users.length,
        active: users.filter(u => u.isActive !== false).length,
        demo: users.filter(u => u.isDemo).length,
        regular: users.filter(u => !u.isDemo).length
    };

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
                    {isScopedFranchiseAdmin
                        ? `Manage users for franchise ${franchiseScope}`
                        : 'Manage all users across all franchises'}
                </p>
                {isScopedFranchiseAdmin && scopedFranchise && (
                    <button
                        type="button"
                        onClick={() => setShowAddUserModal(true)}
                        disabled={scopedSlots !== null && scopedSlots <= 0}
                        className="pal-btn pal-btn-primary"
                        title={
                            scopedSlots !== null && scopedSlots <= 0
                                ? 'User limit reached for this franchise'
                                : undefined
                        }
                    >
                        Add User
                    </button>
                )}
                {isPlatformAdmin && !isScopedFranchiseAdmin && (
                    <button
                        type="button"
                        onClick={() => setShowPlatformAddUser(true)}
                        className="pal-btn pal-btn-primary inline-flex items-center gap-2"
                    >
                        <Plus size={18} />
                        Add User
                    </button>
                )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Total Users</p>
                    <p className="gm-dash-stat-value">{stats.total}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Active</p>
                    <p className="gm-dash-stat-value">{stats.active}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Demo</p>
                    <p className="gm-dash-stat-value">{stats.demo}</p>
                </div>
                <div className="gm-dash-stat">
                    <p className="gm-dash-stat-title">Regular</p>
                    <p className="gm-dash-stat-value">{stats.regular}</p>
                </div>
            </div>

            {/* Filters */}
            <div className="pal-dash-panel">
                <div className="pal-dash-panel-body flex flex-col md:flex-row gap-4">
                    {/* Search */}
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 z-10" style={{ color: 'var(--erpx-ink-muted)' }} size={18} />
                        <input
                            type="text"
                            placeholder="Search by email or name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="gm-field pl-10"
                        />
                    </div>

                    {!isScopedFranchiseAdmin && (
                        <select
                            value={filterCountry}
                            onChange={(e) => setFilterCountry(e.target.value)}
                            className="gm-field md:max-w-[160px]"
                        >
                            <option value="all">All Countries</option>
                            {distinctCountryCodes.map((cc) => (
                                <option key={cc} value={cc}>
                                    {cc}
                                </option>
                            ))}
                        </select>
                    )}

                    {!isScopedFranchiseAdmin && (
                        <select
                            value={filterFranchise}
                            onChange={(e) => setFilterFranchise(e.target.value)}
                            className="gm-field md:max-w-[200px]"
                        >
                            <option value="all">All Franchises</option>
                            {franchises
                                .filter((f) => filterCountry === 'all'
                                    || String(f.countryCode || '').toUpperCase() === filterCountry)
                                .map((f) => (
                                    <option key={f.id} value={String(f.franchiseId || f.id).toUpperCase()}>
                                        {f.flag} {f.country || f.name || f.franchiseId || f.id}
                                    </option>
                                ))}
                        </select>
                    )}

                    {/* Status Filter */}
                    <select
                        value={filterStatus}
                        onChange={(e) => setFilterStatus(e.target.value)}
                        className="gm-field md:max-w-[160px]"
                    >
                        <option value="all">All Status</option>
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                    </select>

                    {/* Type Filter */}
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="gm-field md:max-w-[160px]"
                    >
                        <option value="all">All Types</option>
                        <option value="demo">Demo</option>
                        <option value="regular">Regular</option>
                    </select>
                </div>
            </div>

            {/* Users Table */}
            <div className="gm-table-wrap">
                    <table className="gm-table">
                        <thead>
                            <tr>
                                <th 
                                    className="cursor-pointer"
                                    onClick={() => {
                                        if (sortBy === 'email') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                        else { setSortBy('email'); setSortOrder('asc'); }
                                    }}
                                >
                                    Email {sortBy === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th 
                                    className="cursor-pointer"
                                    onClick={() => {
                                        if (sortBy === 'name') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                        else { setSortBy('name'); setSortOrder('asc'); }
                                    }}
                                >
                                    Username {sortBy === 'name' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th>Franchise(s)</th>
                                <th>Role</th>
                                <th>Type</th>
                                <th>Status</th>
                                <th 
                                    className="cursor-pointer"
                                    onClick={() => {
                                        if (sortBy === 'lastLogin') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                        else { setSortBy('lastLogin'); setSortOrder('desc'); }
                                    }}
                                >
                                    <div className="flex items-center gap-1">
                                        <LogIn size={14} />
                                        Last Login {sortBy === 'lastLogin' && (sortOrder === 'asc' ? '↑' : '↓')}
                                    </div>
                                </th>
                                <th 
                                    className="cursor-pointer"
                                    onClick={() => {
                                        if (sortBy === 'createdAt') setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                        else { setSortBy('createdAt'); setSortOrder('desc'); }
                                    }}
                                >
                                    Created {sortBy === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map((user) => {
                                const franchiseInfo = getFranchiseInfo(user.franchiseId);
                                const daysRemaining = user.isDemo ? getDaysRemaining(user.demoExpiresAt) : null;
                                
                                return (
                                    <tr key={user.id} className={`hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover ${user.isActive === false ? 'opacity-50' : ''}`}>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center gap-2">
                                                <Mail size={16} className="text-sap-text-secondary dark:text-sap-textDark-secondary" />
                                                <span className="text-sap-text-primary dark:text-sap-textDark-primary">
                                                    {user.email}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-sap-text-primary dark:text-sap-textDark-primary">
                                            {profileDisplayHandle(user)
                                                ? profileDisplayHandle(user)
                                                : (user.firstName || user.lastName
                                                    ? `${user.firstName || ''} ${user.lastName || ''}`.trim()
                                                    : '-'
                                                )
                                            }
                                            {user.convertedFromDemo && (
                                                <span className="ml-2 text-xs text-green-600 dark:text-green-400">(Converted)</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <UserFranchiseChips
                                                user={user}
                                                franchises={franchises}
                                                fallbackInfo={franchiseInfo}
                                            />
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                user.role === 'globaladmin'
                                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                    : user.role === 'superadmin'
                                                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                                                        : user.role === 'admin'
                                                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400'
                                                            : user.role === 'manager'
                                                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                                                                : user.role === 'garage'
                                                                  ? 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300'
                                                                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'
                                            }`}>
                                                {user.role === 'globaladmin'
                                                    ? 'Global Admin'
                                                    : user.role === 'garage'
                                                      ? 'Garage (service partner)'
                                                      : (user.role || 'staff')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {user.isDemo ? (
                                                <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 rounded-full flex items-center gap-1 w-fit">
                                                    <Clock size={12} />
                                                    Demo {daysRemaining !== null && `(${daysRemaining}d)`}
                                                </span>
                                            ) : (
                                                <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded-full flex items-center gap-1 w-fit">
                                                    <CheckCircle size={12} />
                                                    Regular
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3">
                                            {user.isActive !== false ? (
                                                <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-full">
                                                    Active
                                                </span>
                                            ) : (
                                                <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400 rounded-full">
                                                    Inactive
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm">
                                            {user.lastLogin || user.lastLoginAt ? (
                                                <div>
                                                    <span className="text-green-600 dark:text-green-400 font-medium">
                                                        {getRelativeTime(user.lastLogin || user.lastLoginAt)}
                                                    </span>
                                                    <p className="text-xs text-sap-text-tertiary dark:text-sap-textDark-tertiary">
                                                        {safeFormatDate(user.lastLogin || user.lastLoginAt, true)}
                                                    </p>
                                                </div>
                                            ) : (
                                                <span className="text-sap-text-tertiary dark:text-sap-textDark-tertiary italic">
                                                    Never
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                                            <div>
                                                {safeFormatDate(user.createdAt, false)}
                                                {user.createdBy && (
                                                    <p className="text-xs text-sap-text-tertiary dark:text-sap-textDark-tertiary">
                                                        by {user.createdBy}
                                                    </p>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                {user.isDemo && (
                                                    <button
                                                        onClick={() => setShowConvertModal(user)}
                                                        className="px-3 py-1 text-sm bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded-lg hover:bg-green-200 dark:hover:bg-green-900/50 transition-colors"
                                                    >
                                                        Convert
                                                    </button>
                                                )}
                                                {isPlatformAdmin && (
                                                    <button
                                                        onClick={() => setPasswordChangeUser(user)}
                                                        className="p-2 hover:bg-amber-100 dark:hover:bg-amber-900/30 rounded-lg transition-colors"
                                                        title="Set password"
                                                    >
                                                        <KeyRound size={16} className="text-amber-600 dark:text-amber-400" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setEditingUser(user)}
                                                    className="p-2 hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover rounded-lg transition-colors"
                                                    title="Edit"
                                                >
                                                    <Edit size={16} className="text-sap-text-secondary dark:text-sap-textDark-secondary" />
                                                </button>
                                                <button
                                                    onClick={() => handleToggleStatus(user)}
                                                    className={`p-2 rounded-lg transition-colors ${
                                                        user.isActive !== false
                                                            ? 'hover:bg-red-100 dark:hover:bg-red-900/30'
                                                            : 'hover:bg-green-100 dark:hover:bg-green-900/30'
                                                    }`}
                                                    title={user.isActive !== false ? 'Deactivate' : 'Activate'}
                                                >
                                                    {user.isActive !== false ? (
                                                        <XCircle size={16} className="text-red-500" />
                                                    ) : (
                                                        <CheckCircle size={16} className="text-green-500" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => setShowDeleteModal(user)}
                                                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                    title="Delete permanently"
                                                >
                                                    <Trash2 size={16} className="text-red-500" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>

                    {filteredUsers.length === 0 && (
                        <div className="text-center py-12">
                            <Users className="mx-auto text-sap-text-secondary dark:text-sap-textDark-secondary mb-4" size={48} />
                            <p className="text-sap-text-secondary dark:text-sap-textDark-secondary">
                                No users found
                            </p>
                        </div>
                    )}
            </div>

            <AnimatePresence>
                {showAddUserModal && scopedFranchise && (
                    <FranchiseAddUserModal
                        db={db}
                        auth={getAuth()}
                        franchise={scopedFranchise}
                        actorProfile={userProfile}
                        functionsApp={functionsApp}
                        onClose={() => setShowAddUserModal(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isPlatformAdmin && showPlatformAddUser && (
                    <PlatformUserScopeModal
                        mode="create"
                        functionsApp={functionsApp}
                        franchises={franchises}
                        userProfile={userProfile}
                        onClose={() => setShowPlatformAddUser(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Edit User Modal */}
            <AnimatePresence>
                {editingUser && isPlatformAdmin && (
                    <PlatformUserScopeModal
                        mode="edit"
                        functionsApp={functionsApp}
                        franchises={franchises}
                        userProfile={userProfile}
                        target={editingUser}
                        onClose={() => setEditingUser(null)}
                        toast={toast}
                    />
                )}
                {editingUser && !isPlatformAdmin && (
                    <EditUserModal
                        db={db}
                        user={editingUser}
                        franchises={franchises}
                        userProfile={userProfile}
                        assignableRoles={assignableRoles}
                        lockFranchiseId={franchiseScope}
                        onClose={() => setEditingUser(null)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Convert Modal */}
            <AnimatePresence>
                {showConvertModal && (
                    <ConvertModal
                        user={showConvertModal}
                        onConfirm={() => handleConvertToRegular(showConvertModal)}
                        onClose={() => setShowConvertModal(null)}
                    />
                )}
            </AnimatePresence>

            {/* Delete Confirmation Modal */}
            <AnimatePresence>
                {showDeleteModal && (
                    <DeleteUserModal
                        user={showDeleteModal}
                        onConfirm={() => handleDeleteUser(showDeleteModal)}
                        onClose={() => setShowDeleteModal(null)}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {isPlatformAdmin && passwordChangeUser && (
                    <AdminSetPasswordModal
                        user={passwordChangeUser}
                        functionsApp={functionsApp}
                        onClose={() => setPasswordChangeUser(null)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function generateSecureTempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    let core = '';
    for (let i = 0; i < 12; i += 1) {
        core += chars[Math.floor(Math.random() * chars.length)];
    }
    return `${core}!Aa1`;
}

function AdminSetPasswordModal({ user, functionsApp, onClose, toast }) {
    const targetScope = resolveRoleScope(user);
    const isTargetGlobal =
        normalizeRoleKey(user?.role) === 'globaladmin' || targetScope.level === 'global';
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [confirmGlobal, setConfirmGlobal] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [saving, setSaving] = useState(false);

    const handleGenerate = () => {
        const p = generateSecureTempPassword();
        setNewPassword(p);
        setConfirmPassword(p);
        setShowPassword(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!functionsApp) {
            toast.error('Functions client unavailable');
            return;
        }
        if (newPassword.length < 8) {
            toast.error('Password must be at least 8 characters');
            return;
        }
        if (newPassword !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }
        if (isTargetGlobal && !confirmGlobal) {
            toast.error('Confirm password change for this global admin');
            return;
        }
        setSaving(true);
        try {
            const fn = httpsCallable(functionsApp, 'adminSetUserPassword');
            await fn({
                uid: user.id,
                newPassword,
                confirmGlobalAdminPasswordChange: isTargetGlobal,
            });
            toast.success(`Password updated for ${user.email || user.id}`);
            onClose();
        } catch (error) {
            console.error('[AdminSetPasswordModal]', error);
            const msg = String(error?.message || '');
            if (msg.includes('confirmGlobalAdminPasswordChange')) {
                toast.error('Global admin accounts require explicit confirmation');
            } else {
                toast.error(error?.message || 'Failed to update password');
            }
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
                className="pal-dash-panel shadow-xl max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary flex items-center gap-2">
                        <KeyRound size={20} className="text-amber-600" />
                        Set password
                    </h2>
                    <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mt-1">
                        {user?.email}
                    </p>
                    <p className="text-xs text-sap-text-tertiary mt-2 leading-relaxed">
                        Global admin action. The new password applies immediately on web and iOS (same Firebase account).
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm font-medium">New password</label>
                            <button
                                type="button"
                                onClick={handleGenerate}
                                className="text-xs font-medium text-[#635BFF] hover:underline"
                            >
                                Generate secure password
                            </button>
                        </div>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                            className="gm-field font-mono text-sm"
                            placeholder="Min. 8 characters"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2">Confirm password</label>
                        <input
                            type={showPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                            minLength={8}
                            autoComplete="new-password"
                            className="gm-field font-mono text-sm"
                        />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-sap-text-secondary">
                        <input
                            type="checkbox"
                            checked={showPassword}
                            onChange={(e) => setShowPassword(e.target.checked)}
                        />
                        Show password
                    </label>

                    {isTargetGlobal && (
                        <label className="flex items-start gap-2 text-sm p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                            <input
                                type="checkbox"
                                checked={confirmGlobal}
                                onChange={(e) => setConfirmGlobal(e.target.checked)}
                            />
                            <span className="text-red-700 dark:text-red-300">
                                I confirm changing the password for this global admin account.
                            </span>
                        </label>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button type="button" onClick={onClose} className="flex-1 pal-btn">
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 pal-btn pal-btn-primary"
                        >
                            {saving ? 'Updating…' : 'Update password'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

// Edit User Modal
const ROLE_LABELS = {
    globaladmin: 'Global Admin',
    admin: 'Admin',
    manager: 'Manager',
    staff: 'Staff',
    shuttle: 'Shuttle',
    viewer: 'Viewer',
    garage: 'Garage',
};

function EditUserModal({ db, user, userProfile, franchises, assignableRoles = [], lockFranchiseId = null, onClose, toast }) {
    const primaryFid = String(user?.franchiseId || '').toUpperCase();
    const initialScopeRaw = String(user?.scopeLevel || 'single').toLowerCase();
    const initialScope =
        initialScopeRaw === 'country_all'
            ? 'country_all'
            : initialScopeRaw === 'selected'
              ? 'selected'
              : 'single';
    const memFromUser =
        user?.franchiseMemberships && typeof user.franchiseMemberships === 'object'
            ? new Set(
                  Object.keys(user.franchiseMemberships)
                      .filter((k) => user.franchiseMemberships[k] === true)
                      .map((k) => String(k).trim().toUpperCase())
                      .filter(Boolean)
              )
            : new Set(primaryFid ? [primaryFid] : []);

    const [formData, setFormData] = useState({
        firstName: user?.firstName || '',
        lastName: user?.lastName || '',
        username: profileDisplayHandle(user),
        role: user?.role || 'staff',
        franchiseId: user?.franchiseId || '',
        isActive: user?.isActive ?? true,
        isDemo: user?.isDemo ?? false,
        scopeLevel: initialScope,
        /** Must match `garageServiceJobs.targetGarageId` (ServisFirma UUID on iOS). */
        serviceCompanyId: String(user?.garageId || user?.linkedGarageId || '').trim(),
    });
    const [peerFranchises, setPeerFranchises] = useState([]);
    const [membershipIds, setMembershipIds] = useState(memFromUser);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const cc = String(user?.countryCode || 'CH').trim();
        let cancelled = false;
        (async () => {
            try {
                const qy = query(collection(db, 'franchises'), where('countryCode', '==', cc));
                const snap = await getDocs(qy);
                if (cancelled) return;
                const rows = snap.docs
                    .map((d) => ({ id: d.id, ...d.data() }))
                    .filter((f) => f.isActive !== false);
                setPeerFranchises(rows);
            } catch {
                if (!cancelled) setPeerFranchises([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.countryCode, db]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canAssignRole(userProfile, formData.role)) {
            const allowed = assignableRoles.map((r) => ROLE_LABELS[r] || r).join(', ');
            toast.error(`You cannot assign this role. Allowed: ${allowed}`);
            return;
        }
        setSaving(true);

        try {
            let countryCode = user?.countryCode || 'CH';
            if (formData.franchiseId !== user?.franchiseId) {
                const franchise = franchises.find(
                    (f) => f.franchiseId === formData.franchiseId || f.id === formData.franchiseId
                );
                if (franchise?.countryCode) {
                    countryCode = franchise.countryCode;
                } else {
                    const country = EUROPEAN_COUNTRIES.find((c) => c.id === formData.franchiseId);
                    if (country) countryCode = country.countryCode;
                }
            }

            const usernameParts = buildProfileUsernameSaveParts(formData.username, formData.firstName);

            const scopeLevel = String(formData.scopeLevel || 'single').toLowerCase();
            let franchiseMembershipsUpdate = {};
            if (scopeLevel === 'selected') {
                const map = {};
                membershipIds.forEach((id) => {
                    const k = String(id || '').trim().toUpperCase();
                    if (k) map[k] = true;
                });
                if (Object.keys(map).length === 0 && primaryFid) {
                    map[primaryFid] = true;
                }
                franchiseMembershipsUpdate.franchiseMemberships = map;
            } else {
                franchiseMembershipsUpdate.franchiseMemberships = deleteField();
            }

            const scopeStored =
                scopeLevel === 'country_all' ? 'country_all' : scopeLevel === 'selected' ? 'selected' : 'single';

            const updates = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                nickname: deleteField(),
                role: formData.role,
                franchiseId: formData.franchiseId,
                defaultFranchiseId: String(formData.franchiseId || primaryFid || '').toUpperCase(),
                countryCode,
                scopeLevel: scopeStored,
                isActive: formData.isActive,
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'unknown',
                ...franchiseMembershipsUpdate,
            };

            if (usernameParts.clearAll) {
                updates.username = deleteField();
                updates.usernameNormalized = deleteField();
            } else {
                updates.username = usernameParts.username;
                updates.usernameNormalized = usernameParts.usernameNormalized
                    ? usernameParts.usernameNormalized
                    : deleteField();
            }

            if (user.isDemo && !formData.isDemo) {
                updates.isDemo = false;
                updates.isDemoAccount = false;
                updates.demoExpiresAt = null;
                updates.convertedFromDemo = true;
                updates.convertedAt = Timestamp.now();
            }

            const sid = String(formData.serviceCompanyId || '').trim();
            if (formData.role === 'garage') {
                if (!sid) {
                    toast.error('Service company ID (UUID) is required for Garage role');
                    setSaving(false);
                    return;
                }
                updates.garageId = sid;
                updates.linkedGarageId = sid;
            } else {
                updates.garageId = deleteField();
                updates.linkedGarageId = deleteField();
            }

            await updateDoc(doc(db, 'users', user.id), updates);
            toast.success('User updated successfully');
            onClose();
        } catch (error) {
            console.error('Error updating user:', error);
            toast.error('Failed to update user');
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
                className="pal-dash-panel shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                        Edit User
                    </h2>
                    <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mt-1">
                        {user?.email}
                    </p>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                First Name
                            </label>
                            <input
                                type="text"
                                value={formData.firstName}
                                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                Last Name
                            </label>
                            <input
                                type="text"
                                value={formData.lastName}
                                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Username
                        </label>
                        <input
                            type="text"
                            value={formData.username}
                            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            placeholder="Shown in the app; defaults to first name if left empty"
                            autoComplete="off"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Franchise access
                        </label>
                        <select
                            value={formData.scopeLevel}
                            onChange={(e) => {
                                const v = e.target.value;
                                setFormData({ ...formData, scopeLevel: v });
                                if (v === 'single') {
                                    setMembershipIds(new Set(primaryFid ? [primaryFid] : []));
                                }
                            }}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                        >
                            <option value="single">Primary franchise only</option>
                            <option value="selected">Selected franchises (same country)</option>
                            <option value="country_all">All franchises in country</option>
                        </select>
                    </div>

                    {formData.scopeLevel === 'selected' && (
                        <div className="max-h-36 overflow-y-auto border border-sap-border-light dark:border-sap-borderDark-light rounded-lg p-2 space-y-1">
                            {peerFranchises.map((f) => {
                                const fid = String(f.franchiseId || f.id || '').toUpperCase();
                                if (!fid) return null;
                                return (
                                    <label key={fid} className="flex items-center gap-2 text-sm px-1 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={membershipIds.has(fid)}
                                            onChange={() => {
                                                setMembershipIds((prev) => {
                                                    const next = new Set(prev);
                                                    if (next.has(fid)) next.delete(fid);
                                                    else next.add(fid);
                                                    if (primaryFid && next.size === 0) next.add(primaryFid);
                                                    return next;
                                                });
                                            }}
                                            className="rounded text-sap-blue-500"
                                        />
                                        <span>{f.country || f.name || fid}</span>
                                        <span className="text-xs text-sap-text-secondary">({fid})</span>
                                    </label>
                                );
                            })}
                        </div>
                    )}

                    {!lockFranchiseId && (
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                Franchise
                            </label>
                            <select
                                value={formData.franchiseId}
                                onChange={(e) => setFormData({ ...formData, franchiseId: e.target.value })}
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            >
                                <option value="">Select franchise...</option>
                                {franchises.map((f) => (
                                    <option key={f.id} value={f.franchiseId || f.id}>
                                        {f.flag} {f.country}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Role
                        </label>
                        <select
                            value={formData.role}
                            onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                        >
                            {assignableRoles.map((r) => (
                                <option key={r} value={r}>
                                    {ROLE_LABELS[r] || r}
                                </option>
                            ))}
                            {!assignableRoles.includes(normalizeRoleKey(formData.role)) && formData.role && (
                                <option value={formData.role}>{ROLE_LABELS[normalizeRoleKey(formData.role)] || formData.role}</option>
                            )}
                        </select>
                    </div>

                    {formData.role === 'garage' && (
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                Service company ID (UUID)
                            </label>
                            <input
                                type="text"
                                value={formData.serviceCompanyId}
                                onChange={(e) => setFormData({ ...formData, serviceCompanyId: e.target.value })}
                                placeholder="Same UUID as iOS ServisFirma / job targetGarageId"
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500 font-mono text-sm"
                            />
                            <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary mt-1">
                                Garage portal and iOS show only jobs where <code className="text-xs">targetGarageId</code>{' '}
                                matches this value.
                            </p>
                        </div>
                    )}

                    <div className="flex items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={formData.isActive}
                                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                                className="rounded text-sap-blue-500"
                            />
                            <span className="text-sm text-sap-text-primary dark:text-sap-textDark-primary">Active</span>
                        </label>
                    </div>

                    {user?.isDemo && (
                        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <input
                                type="checkbox"
                                id="convertToRegular"
                                checked={!formData.isDemo}
                                onChange={(e) => setFormData({ ...formData, isDemo: !e.target.checked })}
                                className="rounded text-green-500"
                            />
                            <label htmlFor="convertToRegular" className="text-sm text-green-700 dark:text-green-400">
                                Convert to Regular (remove demo expiration)
                            </label>
                        </div>
                    )}

                    {/* Audit Info */}
                    <div className="pt-4 border-t border-sap-border-light dark:border-sap-borderDark-light text-sm text-sap-text-secondary dark:text-sap-textDark-secondary space-y-1">
                        <p>Created: {safeFormatDate(user?.createdAt, true)} {user?.createdBy && `by ${user.createdBy}`}</p>
                        <p>Updated: {safeFormatDate(user?.updatedAt, true)} {user?.updatedBy && `by ${user.updatedBy}`}</p>
                        {(user?.lastLogin || user?.lastLoginAt) && (
                            <p className="text-green-600 dark:text-green-400">
                                Last Login: {safeFormatDate(user?.lastLogin || user?.lastLoginAt, true)}
                            </p>
                        )}
                    </div>

                    <div className="flex gap-3 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg text-sap-text-primary dark:text-sap-textDark-primary hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 px-4 py-2 bg-sap-blue-500 text-white rounded-lg hover:bg-sap-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {saving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

// Convert Modal
function ConvertModal({ user, onConfirm, onClose }) {
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
                className="pal-dash-panel shadow-xl max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary mb-4">
                        Convert Demo to Regular
                    </h2>
                    
                    <p className="text-sap-text-secondary dark:text-sap-textDark-secondary mb-4">
                        Are you sure you want to convert <strong>{user?.email}</strong> from demo to regular account?
                    </p>
                    
                    <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mb-6">
                        This will remove the demo expiration date and the user will have permanent access.
                    </p>

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg text-sap-text-primary dark:text-sap-textDark-primary hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={onConfirm}
                            className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                        >
                            Convert
                        </button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

// Delete User Confirmation Modal
function DeleteUserModal({ user, onConfirm, onClose }) {
    const [confirmText, setConfirmText] = useState('');
    const [deleting, setDeleting] = useState(false);

    const handleDelete = async () => {
        setDeleting(true);
        await onConfirm();
        setDeleting(false);
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
                className="pal-dash-panel shadow-xl max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-4">
                        <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-full">
                            <AlertTriangle className="text-red-600 dark:text-red-400" size={24} />
                        </div>
                        <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                            Delete User Permanently
                        </h2>
                    </div>
                    
                    <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                        <p className="text-sm text-red-800 dark:text-red-200 font-medium mb-2">
                            This action cannot be undone!
                        </p>
                        <p className="text-sm text-red-700 dark:text-red-300">
                            The following user will be permanently deleted from the database:
                        </p>
                        <div className="mt-3 p-3 pal-dash-panel">
                            <p className="font-medium text-sap-text-primary dark:text-sap-textDark-primary">{user?.email}</p>
                            {(user?.firstName || user?.lastName) && (
                                <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                                    {user?.firstName} {user?.lastName}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Type <span className="font-bold text-red-600 dark:text-red-400">DELETE</span> to confirm:
                        </label>
                        <input
                            type="text"
                            value={confirmText}
                            onChange={(e) => setConfirmText(e.target.value)}
                            placeholder="DELETE"
                            className="w-full px-4 py-2 border border-red-300 dark:border-red-700 rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        />
                    </div>

                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg text-sap-text-primary dark:text-sap-textDark-primary hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleDelete}
                            disabled={confirmText !== 'DELETE' || deleting}
                            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                        >
                            <Trash2 size={16} />
                            {deleting ? 'Deleting...' : 'Delete User'}
                        </button>
                    </div>
                </div>
            </motion.div>
        </motion.div>
    );
}

/** Chip list rendering the resolved roleScope (or legacy fallback). */
function UserFranchiseChips({ user, franchises, fallbackInfo }) {
    const scope = resolveRoleScope(user);
    const upperFranchiseMap = useMemo(() => {
        const map = new Map();
        for (const f of franchises) {
            const fid = String(f.franchiseId || f.id || '').toUpperCase();
            if (fid) map.set(fid, f);
        }
        return map;
    }, [franchises]);

    if (scope.level === 'global') {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                <Globe size={12} />
                All countries (global)
            </span>
        );
    }
    if (scope.level === 'country' && scope.franchiseIds.length === 0) {
        const cc = (scope.countryCode || user.countryCode || '').toUpperCase() || '—';
        return (
            <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                <Globe size={12} />
                All in {cc}
            </span>
        );
    }
    const ids = scope.franchiseIds.length
        ? scope.franchiseIds
        : (user.franchiseId ? [String(user.franchiseId).toUpperCase()] : []);
    if (!ids.length) {
        return (
            <span className="flex items-center gap-2 text-sm text-sap-text-secondary">
                <span>{fallbackInfo?.flag}</span>
                <span>{fallbackInfo?.country || '—'}</span>
            </span>
        );
    }
    return (
        <div className="flex flex-wrap gap-1 max-w-[260px]">
            {ids.slice(0, 6).map((fid) => {
                const f = upperFranchiseMap.get(fid);
                const label = (f && (f.country || f.name)) || fid;
                const flag = f?.flag || '🏳️';
                return (
                    <span
                        key={fid}
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        title={fid}
                    >
                        <span>{flag}</span>
                        <span className="truncate max-w-[110px]">{label}</span>
                    </span>
                );
            })}
            {ids.length > 6 && (
                <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                    +{ids.length - 6}
                </span>
            )}
        </div>
    );
}

function UserWelcomeOnboardingInfo() {
    return (
        <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-2">
            <p className="text-sm font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                Automatic onboarding email
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary leading-relaxed">
                <li>
                    A secure <strong>temporary password</strong> is generated for you — you do not choose or type a password.
                </li>
                <li>
                    The user receives an email with their sign-in address, temporary password, and a green{' '}
                    <strong>Set your password</strong> button (secure one-time link).
                </li>
                <li>
                    They can sign in right away or set their own password via that button — or use{' '}
                    <em>Forgot password</em> on the login page later.
                </li>
                <li>
                    If the email cannot be delivered, the account is <strong>not</strong> created (nothing is left half-finished).
                </li>
            </ul>
        </div>
    );
}

function formatUserCreateError(error) {
    const code = String(error?.code || '');
    const msg = String(error?.message || '').toLowerCase();
    if (code.includes('welcome_email_failed') || msg.includes('welcome_email_failed')) {
        return 'Account was not created — the welcome email could not be sent. Check Mail Center → SMTP settings, then try again.';
    }
    if (code.includes('already-exists') || msg.includes('already exists')) {
        return 'A user with this email already exists.';
    }
    return error?.message || 'Operation failed';
}

/**
 * Platform-admin scope-aware user create/edit modal.
 * Drives `adminCreateUserWithScope` / `adminUpdateUserScope` callables.
 */
function PlatformUserScopeModal({ mode, functionsApp, franchises, userProfile, target = null, onClose, toast }) {
    const isEdit = mode === 'edit';
    const initialScope = useMemo(() => resolveRoleScope(target || {}), [target]);
    const assignableRoles = assignableRolesForActor(userProfile).filter(
        (r) => !['superadmin'].includes(r)
    );
    const initialRole = (() => {
        const r = normalizeRoleKey(target?.role || 'staff');
        if (assignableRoles.includes(r)) return r;
        return assignableRoles[0] || 'staff';
    })();

    const initialPickerScope = (() => {
        if (initialScope.level === 'global') return 'country_all';
        if (initialScope.level === 'country' && initialScope.franchiseIds.length === 0) return 'country_all';
        if (initialScope.level === 'country') return 'selected';
        if (initialScope.franchiseIds.length > 1) return 'selected';
        return 'single';
    })();

    const [email, setEmail] = useState(target?.email || '');
    const [displayName, setDisplayName] = useState(
        target?.displayName ||
        [target?.firstName, target?.lastName].filter(Boolean).join(' ').trim() ||
        ''
    );
    const [role, setRole] = useState(initialRole);
    const [scopeKind, setScopeKind] = useState(initialPickerScope); // country_all | selected | single
    const [countryCode, setCountryCode] = useState(
        (initialScope.countryCode || target?.countryCode || 'CH').toUpperCase()
    );
    const [selectedFids, setSelectedFids] = useState(() => new Set(
        (initialScope.franchiseIds || []).map((x) => String(x).toUpperCase())
    ));
    const [singleFid, setSingleFid] = useState(
        (initialScope.franchiseIds[0] || target?.franchiseId || '').toUpperCase()
    );
    const [isGlobalCheckbox, setIsGlobalCheckbox] = useState(initialScope.level === 'global');
    const [confirmGlobalDowngrade, setConfirmGlobalDowngrade] = useState(false);
    const [saving, setSaving] = useState(false);

    const distinctCountryCodes = useMemo(() => {
        const set = new Set();
        for (const f of franchises) {
            const cc = String(f.countryCode || '').trim().toUpperCase();
            if (cc) set.add(cc);
        }
        return Array.from(set).sort();
    }, [franchises]);

    const franchisesInCountry = useMemo(() => {
        return franchises.filter(
            (f) => String(f.countryCode || '').toUpperCase() === countryCode
        );
    }, [franchises, countryCode]);

    const buildScopePayload = () => {
        if (isGlobalCheckbox) {
            return { level: 'global', countryCode: '', franchiseIds: [] };
        }
        if (scopeKind === 'country_all') {
            return { level: 'country', countryCode, franchiseIds: [] };
        }
        if (scopeKind === 'selected') {
            return {
                level: 'country',
                countryCode,
                franchiseIds: Array.from(selectedFids).map((x) => x.toUpperCase()),
            };
        }
        // single
        return {
            level: 'franchise',
            countryCode,
            franchiseIds: singleFid ? [singleFid.toUpperCase()] : [],
        };
    };

    const validate = () => {
        const scope = buildScopePayload();
        if (!isEdit && !email) return 'Email is required';
        if (!isGlobalCheckbox) {
            if (!countryCode || countryCode.length < 2) return 'Select a country';
            if (scope.level === 'franchise' && !scope.franchiseIds.length) {
                return 'Pick a franchise for level=franchise';
            }
            if (scope.level === 'country' && scopeKind === 'selected' && !scope.franchiseIds.length) {
                return 'Pick at least one franchise';
            }
        }
        return null;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const err = validate();
        if (err) {
            toast.error(err);
            return;
        }
        if (!functionsApp) {
            toast.error('Functions client unavailable');
            return;
        }
        setSaving(true);
        try {
            const scope = buildScopePayload();
            if (isEdit) {
                const wasGlobal = initialScope.level === 'global';
                const becomesGlobal = scope.level === 'global';
                if (wasGlobal && !becomesGlobal && !confirmGlobalDowngrade) {
                    toast.error('Target is a global admin — tick the downgrade confirmation.');
                    setSaving(false);
                    return;
                }
                const fn = httpsCallable(functionsApp, 'adminUpdateUserScope');
                await fn({
                    uid: target.id,
                    role,
                    roleScope: scope,
                    displayName: displayName || undefined,
                    confirmGlobalAdminDowngrade: wasGlobal && !becomesGlobal,
                });
                toast.success('User scope updated');
            } else {
                const fn = httpsCallable(functionsApp, 'adminCreateUserWithScope');
                await fn({
                    email,
                    displayName: displayName || undefined,
                    role,
                    roleScope: scope,
                });
                toast.success(`User created. Login details emailed to ${email}`);
            }
            onClose();
        } catch (error) {
            console.error('[PlatformUserScopeModal] submit', error);
            toast.error(formatUserCreateError(error));
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
                className="pal-dash-panel shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                        {isEdit ? 'Edit user (scope + role)' : 'Add user with scope'}
                    </h2>
                    <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mt-1">
                        Platform admin · uses cloud function {isEdit ? 'adminUpdateUserScope' : 'adminCreateUserWithScope'}.
                    </p>
                    {isEdit && target?.email && (
                        <p className="text-xs text-sap-text-tertiary mt-2">{target.email}</p>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {!isEdit && (
                        <div>
                            <label className="block text-sm font-medium mb-2">Email *</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="gm-field"
                            />
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium mb-2">Display name</label>
                        <input
                            type="text"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            placeholder="First Last"
                            className="gm-field"
                        />
                    </div>

                    {!isEdit && <UserWelcomeOnboardingInfo />}

                    <div>
                        <label className="block text-sm font-medium mb-2">Role</label>
                        <select
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            className="gm-field"
                        >
                            {assignableRoles.map((r) => (
                                <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                            ))}
                        </select>
                    </div>

                    <div className="rounded-lg border border-sap-border-light dark:border-sap-borderDark-light p-3 space-y-3">
                        <label className="flex items-center gap-2 text-sm font-medium">
                            <input
                                type="checkbox"
                                checked={isGlobalCheckbox}
                                onChange={(e) => setIsGlobalCheckbox(e.target.checked)}
                            />
                            <Globe size={14} />
                            Global admin (all countries · bypass)
                        </label>

                        {!isGlobalCheckbox && (
                            <>
                                <div>
                                    <label className="block text-sm font-medium mb-1">Country</label>
                                    <select
                                        value={countryCode}
                                        onChange={(e) => {
                                            const cc = e.target.value;
                                            setCountryCode(cc);
                                            // Clear selections that no longer match.
                                            setSelectedFids(new Set());
                                            setSingleFid('');
                                        }}
                                        className="gm-field"
                                    >
                                        {distinctCountryCodes.map((cc) => (
                                            <option key={cc} value={cc}>{cc}</option>
                                        ))}
                                    </select>
                                </div>

                                <fieldset className="space-y-1 text-sm">
                                    <legend className="font-medium mb-1">Scope</legend>
                                    {['country_all', 'selected', 'single'].map((k) => (
                                        <label key={k} className="flex items-center gap-2 cursor-pointer">
                                            <input
                                                type="radio"
                                                name="scopeKind"
                                                value={k}
                                                checked={scopeKind === k}
                                                onChange={() => setScopeKind(k)}
                                            />
                                            {k === 'country_all' && <span>All franchises in country</span>}
                                            {k === 'selected' && <span>Selected franchises</span>}
                                            {k === 'single' && <span>Single franchise</span>}
                                        </label>
                                    ))}
                                </fieldset>

                                {scopeKind === 'selected' && (
                                    <div className="max-h-44 overflow-y-auto border rounded-lg p-2 space-y-1">
                                        {franchisesInCountry.length === 0 && (
                                            <p className="text-xs text-amber-600">
                                                No franchises found for {countryCode}.
                                            </p>
                                        )}
                                        {franchisesInCountry.map((f) => {
                                            const fid = String(f.franchiseId || f.id || '').toUpperCase();
                                            if (!fid) return null;
                                            return (
                                                <label key={fid} className="flex items-center gap-2 text-sm">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedFids.has(fid)}
                                                        onChange={() => {
                                                            setSelectedFids((prev) => {
                                                                const next = new Set(prev);
                                                                if (next.has(fid)) next.delete(fid);
                                                                else next.add(fid);
                                                                return next;
                                                            });
                                                        }}
                                                    />
                                                    <span>{f.flag} {f.country || f.name || fid}</span>
                                                    <span className="text-xs text-sap-text-secondary">({fid})</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}

                                {scopeKind === 'single' && (
                                    <div>
                                        <label className="block text-sm font-medium mb-1">Franchise</label>
                                        <select
                                            value={singleFid}
                                            onChange={(e) => setSingleFid(e.target.value)}
                                            className="gm-field"
                                        >
                                            <option value="">Select…</option>
                                            {franchisesInCountry.map((f) => {
                                                const fid = String(f.franchiseId || f.id || '').toUpperCase();
                                                if (!fid) return null;
                                                return (
                                                    <option key={fid} value={fid}>
                                                        {f.flag} {f.country || f.name || fid} ({fid})
                                                    </option>
                                                );
                                            })}
                                        </select>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {isEdit && initialScope.level === 'global' && !isGlobalCheckbox && (
                        <label className="flex items-start gap-2 text-sm p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                            <input
                                type="checkbox"
                                checked={confirmGlobalDowngrade}
                                onChange={(e) => setConfirmGlobalDowngrade(e.target.checked)}
                            />
                            <span className="text-red-700 dark:text-red-300">
                                I confirm downgrading this global admin to a scoped role.
                            </span>
                        </label>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 pal-btn"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={saving}
                            className="flex-1 pal-btn pal-btn-primary"
                        >
                            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

// Silence unused-imports for legacy helpers retained for future use.
const _legacyScopeUnused = legacyScopeLevelFromScope;
const _franchiseListUnused = userFranchiseIdList;
void _legacyScopeUnused;
void _franchiseListUnused;
void Building; // icon kept for future use in chip column tooltip

export default AdminUserManagementView;
