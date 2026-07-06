import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

/**
 * Animated Modal — reference1 design system
 */
export const AnimatedModal = ({
    isOpen,
    onClose,
    children,
    title,
    size = 'medium',
    className = '',
    variant = 'center'
}) => {
    const sizeClasses = {
        small:  'max-w-md',
        medium: 'max-w-2xl',
        large:  'max-w-4xl',
        full:   'max-w-6xl',
    };
    const isDrawer = variant === 'drawer';

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="fixed inset-0 bg-black/65 z-50"
                        onClick={onClose}
                    />

                    {/* Modal content */}
                    <div className={`fixed inset-0 z-50 flex pointer-events-none ${isDrawer ? 'items-stretch justify-end' : 'items-center justify-center p-4'}`}>
                        <motion.div
                            initial={isDrawer ? { opacity: 0, x: 32 } : { opacity: 0, scale: 0.96, y: 16 }}
                            animate={isDrawer ? { opacity: 1, x: 0 } : { opacity: 1, scale: 1, y: 0 }}
                            exit={isDrawer ? { opacity: 0, x: 32 } : { opacity: 0, scale: 0.96, y: 16 }}
                            transition={isDrawer ? { type: 'tween', duration: 0.2 } : { type: 'spring', damping: 26, stiffness: 320 }}
                            role="dialog"
                            className={
                                isDrawer
                                    ? `pal-modal-drawer overflow-y-auto pointer-events-auto ${className}`
                                    : `pal-modal ${sizeClasses[size] || sizeClasses.medium} w-full max-h-[90vh] overflow-y-auto pointer-events-auto ${className}`
                            }
                            onClick={(e) => e.stopPropagation()}
                        >
                            {title && (
                                <div className="flex justify-between items-center px-6 py-4 border-b border-[var(--erpx-border)] bg-[var(--erpx-subtle)]">
                                    <h2 className="text-base font-semibold text-[var(--erpx-ink)]">
                                        {title}
                                    </h2>
                                    <button
                                        onClick={onClose}
                                        className="p-1.5 hover:bg-[var(--erpx-muted)] rounded-md transition-colors text-[var(--erpx-ink-muted)]"
                                        style={{ minHeight: 'unset', padding: '0.375rem' }}
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            )}
                            <div className={title ? 'px-6 py-5' : ''}>
                                {children}
                            </div>
                        </motion.div>
                    </div>
                </>
            )}
        </AnimatePresence>
    );
};
