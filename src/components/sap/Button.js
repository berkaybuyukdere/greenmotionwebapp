import React from 'react';
import { DESIGN_REFERENCE } from '../../design/designReference';

/**
 * Stripe ERPX Button — maps to gm-btn design tokens
 */
export function SapButton({
    children,
    variant = 'primary',
    size = 'medium',
    disabled = false,
    icon,
    iconPosition = 'left',
    className = '',
    ...props
}) {
    const variantClasses = {
        primary: DESIGN_REFERENCE.button.variants.primary,
        secondary: DESIGN_REFERENCE.button.variants.secondary,
        ghost: DESIGN_REFERENCE.button.variants.ghost,
        emphasized: DESIGN_REFERENCE.button.variants.emphasized,
        danger: DESIGN_REFERENCE.button.variants.danger,
        success: DESIGN_REFERENCE.button.variants.success,
    };

    const sizeClasses = {
        small: DESIGN_REFERENCE.button.sizes.small,
        medium: DESIGN_REFERENCE.button.sizes.medium,
        large: DESIGN_REFERENCE.button.sizes.large,
    };

    const classes = `${DESIGN_REFERENCE.button.base} ${variantClasses[variant] || variantClasses.primary} ${sizeClasses[size] || sizeClasses.medium} ${className}`.trim();

    return (
        <button className={classes} disabled={disabled} {...props}>
            {icon && iconPosition === 'left' && <span className="flex-shrink-0">{icon}</span>}
            {children}
            {icon && iconPosition === 'right' && <span className="flex-shrink-0">{icon}</span>}
        </button>
    );
}
