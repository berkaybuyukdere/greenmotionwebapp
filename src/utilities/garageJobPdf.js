/**
 * Client-side PDF for garage service jobs (ERPX garage portal).
 * Lightweight jsPDF report: garage, plate, purpose, dates, notes.
 */
import { jsPDF } from 'jspdf';
import { format } from 'date-fns';

function tsToDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (value.seconds !== undefined) return new Date(value.seconds * 1000);
    if (typeof value === 'number') {
        if (value > 1_000_000_000) return new Date(value * 1000);
        const ref = new Date('2001-01-01T00:00:00Z').getTime();
        return new Date(ref + value * 1000);
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function fmtTs(value) {
    const d = tsToDate(value);
    if (!d) return '—';
    try {
        return format(d, 'yyyy-MM-dd HH:mm');
    } catch {
        return d.toISOString();
    }
}

function pickPlate(job) {
    return String(job?.plate || job?.vehiclePlate || job?.plaka || '').trim() || '—';
}

function pickPurpose(job) {
    return String(job?.purpose || job?.servicePurpose || job?.serviceReason || '').trim() || '—';
}

function pickNotes(job) {
    return String(job?.notes || job?.note || '').trim() || '—';
}

/**
 * @param {object} job — Firestore doc data + id
 * @param {{ garageDisplayName?: string, franchiseId?: string }} meta
 */
export function downloadGarageServiceJobPdf(job, meta = {}) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const margin = 16;
    let y = margin;

    const title = 'Garage service job';
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin, y);
    y += 10;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');

    const franchiseId = String(meta.franchiseId || job?.franchiseId || '').trim();
    const garageName = String(
        meta.garageDisplayName || job?.garageName || job?.targetGarageName || job?.garageDisplayName || ''
    ).trim();

    const rows = [
        ['Franchise', franchiseId || '—'],
        ['Job ID', String(job?.id || '—')],
        ['Garage', garageName || '—'],
        ['Plate', pickPlate(job)],
        ['Purpose', pickPurpose(job)],
        ['Status', String(job?.status || '—')],
        ['Created / requested', fmtTs(job?.createdAt || job?.requestedAt)],
        ['Scheduled / due', fmtTs(job?.scheduledAt || job?.dueAt)],
        ['Completed', fmtTs(job?.completedAt)],
        ['Notes', pickNotes(job)],
    ];

    for (const [label, value] of rows) {
        doc.setFont('helvetica', 'bold');
        doc.text(`${label}:`, margin, y);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(String(value), 210 - margin * 2 - 36);
        doc.text(lines, margin + 36, y);
        y += Math.max(6, lines.length * 5);
        if (y > 270) {
            doc.addPage();
            y = margin;
        }
    }

    const safePlate = pickPlate(job).replace(/[^\w\-]+/g, '_').slice(0, 40);
    doc.save(`garage-job-${safePlate || job?.id || 'export'}.pdf`);
}
