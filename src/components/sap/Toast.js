import React, { useEffect, useState } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

/**
 * SAP Fiori Toast/Message Component
 */
export function SapToast({ 
    message, 
    type = 'info', 
    duration = 5000,
    onClose 
}) {
    const [isVisible, setIsVisible] = useState(true);
    
    useEffect(() => {
        if (duration > 0) {
            const timer = setTimeout(() => {
                setIsVisible(false);
                setTimeout(() => onClose && onClose(), 300);
            }, duration);
            return () => clearTimeout(timer);
        }
    }, [duration, onClose]);
    
    const typeConfig = {
        success: {
            icon: CheckCircle,
            bg: 'bg-green-50 dark:bg-green-900/20',
            border: 'border-green-200 dark:border-green-800',
            text: 'text-green-800 dark:text-green-300',
            iconColor: 'text-green-600 dark:text-green-400',
        },
        error: {
            icon: XCircle,
            bg: 'bg-red-50 dark:bg-red-900/20',
            border: 'border-red-200 dark:border-red-800',
            text: 'text-red-800 dark:text-red-300',
            iconColor: 'text-red-600 dark:text-red-400',
        },
        warning: {
            icon: AlertCircle,
            bg: 'bg-orange-50 dark:bg-orange-900/20',
            border: 'border-orange-200 dark:border-orange-800',
            text: 'text-orange-800 dark:text-orange-300',
            iconColor: 'text-orange-600 dark:text-orange-400',
        },
        info: {
            icon: Info,
            bg: 'bg-blue-50 dark:bg-blue-900/20',
            border: 'border-blue-200 dark:border-blue-800',
            text: 'text-blue-800 dark:text-blue-300',
            iconColor: 'text-blue-600 dark:text-blue-400',
        },
    };
    
    const config = typeConfig[type];
    const Icon = config.icon;
    
    if (!isVisible) return null;
    
    return (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-sap-3 px-sap-4 py-sap-3 rounded-sap-md shadow-sap-2 border ${config.bg} ${config.border} animate-slide-down max-w-md`}>
            <Icon className={`${config.iconColor} flex-shrink-0`} size={20} />
            <p className={`flex-1 text-sap-sm font-medium ${config.text}`}>
                {message}
            </p>
            <button
                onClick={() => {
                    setIsVisible(false);
                    setTimeout(() => onClose && onClose(), 300);
                }}
                className={`${config.text} hover:opacity-70 transition-opacity`}
            >
                <X size={16} />
            </button>
        </div>
    );
}

/**
 * Toast Container for managing multiple toasts
 */
export function ToastContainer({ toasts = [], onRemove }) {
    return (
        <div className="fixed top-4 right-4 z-50 space-y-sap-2">
            {toasts.map((toast) => (
                <SapToast
                    key={toast.id}
                    message={toast.message}
                    type={toast.type}
                    duration={toast.duration}
                    onClose={() => onRemove && onRemove(toast.id)}
                />
            ))}
        </div>
    );
}

