import React from 'react';

/**
 * Table Component — Stripe gm-table design system
 */
export function SapTable({
    columns = [],
    data = [],
    onRowClick,
    selectedRows = [],
    className = ''
}) {
    return (
        <div className={`gm-table-wrap overflow-x-auto ${className}`}>
            <table className="gm-table">
                <thead>
                    <tr>
                        {columns.map((col, idx) => (
                            <th
                                key={idx}
                                className={col.className || ''}
                                style={{ width: col.width }}
                            >
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {data.length === 0 ? (
                        <tr>
                            <td colSpan={columns.length} className="text-center gm-table-muted py-10">
                                No data available
                            </td>
                        </tr>
                    ) : (
                        data.map((row, rowIdx) => (
                            <tr
                                key={rowIdx}
                                onClick={() => onRowClick && onRowClick(row, rowIdx)}
                                className={selectedRows.includes(rowIdx) ? '!bg-[var(--erpx-brand-light)]' : ''}
                                style={onRowClick ? { cursor: 'pointer' } : undefined}
                            >
                                {columns.map((col, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className={col.className || ''}
                                    >
                                        {col.render ? col.render(row[col.key], row, rowIdx) : row[col.key]}
                                    </td>
                                ))}
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
    );
}
