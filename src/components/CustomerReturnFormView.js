import React, { useEffect, useRef, useState } from 'react';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, PenLine, Trash2 } from 'lucide-react';

function isSubmittedData(data) {
    if (!data) return false;
    if (data.submittedAt) return true;
    const sig = data.signatureBase64;
    return typeof sig === 'string' && sig.length > 40;
}

function portalBranding(franchiseId, formKind) {
    const fr = String(franchiseId || '').toUpperCase();
    const action = formKind === 'checkout' ? 'Check-out' : 'Return';
    if (fr.startsWith('DE')) return { office: 'Germany · Green Motion', action: `Vehicle ${action}` };
    if (fr.startsWith('TR')) return { office: 'Türkiye · Green Motion', action: `Vehicle ${action}` };
    return { office: 'Green Motion', action: `Vehicle ${action}` };
}

function SignaturePad({ onSignatureChange }) {
    const canvasRef = useRef(null);
    const drawingRef = useRef(false);
    const lastRef = useRef({ x: 0, y: 0 });
    const [hasSignature, setHasSignature] = useState(false);
    const CSS_W = 640;
    const CSS_H = 160;

    const getPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const scaleX = CSS_W / rect.width;
        const scaleY = CSS_H / rect.height;
        const src = e.touches ? e.touches[0] : e;
        return {
            x: (src.clientX - rect.left) * scaleX,
            y: (src.clientY - rect.top) * scaleY,
        };
    };

    const startDraw = (e) => {
        e.preventDefault();
        drawingRef.current = true;
        const pos = getPos(e);
        lastRef.current = pos;
        const ctx = canvasRef.current.getContext('2d');
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 1.1, 0, Math.PI * 2);
        ctx.fill();
    };

    const draw = (e) => {
        e.preventDefault();
        if (!drawingRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(lastRef.current.x, lastRef.current.y);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        lastRef.current = pos;
        setHasSignature(true);
        onSignatureChange(exportSignature(canvas));
    };

    const endDraw = () => {
        drawingRef.current = false;
    };

    const clear = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CSS_W, CSS_H);
        ctx.fillStyle = '#0f172a';
        setHasSignature(false);
        onSignatureChange(null);
    };

    const exportSignature = (canvas) => {
        try {
            const png = canvas.toDataURL('image/png');
            return png.replace(/^data:image\/\w+;base64,/, '');
        } catch {
            const off = document.createElement('canvas');
            off.width = CSS_W;
            off.height = CSS_H;
            const offCtx = off.getContext('2d');
            offCtx.fillStyle = '#ffffff';
            offCtx.fillRect(0, 0, CSS_W, CSS_H);
            offCtx.drawImage(canvas, 0, 0);
            return off.toDataURL('image/jpeg', 0.82).replace(/^data:image\/\w+;base64,/, '');
        }
    };

    useEffect(() => {
        const canvas = canvasRef.current;
        canvas.width = CSS_W;
        canvas.height = CSS_H;
        const ctx = canvas.getContext('2d');
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, CSS_W, CSS_H);
        ctx.fillStyle = '#0f172a';
    }, []);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erpx-ink-muted)]">
                    Signature <span className="text-red-500">*</span>
                </p>
                {hasSignature && (
                    <button
                        type="button"
                        onClick={clear}
                        className="flex items-center gap-1 text-[11px] font-semibold text-[var(--erpx-ink-muted)] hover:text-red-500"
                    >
                        <Trash2 size={12} /> Clear
                    </button>
                )}
            </div>
            <div className="relative rounded border border-[var(--erpx-border)] bg-white overflow-hidden touch-none">
                {!hasSignature && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <PenLine size={22} className="text-[var(--erpx-ink-muted)] mb-1" />
                        <span className="text-[10px] text-[var(--erpx-ink-muted)] tracking-wide">Sign here</span>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    className="w-full h-[148px] cursor-crosshair"
                    style={{ touchAction: 'none' }}
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={endDraw}
                />
            </div>
        </div>
    );
}

/**
 * Public customer self-fill (return or checkout) — SPA fallback when not on static HTML.
 */
export function CustomerReturnFormView({ db, token, franchiseId, formKind = 'return' }) {
    const collectionName = formKind === 'checkout' ? 'checkoutFormData' : 'returnFormData';
    const brand = portalBranding(franchiseId, formKind);

    const [step, setStep] = useState('loading');
    const [errorMsg, setErrorMsg] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [email, setEmail] = useState('');
    const [signatureBase64, setSignatureBase64] = useState(null);

    const docRef = () => doc(db, 'franchises', franchiseId, collectionName, token);

    useEffect(() => {
        if (!token || !franchiseId) {
            setErrorMsg('Invalid link — missing token or franchise.');
            setStep('error');
            return;
        }
        getDoc(docRef())
            .then((snap) => {
                if (snap.exists() && isSubmittedData(snap.data())) {
                    setStep('already_submitted');
                } else {
                    setStep('form');
                }
            })
            .catch((err) => {
                console.error('CustomerReturnForm check error:', err);
                setStep('form');
            });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, token, franchiseId, collectionName]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!signatureBase64 || signatureBase64.length < 40) {
            setErrorMsg('Please sign before submitting.');
            return;
        }
        setSubmitting(true);
        setErrorMsg('');
        try {
            const ref = docRef();
            const existing = await getDoc(ref);
            if (existing.exists() && isSubmittedData(existing.data())) {
                setStep('already_submitted');
                return;
            }
            const payload = {
                token,
                franchiseId,
                firstName: firstName.trim(),
                lastName: lastName.trim(),
                email: email.trim().toLowerCase(),
                signatureBase64,
                submittedAt: new Date().toISOString(),
            };
            if (!existing.exists()) {
                await setDoc(ref, payload);
            } else {
                await updateDoc(ref, payload);
            }
            setStep('success');
        } catch (err) {
            console.error('CustomerReturnForm submit error:', err);
            if (err?.code === 'permission-denied') {
                try {
                    const snap = await getDoc(docRef());
                    if (snap.exists() && isSubmittedData(snap.data())) {
                        setStep('already_submitted');
                        return;
                    }
                } catch {
                    /* ignore */
                }
                setErrorMsg('Permission denied. Ask staff to refresh the QR code.');
            } else {
                setErrorMsg(err?.message || 'Submission failed. Please try again.');
            }
            setStep('error');
        } finally {
            setSubmitting(false);
        }
    };

    const note =
        formKind === 'checkout'
            ? 'Used only for check-out processing. Your signature confirms collection details.'
            : 'Used only for return processing. Your signature confirms handover details.';

    return (
        <div className="min-h-screen bg-[#e8eaed] text-[var(--erpx-ink)] flex flex-col items-center py-8 px-4">
            <div className="w-full max-w-md mb-5 px-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--erpx-ink-muted)]">
                    {brand.office}
                </p>
                <h1 className="text-xl font-bold tracking-tight mt-1">{brand.action}</h1>
                <p className="text-sm text-[var(--erpx-ink-muted)] mt-1">Customer self-fill</p>
            </div>

            <div className="w-full max-w-md">
                <AnimatePresence mode="wait">
                    {step === 'loading' && (
                        <motion.div
                            key="loading"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="pal-dash-panel p-8 text-center"
                        >
                            <div className="w-9 h-9 border-2 border-[var(--erpx-border)] border-t-[var(--erpx-brand)] rounded-full animate-spin mx-auto mb-3" />
                            <p className="text-sm text-[var(--erpx-ink-muted)]">Loading form…</p>
                        </motion.div>
                    )}

                    {step === 'form' && (
                        <motion.form
                            key="form"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            onSubmit={handleSubmit}
                            className="pal-dash-panel border border-[var(--erpx-border)] rounded p-5 space-y-4 bg-white"
                        >
                            <p className="text-[11px] text-[var(--erpx-ink-muted)] leading-relaxed">{note}</p>

                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erpx-ink-muted)] mb-1.5">
                                    First name
                                </p>
                                <input
                                    required
                                    type="text"
                                    value={firstName}
                                    onChange={(e) => setFirstName(e.target.value)}
                                    autoComplete="given-name"
                                    className="gm-field"
                                    placeholder="John"
                                />
                            </div>

                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erpx-ink-muted)] mb-1.5">
                                    Last name
                                </p>
                                <input
                                    required
                                    type="text"
                                    value={lastName}
                                    onChange={(e) => setLastName(e.target.value)}
                                    autoComplete="family-name"
                                    className="gm-field"
                                    placeholder="Smith"
                                />
                            </div>

                            <div>
                                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--erpx-ink-muted)] mb-1.5">
                                    Email
                                </p>
                                <input
                                    required
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    autoComplete="email"
                                    inputMode="email"
                                    className="gm-field"
                                    placeholder="you@example.com"
                                />
                            </div>

                            <SignaturePad onSignatureChange={setSignatureBase64} />

                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full py-3 rounded pal-btn pal-btn-primary disabled:opacity-50 font-semibold text-sm"
                            >
                                {submitting ? 'Submitting…' : 'Submit details'}
                            </button>
                        </motion.form>
                    )}

                    {step === 'success' && (
                        <motion.div key="success" className="pal-dash-panel p-8 text-center bg-white">
                            <CheckCircle size={44} className="text-green-600 mx-auto mb-3" />
                            <h2 className="text-lg font-bold mb-2">Thank you</h2>
                            <p className="text-sm text-[var(--erpx-ink-muted)]">
                                Your details were sent to the rental team. You may close this page.
                            </p>
                        </motion.div>
                    )}

                    {step === 'already_submitted' && (
                        <motion.div key="already" className="pal-dash-panel p-8 text-center bg-white">
                            <CheckCircle size={44} className="text-blue-600 mx-auto mb-3" />
                            <h2 className="text-lg font-bold mb-2">Already submitted</h2>
                            <p className="text-sm text-[var(--erpx-ink-muted)]">
                                Your details were already received. You may close this page.
                            </p>
                        </motion.div>
                    )}

                    {step === 'error' && (
                        <motion.div key="error" className="pal-dash-panel p-8 text-center bg-white border-red-200">
                            <p className="text-red-600 font-semibold mb-2">Something went wrong</p>
                            <p className="text-sm text-[var(--erpx-ink-muted)]">{errorMsg}</p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

export default CustomerReturnFormView;
