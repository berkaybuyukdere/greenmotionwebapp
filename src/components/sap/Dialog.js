import React, { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Dialog Component — reference1 design system
 */
export function SapDialog({
    isOpen,
    onClose,
    title,
    children,
    footer,
    size = 'medium',
    className = ''
}) {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (e) => {
            if (e.key === 'Escape' && isOpen) onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const sizeClasses = {
        small:  'max-w-md',
        medium: 'max-w-2xl',
        large:  'max-w-4xl',
        xlarge: 'max-w-6xl',
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div className="absolute inset-0 bg-black/50 dark:bg-black/70" />
            <div
                role="dialog"
                className={`relative bg-white dark:bg-sap-bgDark-dark rounded-xl border border-gray-200 dark:border-sap-borderDark-light shadow-2xl ${sizeClasses[size]} w-full max-h-[90vh] flex flex-col ${className}`}
                onClick={(e) => e.stopPropagation()}
            >
                {title && (
                    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-sap-borderDark-light">
                        <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                            {title}
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-gray-100 dark:hover:bg-sap-bgDark-input rounded-md transition-colors text-gray-500 dark:text-gray-400"
                            style={{ minHeight: 'unset', padding: '0.375rem' }}
                            aria-label="Close"
                        >
                            <X size={16} />
                        </button>
                    </div>
                )}
                <div className="flex-1 overflow-y-auto px-6 py-5">
                    {children}
                </div>
                {footer && (
                    <div className="px-6 py-4 border-t border-gray-200 dark:border-sap-borderDark-light flex items-center justify-end gap-2">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}
