/**
 * Live activity feed — ported from iOS LiveActivityFeedService + LiveActivityEvent
 */

import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';

const LEGACY_HIDDEN_KINDS = new Set([
  'vehicle_opened',
  'checkout_started',
  'return_started',
  'inspection_opened',
  'shuttle_map_opened',
  'panel_opened',
  'jarvis_opened',
]);

const PRESENCE_KINDS = new Set(['presence_online', 'presence_away', 'presence_offline']);

const OPERATIONAL_KINDS = new Set([
  'checkout_completed',
  'checkout_parked',
  'checkout_deleted',
  'return_completed',
  'return_deleted',
  'damage_created',
  'damage_updated',
  'damage_completed',
  'damage_deleted',
  'office_created',
  'office_updated',
  'office_deleted',
  'washing_created',
  'washing_updated',
  'washing_deleted',
  'shuttle_sharing_on',
  'shuttle_customer_ping',
  'login',
  'logout',
]);

export function isOperationalKind(kind) {
  return OPERATIONAL_KINDS.has(kind);
}

export function isPresenceKind(kind) {
  return PRESENCE_KINDS.has(kind);
}

export function isVisibleInFeed(kindRaw) {
  if (!kindRaw || LEGACY_HIDDEN_KINDS.has(kindRaw)) return false;
  return isOperationalKind(kindRaw) || isPresenceKind(kindRaw);
}

function parseCreatedAt(data) {
  const v = data.createdAt;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  if (v instanceof Date) return v;
  return new Date();
}

export function parseLiveActivityDoc(docSnap) {
  const data = docSnap.data();
  const kindRaw = data.kind;
  if (!data.userId || !kindRaw || !data.title) return null;
  if (!isVisibleInFeed(kindRaw)) return null;

  return {
    id: docSnap.id,
    userId: data.userId,
    userName: data.userName || 'User',
    userRole: data.userRole || '',
    kind: kindRaw,
    title: data.title,
    subtitle: data.subtitle || '',
    plate: data.plate || null,
    recordId: data.recordId || null,
    franchiseId: data.franchiseId || 'CH',
    createdAt: parseCreatedAt(data),
    deviceInfo: data.deviceInfo || null,
    isOperational: isOperationalKind(kindRaw),
    isPresence: isPresenceKind(kindRaw),
    accentToken: accentForKind(kindRaw),
    searchBlob: [
      data.userName,
      data.userRole,
      data.title,
      data.subtitle,
      data.plate,
      kindRaw,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase(),
  };
}

function accentForKind(kind) {
  switch (kind) {
    case 'checkout_completed':
    case 'return_completed':
    case 'damage_completed':
    case 'office_created':
    case 'washing_created':
    case 'presence_online':
    case 'login':
      return 'success';
    case 'damage_created':
    case 'shuttle_customer_ping':
      return 'warning';
    case 'checkout_deleted':
    case 'return_deleted':
    case 'damage_deleted':
    case 'office_deleted':
    case 'washing_deleted':
      return 'critical';
    case 'checkout_parked':
    case 'presence_away':
      return 'accent';
    default:
      return 'muted';
  }
}

export function filterOperationalEvents(events) {
  return events.filter((e) => e.isOperational);
}

export function filterEventsBySearch(events, search) {
  const q = String(search || '')
    .trim()
    .toLowerCase();
  const ops = filterOperationalEvents(events);
  if (!q) return ops;
  return ops.filter((e) => e.searchBlob.includes(q));
}

export function latestOperationalEvent(events) {
  return filterOperationalEvents(events)[0] || null;
}

export function eventsLast15Minutes(events) {
  const cutoff = Date.now() - 15 * 60 * 1000;
  return filterOperationalEvents(events).filter((e) => e.createdAt.getTime() >= cutoff).length;
}

const PRESENCE_FRESHNESS_MS = 45 * 60 * 1000;
const ACTIVE_FRESHNESS_MS = 20 * 60 * 1000;

function resolvePresenceStatus(presence, lastOp, now) {
  if (presence && now - presence.createdAt.getTime() <= PRESENCE_FRESHNESS_MS) {
    switch (presence.kind) {
      case 'presence_online':
        return 'online';
      case 'presence_away':
        return 'away';
      case 'presence_offline':
        return 'offline';
      default:
        break;
    }
  }
  if (lastOp && now - lastOp.createdAt.getTime() <= ACTIVE_FRESHNESS_MS) {
    return 'active';
  }
  return 'offline';
}

const STATUS_RANK = { online: 0, active: 1, away: 2, offline: 3 };

/**
 * Build presence roster from raw live_activity events (iOS LiveFranchisePresenceService).
 */
export function presenceRosterFromEvents(events) {
  const now = Date.now();
  const byUser = {};

  events.forEach((event) => {
    let slot = byUser[event.userId];
    if (!slot) {
      slot = { name: event.userName, role: event.userRole, presence: null, lastOp: null };
    }
    slot.name = event.userName;
    slot.role = event.userRole;
    if (event.isPresence) {
      if (!slot.presence || event.createdAt > slot.presence.createdAt) {
        slot.presence = event;
      }
    } else if (event.isOperational) {
      if (!slot.lastOp || event.createdAt > slot.lastOp.createdAt) {
        slot.lastOp = event;
      }
    }
    byUser[event.userId] = slot;
  });

  return Object.entries(byUser)
    .map(([userId, slot]) => {
      const status = resolvePresenceStatus(slot.presence, slot.lastOp, now);
      const updatedAt = Math.max(
        slot.presence?.createdAt?.getTime() || 0,
        slot.lastOp?.createdAt?.getTime() || 0,
        now
      );
      return {
        userId,
        userName: slot.name,
        userRole: slot.role,
        status,
        updatedAt: new Date(updatedAt),
      };
    })
    .sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 9;
      const rb = STATUS_RANK[b.status] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.userName.localeCompare(b.userName);
    });
}

export function formatRelativeTime(date) {
  if (!date) return '';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(diffSec, 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86400), 'day');
}

export function formatExactTime(date) {
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Subscribe to franchises/{franchiseId}/live_activity
 * @returns {() => void} unsubscribe
 */
export function subscribeLiveActivityFeed(db, franchiseId, onUpdate, onError) {
  const fid = String(franchiseId || 'CH')
    .trim()
    .toUpperCase();
  if (!fid) {
    onUpdate([]);
    return () => {};
  }

  const ref = collection(db, 'franchises', fid, 'live_activity');
  const q = query(ref, orderBy('createdAt', 'desc'), limit(200));

  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs
        .map(parseLiveActivityDoc)
        .filter(Boolean);
      onUpdate(items);
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}
