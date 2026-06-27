import {
    File,
    FileText,
    FileArchive,
    FileSpreadsheet,
    FileImage,
    Folder,
} from 'lucide-react';
import React from 'react';

export function isSwissFranchiseId(franchiseId) {
    return /^CH/i.test(String(franchiseId || '').trim());
}

export const FILE_LIBRARY_CATEGORIES = [
    { id: 'calculation', label: 'Calculation' },
    { id: 'damage', label: 'Damage' },
    { id: 'traffic_accident', label: 'Traffic accident' },
    { id: 'return_checkout_report', label: 'Return / checkout report' },
    { id: 'fuel_document', label: 'Fuel document' },
    { id: 'other', label: 'Other' },
];

export function categoryLabel(id) {
    return FILE_LIBRARY_CATEGORIES.find((c) => c.id === id)?.label || 'Other';
}

export function formatFileSize(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function fileExtension(name) {
    const parts = String(name || '').split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
}

export function mimeFromName(name) {
    const ext = fileExtension(name);
    const map = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        zip: 'application/zip',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
    };
    return map[ext] || 'application/octet-stream';
}

export function buildSearchBlob(item) {
    const parts = [
        item.name,
        item.note,
        item.fileName,
        categoryLabel(item.category),
        item.uploadedByName,
        item.uploadedByEmail,
        item.type,
    ];
    return parts.filter(Boolean).join(' ').toLowerCase();
}

export function userInitials(name, email) {
    const n = String(name || '').trim();
    if (n) {
        const bits = n.split(/\s+/).filter(Boolean);
        if (bits.length >= 2) return `${bits[0][0]}${bits[1][0]}`.toUpperCase();
        return n.slice(0, 2).toUpperCase();
    }
    const em = String(email || '').trim();
    if (em) return em.slice(0, 2).toUpperCase();
    return '?';
}

export function avatarColorFromUid(uid) {
    const s = String(uid || 'x');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return `hsl(${h} 52% 42%)`;
}

/** Stripe-style file type chip */
export function FileTypeIcon({ name, mimeType, type, size = 22, className = '' }) {
    if (type === 'folder') {
        return <Folder size={size} className={`text-[#0A84FF] ${className}`} strokeWidth={1.75} />;
    }
    const ext = fileExtension(name);
    const mime = String(mimeType || '').toLowerCase();
    if (mime.includes('pdf') || ext === 'pdf') {
        return <FileText size={size} className={`text-[#FF3B30] ${className}`} strokeWidth={1.75} />;
    }
    if (['doc', 'docx'].includes(ext) || mime.includes('word')) {
        return <FileText size={size} className={`text-[#007AFF] ${className}`} strokeWidth={1.75} />;
    }
    if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('sheet') || mime.includes('excel')) {
        return <FileSpreadsheet size={size} className={`text-[#34C759] ${className}`} strokeWidth={1.75} />;
    }
    if (['zip', 'rar', '7z', 'gz'].includes(ext) || mime.includes('zip') || mime.includes('archive')) {
        return <FileArchive size={size} className={`text-[#FF9500] ${className}`} strokeWidth={1.75} />;
    }
    if (mime.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) {
        return <FileImage size={size} className={`text-[#AF52DE] ${className}`} strokeWidth={1.75} />;
    }
    return <File size={size} className={`text-[#8E8E93] ${className}`} strokeWidth={1.75} />;
}

export const MAX_FILE_LIBRARY_BYTES = 200 * 1024 * 1024;

export function isSpreadsheetLibraryFile(item) {
    if (!item || item.type === 'folder') return false;
    const name = String(item.fileName || item.name || '').toLowerCase();
    const mime = String(item.mimeType || '').toLowerCase();
    return (
        /\.(xlsx|xls|csv)$/i.test(name) ||
        mime.includes('spreadsheet') ||
        mime.includes('excel') ||
        mime.includes('csv')
    );
}
