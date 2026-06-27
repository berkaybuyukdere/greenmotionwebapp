// Centralized visual reference tokens/classes for the whole UI.
// Every new button and metric style should be derived from here.
export const DESIGN_REFERENCE = {
    button: {
        base: 'gm-btn',
        variants: {
            primary: 'gm-btn-primary',
            secondary: 'gm-btn-secondary',
            ghost: 'gm-btn-ghost',
            danger: 'gm-btn-danger',
            success: 'gm-btn-success',
            emphasized: 'gm-btn-primary',
        },
        sizes: {
            small: 'gm-btn-sm',
            medium: 'gm-btn-md',
            large: 'gm-btn-lg',
        },
    },
    text: {
        metric: 'gm-metric-value',
        price: 'gm-price-value',
    },
};

