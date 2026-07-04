import React from 'react';

/**
 * Foundry process-status primitives.
 *
 * Visual grammar from the approved Foundry wireframe (PalantirFoundry.zip):
 *   done    → green text/border on green-dim fill
 *   active  → accent on accent-dim, bold (the stage in motion)
 *   pending → hollow, border-strong tone (not yet)
 *   blocked → red on red-dim (overdue / failed)
 * Square corners, 1px borders, 8.5–9px uppercase mono labels throughout.
 * Styling lives in foundry-theme.css under .fd-pipeline / .fd-pill / .fd-timeline.
 */

const STAGE_STATES = new Set(['done', 'active', 'pending', 'blocked']);

/**
 * Horizontal lifecycle pipeline.
 * @param {Array<{key:string,label:string,state:'done'|'active'|'pending'|'blocked',note?:string}>} stages
 */
export function FoundryPipeline({ stages = [], className = '' }) {
    const safeStages = stages.filter((s) => s && s.label);
    if (!safeStages.length) return null;
    return (
        <div className={`fd-pipeline ${className}`.trim()} role="list" aria-label="Process pipeline">
            {safeStages.map((stage, index) => {
                const state = STAGE_STATES.has(stage.state) ? stage.state : 'pending';
                return (
                    <React.Fragment key={stage.key || stage.label}>
                        {index > 0 && <span className={`fd-pipeline-link fd-pipeline-link-${state}`} aria-hidden="true" />}
                        <div className={`fd-pipeline-stage fd-pipeline-stage-${state}`} role="listitem">
                            <span className="fd-pipeline-chip">
                                {state === 'done' ? '✓ ' : state === 'blocked' ? '✕ ' : ''}
                                {stage.label}
                            </span>
                            {stage.note ? <span className="fd-pipeline-note">{stage.note}</span> : null}
                        </div>
                    </React.Fragment>
                );
            })}
        </div>
    );
}

/** Bordered status pill — the wireframe's per-row process state indicator. */
export function FoundryStatusPill({ tone = 'neutral', label, className = '' }) {
    if (!label) return null;
    return <span className={`fd-pill fd-pill-${tone} ${className}`.trim()}>{label}</span>;
}

/**
 * Vertical dot timeline (wireframe "Rental timeline"): time · dot · event.
 * @param {Array<{at:string,label:string,tone?:'accent'|'green'|'amber'|'red'|'purple'|'neutral'}>} events
 */
export function FoundryDotTimeline({ events = [], title, className = '' }) {
    const safeEvents = events.filter((e) => e && e.label);
    if (!safeEvents.length) return null;
    return (
        <div className={`fd-timeline ${className}`.trim()}>
            {title ? <div className="fd-timeline-title">{title}</div> : null}
            <div className="fd-timeline-body">
                {safeEvents.map((event, index) => (
                    <div key={`${event.at}-${index}`} className="fd-timeline-row">
                        <span className="fd-timeline-at">{event.at}</span>
                        <span className={`fd-timeline-dot fd-timeline-dot-${event.tone || 'neutral'}`} aria-hidden="true" />
                        <span className="fd-timeline-label">{event.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

// ─── Stage builders driven by REAL record fields ───────────────────────────

function toDate(raw) {
    if (!raw) return null;
    if (raw?.seconds != null) return new Date(raw.seconds * 1000);
    if (raw instanceof Date) return raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

function shortStamp(raw) {
    const d = toDate(raw);
    if (!d) return null;
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }).toUpperCase();
}

/**
 * Checkout lifecycle from a real exit record.
 * Statuses observed in data: 'In Progress' | 'Parked' | 'Completed'.
 */
export function buildCheckoutPipelineStages(exit) {
    if (!exit) return [];
    const status = String(exit.status || '').trim();
    const completed = status === 'Completed';
    const parked = status === 'Parked';
    const planned = toDate(exit.plannedCheckinAt || exit.plannedReturnAt);
    const returnOverdue = completed && planned && planned.getTime() < Date.now() && !exit.expectedReturnDismissedAt;

    return [
        {
            key: 'created',
            label: 'CREATED',
            state: 'done',
            note: shortStamp(exit.createdAt || exit.exitTarihi),
        },
        {
            key: 'handover',
            label: parked ? 'PARKED' : 'HANDOVER',
            state: completed ? 'done' : 'active',
            note: parked ? 'AWAITING COMPLETE' : null,
        },
        {
            key: 'completed',
            label: 'COMPLETED',
            state: completed ? 'done' : 'pending',
            note: completed ? shortStamp(exit.exitTarihi) : null,
        },
        {
            key: 'return',
            label: returnOverdue ? 'RETURN OVERDUE' : 'RETURN DUE',
            state: returnOverdue ? 'blocked' : completed ? 'active' : 'pending',
            note: planned ? shortStamp(planned) : null,
        },
    ];
}

/** Return lifecycle from a real return record (status 'In Progress' | 'Completed'). */
export function buildReturnPipelineStages(ret) {
    if (!ret) return [];
    const status = String(ret.status || '').trim();
    const completed = status === 'Completed';
    const damageCount = Number(ret.hasarSayisi) || 0;
    const photoCount = Array.isArray(ret.fotograflar) ? ret.fotograflar.length : 0;
    const inspected = completed || photoCount > 0;

    return [
        {
            key: 'linked',
            label: ret.linkedExitId ? 'CHECKOUT LINKED' : 'STANDALONE',
            state: 'done',
            note: shortStamp(ret.createdAt),
        },
        {
            key: 'arriving',
            label: 'ARRIVING',
            state: completed || inspected ? 'done' : 'active',
        },
        {
            key: 'inspection',
            label: 'INSPECTION',
            state: inspected ? 'done' : completed ? 'done' : 'pending',
            note: damageCount > 0 ? `${damageCount} DMG` : photoCount > 0 ? `${photoCount} PHOTOS` : null,
        },
        {
            key: 'finalized',
            label: 'FINALIZED',
            state: completed ? 'done' : 'pending',
            note: completed ? shortStamp(ret.iadeTarihi) : null,
        },
    ];
}

/** Vehicle rental timeline events from real exits / returns / damage records. */
export function buildVehicleTimelineEvents({ exits = [], returns = [], damages = [] }, limit = 6) {
    const events = [];
    for (const exit of exits) {
        const d = toDate(exit.createdAt || exit.exitTarihi);
        if (!d) continue;
        events.push({
            when: d,
            at: shortStamp(d),
            label: `Checkout · ${exit.resKodu ? `RES-${String(exit.resKodu).replace(/^RES-?/i, '')}` : exit.aracPlaka || ''} · ${exit.status || ''}`.trim(),
            tone: 'accent',
        });
    }
    for (const ret of returns) {
        const d = toDate(ret.iadeTarihi || ret.createdAt);
        if (!d) continue;
        events.push({
            when: d,
            at: shortStamp(d),
            label: `Return · ${ret.status === 'Completed' ? 'finalized' : 'open'}${Number(ret.hasarSayisi) > 0 ? ` · ${ret.hasarSayisi} damage` : ''}`,
            tone: ret.status === 'Completed' ? 'green' : 'purple',
        });
    }
    for (const dmg of damages) {
        const d = toDate(dmg.tarih);
        if (!d) continue;
        events.push({
            when: d,
            at: shortStamp(d),
            label: `Damage logged${dmg.resKodu ? ` · ${dmg.resKodu}` : ''}`,
            tone: 'amber',
        });
    }
    return events
        .sort((a, b) => b.when - a.when)
        .slice(0, limit)
        .map(({ when, ...rest }) => rest);
}
