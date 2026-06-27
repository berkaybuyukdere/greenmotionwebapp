import React from 'react';

const toneClasses = {
    positive: 'gm-badge gm-badge-success',
    negative: 'gm-badge gm-badge-warning',
    neutral: 'gm-badge gm-badge-info',
};

export function ValueBadge({ tone = 'neutral', children }) {
    return <span className={toneClasses[tone] || toneClasses.neutral}>{children}</span>;
}
