import { effectiveWorkMinutes } from './workTimeSwiss';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKeyToDate(dayKey) {
    const [y, mo, d] = String(dayKey || '').split('-').map(Number);
    if (!y || !mo || !d) return null;
    return new Date(y, mo - 1, d);
}

export function groupEntriesByUser(entries) {
    const map = new Map();
    entries.forEach((e) => {
        const key = e.userId || 'unknown';
        if (!map.has(key)) {
            map.set(key, {
                userId: key,
                displayName: e.userDisplayName || e.userEmail || key,
                rows: [],
            });
        }
        map.get(key).rows.push(e);
    });
    return Array.from(map.values())
        .map((g) => ({
            ...g,
            rows: g.rows.sort((a, b) => String(a.dayKey).localeCompare(String(b.dayKey))),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function computeWorkTimeStatistics(entries, franchiseId) {
    const rows = (entries || [])
        .filter((e) => e && !e.isHoliday)
        .map((e) => ({
            ...e,
            minutes: effectiveWorkMinutes(e, franchiseId),
        }))
        .filter((e) => e.minutes > 0);

    const totalMinutes = rows.reduce((s, e) => s + e.minutes, 0);
    const uniqueDays = new Set(rows.map((e) => e.dayKey)).size;

    const byWeekday = Array.from({ length: 7 }, (_, i) => ({
        weekday: i,
        label: WEEKDAY_LABELS[i],
        minutes: 0,
        days: 0,
    }));
    const byDayKey = new Map();

    rows.forEach((e) => {
        const d = dayKeyToDate(e.dayKey);
        if (!d) return;
        const wd = d.getDay();
        byWeekday[wd].minutes += e.minutes;
        byWeekday[wd].days += 1;
        const prev = byDayKey.get(e.dayKey) || 0;
        byDayKey.set(e.dayKey, prev + e.minutes);
    });

    const topDays = Array.from(byDayKey.entries())
        .map(([dayKey, minutes]) => ({ dayKey, minutes }))
        .sort((a, b) => b.minutes - a.minutes)
        .slice(0, 12);

    const busiestWeekdays = [...byWeekday]
        .filter((w) => w.minutes > 0)
        .sort((a, b) => b.minutes - a.minutes);

    const byUser = groupEntriesByUser(rows).map((g) => {
        const minutes = g.rows.reduce((s, e) => s + effectiveWorkMinutes(e, franchiseId), 0);
        const days = new Set(g.rows.map((r) => r.dayKey)).size;
        const userByWeekday = Array.from({ length: 7 }, (_, i) => ({
            weekday: i,
            label: WEEKDAY_LABELS[i],
            minutes: 0,
        }));
        g.rows.forEach((e) => {
            const d = dayKeyToDate(e.dayKey);
            if (!d) return;
            userByWeekday[d.getDay()].minutes += effectiveWorkMinutes(e, franchiseId);
        });
        const topUserDays = g.rows
            .map((e) => ({ dayKey: e.dayKey, minutes: effectiveWorkMinutes(e, franchiseId) }))
            .sort((a, b) => b.minutes - a.minutes)
            .slice(0, 5);
        return {
            userId: g.userId,
            displayName: g.displayName,
            totalMinutes: minutes,
            daysWorked: days,
            avgPerDay: days > 0 ? Math.round(minutes / days) : 0,
            busiestWeekdays: [...userByWeekday].filter((w) => w.minutes > 0).sort((a, b) => b.minutes - a.minutes),
            topDays: topUserDays,
        };
    });

    return {
        totalMinutes,
        uniqueDays,
        avgPerDay: uniqueDays > 0 ? Math.round(totalMinutes / uniqueDays) : 0,
        busiestWeekdays,
        topDays,
        byWeekday,
        byUser,
        entryCount: rows.length,
    };
}
