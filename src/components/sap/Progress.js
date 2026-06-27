import React from 'react';

/**
 * SAP Fiori Progress Indicator Component
 */
export function SapProgress({ 
    value = 0, 
    max = 100,
    showLabel = false,
    size = 'medium',
    className = '' 
}) {
    const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
    
    const sizeClasses = {
        small: 'h-1',
        medium: 'h-2',
        large: 'h-3',
    };
    
    return (
        <div className={`w-full ${className}`}>
            {showLabel && (
                <div className="flex items-center justify-between mb-sap-2">
                    <span className="text-sap-sm text-sap-text-secondary dark:text-sap-textDark-secondary">
                        Progress
                    </span>
                    <span className="text-sap-sm font-medium text-sap-text-primary dark:text-sap-textDark-primary">
                        {Math.round(percentage)}%
                    </span>
                </div>
            )}
            <div className={`w-full bg-sap-bg-lightAlt dark:bg-sap-bgDark-dark rounded-full overflow-hidden ${sizeClasses[size]}`}>
                <div
                    className="h-full bg-sap-blue-500 dark:bg-sap-blue-600 transition-all duration-300 ease-out"
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}

/**
 * SAP Fiori Loading Spinner
 */
export function SapSpinner({ size = 'medium', className = '' }) {
    const sizeClasses = {
        small: 'w-4 h-4 border-2',
        medium: 'w-8 h-8 border-2',
        large: 'w-12 h-12 border-4',
    };
    
    return (
        <div className={`inline-block ${className}`}>
            <div
                className={`${sizeClasses[size]} border-sap-blue-200 dark:border-sap-blue-800 border-t-sap-blue-500 dark:border-t-sap-blue-600 rounded-full animate-spin`}
            />
        </div>
    );
}

