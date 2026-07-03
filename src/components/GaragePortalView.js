/**
 * Garage portal — direct URL only (#/garage-portal or /garage-portal).
 *
 * Franchise admins must provision Firebase Auth + Firestore `users/{uid}` with:
 *   - franchiseId (or defaultFranchiseId + membership as per ERPX)
 *   - role: "garage" (recommended so Firestore rules can scope access)
 *   - garageId OR linkedGarageId: string token matching `garageServiceJobs.targetGarageId`
 *   - isActive: true
 *
 * Data paths (match iOS):
 *   - Jobs:   franchises/{franchiseId}/garageServiceJobs/{jobId}
 *   - Email:  franchises/{franchiseId}/garageOutgoingEmails/{emailId}  (processed by Cloud Function)
 *
 * Job document fields (coordinate with iOS):
 *   - targetGarageId (string, required for assignment)
 *   - status: "pending" | "completed" (and optional others; UI treats non-completed as pending)
 *   - plate | vehiclePlate | plaka
 *   - purpose | servicePurpose | serviceReason
 *   - notes | note
 *   - createdAt | requestedAt, scheduledAt | dueAt, completedAt
 *   - pickupNotifyEmail | customerEmail | notifyEmail — recipient when marking completed
 *   - garageName | targetGarageName — used in customer email body
 *
 * ---------------------------------------------------------------------------
 * REQUIRED FIRESTORE RULES (summary — deploy with franchise rules file):
 *
 * 1) garageServiceJobs under franchises/{franchiseId}:
 *    - Users with role "garage": read + list only documents where
 *      resource.data.targetGarageId == users/{uid}.garageId OR .linkedGarageId
 *    - Same users: update only completion fields (status, completedAt, updatedAt)
 *      on those documents.
 *    - Franchise staff (non-garage role): keep existing franchise-scoped create/read
 *      for dispatching jobs from ERPX.
 *
 * 2) garageOutgoingEmails:
 *    - Create allowed for authenticated franchise users (or garage role only, if you
 *      prefer) with franchiseId on the payload; no client update/delete.
 *
 * 3) Ensure garage portal accounts cannot read unrelated franchise collections.
 * ---------------------------------------------------------------------------
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where,
    addDoc,
} from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Car, CheckCircle, Download, LogOut, Wrench } from 'lucide-react';
import { normalizeRoleKey, resolveSessionFranchiseId } from '../utilities/userAccess';
import { getCollectionRef } from '../utilities/firebaseHelpers';
import { downloadGarageServiceJobPdf } from '../utilities/garageJobPdf';
import { useToast } from './ToastNotification';
import { AnimatedButton } from './AnimatedButton';
import ZoomableImageOverlay from './ZoomableImageOverlay';
import * as XLSX from 'xlsx';

function mapLoginError(err) {
    const code = String(err?.code || '');
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-login-credentials':
            return 'The email or password is incorrect.';
        case 'auth/invalid-email':
            return 'Enter a valid email address.';
        case 'auth/user-disabled':
            return 'This account is disabled. Contact your administrator.';
        case 'auth/too-many-requests':
            return 'Too many attempts. Wait and try again.';
        default:
            return err?.message || 'Sign-in failed.';
    }
}

/** Resolve garage linkage from profile (garageId preferred, else linkedGarageId). */
export function resolveUserGarageId(profile) {
    if (!profile) return '';
    const a = String(profile.garageId || '').trim();
    if (a) return a;
    return String(profile.linkedGarageId || '').trim();
}

function isCompletedJob(data) {
    const s = String(data?.status || '').toLowerCase();
    return s === 'completed' || s === 'done';
}

function humanPurposeLabel(raw) {
    const key = String(raw || '').trim();
    if (!key) return '—';
    const map = {
        routineMaintenance: 'Routine maintenance',
        repair: 'Repair',
        tireService: 'Tire',
        bodywork: 'Bodywork',
        inspection: 'Inspection',
        glass: 'Glass',
        other: 'Other',
    };
    if (map[key]) return map[key];
    return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
}

export function GaragePortalView({ db, auth }) {
    const toast = useToast();
    const [authUser, setAuthUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [busy, setBusy] = useState(false);
    const [jobs, setJobs] = useState([]);
    const [completingId, setCompletingId] = useState('');
    const [searchPlate, setSearchPlate] = useState('');
    const [selectedJob, setSelectedJob] = useState(null);
    const [showCompleteModal, setShowCompleteModal] = useState(false);
    const [completeNotes, setCompleteNotes] = useState('');
    const [completeFiles, setCompleteFiles] = useState([]);
    const [updatingJob, setUpdatingJob] = useState(false);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, setAuthUser);
        return () => unsub();
    }, [auth]);

    const loadProfile = useCallback(
        async (uid) => {
            const ref = doc(db, 'users', uid);
            const snap = await getDoc(ref);
            if (!snap.exists()) {
                setProfile(null);
                return null;
            }
            const data = snap.data();
            setProfile(data);
            return data;
        },
        [db]
    );

    useEffect(() => {
        if (!authUser) {
            setProfile(null);
            return;
        }
        loadProfile(authUser.uid);
    }, [authUser, loadProfile]);

    const franchiseId = useMemo(() => {
        if (!profile) return '';
        return String(resolveSessionFranchiseId(profile) || '').trim().toUpperCase();
    }, [profile]);

    const garageId = useMemo(() => resolveUserGarageId(profile), [profile]);
    const hasGaragePortalRole = useMemo(() => {
        const role = normalizeRoleKey(profile?.role);
        return role === 'globaladmin' || role === 'garage';
    }, [profile]);

    useEffect(() => {
        if (!authUser || !profile || !franchiseId || !garageId) {
            setJobs([]);
            return undefined;
        }

        const jobsRef = getCollectionRef(db, 'garageServiceJobs', authUser, profile, null);
        const q = query(jobsRef, where('targetGarageId', '==', garageId));

        const unsub = onSnapshot(
            q,
            (snap) => {
                const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                rows.sort((a, b) => {
                    const ta = a.createdAt?.seconds || a.requestedAt?.seconds || 0;
                    const tb = b.createdAt?.seconds || b.requestedAt?.seconds || 0;
                    return tb - ta;
                });
                setJobs(rows);
            },
            (err) => {
                console.error('[GaragePortal] jobs listener', err);
                toast.error(err?.message || 'Could not load jobs.');
                setJobs([]);
            }
        );
        return () => unsub();
    }, [authUser, profile, franchiseId, garageId, db, toast]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
            const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
            const snap = await getDoc(doc(db, 'users', cred.user.uid));
            if (!snap.exists()) {
                await signOut(auth);
                toast.error('No user profile. Ask your franchise administrator to create one.');
                return;
            }
            const p = snap.data();
            if (p?.isActive === false) {
                await signOut(auth);
                toast.error('This account is not active.');
                return;
            }
            const role = normalizeRoleKey(p?.role);
            if (!(role === 'globaladmin' || role === 'garage')) {
                await signOut(auth);
                toast.error('Only Global Admin or Garage accounts can access the garage link.');
                return;
            }
        } catch (err) {
            toast.error(mapLoginError(err));
        } finally {
            setBusy(false);
        }
    };

    const handleLogout = () => signOut(auth).catch(() => {});

    const garageDisplayName = useMemo(() => {
        const g = String(profile?.garageName || profile?.garageDisplayName || jobs?.[0]?.targetGarageName || '').trim();
        return g || 'Garage';
    }, [profile, jobs]);

    const visibleJobs = useMemo(() => {
        const q = searchPlate.trim().toLowerCase();
        const list = jobs.filter((j) => j.isDeleted !== true);
        if (!q) return list;
        return list.filter((job) =>
            String(job.plate || job.vehiclePlate || job.plaka || '')
                .toLowerCase()
                .includes(q)
        );
    }, [jobs, searchPlate]);
    const pendingJobs = useMemo(() => visibleJobs.filter((j) => !isCompletedJob(j)), [visibleJobs]);
    const completedJobs = useMemo(() => visibleJobs.filter((j) => isCompletedJob(j)), [visibleJobs]);

    const queuePickupEmail = async (job) => {
        const toRaw =
            job.pickupNotifyEmail ||
            job.customerEmail ||
            job.notifyEmail ||
            job.contactEmail ||
            '';
        const to = String(toRaw || '').trim();
        if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
            return;
        }
        const plate = String(job.plate || job.vehiclePlate || job.plaka || '').trim() || '—';
        const gName = String(job.garageName || job.targetGarageName || garageDisplayName || 'Garage').trim();
        const purpose = humanPurposeLabel(job.purpose || job.servicePurpose || job.serviceReason);
        const sentAt = job.createdAt?.toDate ? job.createdAt.toDate().toISOString() : null;
        const doneAt = job.completedAt?.toDate ? job.completedAt.toDate().toISOString() : (job.completedAtClient || null);
        const beforePhotos = Array.isArray(job.photoURLs) ? job.photoURLs : [];
        const afterPhotos = Array.isArray(job.completionPhotoURLs) ? job.completionPhotoURLs : [];
        const completionNotes = String(job.completionNotes || '').trim();
        const body = completionNotes ? `Completion note: ${completionNotes}` : '';
        const col = getCollectionRef(db, 'garageOutgoingEmails', authUser, profile, null);
        await addDoc(col, {
            type: 'garage_service_ready',
            status: 'queued',
            franchiseId,
            to,
            subject: 'Vehicle ready for pickup',
            body,
            garageServiceJobId: job.id,
            vehiclePlate: plate,
            purposeLabel: purpose,
            serviceCompanyLabel: gName,
            sentDateISO: sentAt,
            completedDateISO: doneAt,
            beforePhotoURLs: beforePhotos,
            afterPhotoURLs: afterPhotos,
            completionNotes,
            idempotencyKey: `${job.id}|${to}|garage_ready`,
            createdAt: serverTimestamp(),
        });
    };

    const uploadCompletionPhotos = async (jobId, files) => {
        if (!files?.length) return [];
        const storage = getStorage();
        const urls = [];
        for (const file of files) {
            const safeName = `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name || 'photo.jpg'}`;
            const fileRef = ref(storage, `franchises/${franchiseId}/garage_service_jobs/${jobId}/completion/${safeName}`);
            await uploadBytes(fileRef, file);
            urls.push(await getDownloadURL(fileRef));
        }
        return urls;
    };

    const markCompleted = async (job, overrides = {}) => {
        if (!authUser || !profile || !franchiseId || !garageId) return;
        if (isCompletedJob(job)) return;
        setCompletingId(job.id);
        try {
            const jobRef = doc(getCollectionRef(db, 'garageServiceJobs', authUser, profile, null), job.id);
            const uploadedAfter = await uploadCompletionPhotos(job.id, overrides.files || []);
            const notes = String(overrides.notes ?? job.notes ?? '').trim();
            const completionNotes = String(overrides.completionNotes ?? '').trim();
            const payload = {
                status: 'completed',
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                notes,
            };
            if (completionNotes) payload.completionNotes = completionNotes;
            if (uploadedAfter.length) payload.completionPhotoURLs = uploadedAfter;
            await updateDoc(jobRef, payload);
            const completedAtClient = new Date().toISOString();
            try {
                await queuePickupEmail({
                    ...job,
                    status: 'completed',
                    notes,
                    completionNotes,
                    completedAtClient,
                    completionPhotoURLs: [...(job.completionPhotoURLs || []), ...uploadedAfter],
                });
            } catch (mailErr) {
                console.warn('[GaragePortal] queue email', mailErr);
                toast.error('Job saved, but pickup email was not queued. Check customer email on the job.');
            }
            toast.success('Marked completed.');
        } catch (err) {
            console.error(err);
            toast.error(err?.message || 'Could not update job.');
        } finally {
            setCompletingId('');
        }
    };

    const saveJobEdits = async (job, notes) => {
        if (!authUser || !profile || !franchiseId || !garageId) return;
        setUpdatingJob(true);
        try {
            const jobRef = doc(getCollectionRef(db, 'garageServiceJobs', authUser, profile, null), job.id);
            await updateDoc(jobRef, {
                notes: String(notes || '').trim(),
                updatedAt: serverTimestamp(),
            });
            toast.success('Job updated.');
        } catch (err) {
            toast.error(err?.message || 'Could not update job.');
        } finally {
            setUpdatingJob(false);
        }
    };

    const deleteJob = async (job) => {
        if (!authUser || !profile || !franchiseId || !garageId) return;
        if (!window.confirm('Delete this service job?')) return;
        setUpdatingJob(true);
        try {
            const jobRef = doc(getCollectionRef(db, 'garageServiceJobs', authUser, profile, null), job.id);
            await updateDoc(jobRef, { isDeleted: true, deletedAt: serverTimestamp(), updatedAt: serverTimestamp() });
            toast.success('Job deleted.');
            setSelectedJob(null);
        } catch (err) {
            toast.error(err?.message || 'Could not delete job.');
        } finally {
            setUpdatingJob(false);
        }
    };

    const exportExcel = () => {
        const rows = visibleJobs.map((job) => ({
            plate: String(job.plate || job.vehiclePlate || job.plaka || ''),
            purpose: humanPurposeLabel(job.purpose || job.servicePurpose || job.serviceReason),
            status: String(job.status || ''),
            sentDate: job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : '',
            completedDate: job.completedAt?.toDate ? job.completedAt.toDate().toLocaleString() : '',
            notes: String(job.notes || ''),
            completionNotes: String(job.completionNotes || ''),
            serviceCompany: String(job.garageName || job.targetGarageName || garageDisplayName || ''),
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'GarageJobs');
        XLSX.writeFile(wb, `garage-jobs-${Date.now()}.xlsx`);
    };

    const onDownloadPdf = (job) => {
        try {
            downloadGarageServiceJobPdf(
                { ...job, franchiseId },
                { garageDisplayName, franchiseId }
            );
        } catch (e) {
            toast.error(e?.message || 'PDF failed.');
        }
    };

    if (!authUser) {
        return (
            <div className="min-h-screen bg-[var(--erpx-canvas)] text-[var(--erpx-ink)] flex items-center justify-center p-6">
                <div className="pal-dash-panel w-full max-w-md p-8">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-3 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            <Wrench className="w-7 h-7" />
                        </div>
                        <div>
                            <h1 className="text-xl font-semibold text-[var(--erpx-ink)]">Garage portal</h1>
                            <p className="text-sm text-[var(--erpx-ink-muted)]">Staff sign-in</p>
                        </div>
                    </div>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-[var(--erpx-ink-secondary)] mb-1">
                                Email
                            </label>
                            <input
                                type="email"
                                autoComplete="username"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="w-full rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] px-3 py-2 text-[var(--erpx-ink)]"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-[var(--erpx-ink-secondary)] mb-1">
                                Password
                            </label>
                            <input
                                type="password"
                                autoComplete="current-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] px-3 py-2 text-[var(--erpx-ink)]"
                                required
                            />
                        </div>
                        <AnimatedButton
                            type="submit"
                            disabled={busy}
                            className="w-full justify-center py-2.5 pal-btn pal-btn-primary !text-white !font-medium rounded-lg"
                        >
                            {busy ? 'Signing in…' : 'Sign in'}
                        </AnimatedButton>
                    </form>
                    <p className="mt-6 text-[11px] text-[var(--erpx-ink-muted)] leading-relaxed">
                        Use only the link provided by your franchise. For access issues, contact your administrator.
                    </p>
                </div>
            </div>
        );
    }

    if (!profile) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[var(--erpx-canvas)] text-[var(--erpx-ink)]">
                <div className="animate-spin rounded-full h-12 w-12 border-2 border-amber-400 border-t-transparent" />
            </div>
        );
    }

    if (!hasGaragePortalRole) {
        return (
            <div className="min-h-screen bg-[var(--erpx-canvas)] text-[var(--erpx-ink)] p-8 flex flex-col items-center justify-center">
                <p className="max-w-lg text-center text-[var(--erpx-ink-secondary)] mb-6">
                    This link is restricted. Only users with <strong className="text-[var(--erpx-ink)]">globaladmin</strong> or{' '}
                    <strong className="text-[var(--erpx-ink)]">garage</strong> role can enter.
                </p>
                <AnimatedButton type="button" onClick={handleLogout} className="pal-btn px-4 py-2 rounded-lg">
                    Sign out
                </AnimatedButton>
            </div>
        );
    }

    if (!garageId) {
        return (
            <div className="min-h-screen bg-[var(--erpx-canvas)] text-[var(--erpx-ink)] p-8 flex flex-col items-center justify-center">
                <p className="max-w-lg text-center text-[var(--erpx-ink-secondary)] mb-6">
                    Your account is missing <strong className="text-[var(--erpx-ink)]">garageId</strong> or{' '}
                    <strong className="text-[var(--erpx-ink)]">linkedGarageId</strong> on your user profile. Franchise
                    administrators must set this to match dispatched jobs&apos;{' '}
                    <code className="text-amber-300">targetGarageId</code>.
                </p>
                <AnimatedButton type="button" onClick={handleLogout} className="pal-btn px-4 py-2 rounded-lg">
                    Sign out
                </AnimatedButton>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--erpx-canvas)] text-[var(--erpx-ink)]">
            <header className="sticky top-0 z-10 border-b border-[var(--erpx-border)] bg-[var(--erpx-surface)]/90 backdrop-blur-md">
                <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Car className="w-6 h-6 text-amber-600" />
                        <div>
                            <h1 className="font-semibold leading-tight">{garageDisplayName}</h1>
                            <p className="text-xs text-[var(--erpx-ink-muted)]">
                                {garageDisplayName} · {franchiseId}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleLogout}
                        className="inline-flex items-center gap-2 text-sm text-[var(--erpx-ink-secondary)] hover:text-[var(--erpx-brand)]"
                    >
                        <LogOut className="w-4 h-4" />
                        Sign out
                    </button>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 py-6">
                <div className="mb-4 flex items-center gap-2">
                    <input
                        type="text"
                        value={searchPlate}
                        onChange={(e) => setSearchPlate(e.target.value)}
                        placeholder="Search by plate..."
                        className="w-full sm:w-80 rounded-lg border border-[var(--erpx-border)] bg-[var(--erpx-surface)] px-3 py-2 text-sm"
                    />
                    <AnimatedButton
                        type="button"
                        onClick={exportExcel}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg pal-btn pal-btn-primary text-sm"
                    >
                        Excel
                    </AnimatedButton>
                </div>
                {visibleJobs.length === 0 ? (
                    <p className="text-center text-[var(--erpx-ink-muted)] py-16">No assigned jobs right now.</p>
                ) : (
                    <div className="space-y-5">
                        <div>
                            <h2 className="text-sm font-semibold text-[var(--erpx-ink-secondary)] mb-2">Pending ({pendingJobs.length})</h2>
                            <ul className="space-y-3">
                                {pendingJobs.map((job) => {
                                    const done = isCompletedJob(job);
                                    const plate = String(job.plate || job.vehiclePlate || job.plaka || '—').trim();
                                    const purpose = humanPurposeLabel(job.purpose || job.servicePurpose || job.serviceReason);
                                    return (
                                        <li
                                            key={job.id}
                                            onClick={() => setSelectedJob(job)}
                                            className={`pal-dash-panel p-4 transition-colors ${
                                                done
                                                    ? '!bg-[var(--erpx-green-bg)] !border-[var(--erpx-green-border)]'
                                                    : '!bg-[var(--erpx-amber-bg)] !border-[var(--erpx-amber-border)]'
                                            } cursor-pointer`}
                                        >
                                            <JobCardBody
                                                job={job}
                                                done={done}
                                                plate={plate}
                                                purpose={purpose}
                                                completingId={completingId}
                                                onDownloadPdf={onDownloadPdf}
                                                onOpenDetails={() => setSelectedJob(job)}
                                                onOpenComplete={() => {
                                                    setSelectedJob(job);
                                                    setCompleteNotes(String(job.completionNotes || ''));
                                                    setShowCompleteModal(true);
                                                }}
                                            />
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-[var(--erpx-ink-secondary)] mb-2">Completed ({completedJobs.length})</h2>
                            <ul className="space-y-3">
                                {completedJobs.map((job) => {
                                    const done = isCompletedJob(job);
                                    const plate = String(job.plate || job.vehiclePlate || job.plaka || '—').trim();
                                    const purpose = humanPurposeLabel(job.purpose || job.servicePurpose || job.serviceReason);
                                    return (
                                        <li
                                            key={job.id}
                                            onClick={() => setSelectedJob(job)}
                                            className={`pal-dash-panel p-4 transition-colors ${
                                                done
                                                    ? '!bg-[var(--erpx-green-bg)] !border-[var(--erpx-green-border)]'
                                                    : '!bg-[var(--erpx-amber-bg)] !border-[var(--erpx-amber-border)]'
                                            } cursor-pointer`}
                                        >
                                            <JobCardBody
                                                job={job}
                                                done={done}
                                                plate={plate}
                                                purpose={purpose}
                                                completingId={completingId}
                                                onDownloadPdf={onDownloadPdf}
                                                onOpenDetails={() => setSelectedJob(job)}
                                                onOpenComplete={() => {}}
                                            />
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    </div>
                )}
            </main>
            {selectedJob && (
                <JobDetailModal
                    job={selectedJob}
                    busy={updatingJob || completingId === selectedJob.id}
                    showComplete={showCompleteModal}
                    setShowComplete={setShowCompleteModal}
                    completeNotes={completeNotes}
                    setCompleteNotes={setCompleteNotes}
                    completeFiles={completeFiles}
                    setCompleteFiles={setCompleteFiles}
                    onClose={() => {
                        setSelectedJob(null);
                        setShowCompleteModal(false);
                        setCompleteFiles([]);
                    }}
                    onSaveEdits={saveJobEdits}
                    onDelete={deleteJob}
                    onComplete={async (note, files, notes) => {
                        await markCompleted(selectedJob, { completionNotes: note, files, notes });
                        setShowCompleteModal(false);
                        setCompleteFiles([]);
                    }}
                />
            )}
        </div>
    );
}

function JobDetailModal({
    job,
    busy,
    showComplete,
    setShowComplete,
    completeNotes,
    setCompleteNotes,
    completeFiles,
    setCompleteFiles,
    onClose,
    onSaveEdits,
    onDelete,
    onComplete,
}) {
    const [notes, setNotes] = useState(String(job.notes || ''));
    const done = isCompletedJob(job);
    const plate = String(job.plate || job.vehiclePlate || job.plaka || '—').trim();
    const purpose = humanPurposeLabel(job.purpose || job.servicePurpose || job.serviceReason);
    const sentDate = job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : '—';
    const completedDate = job.completedAt?.toDate ? job.completedAt.toDate().toLocaleString() : '—';
    const beforePhotos = Array.isArray(job.photoURLs) ? job.photoURLs : [];
    const afterPhotos = Array.isArray(job.completionPhotoURLs) ? job.completionPhotoURLs : [];

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div className="pal-modal w-full max-w-3xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{plate} · {purpose}</h3>
                    <button type="button" onClick={onClose} className="pal-btn pal-btn-sm">Close</button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm mb-4">
                    <div><span className="font-medium">Sent date:</span> {sentDate}</div>
                    <div><span className="font-medium">Completed date:</span> {completedDate}</div>
                </div>
                <div className="mb-3">
                    <label className="text-sm font-medium">Notes</label>
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-[var(--erpx-border)] p-2 bg-[var(--erpx-surface)] text-[var(--erpx-ink)]" rows={3} />
                </div>
                <div className="mb-3">
                    <p className="text-sm font-medium mb-1">Before photos</p>
                    <PhotoGrid urls={beforePhotos} />
                </div>
                <div className="mb-4">
                    <p className="text-sm font-medium mb-1">After photos</p>
                    <PhotoGrid urls={afterPhotos} />
                </div>
                {showComplete && !done && (
                    <div className="mb-4 rounded-lg border border-[var(--erpx-green-border)] bg-[var(--erpx-green-bg)] p-3">
                        <label className="text-sm font-medium">Completion note</label>
                        <textarea value={completeNotes} onChange={(e) => setCompleteNotes(e.target.value)} className="mt-1 w-full rounded border border-[var(--erpx-border)] p-2 bg-[var(--erpx-surface)] text-[var(--erpx-ink)]" rows={2} />
                        <label className="mt-2 block text-sm font-medium">Completion photos</label>
                        <input type="file" multiple accept="image/*" onChange={(e) => setCompleteFiles(Array.from(e.target.files || []))} />
                    </div>
                )}
                <div className="flex flex-wrap gap-2">
                    <AnimatedButton type="button" disabled={busy} onClick={() => onSaveEdits(job, notes)} className="pal-btn pal-btn-primary px-3 py-2 rounded text-sm">Save notes</AnimatedButton>
                    {!done && (
                        <AnimatedButton
                            type="button"
                            disabled={busy}
                            onClick={() => {
                                if (!showComplete) {
                                    setShowComplete(true);
                                    return;
                                }
                                onComplete(completeNotes, completeFiles, notes);
                            }}
                            className="pal-btn pal-btn-primary px-3 py-2 rounded text-sm"
                        >
                            {showComplete ? 'Confirm complete' : 'Complete'}
                        </AnimatedButton>
                    )}
                    <AnimatedButton type="button" disabled={busy} onClick={() => onDelete(job)} className="pal-btn pal-btn-danger px-3 py-2 rounded text-sm">Delete</AnimatedButton>
                </div>
            </div>
        </div>
    );
}

function JobCardBody({ job, done, plate, purpose, completingId, onDownloadPdf, onOpenDetails, onOpenComplete }) {
    return (
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-semibold text-lg">{plate}</span>
                    {done ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--erpx-green)]">
                            <CheckCircle className="w-3.5 h-3.5" />
                            Completed
                        </span>
                    ) : (
                        <span className="text-xs font-medium text-[var(--erpx-amber)]">Pending</span>
                    )}
                </div>
                <p className="text-sm text-[var(--erpx-ink-secondary)]">{purpose}</p>
                {job.notes ? (
                    <p className="text-xs text-[var(--erpx-ink-muted)] line-clamp-2">{String(job.notes)}</p>
                ) : null}
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
                <AnimatedButton
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onOpenDetails();
                    }}
                    className="pal-btn pal-btn-sm pal-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                >
                    Details
                </AnimatedButton>
                <AnimatedButton
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDownloadPdf(job);
                    }}
                    className="pal-btn pal-btn-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm"
                >
                    <Download className="w-4 h-4" />
                    PDF
                </AnimatedButton>
                {!done && (
                    <AnimatedButton
                        type="button"
                        disabled={completingId === job.id}
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenComplete();
                        }}
                        className="pal-btn pal-btn-sm pal-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium"
                    >
                        <CheckCircle className="w-4 h-4" />
                        {completingId === job.id ? 'Saving…' : 'Complete'}
                    </AnimatedButton>
                )}
            </div>
        </div>
    );
}

function PhotoGrid({ urls }) {
    const [preview, setPreview] = useState(null);
    if (!urls?.length) return <p className="text-xs text-slate-500">No photos.</p>;
    return (
        <>
            <div className="grid grid-cols-3 gap-2">
                {urls.map((url, index) => (
                    <button
                        key={url}
                        type="button"
                        className="block p-0 border-0 bg-transparent cursor-zoom-in"
                        onClick={() => setPreview({ startIndex: index })}
                    >
                        <img src={url} alt="" className="h-20 w-full object-cover rounded" loading="lazy" decoding="async" />
                    </button>
                ))}
            </div>
            {preview && (
                <ZoomableImageOverlay
                    images={urls}
                    startIndex={preview.startIndex}
                    onClose={() => setPreview(null)}
                />
            )}
        </>
    );
}

export function isGaragePortalRoute() {
    if (typeof window === 'undefined') return false;
    const hashFull = window.location.hash.replace(/^#/, '');
    const [hashPathPart] = hashFull.split('?');
    const hashPath = (hashPathPart || '').replace(/^\//, '').toLowerCase();
    const pathTrim = (window.location.pathname || '').replace(/^\/+|\/+$/g, '').toLowerCase();
    const lastSeg = pathTrim.split('/').filter(Boolean).pop() || '';
    if (hashPath === 'garage-portal' || pathTrim === 'garage-portal' || lastSeg === 'garage-portal') {
        return true;
    }
    try {
        const q = new URLSearchParams(window.location.search || '');
        const hashQuery = hashFull.includes('?') ? hashFull.slice(hashFull.indexOf('?') + 1) : '';
        const hq = new URLSearchParams(hashQuery);
        if (q.get('garagePortal') === '1' || q.get('garage') === 'portal' || hq.get('garagePortal') === '1') {
            return true;
        }
    } catch {
        /* ignore */
    }
    return false;
}
