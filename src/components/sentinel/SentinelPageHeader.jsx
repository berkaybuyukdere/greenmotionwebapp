import React from 'react';

export function SentinelPageHeader({ breadcrumb, title, subtitle, actions }) {
    return (
        <div className="page-header">
            <div className="page-title-group">
                <div className="page-breadcrumb">
                    Sentinel / <span>{breadcrumb || title}</span>
                </div>
                <div className="page-title">{title}</div>
                {subtitle ? <div className="page-subtitle">{subtitle}</div> : null}
            </div>
            {actions ? <div className="page-actions">{actions}</div> : null}
        </div>
    );
}
