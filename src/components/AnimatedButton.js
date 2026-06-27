import React from 'react';
import { motion } from 'framer-motion';

/**
 * Animated Button — reference1 design system
 * Clean, flat buttons with subtle spring interaction.
 */
export const AnimatedButton = ({
    children,
    onClick,
    className = '',
    disabled = false,
    variant = 'primary',
    size = 'medium',
    icon,
    iconPosition = 'left',
    ...props
}) => {
    const handleClick = (e) => {
        if (disabled) return;
        if (onClick) onClick(e);
    };

    const base = 'gm-btn relative inline-flex items-center justify-center gap-2 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed';

    const variants = {
        primary: 'gm-btn-primary',
        secondary: 'gm-btn-secondary',
        danger: 'gm-btn-danger',
        success: 'gm-btn-success',
        ghost: 'gm-btn-ghost',
    };

    const sizes = {
        small: 'gm-btn-sm',
        medium: 'gm-btn-md',
        large: 'gm-btn-lg',
    };

    const classes = `${base} ${variants[variant] || variants.primary} ${sizes[size] || sizes.medium} ${className}`;

    return (
        <motion.button
            className={classes}
            onClick={handleClick}
            disabled={disabled}
            whileHover={{ scale: disabled ? 1 : 1.01 }}
            whileTap={{ scale: disabled ? 1 : 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
            {...props}
        >
            {icon && iconPosition === 'left'  && <span className="flex-shrink-0">{icon}</span>}
            <span className="flex items-center gap-1.5">{children}</span>
            {icon && iconPosition === 'right' && <span className="flex-shrink-0">{icon}</span>}
        </motion.button>
    );
};
