import { useMemo } from 'react';

// Advanced Search Hook (supports fuzzy matching when Fuse.js is available)
export function useAdvancedSearch(data, searchKeys, searchTerm) {
    return useMemo(() => {
        if (!searchTerm || !data || data.length === 0) return data;
        
        // Enhanced basic search with multiple field matching
        const query = searchTerm.toLowerCase().trim();
        const queryWords = query.split(/\s+/);
        
        return data.filter(item => {
            // Check if all query words match in any of the search keys
            return queryWords.every(word => {
                return searchKeys.some(key => {
                    const value = item[key];
                    if (!value) return false;
                    return String(value).toLowerCase().includes(word);
                });
            });
        });
    }, [data, searchKeys, searchTerm]);
}
