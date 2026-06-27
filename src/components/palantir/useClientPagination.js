import { useEffect, useMemo, useState } from 'react';

/**
 * Client-side pagination for large in-memory lists (checkout / returns).
 * Resets to page 1 when filters change via resetKey.
 */
export function useClientPagination(items, { pageSize: initialPageSize = 50, resetKey = '' } = {}) {
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(initialPageSize);

    const totalItems = items?.length ?? 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize) || 1);

    useEffect(() => {
        setPage(1);
    }, [resetKey, pageSize]);

    useEffect(() => {
        if (page > totalPages) setPage(totalPages);
    }, [page, totalPages]);

    const safePage = Math.min(Math.max(1, page), totalPages);

    const paginatedItems = useMemo(() => {
        if (!items?.length) return [];
        const start = (safePage - 1) * pageSize;
        return items.slice(start, start + pageSize);
    }, [items, safePage, pageSize]);

    const rangeFrom = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
    const rangeTo = Math.min(safePage * pageSize, totalItems);

    return {
        page: safePage,
        setPage,
        pageSize,
        setPageSize,
        totalPages,
        totalItems,
        paginatedItems,
        rangeFrom,
        rangeTo,
        pageSizeOptions: [25, 50, 100],
    };
}
