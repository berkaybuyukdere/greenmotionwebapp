/** Stable unique React list keys when Firestore id/documentId may repeat in a list. */
export function reactListKey(...parts) {
    return parts
        .map((p, i) => {
            if (p === null || p === undefined || p === '') return `_${i}`;
            return String(p);
        })
        .join('::');
}

export function recordListKey(record, idx, prefix = 'row') {
    const id =
        record?.documentId ??
        record?.id ??
        record?.protocolId ??
        record?.returnId ??
        record?.uid ??
        null;
    const extra = record?.resKodu || record?.resCode || record?.referenceNumber || record?.type || '';
    return reactListKey(prefix, id, extra, idx);
}
