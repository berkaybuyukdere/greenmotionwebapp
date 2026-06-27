import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
    ArrowLeft, Users, Plus, Edit, Trash2, UserPlus,
    CheckCircle, Clock, Mail, Shield, Search,
    AlertTriangle
} from 'lucide-react';
import { collection, setDoc, updateDoc, doc, Timestamp, onSnapshot, query, where, increment, getDocs, deleteField } from 'firebase/firestore';
import { getAuth, createUserWithEmailAndPassword, deleteUser } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useToast } from './ToastNotification';
import { SUBSCRIPTION_PLANS, EUROPEAN_COUNTRIES } from './AdminFranchiseDashboard';
import { ISO_CURRENCY_OPTIONS } from '../franchiseCountryDefaults';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';
import {
    buildProfileUsernameSaveParts,
    profileDisplayHandle,
    assignableRolesForActor,
    canAssignRole,
    normalizeRoleKey,
} from '../utilities/userAccess';
import { franchiseReadinessChecks } from '../utilities/franchiseCapabilities';

// Firebase config for secondary app (to create users without signing them in)
const firebaseConfig = {
    apiKey: "AIzaSyDKL5-CYr9UN7PmZQqk3sL_AZg5SdlXF2g",
    authDomain: "greenmotionapp-33413.firebaseapp.com",
    projectId: "greenmotionapp-33413",
    storageBucket: "greenmotionapp-33413.appspot.com",
    messagingSenderId: "1072954710498",
    appId: "1:1072954710498:web:5f8cbb4bdd5e62e31fb72b"
};

export function AdminFranchiseDetailView({ db, franchise, onBack, functionsApp, userProfile = null }) {
    const toast = useToast();
    const auth = getAuth();
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddUserModal, setShowAddUserModal] = useState(false);
    const [showAssignUserModal, setShowAssignUserModal] = useState(false);
    const [showEditFranchiseModal, setShowEditFranchiseModal] = useState(false);
    const [showConvertModal, setShowConvertModal] = useState(null);
    const [editingUser, setEditingUser] = useState(null);
    const [closingFranchise, setClosingFranchise] = useState(false);

    const readinessChecks = franchiseReadinessChecks({
        ...franchise,
        franchiseId: franchise?.franchiseId || franchise?.id,
        id: franchise?.id,
    });
    const branchReady = readinessChecks.every((c) => c.ok);

    // Load users for this franchise
    useEffect(() => {
        if (!franchise?.id) {
            setLoading(false);
            return;
        }

        const usersQuery = query(
            collection(db, 'users'),
            where('franchiseId', '==', franchise.franchiseId || franchise.id)
        );
        
        const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
            const userList = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            }));
            setUsers(userList);
            setLoading(false);

            // Auto-correct franchise currentUserCount if it doesn't match
            const activeCount = userList.filter(u => u.isActive !== false).length;
            if (franchise?.id && (franchise.currentUserCount || 0) !== activeCount) {
                updateDoc(doc(db, 'franchises', franchise.id), {
                    currentUserCount: activeCount,
                    updatedAt: Timestamp.now()
                }).catch(err => console.warn('Failed to sync user count:', err));
            }
        }, (error) => {
            console.error('Error loading users:', error);
            toast.error('Failed to load users: ' + error.message);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, franchise, toast]);

    // Calculate days remaining for demo
    const getDaysRemaining = (expiresAt) => {
        if (!expiresAt) return null;
        const expDate = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
        const now = new Date();
        const diffTime = expDate - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
    };

    // Format date
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    // Get plan info
    const planInfo = SUBSCRIPTION_PLANS.find(p => p.id === franchise?.subscriptionType) || SUBSCRIPTION_PLANS[0];
    const daysRemaining = franchise?.isDemo ? getDaysRemaining(franchise?.subscriptionEndDate) : null;
    const availableSlots = (franchise?.maxUsers || 0) - (franchise?.currentUserCount || 0);

    // Handle user deletion
    const handleDeleteUser = async (userId) => {
        if (!window.confirm('Are you sure you want to deactivate this user?')) return;

        try {
            await updateDoc(doc(db, 'users', userId), {
                isActive: false,
                updatedAt: Timestamp.now(),
                updatedBy: auth.currentUser?.email || 'unknown'
            });

            // Decrement franchise user count
            await updateDoc(doc(db, 'franchises', franchise.id), {
                currentUserCount: increment(-1),
                updatedAt: Timestamp.now()
            });

            toast.success('User deactivated successfully');
        } catch (error) {
            console.error('Error deactivating user:', error);
            toast.error('Failed to deactivate user');
        }
    };

    // Handle convert demo to regular
    const handleConvertToRegular = async (user) => {
        try {
            await updateDoc(doc(db, 'users', user.id), {
                isDemo: false,
                demoExpiresAt: null,
                convertedFromDemo: true,
                convertedAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
                updatedBy: auth.currentUser?.email || 'unknown'
            });

            toast.success(`User "${user.email}" converted to regular account`);
            setShowConvertModal(null);
        } catch (error) {
            console.error('Error converting user:', error);
            toast.error('Failed to convert user');
        }
    };

    const handleCloseFranchise = async () => {
        if (!functionsApp) {
            toast.error('Functions service is not available');
            return;
        }
        const fid = (franchise?.franchiseId || franchise?.id || '').toUpperCase();
        if (!fid) {
            toast.error('Invalid franchise id');
            return;
        }
        const confirmed = window.confirm(
            `Close franchise ${fid}?\n\nAll users in this franchise will be SOFT-deactivated:\n` +
                `• Auth accounts are disabled (not deleted).\n` +
                `• Firestore profiles are set isActive=false.\n` +
                `Existing data and Storage objects remain accessible to global admins.\n\n` +
                `To permanently remove a user, use the User Management view with explicit deletion.`
        );
        if (!confirmed) return;

        setClosingFranchise(true);
        try {
            const callable = httpsCallable(functionsApp, 'adminCloseFranchise');
            const res = await callable({ franchiseId: fid });
            const data = res?.data || {};
            toast.success(
                `Franchise ${fid} closed. Users deactivated: ${data.usersDeactivated ?? data.firestoreDeleted ?? 0}`
            );
        } catch (error) {
            console.error('Error closing franchise:', error);
            toast.error('Failed to close franchise: ' + (error.message || 'Unknown error'));
        } finally {
            setClosingFranchise(false);
        }
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
            {/* Header */}
            <div className="flex items-center gap-4 flex-wrap erpx-page-toolbar">
                <button
                    type="button"
                    onClick={onBack}
                    className="pal-btn !p-2"
                >
                    <ArrowLeft size={20} />
                </button>
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <span className="text-3xl">{franchise?.flag}</span>
                        <div>
                            <p className="text-lg font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                                {franchise?.name}
                            </p>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                                {franchise?.franchiseId || franchise?.id}
                            </p>
                        </div>
                    </div>
                </div>
                <button
                    type="button"
                    onClick={() => setShowEditFranchiseModal(true)}
                    className="pal-btn"
                >
                    <Edit size={18} />
                    Edit Franchise
                </button>
                <button
                    type="button"
                    onClick={handleCloseFranchise}
                    disabled={closingFranchise}
                    className="pal-btn pal-btn-danger"
                >
                    <Trash2 size={18} />
                    {closingFranchise ? 'Closing...' : 'Close Franchise (soft)'}
                </button>
            </div>

            {/* License Information Card */}
            <div className="pal-dash-panel">
                <div className="pal-dash-panel-header">
                    <h2 className="pal-dash-panel-title flex items-center gap-2">
                        <Shield size={18} />
                        License Information
                    </h2>
                </div>
                <div className="pal-dash-panel-body">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Subscription</p>
                            <p className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary">{planInfo.name}</p>
                        </div>
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Status</p>
                            <p className="font-semibold">
                                {!franchise?.isActive ? (
                                    <span className="text-gray-500">Inactive</span>
                                ) : franchise?.isDemo ? (
                                    <span className="text-yellow-600 dark:text-yellow-400">Demo</span>
                                ) : (
                                    <span className="text-green-600 dark:text-green-400">Production</span>
                                )}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Max Users</p>
                            <p className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary">{franchise?.maxUsers}</p>
                        </div>
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Current Users</p>
                            <p className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary">{franchise?.currentUserCount || 0}</p>
                        </div>
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Available Slots</p>
                            <p className={`font-semibold ${availableSlots > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {availableSlots}
                            </p>
                        </div>
                        {franchise?.isDemo && daysRemaining !== null && (
                            <div>
                                <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Demo Expires</p>
                                <p className={`font-semibold ${daysRemaining <= 7 ? 'text-red-600 dark:text-red-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                                    {daysRemaining} days remaining
                                </p>
                            </div>
                        )}
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Created</p>
                            <p className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary text-sm">
                                {formatDate(franchise?.createdAt)}
                            </p>
                        </div>
                        <div>
                            <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">Updated</p>
                            <p className="font-semibold text-sap-text-primary dark:text-sap-textDark-primary text-sm">
                                {formatDate(franchise?.updatedAt)}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pal-dash-panel">
                <div className="pal-dash-panel-header">
                    <h2 className="pal-dash-panel-title flex items-center gap-2">
                        <CheckCircle size={18} />
                        Branch readiness
                        <span className={`gm-badge ${branchReady ? 'gm-badge-success' : 'gm-badge-warning'}`}>
                            {branchReady ? 'Ready' : 'Review'}
                        </span>
                    </h2>
                </div>
                <div className="pal-dash-panel-body space-y-2">
                    {readinessChecks.map((check) => (
                        <div key={check.id} className="flex items-center gap-2 text-sm">
                            {check.ok ? (
                                <CheckCircle size={16} className="text-green-600 shrink-0" />
                            ) : (
                                <AlertTriangle size={16} className="text-amber-600 shrink-0" />
                            )}
                            <span>{check.label}</span>
                        </div>
                    ))}
                    <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary pt-2">
                        Customer return/checkout QR works for every active franchise ID (UK included). Scan a live QR from the iOS app to verify end-to-end.
                    </p>
                </div>
            </div>

            {/* Users Section */}
            <div className="pal-dash-panel">
                <div className="pal-dash-panel-header flex-wrap gap-3">
                    <h2 className="pal-dash-panel-title flex items-center gap-2">
                        <Users size={18} />
                        Users ({users.filter(u => u.isActive !== false).length}/{franchise?.maxUsers})
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                        {!franchise?.countryCode && (
                            <span className="gm-badge gm-badge-warning flex items-center gap-1">
                                <AlertTriangle size={14} />
                                Missing country code
                            </span>
                        )}
                        <button
                            type="button"
                            onClick={() => setShowAssignUserModal(true)}
                            disabled={availableSlots <= 0}
                            className="pal-btn"
                        >
                            <UserPlus size={18} />
                            Assign User
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowAddUserModal(true)}
                            disabled={availableSlots <= 0 || !franchise?.countryCode}
                            title={!franchise?.countryCode ? 'Franchise is missing countryCode - edit franchise first' : ''}
                            className="pal-btn pal-btn-primary"
                        >
                            <Plus size={18} />
                            Add User
                        </button>
                    </div>
                </div>

                {/* Users Table */}
                <div className="gm-table-wrap border-0 rounded-none">
                    <table className="gm-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Username</th>
                                <th>Role</th>
                                <th>Type</th>
                                <th>Created</th>
                                <th className="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.filter(u => u.isActive !== false).map((user) => {
                                const userDaysRemaining = user.isDemo ? getDaysRemaining(user.demoExpiresAt) : null;
                                
                                return (
                                    <tr key={user.id}>
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
                                                : `${user.firstName || ''} ${user.lastName || ''}`.trim()
                                            }
                                            {user.convertedFromDemo && (
                                                <span className="ml-2 text-xs text-green-600 dark:text-green-400">(Converted)</span>
                                            )}
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
                                                      ? 'Garage'
                                                      : (user.role || 'staff')}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {user.isDemo ? (
                                                <span className="gm-badge gm-badge-warning flex items-center gap-1 w-fit">
                                                    <Clock size={12} />
                                                    Demo {userDaysRemaining !== null && `(${userDaysRemaining}d)`}
                                                </span>
                                            ) : (
                                                <span className="gm-badge gm-badge-success flex items-center gap-1 w-fit">
                                                    <CheckCircle size={12} />
                                                    Regular
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                                            {formatDate(user.createdAt)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <div className="flex items-center justify-end gap-2">
                                                {user.isDemo && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setShowConvertModal(user)}
                                                        className="pal-btn pal-btn-primary pal-btn-sm"
                                                    >
                                                        Convert
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setEditingUser(user)}
                                                    className="pal-btn pal-btn-sm !p-2"
                                                >
                                                    <Edit size={16} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteUser(user.id)}
                                                    className="pal-btn pal-btn-danger pal-btn-sm !p-2"
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

                    {users.filter(u => u.isActive !== false).length === 0 && (
                        <div className="text-center py-12">
                            <Users className="mx-auto text-sap-text-secondary dark:text-sap-textDark-secondary mb-4" size={48} />
                            <p className="text-sap-text-secondary dark:text-sap-textDark-secondary">
                                No users in this franchise yet
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Assign User Modal */}
            <AnimatePresence>
                {showAssignUserModal && (
                    <AssignUserModal
                        db={db}
                        franchise={franchise}
                        currentUserIds={users.map(u => u.id)}
                        onClose={() => setShowAssignUserModal(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Add User Modal */}
            <AnimatePresence>
                {showAddUserModal && (
                    <AddUserModal
                        db={db}
                        auth={auth}
                        franchise={franchise}
                        actorProfile={userProfile}
                        functionsApp={functionsApp}
                        onClose={() => setShowAddUserModal(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Edit Franchise Modal */}
            <AnimatePresence>
                {showEditFranchiseModal && (
                    <EditFranchiseModal
                        db={db}
                        franchise={franchise}
                        onClose={() => setShowEditFranchiseModal(false)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Edit User Modal */}
            <AnimatePresence>
                {editingUser && (
                    <EditUserModal
                        db={db}
                        user={editingUser}
                        franchise={franchise}
                        actorProfile={userProfile}
                        onClose={() => setEditingUser(null)}
                        toast={toast}
                    />
                )}
            </AnimatePresence>

            {/* Convert to Regular Modal */}
            <AnimatePresence>
                {showConvertModal && (
                    <ConvertDemoModal
                        user={showConvertModal}
                        onConfirm={() => handleConvertToRegular(showConvertModal)}
                        onClose={() => setShowConvertModal(null)}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

// Assign Existing User Modal
function AssignUserModal({ db, franchise, currentUserIds, onClose, toast }) {
    const [allUsers, setAllUsers] = useState([]);
    const [allFranchises, setAllFranchises] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [assigning, setAssigning] = useState(null); // user id being assigned
    const [confirmUser, setConfirmUser] = useState(null); // user to confirm assignment

    useEffect(() => {
        const loadData = async () => {
            try {
                const [usersSnap, franchisesSnap] = await Promise.all([
                    getDocs(collection(db, 'users')),
                    getDocs(collection(db, 'franchises'))
                ]);
                const userList = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                const franchiseList = franchisesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
                setAllUsers(userList);
                setAllFranchises(franchiseList);
            } catch (error) {
                console.error('Error loading users:', error);
                toast.error('Failed to load users');
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [db, toast]);

    // Get franchise info for a user
    const getUserFranchise = (user) => {
        if (!user.franchiseId) return null;
        const f = allFranchises.find(fr => fr.franchiseId === user.franchiseId || fr.id === user.franchiseId);
        if (f) return f;
        const country = EUROPEAN_COUNTRIES.find(c => c.id === user.franchiseId);
        if (country) return { flag: country.flag, country: country.name };
        return { flag: '🌍', country: user.franchiseId };
    };

    // Filter users: exclude current franchise users, apply search
    const availableUsers = allUsers
        .filter(u => !currentUserIds.includes(u.id))
        .filter(u => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return u.email?.toLowerCase().includes(term) ||
                   u.firstName?.toLowerCase().includes(term) ||
                   u.lastName?.toLowerCase().includes(term);
        });

    const handleAssignUser = async (user) => {
        setAssigning(user.id);

        // Get target franchise country info
        const targetCountry = EUROPEAN_COUNTRIES.find(
            c => c.id === franchise.franchiseId || 
                 c.countryCode === franchise.countryCode ||
                 c.name === franchise.country
        );
        const newCountryCode = franchise.countryCode || targetCountry?.countryCode || 'CH';
        const oldFranchiseId = user.franchiseId;

        try {
            // Update user's franchiseId and countryCode
            await updateDoc(doc(db, 'users', user.id), {
                franchiseId: franchise.franchiseId || franchise.id,
                countryCode: newCountryCode,
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'admin@gmail.com'
            });

            // Increment new franchise user count
            await updateDoc(doc(db, 'franchises', franchise.id), {
                currentUserCount: increment(1),
                updatedAt: Timestamp.now()
            });

            // Decrement old franchise user count if applicable
            if (oldFranchiseId) {
                const oldFranchise = allFranchises.find(
                    f => f.franchiseId === oldFranchiseId || f.id === oldFranchiseId
                );
                if (oldFranchise) {
                    try {
                        await updateDoc(doc(db, 'franchises', oldFranchise.id), {
                            currentUserCount: increment(-1),
                            updatedAt: Timestamp.now()
                        });
                    } catch (e) {
                        console.warn('Failed to decrement old franchise count:', e);
                    }
                }
            }

            toast.success(`User "${user.email}" assigned to ${franchise.country}`);
            setConfirmUser(null);
            
            // Remove from available list
            setAllUsers(prev => prev.map(u => 
                u.id === user.id 
                    ? { ...u, franchiseId: franchise.franchiseId || franchise.id, countryCode: newCountryCode }
                    : u
            ));
        } catch (error) {
            console.error('Error assigning user:', error);
            toast.error('Failed to assign user: ' + error.message);
        } finally {
            setAssigning(null);
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
                className="pal-dash-panel shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary flex items-center gap-2">
                        <UserPlus size={20} />
                        Assign User to {franchise?.country}
                    </h2>
                    <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mt-1">
                        Select an existing user to assign to this franchise. Their country code will be updated for iOS login.
                    </p>
                </div>

                {/* Search */}
                <div className="px-6 pt-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-sap-text-secondary dark:text-sap-textDark-secondary" size={18} />
                        <input
                            type="text"
                            placeholder="Search by email or name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500 focus:border-transparent"
                        />
                    </div>
                </div>

                {/* User List */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sap-blue-500"></div>
                        </div>
                    ) : availableUsers.length === 0 ? (
                        <div className="text-center py-8">
                            <Users className="mx-auto text-sap-text-secondary dark:text-sap-textDark-secondary mb-3" size={40} />
                            <p className="text-sap-text-secondary dark:text-sap-textDark-secondary">
                                {searchTerm ? 'No matching users found' : 'No available users to assign'}
                            </p>
                        </div>
                    ) : (
                        availableUsers.map((user) => {
                            const userFranchise = getUserFranchise(user);
                            const isCurrentlyAssigning = assigning === user.id;
                            
                            return (
                                <div
                                    key={user.id}
                                    className="flex items-center justify-between p-3 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <Mail size={14} className="text-sap-text-secondary dark:text-sap-textDark-secondary flex-shrink-0" />
                                            <p className="text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary truncate">
                                                {user.email}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1">
                                            {(profileDisplayHandle(user) || (user.firstName || user.lastName)) && (
                                                <span className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                                                    {profileDisplayHandle(user)
                                                        ? profileDisplayHandle(user)
                                                        : `${user.firstName || ''} ${user.lastName || ''}`.trim()
                                                    }
                                                </span>
                                            )}
                                            {userFranchise && (
                                                <span className="text-xs text-sap-text-tertiary dark:text-sap-textDark-tertiary flex items-center gap-1">
                                                    {userFranchise.flag} {userFranchise.country}
                                                </span>
                                            )}
                                            {!userFranchise && (
                                                <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                                    Unassigned
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setConfirmUser(user)}
                                        disabled={isCurrentlyAssigning}
                                        className="ml-3 flex-shrink-0 px-3 py-1.5 text-sm bg-sap-blue-500 text-white rounded-lg hover:bg-sap-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {isCurrentlyAssigning ? 'Assigning...' : 'Assign'}
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-sap-border-light dark:border-sap-borderDark-light">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg text-sap-text-primary dark:text-sap-textDark-primary hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                    >
                        Close
                    </button>
                </div>

                {/* Confirmation Dialog */}
                <AnimatePresence>
                    {confirmUser && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl"
                            onClick={() => setConfirmUser(null)}
                        >
                            <motion.div
                                initial={{ scale: 0.95 }}
                                animate={{ scale: 1 }}
                                exit={{ scale: 0.95 }}
                                className="pal-dash-panel shadow-xl max-w-sm w-full mx-4 p-6"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="flex items-center gap-3 mb-4">
                                    <div className="p-2 bg-sap-blue-100 dark:bg-sap-blue-900/30 rounded-full">
                                        <UserPlus className="text-sap-blue-500" size={20} />
                                    </div>
                                    <h3 className="text-lg font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                                        Confirm Assignment
                                    </h3>
                                </div>
                                
                                <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary mb-2">
                                    Assign <strong className="text-sap-text-primary dark:text-sap-textDark-primary">{confirmUser.email}</strong> to:
                                </p>
                                <div className="p-3 bg-sap-bg-lightAlt dark:bg-sap-bgDark-dark rounded-lg mb-4">
                                    <p className="font-medium text-sap-text-primary dark:text-sap-textDark-primary flex items-center gap-2">
                                        <span className="text-xl">{franchise?.flag}</span>
                                        {franchise?.country} ({franchise?.countryCode})
                                    </p>
                                </div>

                                {confirmUser.franchiseId && (
                                    <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg mb-4">
                                        <p className="text-xs text-yellow-700 dark:text-yellow-300 flex items-center gap-1">
                                            <AlertTriangle size={14} />
                                            This user is currently assigned to another franchise. They will be moved.
                                        </p>
                                    </div>
                                )}

                                <p className="text-xs text-sap-text-tertiary dark:text-sap-textDark-tertiary mb-4">
                                    The user's country code will be updated to <strong>{franchise?.countryCode}</strong> for iOS login compatibility.
                                </p>

                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setConfirmUser(null)}
                                        className="flex-1 px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg text-sap-text-primary dark:text-sap-textDark-primary hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => handleAssignUser(confirmUser)}
                                        disabled={assigning === confirmUser.id}
                                        className="flex-1 px-4 py-2 bg-sap-blue-500 text-white rounded-lg hover:bg-sap-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                    >
                                        {assigning === confirmUser.id ? 'Assigning...' : 'Confirm'}
                                    </button>
                                </div>
                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </motion.div>
    );
}

// Add User Modal
const FRANCHISE_ROLE_LABELS = {
    globaladmin: 'Global Admin',
    admin: 'Admin',
    manager: 'Manager',
    staff: 'Staff',
    shuttle: 'Shuttle',
    viewer: 'Viewer',
    garage: 'Garage',
};

function AddUserModal({ db, auth, franchise, actorProfile, functionsApp, onClose, toast }) {
    const assignableRoles = assignableRolesForActor(actorProfile);
    const primaryFid = String(franchise?.franchiseId || franchise?.id || '').toUpperCase();
    const franchiseKey = String(franchise?.franchiseId || franchise?.id || '').trim();
    const [formData, setFormData] = useState({
        email: '',
        firstName: '',
        lastName: '',
        username: '',
        role: 'staff',
        isDemo: franchise?.isDemo || false,
        scopeLevel: 'single',
        serviceCompanyId: '',
    });
    const [peerFranchises, setPeerFranchises] = useState([]);
    const [serviceCompanies, setServiceCompanies] = useState([]);
    const [membershipIds, setMembershipIds] = useState(() => new Set(primaryFid ? [primaryFid] : []));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const cc = String(franchise?.countryCode || 'CH').trim();
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
            } catch (e) {
                if (!cancelled) setPeerFranchises([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [franchise?.countryCode, db]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Primary source: franchise-scoped collection used by main app data path.
                let rows = [];
                if (franchiseKey) {
                    const scopedSnap = await getDocs(collection(db, 'franchises', franchiseKey.toUpperCase(), 'servisFirmalari'));
                    rows = scopedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                }

                // Legacy fallback: old top-level collection shape.
                if (!rows.length) {
                    const snap = await getDocs(collection(db, 'servisFirmalari'));
                    const allRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    const keyUpper = franchiseKey.toUpperCase();
                    const filtered = allRows.filter((f) => {
                        const fId = String(f.franchiseId || '').trim().toUpperCase();
                        const fDef = String(f.defaultFranchiseId || '').trim().toUpperCase();
                        const fCountry = String(f.countryCode || '').trim().toUpperCase();
                        const sessionCountry = String(franchise?.countryCode || '').trim().toUpperCase();
                        return !fId || fId === keyUpper || fDef === keyUpper || (sessionCountry && fCountry === sessionCountry);
                    });
                    rows = filtered.length ? filtered : allRows;
                }

                rows.sort((a, b) => {
                    const an = String(a.firmaAdi || a.ad || a.name || '').toLowerCase();
                    const bn = String(b.firmaAdi || b.ad || b.name || '').toLowerCase();
                    return an.localeCompare(bn);
                });
                if (!cancelled) setServiceCompanies(rows);
            } catch {
                if (!cancelled) setServiceCompanies([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [db, franchiseKey, franchise?.countryCode]);

    const serviceCompanyOptionValue = (company) => {
        const candidate = String(company?.id || company?.documentId || '').trim();
        return candidate;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!formData.email) {
            toast.error('Email is required');
            return;
        }
        if (!functionsApp) {
            toast.error('Cloud Functions unavailable — cannot create user with email onboarding');
            return;
        }
        if (!canAssignRole(actorProfile, formData.role)) {
            toast.error('You cannot assign this role');
            return;
        }
        const activeCount = Number(franchise?.currentUserCount || 0);
        const maxUsers = Number(franchise?.maxUsers || 0);
        if (maxUsers > 0 && activeCount >= maxUsers) {
            toast.error(`User limit reached (${activeCount}/${maxUsers}). Contact platform admin to increase the limit.`);
            return;
        }
        const sid = String(formData.serviceCompanyId || '').trim();
        if (formData.role === 'garage' && !sid) {
            toast.error('Please select a service company for Garage role');
            return;
        }

        const scopeLevel = String(formData.scopeLevel || 'single').toLowerCase();
        const membershipList = scopeLevel === 'selected'
            ? Array.from(membershipIds).map((id) => String(id || '').trim().toUpperCase()).filter(Boolean)
            : undefined;

        setSaving(true);
        try {
            const fn = httpsCallable(functionsApp, 'franchiseCreateUser');
            await fn({
                email: formData.email.trim().toLowerCase(),
                firstName: formData.firstName,
                lastName: formData.lastName,
                username: formData.username,
                role: formData.role,
                franchiseId: primaryFid,
                scopeLevel,
                membershipIds: membershipList,
                isDemo: formData.isDemo,
                serviceCompanyId: formData.role === 'garage' ? sid : undefined,
            });
            toast.success(`User "${formData.email}" created — login details emailed`);
            onClose();
        } catch (error) {
            console.error('Error creating user:', error);
            const code = String(error?.code || '');
            const msg = String(error?.message || '').toLowerCase();
            if (code.includes('welcome_email_failed') || msg.includes('welcome_email_failed')) {
                toast.error(
                    'Account was not created — welcome email could not be sent. Check Mail Center → SMTP, then try again.'
                );
            } else if (code.includes('already-exists') || msg.includes('already exists')) {
                toast.error('A user with this email already exists.');
            } else {
                toast.error(error?.message || 'Failed to create user');
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
                className="pal-dash-panel shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                        Add User to {franchise?.country}
                    </h2>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Email *
                        </label>
                        <input
                            type="email"
                            value={formData.email}
                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            required
                        />
                    </div>

                    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 space-y-2">
                        <p className="text-sm font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                            Automatic onboarding email
                        </p>
                        <ul className="list-disc pl-5 space-y-1.5 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary leading-relaxed">
                            <li>
                                A secure <strong>temporary password</strong> is generated — you do not set a password.
                            </li>
                            <li>
                                The user receives an email with sign-in details and a green{' '}
                                <strong>Set your password</strong> button.
                            </li>
                            <li>
                                They can sign in immediately or choose their own password via that button
                                (or <em>Forgot password</em> on the login page).
                            </li>
                            <li>
                                If the email cannot be sent, the account is <strong>not</strong> created.
                            </li>
                        </ul>
                    </div>

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
                            <option value="single">This franchise only</option>
                            <option value="selected">Selected franchises (same country)</option>
                            <option value="country_all">All franchises in this country</option>
                        </select>
                    </div>

                    {formData.scopeLevel === 'selected' && (
                        <div className="max-h-40 overflow-y-auto border border-sap-border-light dark:border-sap-borderDark-light rounded-lg p-2 space-y-1">
                            <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary px-1 pb-1">
                                Select locations this user may choose at login.
                            </p>
                            {peerFranchises.map((f) => {
                                const fid = String(f.franchiseId || f.id || '').toUpperCase();
                                if (!fid) return null;
                                return (
                                    <label key={fid} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
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
                                        <span>{f.name || f.country || fid}</span>
                                        <span className="text-sap-text-secondary dark:text-sap-textDark-secondary text-xs">
                                            ({fid})
                                        </span>
                                    </label>
                                );
                            })}
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
                                    {FRANCHISE_ROLE_LABELS[r] || r}
                                </option>
                            ))}
                        </select>
                    </div>

                    {formData.role === 'garage' && (
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                Service company
                            </label>
                            <select
                                value={formData.serviceCompanyId}
                                onChange={(e) => setFormData({ ...formData, serviceCompanyId: e.target.value })}
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            >
                                <option value="">Select service company...</option>
                                {serviceCompanies.map((company) => {
                                    const value = serviceCompanyOptionValue(company);
                                    if (!value) return null;
                                    const label = String(company.firmaAdi || company.ad || company.name || value);
                                    return (
                                        <option key={`${value}-${label}`} value={value}>
                                            {label}
                                        </option>
                                    );
                                })}
                            </select>
                            {serviceCompanies.length === 0 && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    No service company found for this franchise.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isDemo"
                            checked={formData.isDemo}
                            onChange={(e) => setFormData({ ...formData, isDemo: e.target.checked })}
                            className="rounded text-sap-blue-500"
                        />
                        <label htmlFor="isDemo" className="text-sm text-sap-text-primary dark:text-sap-textDark-primary">
                            Demo Account (30 days trial)
                        </label>
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
                            {saving ? 'Creating...' : 'Create User'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}

// Edit Franchise Modal
function EditFranchiseModal({ db, franchise, onClose, toast }) {
    const [formData, setFormData] = useState({
        franchiseName: (franchise?.name ?? '').toString(),
        subscriptionType: franchise?.subscriptionType || 'demo',
        maxUsers: franchise?.maxUsers || 5,
        isActive: franchise?.isActive ?? true,
        isDemo: franchise?.isDemo ?? true,
        currency: (franchise?.currency || 'CHF').toString().toUpperCase(),
    });
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);

        try {
            const updates = {
                name: String(formData.franchiseName ?? '').trim(),
                subscriptionType: formData.subscriptionType,
                maxUsers: formData.maxUsers,
                isActive: formData.isActive,
                isDemo: formData.isDemo,
                currency: String(formData.currency || 'CHF').trim().toUpperCase(),
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'admin@gmail.com'
            };

            // If converting from demo to production
            if (franchise.isDemo && !formData.isDemo) {
                updates.subscriptionEndDate = null;
            }

            await updateDoc(doc(db, 'franchises', franchise.id), updates);
            toast.success('Franchise updated successfully');
            onClose();
        } catch (error) {
            console.error('Error updating franchise:', error);
            toast.error('Failed to update franchise');
        } finally {
            setSaving(false);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-3 sm:p-4"
            onClick={onClose}
        >
            <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="pal-dash-panel shadow-xl w-full max-w-5xl max-h-[92vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 border-b border-sap-border-light dark:border-sap-borderDark-light">
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                        Edit Franchise License
                    </h2>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Franchise name
                        </label>
                        <input
                            type="text"
                            value={formData.franchiseName}
                            onChange={(e) => setFormData({ ...formData, franchiseName: e.target.value })}
                            placeholder="e.g. Green Motion Zürich"
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                        />
                        <p className="mt-1 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                            Display name for this franchise in the admin dashboard and listings (does not change the franchise ID).
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Currency (ISO) *
                        </label>
                        <select
                            value={formData.currency}
                            onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                        >
                            {ISO_CURRENCY_OPTIONS.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                        <p className="mt-1 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                            Used for amount formatting in web and mobile for this franchise.
                        </p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Subscription Plan
                        </label>
                        <div className="space-y-2">
                            {SUBSCRIPTION_PLANS.map((plan) => (
                                <label
                                    key={plan.id}
                                    className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                                        formData.subscriptionType === plan.id
                                            ? 'border-sap-blue-500 bg-sap-blue-50 dark:bg-sap-blue-900/20'
                                            : 'border-sap-border-light dark:border-sap-borderDark-light hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="radio"
                                            name="subscriptionType"
                                            value={plan.id}
                                            checked={formData.subscriptionType === plan.id}
                                            onChange={(e) => {
                                                setFormData({ 
                                                    ...formData, 
                                                    subscriptionType: e.target.value,
                                                    maxUsers: plan.maxUsers,
                                                    isDemo: plan.id === 'demo'
                                                });
                                            }}
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

                    <div>
                        <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                            Custom User Limit
                        </label>
                        <input
                            type="number"
                            min="1"
                            max="999"
                            value={formData.maxUsers}
                            onChange={(e) => setFormData({ ...formData, maxUsers: parseInt(e.target.value) || 5 })}
                            className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isActive"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="rounded text-sap-blue-500"
                        />
                        <label htmlFor="isActive" className="text-sm text-sap-text-primary dark:text-sap-textDark-primary">
                            Active
                        </label>
                    </div>

                    {franchise?.isDemo && (
                        <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
                            <input
                                type="checkbox"
                                id="convertToProduction"
                                checked={!formData.isDemo}
                                onChange={(e) => setFormData({ ...formData, isDemo: !e.target.checked })}
                                className="rounded text-green-500"
                            />
                            <label htmlFor="convertToProduction" className="text-sm text-green-700 dark:text-green-400">
                                Convert to Production (remove demo expiration)
                            </label>
                        </div>
                    )}

                    <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary rounded-lg border border-sap-border-light dark:border-sap-borderDark-light bg-sap-bg-light dark:bg-sap-bgDark-dark px-3 py-2">
                        Terms &amp; Conditions and Privacy Policy for the kiosk are edited under{' '}
                        <span className="font-medium text-sap-text-primary dark:text-sap-textDark-primary">Front-desk customers</span>{' '}
                        (not here).
                    </p>

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

// Edit User Modal
function EditUserModal({ db, user, franchise, actorProfile, onClose, toast }) {
    const assignableRoles = assignableRolesForActor(actorProfile);
    const primaryFid = String(franchise?.franchiseId || franchise?.id || user?.franchiseId || '').toUpperCase();
    const franchiseKey = String(franchise?.franchiseId || franchise?.id || user?.franchiseId || '').trim();
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
        isActive: user?.isActive ?? true,
        scopeLevel: initialScope,
        serviceCompanyId: String(user?.garageId || user?.linkedGarageId || '').trim(),
    });
    const [peerFranchises, setPeerFranchises] = useState([]);
    const [serviceCompanies, setServiceCompanies] = useState([]);
    const [membershipIds, setMembershipIds] = useState(memFromUser);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const cc = String(franchise?.countryCode || user?.countryCode || 'CH').trim();
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
    }, [franchise?.countryCode, user?.countryCode, db]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                let rows = [];
                if (franchiseKey) {
                    const scopedSnap = await getDocs(collection(db, 'franchises', franchiseKey.toUpperCase(), 'servisFirmalari'));
                    rows = scopedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
                }
                if (!rows.length) {
                    const snap = await getDocs(collection(db, 'servisFirmalari'));
                    const allRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    const keyUpper = franchiseKey.toUpperCase();
                    const sessionCountry = String(franchise?.countryCode || user?.countryCode || '').trim().toUpperCase();
                    const filtered = allRows.filter((f) => {
                        const fId = String(f.franchiseId || '').trim().toUpperCase();
                        const fDef = String(f.defaultFranchiseId || '').trim().toUpperCase();
                        const fCountry = String(f.countryCode || '').trim().toUpperCase();
                        return !fId || fId === keyUpper || fDef === keyUpper || (sessionCountry && fCountry === sessionCountry);
                    });
                    rows = filtered.length ? filtered : allRows;
                }
                rows.sort((a, b) => {
                    const an = String(a.firmaAdi || a.ad || a.name || '').toLowerCase();
                    const bn = String(b.firmaAdi || b.ad || b.name || '').toLowerCase();
                    return an.localeCompare(bn);
                });
                if (!cancelled) setServiceCompanies(rows);
            } catch {
                if (!cancelled) setServiceCompanies([]);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [db, franchiseKey, franchise?.countryCode, user?.countryCode]);

    const serviceCompanyOptionValue = (company) => {
        const candidate = String(company?.id || company?.documentId || '').trim();
        return candidate;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!canAssignRole(actorProfile, formData.role)) {
            toast.error('You cannot assign this role');
            return;
        }
        setSaving(true);

        try {
            const countryCode = user?.countryCode || franchise?.countryCode || 'CH';
            const franchiseId = user?.franchiseId || franchise?.franchiseId || franchise?.id || 'ch';

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

            const payload = {
                firstName: formData.firstName,
                lastName: formData.lastName,
                nickname: deleteField(),
                role: formData.role,
                isActive: formData.isActive,
                countryCode,
                franchiseId,
                defaultFranchiseId: primaryFid || String(franchiseId).toUpperCase(),
                scopeLevel: scopeStored,
                isDemoAccount: user?.isDemoAccount ?? user?.isDemo ?? false,
                isDemo: user?.isDemo ?? user?.isDemoAccount ?? false,
                updatedAt: Timestamp.now(),
                updatedBy: getAuth().currentUser?.email || 'admin@gmail.com',
                ...franchiseMembershipsUpdate,
            };

            if (usernameParts.clearAll) {
                payload.username = deleteField();
                payload.usernameNormalized = deleteField();
            } else {
                payload.username = usernameParts.username;
                payload.usernameNormalized = usernameParts.usernameNormalized
                    ? usernameParts.usernameNormalized
                    : deleteField();
            }

            const sid = String(formData.serviceCompanyId || '').trim();
            if (formData.role === 'garage') {
                if (!sid) {
                    toast.error('Please select a service company for Garage role');
                    setSaving(false);
                    return;
                }
                payload.garageId = sid;
                payload.linkedGarageId = sid;
            } else {
                payload.garageId = deleteField();
                payload.linkedGarageId = deleteField();
            }

            await updateDoc(doc(db, 'users', user.id), payload);
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
                className="pal-dash-panel shadow-xl max-w-md w-full"
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
                            <option value="single">This franchise only</option>
                            <option value="selected">Selected franchises (same country)</option>
                            <option value="country_all">All franchises in this country</option>
                        </select>
                    </div>

                    {formData.scopeLevel === 'selected' && (
                        <div className="max-h-40 overflow-y-auto border border-sap-border-light dark:border-sap-borderDark-light rounded-lg p-2 space-y-1">
                            {peerFranchises.map((f) => {
                                const fid = String(f.franchiseId || f.id || '').toUpperCase();
                                if (!fid) return null;
                                return (
                                    <label key={fid} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
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
                                        <span>{f.name || f.country || fid}</span>
                                        <span className="text-sap-text-secondary dark:text-sap-textDark-secondary text-xs">
                                            ({fid})
                                        </span>
                                    </label>
                                );
                            })}
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
                                    {FRANCHISE_ROLE_LABELS[r] || r}
                                </option>
                            ))}
                        </select>
                    </div>

                    {formData.role === 'garage' && (
                        <div>
                            <label className="block text-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary mb-2">
                                Service company
                            </label>
                            <select
                                value={formData.serviceCompanyId}
                                onChange={(e) => setFormData({ ...formData, serviceCompanyId: e.target.value })}
                                className="w-full px-4 py-2 border border-sap-border-light dark:border-sap-borderDark-light rounded-lg bg-white dark:bg-sap-bgDark-input text-sap-text-primary dark:text-sap-textDark-primary focus:ring-2 focus:ring-sap-blue-500"
                            >
                                <option value="">Select service company...</option>
                                {serviceCompanies.map((company) => {
                                    const value = serviceCompanyOptionValue(company);
                                    if (!value) return null;
                                    const label = String(company.firmaAdi || company.ad || company.name || value);
                                    return (
                                        <option key={`${value}-${label}`} value={value}>
                                            {label}
                                        </option>
                                    );
                                })}
                            </select>
                            {serviceCompanies.length === 0 && (
                                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                                    No service company found for this franchise.
                                </p>
                            )}
                        </div>
                    )}

                    <div className="flex items-center gap-2">
                        <input
                            type="checkbox"
                            id="isActiveUser"
                            checked={formData.isActive}
                            onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                            className="rounded text-sap-blue-500"
                        />
                        <label htmlFor="isActiveUser" className="text-sm text-sap-text-primary dark:text-sap-textDark-primary">
                            Active
                        </label>
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

// Convert Demo Modal
function ConvertDemoModal({ user, onConfirm, onClose }) {
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
                    <h2 className="text-xl font-semibold text-sap-text-primary dark:text-sap-textDark-primary">
                        Convert Demo to Regular
                    </h2>
                </div>

                <div className="p-6 space-y-4">
                    <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg">
                        <AlertTriangle className="text-yellow-600 flex-shrink-0 mt-0.5" size={20} />
                        <div>
                            <p className="text-sm text-yellow-800 dark:text-yellow-200">
                                This action will:
                            </p>
                            <ul className="text-sm text-yellow-700 dark:text-yellow-300 mt-2 list-disc list-inside space-y-1">
                                <li>Remove demo expiration date</li>
                                <li>Convert user to regular subscription</li>
                                <li>User data will be permanently retained</li>
                            </ul>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">User</p>
                        <p className="font-medium text-sap-text-primary dark:text-sap-textDark-primary">{user?.email}</p>
                    </div>

                    <div className="flex gap-3 pt-4">
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

export { AddUserModal as FranchiseAddUserModal };

export default AdminFranchiseDetailView;
