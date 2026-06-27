import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Palantir table footer with working pagination (replaces display-only StripeTableFooter).
 */
export function PalantirTablePager({
    totalItems,
    rangeFrom,
    rangeTo,
    page,
    totalPages,
    pageSize,
    pageSizeOptions = [25, 50, 100],
    onPageChange,
    onPageSizeChange,
    totalLabel,
}) {
    return (
        <div className="pal-table-pager">
            <span className="pal-table-pager-count">
                {totalItems === 0 ? (
                    <>No items</>
                ) : (
                    <>
                        Showing <strong>{rangeFrom}</strong>–<strong>{rangeTo}</strong> of{' '}
                        <strong>{totalItems}</strong>
                        {totalLabel ? ` · ${totalLabel}` : ''}
                    </>
                )}
            </span>
            <div className="pal-table-pager-controls">
                <label className="pal-table-pager-size">
                    <span className="sr-only">Rows per page</span>
                    <select
                        value={pageSize}
                        onChange={(e) => onPageSizeChange(Number(e.target.value) || 50)}
                        aria-label="Rows per page"
                    >
                        {pageSizeOptions.map((n) => (
                            <option key={n} value={n}>
                                {n} / page
                            </option>
                        ))}
                    </select>
                </label>
                <span className="pal-table-pager-page">
                    Page <strong>{page}</strong> / <strong>{totalPages}</strong>
                </span>
                <button
                    type="button"
                    className="pal-btn pal-btn-sm !p-1.5"
                    disabled={page <= 1}
                    onClick={() => onPageChange(page - 1)}
                    aria-label="Previous page"
                >
                    <ChevronLeft size={14} />
                </button>
                <button
                    type="button"
                    className="pal-btn pal-btn-sm !p-1.5"
                    disabled={page >= totalPages}
                    onClick={() => onPageChange(page + 1)}
                    aria-label="Next page"
                >
                    <ChevronRight size={14} />
                </button>
            </div>
        </div>
    );
}
