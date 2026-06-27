import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { effectiveWorkMinutes, swissBreakWasApplied } from './workTimeSwiss';
import { formatDuration, formatDurationDecimal, monthTitle, tsToTimeInput } from './workTimeFormat';
import { groupEntriesByUser } from './workTimeAnalytics';
import { isSwissFranchiseId } from './fileLibraryHelpers';

function csvEscape(s) {
    const v = String(s ?? '');
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
        return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
}

function dateLabel(dayKey) {
    const [y, mo, d] = dayKey.split('-').map(Number);
    if (!y) return dayKey;
    return new Date(y, mo - 1, d).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function filterEntriesForUsers(entries, userIds) {
    if (!userIds || userIds.length === 0) return entries;
    const set = new Set(userIds);
    return entries.filter((e) => set.has(e.userId));
}

export function buildWorkTimeCsv(entries, franchiseId, monthDate) {
    const header = [
        'Month',
        'Day',
        'Person',
        'Clock in',
        'Clock out',
        'Hours (billed)',
        'Holiday',
        'CH break (−30m)',
        'Notes',
    ];
    const lines = [header.join(',')];
    const monthLabel = monthTitle(monthDate);
    const groups = groupEntriesByUser(
        [...entries].sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)))
    );

    groups.forEach((g, gi) => {
        let userTotal = 0;
        g.rows.forEach((e) => {
            const mins = effectiveWorkMinutes(e, franchiseId);
            userTotal += mins;
            lines.push(
                [
                    csvEscape(monthLabel),
                    csvEscape(dateLabel(e.dayKey)),
                    csvEscape(g.displayName),
                    csvEscape(e.isHoliday ? '—' : tsToTimeInput(e.clockIn)),
                    csvEscape(e.isHoliday ? '—' : tsToTimeInput(e.clockOut)),
                    csvEscape(e.isHoliday ? '0' : formatDurationDecimal(mins)),
                    csvEscape(e.isHoliday ? 'yes' : 'no'),
                            csvEscape(swissBreakWasApplied(e, franchiseId) && !e.ohnePause ? 'yes' : 'no'),
                    csvEscape(e.notes || ''),
                ].join(',')
            );
        });
        lines.push(
            [
                csvEscape(monthLabel),
                csvEscape('TOTAL'),
                csvEscape(g.displayName),
                '',
                '',
                csvEscape(formatDurationDecimal(userTotal)),
                '',
                '',
                '',
            ].join(',')
        );
        if (gi < groups.length - 1) lines.push('');
    });

    return '\uFEFF' + lines.join('\n');
}

export function downloadWorkTimeCsv(entries, franchiseId, monthDate, filenameBase) {
    const csv = buildWorkTimeCsv(entries, franchiseId, monthDate);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filenameBase || 'work_hours'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

export function buildWorkTimePdf(entries, franchiseId, monthDate, franchiseLabel) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const monthLabel = monthTitle(monthDate);
    const chNote = isSwissFranchiseId(franchiseId)
        ? 'Switzerland: shifts over 4h include a 30-minute unpaid break in billed hours.'
        : '';

    doc.setFontSize(14);
    doc.text('Working timetable report', 14, 16);
    doc.setFontSize(10);
    doc.setTextColor(90);
    doc.text(`${franchiseLabel || franchiseId} · ${monthLabel}`, 14, 22);
    if (chNote) doc.text(chNote, 14, 28, { maxWidth: 180 });

    const groups = groupEntriesByUser(
        [...entries].sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey)))
    );
    let startY = chNote ? 34 : 28;

    groups.forEach((g) => {
        const body = g.rows.map((e) => {
            const mins = effectiveWorkMinutes(e, franchiseId);
            return [
                dateLabel(e.dayKey),
                e.isHoliday ? 'Day off' : tsToTimeInput(e.clockIn),
                e.isHoliday ? '—' : tsToTimeInput(e.clockOut),
                e.isHoliday ? '0.0' : formatDurationDecimal(mins),
                e.notes || '',
            ];
        });
        const userTotal = g.rows.reduce((s, e) => s + effectiveWorkMinutes(e, franchiseId), 0);
        body.push(['', '', 'Monthly total', formatDurationDecimal(userTotal), '']);

        if (startY > 250) {
            doc.addPage();
            startY = 16;
        }
        doc.setFontSize(11);
        doc.setTextColor(30);
        doc.text(g.displayName, 14, startY);
        startY += 4;

        autoTable(doc, {
            startY: startY + 2,
            head: [['Date', 'In', 'Out', 'Hours', 'Notes']],
            body,
            styles: { fontSize: 8, cellPadding: 2 },
            headStyles: { fillColor: [41, 52, 64] },
            margin: { left: 14, right: 14 },
        });
        startY = (doc.lastAutoTable?.finalY || startY) + 10;
    });

    return doc;
}

export function downloadWorkTimePdf(entries, franchiseId, monthDate, franchiseLabel, filenameBase) {
    const doc = buildWorkTimePdf(entries, franchiseId, monthDate, franchiseLabel);
    doc.save(`${filenameBase || 'work_hours'}.pdf`);
}

export function exportWorkTimeMonthReport({
    entries,
    franchiseId,
    monthDate,
    franchiseLabel,
    userIds,
    format,
    filenameBase,
}) {
    const filtered = filterEntriesForUsers(entries, userIds);
    if (!filtered.length) {
        throw new Error('No entries to export for the selected people and month.');
    }
    if (format === 'pdf') {
        downloadWorkTimePdf(filtered, franchiseId, monthDate, franchiseLabel, filenameBase);
    } else {
        downloadWorkTimeCsv(filtered, franchiseId, monthDate, filenameBase);
    }
}
