import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, XCircle, AlertCircle, Info, X, FileText } from 'lucide-react';

const ToastContext = createContext(null);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([]);

    const showToast = useCallback((message, type = 'info', duration = 5000, detail = null) => {
        const id = Date.now() + Math.random();
        const toast = { id, message, type, duration, detail };

        setToasts((prev) => [...prev, toast]);

        if (duration > 0) {
            setTimeout(() => {
                setToasts((prev) => prev.filter((t) => t.id !== id));
            }, duration);
        }

        return id;
    }, []);

    const removeToast = useCallback((id) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const success = useCallback(
        (message, duration = 4200, detail = null) => showToast(message, 'success', duration, detail),
        [showToast]
    );

    const error = useCallback(
        (message, duration = 5200, detail = null) => showToast(message, 'error', duration, detail),
        [showToast]
    );

    const warning = useCallback(
        (message, duration = 4800, detail = null) => showToast(message, 'warning', duration, detail),
        [showToast]
    );

    const info = useCallback(
        (message, duration = 4200, detail = null) => showToast(message, 'info', duration, detail),
        [showToast]
    );

    /** Palantir export confirmation (PDF / report downloads). */
    const exportSuccess = useCallback(
        (message = 'Report exported', detail = null, duration = 4500) =>
            showToast(message, 'export', duration, detail),
        [showToast]
    );

    return (
        <ToastContext.Provider
            value={{ showToast, success, error, warning, info, exportSuccess, removeToast }}
        >
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

function ToastContainer({ toasts, onRemove }) {
    return (
        <div className="pal-toast-stack" aria-live="polite" aria-relevant="additions">
            <AnimatePresence mode="popLayout">
                {toasts.map((toast) => (
                    <PalToastItem key={toast.id} toast={toast} onRemove={onRemove} />
                ))}
            </AnimatePresence>
        </div>
    );
}

function PalToastItem({ toast, onRemove }) {
    const typeConfig = {
        success: { icon: CheckCircle, kicker: 'Success', className: 'pal-toast--success' },
        error: { icon: XCircle, kicker: 'Error', className: 'pal-toast--error' },
        warning: { icon: AlertCircle, kicker: 'Warning', className: 'pal-toast--warning' },
        info: { icon: Info, kicker: 'Notice', className: 'pal-toast--info' },
        export: { icon: FileText, kicker: 'Export complete', className: 'pal-toast--export' },
    };

    const config = typeConfig[toast.type] || typeConfig.info;
    const Icon = config.icon;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: -16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ type: 'spring', damping: 28, stiffness: 380, mass: 0.65 }}
            className={`pal-toast ${config.className}`}
            role="status"
        >
            <Icon className="pal-toast-icon" size={18} strokeWidth={2.25} />
            <div className="pal-toast-body">
                <p className="pal-toast-kicker">{config.kicker}</p>
                <p className="pal-toast-message">{toast.message}</p>
                {toast.detail ? <p className="pal-toast-detail">{toast.detail}</p> : null}
            </div>
            <button
                type="button"
                className="pal-toast-close"
                aria-label="Dismiss"
                onClick={() => onRemove(toast.id)}
            >
                <X size={15} />
            </button>
        </motion.div>
    );
}
