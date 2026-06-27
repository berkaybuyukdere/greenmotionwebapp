import React from 'react';
import { motion } from 'framer-motion';

/**
 * Chart Container — reference1 design system
 */
export const ChartContainer = ({
    children,
    title,
    icon,
    className = '',
    delay = 0
}) => {
    return (
        <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay, ease: 'easeOut' }}
            className={`bg-white dark:bg-sap-bgDark-dark rounded-xl border border-gray-200 dark:border-sap-borderDark-light p-5 hover:shadow-md transition-shadow ${className}`}
        >
            {title && (
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    {icon && <span className="text-gray-500 dark:text-gray-400">{icon}</span>}
                    {title}
                </h3>
            )}
            <div>
                {children}
            </div>
        </motion.div>
    );
};
