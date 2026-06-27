/**
 * Fortune Sheet stores cell values in `data` as a 2D matrix (nested arrays).
 * Firestore rejects nested arrays — persist JSON instead and omit `data`.
 */

function stripNestedArraysFromSheet(sheet) {
    if (!sheet || typeof sheet !== 'object') return sheet;
    const copy = { ...sheet };
    delete copy.data;
    return copy;
}

export function sheetsToFirestorePayload(sheets) {
    const cleaned = Array.isArray(sheets) ? sheets.map(stripNestedArraysFromSheet) : [];
    return {
        sheetsJson: JSON.stringify(cleaned),
    };
}

export function sheetsFromFirestoreDoc(doc) {
    if (!doc) return null;
    if (typeof doc.sheetsJson === 'string' && doc.sheetsJson.length > 0) {
        try {
            const parsed = JSON.parse(doc.sheetsJson);
            return Array.isArray(parsed) ? parsed.map(stripNestedArraysFromSheet) : null;
        } catch {
            return null;
        }
    }
    if (Array.isArray(doc.sheets)) {
        return doc.sheets.map(stripNestedArraysFromSheet);
    }
    return null;
}

export function draftHasSheetData(doc) {
    if (!doc) return false;
    if (typeof doc.sheetsJson === 'string' && doc.sheetsJson !== '[]') return true;
    return Array.isArray(doc.sheets) && doc.sheets.length > 0;
}
