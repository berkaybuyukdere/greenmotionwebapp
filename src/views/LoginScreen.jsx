import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, KeyRound, Mail, X } from 'lucide-react';
import { useToast } from '../components/ToastNotification';
import { EUROPEAN_COUNTRIES } from '../components/AdminFranchiseDashboard';
import PalantirLoader from '../components/palantir/PalantirLoader';
import { auth, db, functionsApp } from '../firebase/client';
import { completeLogin } from '../firebase/authScope';
import { GM_SELECTED_FRANCHISE_KEY } from '../constants/sessionKeys';
import { isGlobalAdmin, userCanAccessFranchiseAtLogin } from '../utilities/userAccess';
import { isSabihaFranchiseId } from '../utilities/franchiseHelpers';
import { SITE_NAME, SITE_TAGLINE } from '../constants/siteBrand';

/** Login form — no raw provider strings in UI */
function mapLoginAuthError(err) {
    const code = String(err?.code || '');
    switch (code) {
        case 'auth/invalid-credential':
        case 'auth/wrong-password':
        case 'auth/user-not-found':
        case 'auth/invalid-login-credentials':
            return 'The email or password entered is incorrect. Please check your details and try again.';
        case 'auth/invalid-email':
            return 'Please enter a valid email address.';
        case 'auth/user-disabled':
            return 'This account cannot be used. Please contact your administrator.';
        case 'auth/too-many-requests':
            return 'Too many sign-in attempts. Please wait a moment and try again.';
        case 'auth/network-request-failed':
            return 'Connection failed. Check your network and try again.';
        case 'auth/operation-not-allowed':
            return 'This sign-in option is not available. Please contact your administrator.';
        default:
            return 'Sign-in could not be completed. Please verify your email and password and try again.';
    }
}

function AccountRecoveryPanel({
    recoveryEmail,
    setRecoveryEmail,
    recoveryBusy,
    passwordResetBusy,
    franchiseGateOk,
    onUsernameRecovery,
    onPasswordReset,
    onClose,
}) {
    return (
        <div className="pal-login-recovery-panel" role="dialog" aria-labelledby="login-recovery-title">
            <div className="pal-login-recovery-head">
                <div>
                    <p className="pal-login-recovery-eyebrow">Account access</p>
                    <h2 id="login-recovery-title" className="pal-login-recovery-title">
                        Recover credentials
                    </h2>
                    <p className="pal-login-recovery-sub">
                        Enter the email linked to your franchise account. We never reveal whether an address exists.
                    </p>
                </div>
                <button type="button" className="pal-login-recovery-close" onClick={onClose} aria-label="Close">
                    <X size={16} />
                </button>
            </div>

            <label htmlFor="login-recovery-email" className="pal-login-field-label">
                Email
            </label>
            <input
                id="login-recovery-email"
                type="email"
                autoComplete="email"
                value={recoveryEmail}
                onChange={(e) => setRecoveryEmail(e.target.value)}
                placeholder="name@company.com"
                className="pal-login-field"
            />

            <div className="pal-login-recovery-actions">
                <button
                    type="button"
                    disabled={recoveryBusy || !franchiseGateOk}
                    onClick={onUsernameRecovery}
                    className="pal-login-recovery-btn"
                >
                    <span className="pal-login-recovery-btn-icon">
                        <Mail size={16} />
                    </span>
                    <span className="pal-login-recovery-btn-copy">
                        <span className="pal-login-recovery-btn-title">
                            {recoveryBusy ? 'Sending reminder…' : 'Email username reminder'}
                        </span>
                        <span className="pal-login-recovery-btn-hint">
                            Sends your sign-in email if it matches this franchise
                        </span>
                    </span>
                </button>

                <button
                    type="button"
                    disabled={passwordResetBusy}
                    onClick={onPasswordReset}
                    className="pal-login-recovery-btn pal-login-recovery-btn--secondary"
                >
                    <span className="pal-login-recovery-btn-icon">
                        <KeyRound size={16} />
                    </span>
                    <span className="pal-login-recovery-btn-copy">
                        <span className="pal-login-recovery-btn-title">
                            {passwordResetBusy ? 'Sending reset link…' : 'Send password reset'}
                        </span>
                        <span className="pal-login-recovery-btn-hint">
                            Secure link to choose a new password
                        </span>
                    </span>
                </button>
            </div>

            {!franchiseGateOk && (
                <p className="pal-login-recovery-note">
                    Select country and franchise before requesting a username reminder.
                </p>
            )}
        </div>
    );
}

export function LoginScreen() {
    const toast = useToast();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [showForgotUsername, setShowForgotUsername] = useState(false);
    const [recoveryEmail, setRecoveryEmail] = useState('');
    const [recoveryBusy, setRecoveryBusy] = useState(false);
    const [passwordResetBusy, setPasswordResetBusy] = useState(false);
    const [intro, setIntro] = useState(false);
    const [selectedCountryId, setSelectedCountryId] = useState(() => {
        if (typeof window === 'undefined') return 'ch';
        return localStorage.getItem('gm_selected_country') || 'ch';
    });
    const [loginFranchises, setLoginFranchises] = useState([]);
    const [selectedFranchiseId, setSelectedFranchiseId] = useState(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem(GM_SELECTED_FRANCHISE_KEY) || '';
    });
    const [loadingFranchises, setLoadingFranchises] = useState(false);
    const [franchiseLoadError, setFranchiseLoadError] = useState('');

    const selectedCountry = EUROPEAN_COUNTRIES.find(c => c.id === selectedCountryId)
        || EUROPEAN_COUNTRIES.find(c => c.id === 'ch');

    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('gm_selected_country', selectedCountryId);
        }
    }, [selectedCountryId]);

    useEffect(() => {
        if (typeof window !== 'undefined' && selectedFranchiseId) {
            localStorage.setItem(GM_SELECTED_FRANCHISE_KEY, selectedFranchiseId);
        }
    }, [selectedFranchiseId]);

    useEffect(() => {
        let cancelled = false;
        const code = String(selectedCountry?.countryCode || 'CH').toUpperCase();
        setLoadingFranchises(true);
        setFranchiseLoadError('');
        setLoginFranchises([]);
        const run = async () => {
            try {
                const listFn = httpsCallable(functionsApp, 'listFranchisesForLogin');
                const res = await listFn({ countryCode: code });
                const rows = res?.data?.franchises || [];
                if (cancelled) return;
                setLoginFranchises(rows);
                const saved = (typeof window !== 'undefined' && localStorage.getItem(GM_SELECTED_FRANCHISE_KEY)) || '';
                if (rows.length === 1) {
                    setSelectedFranchiseId(String(rows[0].franchiseId || '').toUpperCase());
                } else if (saved && rows.some((r) => String(r.franchiseId || '').toUpperCase() === saved.toUpperCase())) {
                    setSelectedFranchiseId(saved.toUpperCase());
                } else {
                    setSelectedFranchiseId('');
                }
            } catch (e) {
                if (!cancelled) {
                    setFranchiseLoadError(e?.message || 'Could not load franchises');
                    setLoginFranchises([]);
                    setSelectedFranchiseId('');
                }
            } finally {
                if (!cancelled) setLoadingFranchises(false);
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [selectedCountryId]);

    useEffect(() => {
        const t = window.setTimeout(() => setIntro(true), 420);
        return () => clearTimeout(t);
    }, []);

    const franchiseGateOk =
        !loadingFranchises &&
        !franchiseLoadError &&
        loginFranchises.length > 0 &&
        (loginFranchises.length === 1 || (selectedFranchiseId && String(selectedFranchiseId).trim() !== ''));

    const closeRecovery = () => {
        setShowForgotUsername(false);
        setRecoveryEmail('');
    };

    const handleStartUsernameRecovery = async (e) => {
        e?.preventDefault?.();
        const em = String(recoveryEmail || email || '').trim().toLowerCase();
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            toast.error('Please enter a valid email address.');
            return;
        }
        if (!franchiseGateOk) {
            toast.error('Select country and franchise first.');
            return;
        }
        setRecoveryBusy(true);
        try {
            const fn = httpsCallable(functionsApp, 'startUsernameRecovery');
            const code = String(selectedCountry?.countryCode || 'CH').toUpperCase();
            const hint = String(selectedFranchiseId || '').trim().toUpperCase();
            await fn({
                email: em,
                countryCode: code,
                franchiseHint: hint || null,
            });
            toast.success('If an account matches, we sent a reminder to your email.');
            closeRecovery();
        } catch (err) {
            const code = String(err?.code || '');
            const msg =
                code === 'functions/not-found'
                    ? 'Account recovery service is unavailable. Try again later or contact support.'
                    : err?.message || 'Recovery request failed. Try again later.';
            toast.error(msg);
        } finally {
            setRecoveryBusy(false);
        }
    };

    const handleSendPasswordReset = async (e) => {
        e?.preventDefault?.();
        const em = String(recoveryEmail || email || '').trim().toLowerCase();
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            toast.error('Please enter a valid email address.');
            return;
        }
        setPasswordResetBusy(true);
        try {
            const fn = httpsCallable(functionsApp, 'sendCustomPasswordResetEmail');
            await fn({ email: em });
            toast.success('If this email is registered, check your inbox (and Spam) for a Vehicle Sentinel password reset message.');
            closeRecovery();
        } catch (err) {
            const code = String(err?.code || '');
            const msg = String(err?.message || '');
            const smtpMissing =
                code === 'functions/failed-precondition' &&
                msg.toLowerCase().includes('smtp_not_configured');
            const callableMissing = code === 'functions/not-found';
            const useFallback = smtpMissing || callableMissing;
            if (useFallback) {
                try {
                    await sendPasswordResetEmail(auth, em);
                    toast.success(
                        'Firebase sent a password reset link (generic template). Check Spam/Junk.'
                    );
                    closeRecovery();
                } catch (err2) {
                    if (String(err2?.code || '') === 'auth/too-many-requests') {
                        toast.error('Too many attempts. Please wait and try again.');
                    } else {
                        toast.error(err2?.message || 'Could not send reset email.');
                    }
                }
            } else if (code === 'auth/too-many-requests') {
                toast.error('Too many attempts. Please wait and try again.');
            } else {
                toast.error(err?.message || 'Could not send reset email.');
            }
        } finally {
            setPasswordResetBusy(false);
        }
    };

    const handleSubmit = async (e) => {
        e?.preventDefault?.();
        setError('');
        if (loading || !franchiseGateOk) return;
        setLoading(true);
        try {
            const credential = await signInWithEmailAndPassword(auth, email, password);
            const uid = credential.user.uid;
            const userRef = doc(db, 'users', uid);
            const userSnap = await getDoc(userRef);

            if (!userSnap.exists()) {
                await signOut(auth);
                const msg =
                    'No profile exists for this account. If you need access, please contact your administrator.';
                setError(msg);
                toast.error(msg);
                return;
            }

            const profile = userSnap.data();
            if (profile?.isActive === false) {
                await signOut(auth);
                const msg = 'This account is not active. Please contact your administrator.';
                setError(msg);
                toast.error(msg);
                return;
            }

            const skipCountryGate = isGlobalAdmin(profile);

            if (!skipCountryGate) {
                const expectedCountryCode = String(selectedCountry?.countryCode || 'CH').toUpperCase();
                const profileCountryCode = String(profile?.countryCode || '').toUpperCase();
                const selectedFUpper = String(selectedFranchiseId || '').trim().toUpperCase();

                if (profileCountryCode !== expectedCountryCode) {
                    await signOut(auth);
                    const msg =
                        'The selected country does not match your account. Choose the region assigned to your profile or contact support.';
                    setError(msg);
                    toast.error(msg);
                    return;
                }
                if (
                    selectedFUpper &&
                    !userCanAccessFranchiseAtLogin(profile, selectedFUpper, expectedCountryCode)
                ) {
                    await signOut(auth);
                    const msg =
                        'The selected franchise does not match your account. Pick a location you are assigned to.';
                    setError(msg);
                    toast.error(msg);
                    return;
                }
            }

            await completeLogin(uid);
        } catch (err) {
            const msg = mapLoginAuthError(err);
            setError(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={`pal-login-root ${intro ? 'pal-login-root--ready' : ''}`}>
            <div className="fd-login-brand" aria-hidden="true">
                <div className="fd-login-brand-top">
                    <div className="fd-login-logo">VS</div>
                    <div className="fd-login-wordmark">VehicleSentinel</div>
                    <div className="fd-login-platform-chip">FLEET OPS PLATFORM</div>
                </div>
                <div className="fd-login-brand-copy">
                    <div className="fd-login-headline">
                        Operational command for your entire rental fleet.
                    </div>
                    <div className="fd-login-sub">
                        Checkouts, returns, damage intelligence, deposits and franchise
                        finance — one dense, auditable workspace across every franchise.
                    </div>
                </div>
                <div className="fd-login-build">
                    ROLE-SCOPED ACCESS · ALL SESSIONS AUDITED · WHEELSYS LINK
                </div>
            </div>
            <div className="pal-login-shell relative z-10">
                <div className="pal-login-card">
                    {isSabihaFranchiseId(selectedFranchiseId) && (
                        <header className="pal-login-brand pal-login-brand--partner-only">
                            <img
                                src="/usave-logo.png"
                                alt="U-SAVE"
                                className="pal-login-partner-logo"
                            />
                        </header>
                    )}

                    <div className="pal-login-card-head fd-section-head">
                        <span className="pal-login-card-eyebrow">Sign in</span>
                        <span className="fd-section-head-meta fd-login-nominal">
                            <span className="fd-pulse-dot" /> Systems nominal
                        </span>
                    </div>

                    <form aria-live="polite" onSubmit={handleSubmit} className="pal-login-form">
                        <div className="pal-login-field-row">
                            <div className="pal-login-field-group">
                                <label htmlFor="login-country" className="pal-login-field-label">
                                    Country
                                </label>
                                <select
                                    id="login-country"
                                    className="pal-login-field"
                                    value={selectedCountryId}
                                    onChange={(e) => setSelectedCountryId(e.target.value)}
                                >
                                    {EUROPEAN_COUNTRIES.map((country) => (
                                        <option key={country.id} value={country.id}>
                                            {country.flag} {country.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="pal-login-field-group">
                                <label htmlFor="login-franchise" className="pal-login-field-label">
                                    Franchise
                                </label>
                                {loadingFranchises && (
                                    <div className="pal-login-loader-wrap">
                                        <PalantirLoader label="Loading locations…" size="sm" />
                                    </div>
                                )}
                                {franchiseLoadError && (
                                    <p className="pal-login-inline-error">{franchiseLoadError}</p>
                                )}
                                {!loadingFranchises && !franchiseLoadError && loginFranchises.length === 0 && (
                                    <p className="pal-login-inline-warn">No active franchise for this country.</p>
                                )}
                                {!loadingFranchises && !franchiseLoadError && loginFranchises.length === 1 && (
                                    <div id="login-franchise" className="pal-login-franchise-pill">
                                        <span>{loginFranchises[0].flag || ''}</span>
                                        <span className="truncate">{loginFranchises[0].name}</span>
                                    </div>
                                )}
                                {!loadingFranchises && !franchiseLoadError && loginFranchises.length > 1 && (
                                    <select
                                        id="login-franchise"
                                        className="pal-login-field"
                                        value={selectedFranchiseId}
                                        onChange={(e) => setSelectedFranchiseId(e.target.value)}
                                    >
                                        <option value="">Select franchise…</option>
                                        {loginFranchises.map((f) => (
                                            <option key={f.id || f.franchiseId} value={String(f.franchiseId || '').toUpperCase()}>
                                                {(f.flag || '') + ' ' + (f.name || f.franchiseId)}
                                            </option>
                                        ))}
                                    </select>
                                )}
                            </div>
                        </div>

                        <div className="pal-login-field-group">
                            <label htmlFor="login-email" className="pal-login-field-label">
                                Email
                            </label>
                            <input
                                id="login-email"
                                type="email"
                                autoComplete="username"
                                className="pal-login-field"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@company.com"
                            />
                        </div>

                        <div className="pal-login-field-group">
                            <label htmlFor="login-password" className="pal-login-field-label">
                                Password
                            </label>
                            <input
                                id="login-password"
                                type="password"
                                autoComplete="current-password"
                                className="pal-login-field"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                            />
                        </div>

                        {error && (
                            <div role="alert" className="pal-login-error">
                                <AlertCircle className="shrink-0 text-red-400" size={18} />
                                <p>{error}</p>
                            </div>
                        )}

                        <div className="pal-login-form-footer">
                            {!showForgotUsername ? (
                                <button
                                    type="button"
                                    className="pal-login-forgot-btn"
                                    onClick={() => {
                                        setRecoveryEmail(email);
                                        setShowForgotUsername(true);
                                    }}
                                >
                                    <KeyRound size={14} />
                                    <span>Forgot username or password?</span>
                                </button>
                            ) : (
                                <AccountRecoveryPanel
                                    recoveryEmail={recoveryEmail}
                                    setRecoveryEmail={setRecoveryEmail}
                                    recoveryBusy={recoveryBusy}
                                    passwordResetBusy={passwordResetBusy}
                                    franchiseGateOk={franchiseGateOk}
                                    onUsernameRecovery={handleStartUsernameRecovery}
                                    onPasswordReset={handleSendPasswordReset}
                                    onClose={closeRecovery}
                                />
                            )}

                            <button
                                type="submit"
                                className="pal-login-submit"
                                disabled={loading || !franchiseGateOk}
                            >
                                {loading ? 'Signing in…' : 'Sign in'}
                            </button>
                        </div>
                    </form>

                    <p className="pal-login-footnote">
                        Franchise-scoped access · encrypted session
                    </p>
                </div>
            </div>
        </div>
    );
}
