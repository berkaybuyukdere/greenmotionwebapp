import React from 'react';
import { motion } from 'framer-motion';
import { MiniStockChart } from './MiniStockChart';
import { ValueBadge } from './ValueBadge';

export function DashboardCard({
    title,
    icon,
    badgeText,
    badgeTone = 'neutral',
    value,
    delta,
    deltaTone = 'neutral',
    chartData = [],
    chartId,
    onClick,
    selected = false,
    subtitle,
    formatChartValue,
}) {
    const deltaClass =
        deltaTone === 'positive'
            ? 'text-[#1A9E6A]'
            : deltaTone === 'negative'
              ? 'text-[#C0123C]'
              : 'text-[#697386]';

    return (
        <motion.button
            type="button"
            onClick={onClick}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.18 }}
            className={`gm-dash-card ${selected ? 'gm-dash-card-selected' : ''}`}
        >
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[#8898aa] dark:text-[#9ca3af] shrink-0">{icon}</span>
                    <span className="gm-dash-card-title truncate">{title}</span>
                </div>
                {badgeText ? <ValueBadge tone={badgeTone}>{badgeText}</ValueBadge> : null}
            </div>

            <div className="gm-dash-card-value">{value}</div>

            {delta ? <div className={`gm-dash-card-delta ${deltaClass}`}>{delta}</div> : null}

            <div className="gm-dash-card-chart">
                <MiniStockChart data={chartData} id={chartId} formatValue={formatChartValue} />
            </div>

            {subtitle ? <div className="gm-dash-card-footer">{subtitle}</div> : null}
        </motion.button>
    );
}
