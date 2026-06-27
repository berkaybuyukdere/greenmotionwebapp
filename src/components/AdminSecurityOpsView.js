import React, { useEffect, useMemo, useState } from 'react';
import {
    collection, doc, getDocs, limit, onSnapshot, query, serverTimestamp, setDoc, updateDoc, deleteDoc
} from 'firebase/firestore';
import { ref, uploadBytes, deleteObject, getBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { functionsEu } from '../firebase/client';
import { CheckCircle, XCircle, RefreshCw, Shield, Zap, Play, Terminal, Database } from 'lucide-react';
import { useToast } from './ToastNotification';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';

function ResultBadge({ status }) {
    if (status === 'success') {
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"><CheckCircle size={12} />OK</span>;
    }
    if (status === 'error') {
        return <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"><XCircle size={12} />Error</span>;
    }
    return <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">Pending</span>;
}

const SCOPED_COLLECTIONS = [
    'araclar',
    'activities',
    'servisler',
    'servisFirmalari',
    'iadeIslemleri',
    'exitIslemleri',
    'office_operations',
    'office_Return',
    'assistantCompanies',
    'workSchedules',
    'vacationTimes',
    'protocols',
    'shuttleEntries',
    'shuttleSessions',
    'shuttleReports'
];

const STORAGE_PREFIXES = [
    'iade_fotograflari',
    'exit_fotograflari',
    'hasar_fotograflari',
    'office_operations',
    'office_Return',
    'return_pdfs'
];

function normalizeFranchise(raw) {
    return String(raw || 'CH').toUpperCase();
}

export function AdminSecurityOpsView({ db, storage, functionsApp, userProfile }) {
    const toast = useToast();
    const [users, setUsers] = useState([]);
    const [franchises, setFranchises] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedRole, setSelectedRole] = useState('staff');
    const [isActive, setIsActive] = useState(true);
    const [running, setRunning] = useState(false);
    const [results, setResults] = useState([]);
    const [deployRunning, setDeployRunning] = useState(false);
    const [franchiseFilter, setFranchiseFilter] = useState('ALL');

    const selectedUser = useMemo(
        () => users.find((u) => u.id === selectedUserId) || null,
        [users, selectedUserId]
    );

    const franchiseOptions = useMemo(() => {
        const fromUsers = users.map((u) => normalizeFranchise(u.franchiseId || u.countryCode || 'CH'));
        const merged = new Set(['ALL', ...fromUsers]);
        return Array.from(merged).sort();
    }, [users]);

    const filteredUsers = useMemo(() => {
        if (franchiseFilter === 'ALL') return users;
        return users.filter((u) => normalizeFranchise(u.franchiseId || u.countryCode || 'CH') === franchiseFilter);
    }, [users, franchiseFilter]);

    useEffect(() => {
        const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
            const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            setUsers(list);
            if (!selectedUserId && list.length > 0) {
                setSelectedUserId(list[0].id);
            }
        });

        const unsubFranchises = onSnapshot(collection(db, 'franchises'), (snap) => {
            setFranchises(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        });

        return () => {
            unsubUsers();
            unsubFranchises();
        };
    }, [db, selectedUserId]);

    useEffect(() => {
        if (selectedUser) {
            setSelectedRole(selectedUser.role || 'staff');
            setIsActive(selectedUser.isActive !== false);
        }
    }, [selectedUser]);

    const pushResult = (name, status, details = '') => {
        setResults((prev) => [...prev, { name, status, details, at: new Date().toISOString() }]);
    };

    const runDiagnostics = async () => {
        setRunning(true);
        setResults([]);

        const franchiseId = normalizeFranchise(userProfile?.franchiseId || 'CH');
        const testDocId = `secops_${Date.now()}`;

        try {
            // Connection checks
            await getDocs(query(collection(db, 'users'), limit(1)));
            pushResult('Firestore Connection', 'success', 'users query succeeded');
        } catch (e) {
            pushResult('Firestore Connection', 'error', e.message || String(e));
        }

        try {
            await getDocs(query(collection(db, 'franchises'), limit(1)));
            pushResult('Franchises Read', 'success', 'franchises query succeeded');
        } catch (e) {
            pushResult('Franchises Read', 'error', e.message || String(e));
        }

        const testCollectionPermissions = async (segments, label, data) => {
            try {
                await getDocs(query(collection(db, ...segments), limit(1)));
                pushResult(`${label} READ`, 'success', segments.join('/'));
            } catch (e) {
                pushResult(`${label} READ`, 'error', e.message || String(e));
                return;
            }

            const opDocId = `${testDocId}_${segments[segments.length - 1]}`;
            try {
                const testRef = doc(db, ...segments, opDocId);
                await setDoc(testRef, {
                    ...data,
                    securityOpsType: 'permission_test',
                    franchiseId,
                    createdAt: serverTimestamp(),
                    createdBy: userProfile?.email || 'unknown'
                });
                pushResult(`${label} WRITE`, 'success', `${segments.join('/')}/${opDocId}`);

                await updateDoc(testRef, {
                    updatedAt: serverTimestamp(),
                    updatedBy: userProfile?.email || 'unknown',
                    permissionUpdated: true
                });
                pushResult(`${label} UPDATE`, 'success', `${segments.join('/')}/${opDocId}`);

                await deleteDoc(testRef);
                pushResult(`${label} DELETE`, 'success', `${segments.join('/')}/${opDocId}`);
            } catch (e) {
                pushResult(`${label} WRITE/UPDATE/DELETE`, 'error', e.message || String(e));
            }
        };

        // Scoped Firestore CRUD checks for all major operational collections
        for (const colName of SCOPED_COLLECTIONS) {
            await testCollectionPermissions(
                ['franchises', franchiseId, colName],
                `Scoped ${colName}`,
                {
                    status: 'test',
                    notlar: 'Security ops generated test record',
                    module: colName
                }
            );
        }
        pushResult('Legacy checks', 'success', 'Skipped by design (scoped-only architecture).');

        // Scoped Storage R/W/D checks across critical operation folders
        for (const prefix of STORAGE_PREFIXES) {
            const testStoragePath = `franchises/${franchiseId}/${prefix}/security-${Date.now()}-${prefix}.txt`;
            try {
                const sRef = ref(storage, testStoragePath);
                const content = new Blob([`security ops check ${prefix}`], { type: 'text/plain' });
                await uploadBytes(sRef, content, { contentType: 'text/plain' });
                pushResult(`Scoped Storage ${prefix} WRITE`, 'success', testStoragePath);
                await getBytes(sRef, 2048);
                pushResult(`Scoped Storage ${prefix} READ`, 'success', testStoragePath);
                await deleteObject(sRef);
                pushResult(`Scoped Storage ${prefix} DELETE`, 'success', testStoragePath);
            } catch (e) {
                pushResult(`Scoped Storage ${prefix} R/W/D`, 'error', e.message || String(e));
            }
        }

        setRunning(false);
    };

    const applyUserRoleFix = async () => {
        if (!selectedUser) return;
        try {
            const franchiseId = normalizeFranchise(selectedUser.franchiseId);
            await updateDoc(doc(db, 'users', selectedUser.id), {
                role: selectedRole,
                isActive,
                franchiseId,
                countryCode: franchiseId,
                updatedAt: serverTimestamp(),
                updatedBy: userProfile?.email || 'security-ops'
            });
            toast.success('User role/permission updated');
        } catch (e) {
            toast.error(`Failed to update user: ${e.message}`);
        }
    };

    const runFixFunction = async (fnName, payload = {}) => {
        try {
            const fn = httpsCallable(functionsApp, fnName);
            const res = await fn(payload);
            pushResult(`Function: ${fnName}`, 'success', JSON.stringify(res.data || {}));
        } catch (e) {
            pushResult(`Function: ${fnName}`, 'error', e.message || String(e));
        }
    };

    const runMigrationCallable = async (fnName, payload = {}) => {
        try {
            const fn = httpsCallable(functionsEu, fnName);
            const res = await fn(payload);
            pushResult(`Migration: ${fnName}`, 'success', JSON.stringify(res.data || {}));
            return res.data;
        } catch (e) {
            pushResult(`Migration: ${fnName}`, 'error', e.message || String(e));
            return null;
        }
    };

    const runDeployTrigger = async (fnName) => {
        setDeployRunning(true);
        try {
            const fn = httpsCallable(functionsApp, fnName);
            const res = await fn({ requestedBy: userProfile?.email || 'unknown' });
            pushResult(`Deploy Trigger: ${fnName}`, 'success', JSON.stringify(res.data || {}));
            toast.success(`${fnName} triggered`);
        } catch (e) {
            pushResult(`Deploy Trigger: ${fnName}`, 'error', e.message || String(e));
            toast.error(`${fnName} failed: ${e.message}`);
        } finally {
            setDeployRunning(false);
        }
    };

    const copyDeployCommands = async () => {
        const text = [
            'firebase deploy --only firestore:rules',
            'firebase deploy --only storage',
            'firebase deploy --only functions'
        ].join('\n');
        try {
            await navigator.clipboard.writeText(text);
            toast.success('Deploy commands copied');
        } catch {
            toast.error('Could not copy commands');
        }
    };

    return (
        <div className="erpx-page space-y-6">
            <div className="erpx-page-toolbar">
                <p className="erpx-page-subtitle max-w-measure">
                    Live permission diagnostics, user role fixes, function operations, and deploy triggers.
                </p>
                <button
                    onClick={runDiagnostics}
                    disabled={running}
                    className="pal-btn pal-btn-primary disabled:opacity-50 inline-flex items-center gap-2"
                >
                    <RefreshCw size={16} className={running ? 'animate-spin' : ''} />
                    {running ? 'Running...' : 'Run Diagnostics'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="pal-dash-panel">
                    <div className="pal-dash-panel-header">
                        <h2 className="text-card-title flex items-center gap-2">
                        <Zap size={16} /> Roles Quick Fix
                        </h2>
                    </div>
                    <div className="pal-dash-panel-body space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs mb-1 text-sap-text-secondary dark:text-sap-textDark-secondary">Franchise</label>
                            <select
                                value={franchiseFilter}
                                onChange={(e) => {
                                    setFranchiseFilter(e.target.value);
                                    const firstUser = users.find((u) =>
                                        e.target.value === 'ALL' ||
                                        normalizeFranchise(u.franchiseId || u.countryCode || 'CH') === e.target.value
                                    );
                                    if (firstUser) setSelectedUserId(firstUser.id);
                                }}
                                className="w-full px-3 py-2 rounded-lg border border-sap-border-light dark:border-sap-borderDark-light bg-white dark:bg-sap-bgDark-input"
                            >
                                {franchiseOptions.map((fid) => (
                                    <option key={fid} value={fid}>{fid === 'ALL' ? 'All Franchises' : fid}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs mb-1 text-sap-text-secondary dark:text-sap-textDark-secondary">User</label>
                            <select
                                value={selectedUserId}
                                onChange={(e) => setSelectedUserId(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-sap-border-light dark:border-sap-borderDark-light bg-white dark:bg-sap-bgDark-input"
                            >
                                {filteredUsers.map((u) => (
                                    <option key={u.id} value={u.id}>
                                        {u.email} ({normalizeFranchise(u.franchiseId || u.countryCode || 'CH')})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div className="max-h-44 overflow-auto rounded-lg border border-sap-border-light dark:border-sap-borderDark-light">
                        {filteredUsers.map((u) => (
                            <button
                                key={`quick_${u.id}`}
                                onClick={() => setSelectedUserId(u.id)}
                                className={`w-full text-left px-3 py-2 border-b last:border-b-0 border-sap-border-light dark:border-sap-borderDark-light hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover ${
                                    selectedUserId === u.id ? 'bg-sap-blue-50 dark:bg-sap-blue-900/20' : ''
                                }`}
                            >
                                <div className="text-sm font-medium">{u.email}</div>
                                <div className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                                    role: {u.role || 'staff'} | active: {u.isActive === false ? 'no' : 'yes'}
                                </div>
                            </button>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className="px-3 py-2 rounded-lg border border-sap-border-light dark:border-sap-borderDark-light bg-white dark:bg-sap-bgDark-input">
                            <option value="globaladmin">globaladmin</option>
                            <option value="admin">admin (franchise)</option>
                            <option value="admin">admin</option>
                            <option value="manager">manager</option>
                            <option value="staff">staff</option>
                            <option value="shuttle">shuttle</option>
                            <option value="viewer">viewer</option>
                        </select>
                        <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-sap-border-light dark:border-sap-borderDark-light">
                            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                            <span>Active</span>
                        </label>
                    </div>
                    <button onClick={applyUserRoleFix} className="px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700">
                        Apply Role/Permission Fix
                    </button>
                    <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                        Franchises loaded: {franchises.length}
                    </p>
                    </div>
                </div>

                <div className="pal-dash-panel">
                    <div className="pal-dash-panel-header">
                        <h2 className="text-card-title flex items-center gap-2">
                        <Play size={16} /> Function Operations
                        </h2>
                    </div>
                    <div className="pal-dash-panel-body space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <button onClick={() => runFixFunction('assignUserRoles')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover">assignUserRoles</button>
                        <button onClick={() => runFixFunction('syncUserCountryCodes')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover">syncUserCountryCodes</button>
                        <button onClick={() => runFixFunction('setUserCountryCodes')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover">setUserCountryCodes</button>
                        <button onClick={() => runFixFunction('fixUserDocuments')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover">fixUserDocuments</button>
                    </div>
                    <h3 className="text-caption font-semibold mt-2">Deploy Triggers</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <button disabled={deployRunning} onClick={() => runDeployTrigger('deployFirestoreRules')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover disabled:opacity-50">deployFirestoreRules</button>
                        <button disabled={deployRunning} onClick={() => runDeployTrigger('deployStorageRules')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover disabled:opacity-50">deployStorageRules</button>
                        <button disabled={deployRunning} onClick={() => runDeployTrigger('deployAllRules')} className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover disabled:opacity-50 md:col-span-2">deployAllRules</button>
                    </div>
                    <button onClick={copyDeployCommands} className="px-3 py-2 rounded-lg bg-sap-bg-lightAlt dark:bg-sap-bgDark-darkAlt border inline-flex items-center gap-2">
                        <Terminal size={14} /> Copy CLI Deploy Commands
                    </button>
                    </div>
                </div>

                <div className="pal-dash-panel lg:col-span-2">
                    <div className="pal-dash-panel-header">
                        <h2 className="text-card-title flex items-center gap-2">
                            <Database size={16} /> Legacy → Scoped Migration (europe-west6)
                        </h2>
                    </div>
                    <div className="pal-dash-panel-body space-y-3">
                        <p className="text-xs text-sap-text-secondary dark:text-sap-textDark-secondary">
                            Copy-first migration. Run parity before cleanup. Legacy root paths are read-only for clients after rules deploy.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover"
                                onClick={() => runMigrationCallable('migrateLegacyToScoped', {
                                    dryRun: true,
                                    batchLimit: 100,
                                    franchiseId: franchiseFilter === 'ALL' ? undefined : franchiseFilter,
                                })}
                            >
                                migrateLegacyToScoped (dry-run)
                            </button>
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover"
                                onClick={() => runMigrationCallable('migrateLegacyToScoped', {
                                    batchLimit: 100,
                                    franchiseId: franchiseFilter === 'ALL' ? undefined : franchiseFilter,
                                })}
                            >
                                migrateLegacyToScoped (copy batch)
                            </button>
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg border hover:bg-sap-bg-lightHover dark:hover:bg-sap-bgDark-darkHover"
                                onClick={() => runMigrationCallable('getLegacyScopedParity', {
                                    franchiseId: franchiseFilter === 'ALL' ? undefined : franchiseFilter,
                                })}
                            >
                                getLegacyScopedParity
                            </button>
                            <button
                                type="button"
                                className="px-3 py-2 rounded-lg border border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/20 md:col-span-3"
                                onClick={() => runMigrationCallable('cleanupVerifiedLegacyDocs', {
                                    dryRun: true,
                                    franchiseId: franchiseFilter === 'ALL' ? undefined : franchiseFilter,
                                })}
                            >
                                cleanupVerifiedLegacyDocs (dry-run only — verify parity first)
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="pal-dash-panel overflow-hidden">
                <div className="pal-dash-panel-header text-card-title">
                    Operations Log
                </div>
                <div className="pal-dash-panel-body max-h-[460px] overflow-auto">
                    {results.length === 0 ? (
                        <div className="p-4 text-sm text-sap-text-secondary dark:text-sap-textDark-secondary">No operations yet. Run diagnostics or function operations.</div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-sap-bg-light dark:bg-sap-bgDark-dark">
                                <tr>
                                    <th className="px-4 py-2 text-left">Operation</th>
                                    <th className="px-4 py-2 text-left">Status</th>
                                    <th className="px-4 py-2 text-left">Details</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-sap-border-light dark:divide-sap-borderDark-light">
                                {results.map((r, idx) => (
                                    <tr key={`${r.at}_${idx}`}>
                                        <td className="px-4 py-2">{r.name}</td>
                                        <td className="px-4 py-2"><ResultBadge status={r.status} /></td>
                                        <td className="px-4 py-2 text-xs text-sap-text-secondary dark:text-sap-textDark-secondary break-all">{r.details || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}

export default AdminSecurityOpsView;
