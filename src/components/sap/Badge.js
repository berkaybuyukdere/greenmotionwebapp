import React from 'react';

/**
 * SAP Fiori Badge Component
 */
export function SapBadge({ 
    children, 
    variant = 'neutral',
    size = 'medium',
    className = '' 
}) {
    const variantClasses = {
        positive: 'bg-green-100 text-sap-semantic-positive dark:bg-green-900 dark:text-green-300',
        negative: 'bg-red-100 text-sap-semantic-negative dark:bg-red-900 dark:text-red-300',
        critical: 'bg-orange-100 text-sap-semantic-critical dark:bg-orange-900 dark:text-orange-300',
        informative: 'bg-blue-100 text-sap-semantic-informative dark:bg-blue-900 dark:text-blue-300',
        neutral: 'bg-gray-100 text-sap-semantic-neutral dark:bg-gray-700 dark:text-gray-300',
    };
    
    const sizeClasses = {
        small: 'px-sap-2 py-sap-1 text-sap-xs',
        medium: 'px-sap-3 py-sap-1 text-sap-sm',
        large: 'px-sap-4 py-sap-2 text-sap-base',
    };
    
    return (
        <span className={`inline-flex items-center rounded-full font-medium ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}>
            {children}
        </span>
    );
}

