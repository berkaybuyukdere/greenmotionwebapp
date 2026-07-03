import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  Area,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { getAuth } from 'firebase/auth';
import { collection, getDocs, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import {
  Network,
  Lock,
  ChevronLeft,
  ChevronRight,
  Moon,
  Sun,
  Banknote,
  Car,
  List,
  ArrowUp,
  Radio,
  Users,
  Search,
} from 'lucide-react';
import '../styles/palantir-panel.css';
import '../styles/palantir-dashboard.css';
import '../styles/palantir-analytics.css';
import { getCollectionRef, isAracSoftDeletedForList } from '../utilities/firebaseHelpers';
import { filterListableFleetCars } from '../utilities/fleetVehicleDedupe';
import {
  buildCHPanelSnapshot,
  auditRowsFromLogs,
  officeTypeLabel,
  periodLabel,
  CH_PANEL_PERIODS,
} from '../utilities/chPanelAnalytics';
import {
  subscribeLiveActivityFeed,
  filterEventsBySearch,
  latestOperationalEvent,
  eventsLast15Minutes,
  presenceRosterFromEvents,
  formatRelativeTime,
  formatExactTime,
} from '../utilities/liveActivityFeed';
import { getActiveFranchiseCurrencyCode } from '../franchiseCurrency';
import { isFranchiseAdmin, canAccessAdminPanel } from '../utilities/userAccess';
import { isSwissFranchiseId } from '../utilities/fileLibraryHelpers';
import { PalantirPageIcon } from './palantir/PalantirNavIcon';

function formatPalCurrency(amount) {
  const code = getActiveFranchiseCurrencyCode();
  const n = Number(amount) || 0;
  const [intPart, decPart] = n.toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return `${grouped}.${decPart} ${code}`;
}

function initialsForName(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return String(name || '?').slice(0, 2).toUpperCase();
}

function avatarHue(name) {
  let hash = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i += 1) hash = (hash * 31 + s.charCodeAt(i)) % 360;
  return hash;
}

function flattenDamagesFromCars(cars) {
  const out = [];
  cars.forEach((car) => {
    (car.hasarKayitlari || []).forEach((damage) => {
      if (damage.isDeleted) return;
      out.push({
        ...damage,
        franchiseId: damage.franchiseId || car.franchiseId,
        tarih: damage.tarih || damage.date,
      });
    });
  });
  return out;
}

function PanelCard({ children, className = '' }) {
  return <div className={`pal-analytics-data-panel ${className}`}>{children}</div>;
}

function JarvisCard({ summaryForAI }) {
  const [rows, setRows] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const send = () => {
    const text = input.trim();
    if (!text || isSending) return;
    setIsSending(true);
    setRows((prev) => [...prev, { id: `u-${Date.now()}`, text, isUser: true }]);
    setInput('');
    window.setTimeout(() => {
      setRows((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          text:
            'Jarvis AI insights are available in the iOS fleet app. Web analytics below use the same Firestore data as the mobile CH Operations Panel.',
          isUser: false,
        },
      ]);
      setIsSending(false);
    }, 600);
  };

  return (
    <PanelCard className="pal-dash-panel ch-panel-top-card ch-panel-jarvis">
      <div className="ch-panel-jarvis-header">
        <Network size={16} className="ch-panel-accent" />
        <div style={{ flex: 1 }}>
          <div className="ch-panel-label ch-panel-accent" style={{ letterSpacing: '0.1em' }}>
            JARVIS
          </div>
          <div className="ch-panel-muted" style={{ fontSize: 10 }}>
            Intelligence hub
          </div>
        </div>
      </div>
      <div className="ch-panel-scroll-inner" style={{ flex: 1, marginBottom: 8 }}>
        {rows.length === 0 ? (
          <p className="ch-panel-muted" style={{ fontSize: 11, lineHeight: 1.45 }}>
            On-demand analysis for damages, checkouts, returns, office revenue, banking, and system
            health. No automatic calls — choose a quick action.
          </p>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className={`ch-panel-chat-bubble ${row.isUser ? 'user' : 'assistant'}`}
            >
              {row.text}
            </div>
          ))
        )}
        {isSending && (
          <p className="ch-panel-muted ch-panel-data" style={{ fontSize: 10 }}>
            Thinking…
          </p>
        )}
      </div>
      <div className="ch-panel-jarvis-input">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="Ask Jarvis…"
          disabled={isSending}
        />
        <button
          type="button"
          className="ch-panel-jarvis-send"
          onClick={send}
          disabled={isSending || !input.trim()}
          aria-label="Send"
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </PanelCard>
  );
}

function LiveTrackingCard({ events, isListening, search, onSearchChange }) {
  const [page, setPage] = useState(0);
  const pageSize = 6;
  const filtered = useMemo(() => filterEventsBySearch(events, search), [events, search]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageEvents = filtered.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const roster = useMemo(() => presenceRosterFromEvents(events).slice(0, 8), [events]);
  const count15m = eventsLast15Minutes(events);

  useEffect(() => {
    setPage(0);
  }, [search]);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [safePage, page, pageCount]);

  return (
    <PanelCard className="pal-dash-panel ch-panel-top-card ch-panel-live-card">
      <div className="ch-panel-live-header">
        <div className="ch-panel-live-pulse">
          <div className="ch-panel-live-pulse-dot" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ch-panel-label ch-panel-success" style={{ letterSpacing: '0.12em' }}>
            LIVE TRACKING
          </div>
          <div className="ch-panel-muted" style={{ fontSize: 11 }}>
            Operations only — no page views
          </div>
        </div>
        <div className="ch-panel-metric-pill">
          <div className="value ch-panel-data">{count15m}</div>
          <div className="label">15m</div>
        </div>
        {isListening && (
          <span className="ch-panel-live-badge">
            <Radio size={10} style={{ marginRight: 4 }} />
            LIVE
          </span>
        )}
      </div>

      {roster.length > 0 && (
        <div className="ch-panel-team-presence">
          <div className="ch-panel-team-presence-head">
            <Users size={12} className="ch-panel-accent" />
            <span className="ch-panel-label ch-panel-accent">TEAM PRESENCE</span>
            <span className="ch-panel-muted ch-panel-data" style={{ marginLeft: 'auto', fontSize: 11 }}>
              {roster.length} ›
            </span>
          </div>
          <div className="ch-panel-presence-strip">
            {roster.map((u) => (
              <div
                key={u.userId}
                className={`ch-panel-presence-user ${u.status === 'online' || u.status === 'active' ? 'online' : ''}`}
              >
                <span className="ch-panel-presence-dot" />
                <div>
                  <div className="ch-panel-body" style={{ fontSize: 12, fontWeight: 600 }}>
                    {u.userName}
                  </div>
                  <div className="ch-panel-success" style={{ fontSize: 10 }}>
                    {u.status === 'online' || u.status === 'active' ? 'Online' : u.status}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ch-panel-search-wrap">
        <Search size={14} className="ch-panel-muted" />
        <input
          className="ch-panel-search pal-analytics-data-panel"
          type="search"
          placeholder="Search user or action…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="ch-panel-scroll-inner">
        {pageEvents.length === 0 ? (
          <p className="ch-panel-muted" style={{ fontSize: 12, padding: '8px 0' }}>
            No operational events yet.
          </p>
        ) : (
          pageEvents.map((ev) => (
            <div key={ev.id} className="ch-panel-feed-row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ch-panel-body" style={{ fontSize: 12, fontWeight: 600 }}>
                  {ev.title}
                </div>
                <div className="ch-panel-muted" style={{ fontSize: 11 }}>
                  {ev.subtitle}
                  {ev.plate ? ` · ${ev.plate}` : ''}
                </div>
                <div className="ch-panel-muted" style={{ fontSize: 10 }}>
                  {ev.userName} · {formatRelativeTime(ev.createdAt)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          fontSize: 11,
        }}
      >
        <button
          type="button"
          className="pal-btn pal-btn-sm"
          style={{ width: 'auto', padding: '4px 8px' }}
          disabled={safePage <= 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="ch-panel-muted ch-panel-accent" style={{ fontSize: 11 }}>
          &lt; Page {safePage + 1} of {pageCount} &gt;
        </span>
        <button
          type="button"
          className="pal-btn pal-btn-sm"
          style={{ width: 'auto', padding: '4px 8px' }}
          disabled={safePage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </PanelCard>
  );
}

function LastEventCard({ event }) {
  if (!event) {
    return (
      <PanelCard className="pal-dash-panel ch-panel-bottom-card">
        <div className="ch-panel-label">Last event</div>
        <p className="ch-panel-muted ch-panel-body" style={{ marginTop: 12 }}>
          No recent operational activity.
        </p>
      </PanelCard>
    );
  }

  return (
    <PanelCard className="pal-dash-panel ch-panel-bottom-card">
      <div className="ch-panel-label">Last event</div>
      <div style={{ marginTop: 12 }}>
        <div className="ch-panel-body" style={{ fontWeight: 600, fontSize: 15 }}>
          {event.title}
        </div>
        <p className="ch-panel-muted" style={{ fontSize: 13, marginTop: 6 }}>
          {event.subtitle}
        </p>
        {event.plate && (
          <p className="ch-panel-data ch-panel-accent" style={{ marginTop: 8 }}>
            {event.plate}
          </p>
        )}
        <p className="ch-panel-muted" style={{ fontSize: 11, marginTop: 12 }}>
          {event.userName}
          {event.userRole ? ` · ${event.userRole}` : ''}
        </p>
        <p className="ch-panel-data" style={{ fontSize: 12, marginTop: 4 }}>
          {formatExactTime(event.createdAt)}
        </p>
      </div>
    </PanelCard>
  );
}

function AuditTrailCard({ rows, loading, rangeStart }) {
  const filtered = useMemo(() => {
    if (!rangeStart) return rows;
    return rows.filter((r) => r.timestamp >= rangeStart);
  }, [rows, rangeStart]);

  return (
    <PanelCard className="pal-dash-panel ch-panel-bottom-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="ch-panel-label">AUDIT TRAIL (ALL USERS)</span>
        {loading && (
          <span className="ch-panel-muted" style={{ fontSize: 11 }}>
            Loading…
          </span>
        )}
      </div>
      <div className="ch-panel-scroll-inner" style={{ marginTop: 8 }}>
        {!loading && filtered.length === 0 ? (
          <p className="ch-panel-muted" style={{ fontSize: 13 }}>
            No audit entries in this period.
          </p>
        ) : (
          filtered.slice(0, 40).map((row) => {
            const hue = avatarHue(row.userName);
            const actionTone =
              row.action === 'CREATED'
                ? 'created'
                : row.action === 'DELETED'
                  ? 'deleted'
                  : row.action === 'UPDATED'
                    ? 'updated'
                    : 'default';
            return (
              <div key={row.id} className="ch-panel-audit-row">
                <div
                  className="ch-panel-audit-avatar"
                  style={{ background: `hsl(${hue} 55% 42%)` }}
                >
                  {initialsForName(row.userName)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="ch-panel-body" style={{ fontSize: 12, fontWeight: 600 }}>
                    {row.userName}
                  </div>
                  <div className={`ch-panel-audit-action ${actionTone}`}>
                    <span className="ch-panel-audit-action-dot" />
                    {row.action}
                    <span className="ch-panel-muted"> · {row.tableName}</span>
                  </div>
                  <div className="ch-panel-muted ch-panel-data" style={{ fontSize: 9, marginTop: 4 }}>
                    {row.recordId}
                  </div>
                </div>
                <div className="ch-panel-muted" style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                  {formatRelativeTime(row.timestamp)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </PanelCard>
  );
}

export function CHOperationsPanelView({
  db,
  userProfile,
  dataFranchiseId,
  user: userProp,
}) {
  const authUser = userProp || getAuth().currentUser;
  const franchiseId = String(dataFranchiseId || 'CH').toUpperCase();

  const canAccess =
    isSwissFranchiseId(franchiseId) &&
    (canAccessAdminPanel(userProfile) || isFranchiseAdmin(userProfile));

  const [period, setPeriod] = useState('weekly');
  const [manualTheme, setManualTheme] = useState(null);
  const [cars, setCars] = useState([]);
  const [officeOperations, setOfficeOperations] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [loadingFleet, setLoadingFleet] = useState(true);
  const [liveEvents, setLiveEvents] = useState([]);
  const [liveListening, setLiveListening] = useState(false);
  const [liveSearch, setLiveSearch] = useState('');
  const [systemTheme, setSystemTheme] = useState(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    return 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    const sync = () => setSystemTheme(root.classList.contains('dark') ? 'dark' : 'light');
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  const resolvedTheme = manualTheme || systemTheme;

  useEffect(() => {
    if (!canAccess || !db) return undefined;

    const araclarRef = getCollectionRef(db, 'araclar', authUser, userProfile, franchiseId);
    const officeRef = getCollectionRef(db, 'office_operations', authUser, userProfile, franchiseId);

    const unsubCars = onSnapshot(araclarRef, (snap) => {
      const vehicles = filterListableFleetCars(
        franchiseId,
        snap.docs
          .map((d) => ({ id: d.id, documentId: d.id, ...d.data() }))
          .filter((v) => !isAracSoftDeletedForList(v))
      );
      setCars(vehicles);
      setLoadingFleet(false);
    });

    const unsubOffice = onSnapshot(officeRef, (snap) => {
      setOfficeOperations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubCars();
      unsubOffice();
    };
  }, [db, authUser, userProfile, franchiseId, canAccess]);

  useEffect(() => {
    if (!canAccess || !db) return undefined;

    let cancelled = false;
    setLoadingAudit(true);

    (async () => {
      try {
        const auditRef = collection(db, 'audit_logs');
        const q = query(auditRef, orderBy('timestamp', 'desc'), limit(300));
        const snap = await getDocs(q);
        if (cancelled) return;
        const logs = snap.docs
          .map((d) => ({ id: d.id, documentId: d.id, ...d.data() }))
          .filter((log) => {
            const fid = String(log.franchiseId || '').toUpperCase();
            return !fid || fid === franchiseId;
          });
        setAuditLogs(logs);
      } catch (e) {
        console.error('CH Panel audit load failed', e);
        if (!cancelled) setAuditLogs([]);
      } finally {
        if (!cancelled) setLoadingAudit(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, franchiseId, canAccess]);

  useEffect(() => {
    if (!canAccess || !db) return undefined;
    setLiveListening(true);
    const unsub = subscribeLiveActivityFeed(
      db,
      franchiseId,
      (items) => setLiveEvents(items),
      (err) => console.error('Live activity feed', err)
    );
    return () => {
      setLiveListening(false);
      unsub();
    };
  }, [db, franchiseId, canAccess]);

  const damages = useMemo(() => flattenDamagesFromCars(cars), [cars]);

  const snapshot = useMemo(
    () =>
      buildCHPanelSnapshot({
        period,
        damages,
        officeOperations: officeOperations.filter(
          (op) =>
            !op.franchiseId ||
            String(op.franchiseId).toUpperCase() === franchiseId
        ),
        trafficContracts: [],
        auditLogs,
      }),
    [period, damages, officeOperations, auditLogs, franchiseId]
  );

  const auditRows = useMemo(() => auditRowsFromLogs(auditLogs), [auditLogs]);
  const lastEvent = useMemo(() => latestOperationalEvent(liveEvents), [liveEvents]);

  const chartData = useMemo(
    () =>
      snapshot.buckets.map((b) => ({
        label: b.label,
        damages: b.damageCount,
        revenue: b.officeRevenue,
      })),
    [snapshot.buckets]
  );

  const togglePanelTheme = useCallback(() => {
    setManualTheme((prev) => {
      const base = prev || resolvedTheme;
      return base === 'dark' ? 'light' : 'dark';
    });
  }, [resolvedTheme]);

  if (!canAccess) {
    return (
      <div className="ch-panel-root" data-theme={resolvedTheme}>
        <div className="pal-dash-panel ch-panel-access-denied">
          <Lock size={40} className="ch-panel-muted" />
          <h2 className="ch-panel-body" style={{ fontSize: 18, fontWeight: 600 }}>
            Access restricted
          </h2>
          <p className="ch-panel-muted">
            CH Operations Panel is available to Switzerland franchise administrators.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="ch-panel-root" data-theme={resolvedTheme} style={{ position: 'relative' }}>
      <button
        type="button"
        className="pal-btn pal-btn-sm ch-panel-theme-toggle"
        onClick={togglePanelTheme}
        title="Toggle theme"
      >
        {resolvedTheme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        <span style={{ marginLeft: 6 }}>{resolvedTheme === 'dark' ? 'Light' : 'Dark'}</span>
      </button>

      <div className="ch-panel-scroll ch-panel-stack">
        <header className="ch-panel-page-header">
          <h1 className="ch-panel-page-title inline-flex items-center gap-2">
            <PalantirPageIcon navKey="chOperationsPanel" />
            <span>Admin Panel</span>
          </h1>
          {(loadingFleet || loadingAudit) && (
            <p className="ch-panel-muted" style={{ fontSize: 11, marginTop: 4 }}>
              Syncing…
            </p>
          )}
        </header>

        <div className="ch-panel-top-row">
          <JarvisCard summaryForAI={snapshot.summaryForAI} />
          <LiveTrackingCard
            events={liveEvents}
            isListening={liveListening}
            search={liveSearch}
            onSearchChange={setLiveSearch}
          />
        </div>

        <div className="ch-panel-period ch-panel-period-ios">
          {CH_PANEL_PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              className={`pal-btn pal-btn-sm ${period === p ? 'pal-btn-primary active' : ''}`}
              onClick={() => setPeriod(p)}
            >
              {periodLabel(p)}
            </button>
          ))}
        </div>

        <div className="ch-panel-kpi-row">
          <PanelCard className="pal-dash-kpi ch-panel-kpi">
            <Banknote size={18} className="ch-panel-success" />
            <div className="ch-panel-kpi-value ch-panel-data">{formatPalCurrency(snapshot.totalRevenue)}</div>
            <div className="ch-panel-label">REVENUE</div>
          </PanelCard>
          <PanelCard className="pal-dash-kpi ch-panel-kpi">
            <Car size={18} className="ch-panel-warning" />
            <div className="ch-panel-kpi-value ch-panel-data">{snapshot.totalDamages}</div>
            <div className="ch-panel-label">DAMAGES</div>
          </PanelCard>
          <PanelCard className="pal-dash-kpi ch-panel-kpi">
            <List size={18} className="ch-panel-accent" />
            <div className="ch-panel-kpi-value ch-panel-data">{snapshot.totalAuditEntries}</div>
            <div className="ch-panel-label">AUDIT ENTRIES</div>
          </PanelCard>
        </div>

        <PanelCard className="pal-dash-panel">
          <div className="ch-panel-chart-head">
            <span className="ch-panel-label">DAMAGE REPORTS</span>
            <span className="ch-panel-label ch-panel-success">OFFICE REVENUE</span>
          </div>
          <div className="ch-panel-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--pal-border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--pal-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--pal-muted)', fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--pal-surface)',
                    border: '1px solid var(--pal-border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="damages" fill="var(--pal-warning)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </PanelCard>

        <PanelCard className="pal-dash-panel">
          <div className="ch-panel-label" style={{ marginBottom: 10 }}>
            OFFICE REVENUE
          </div>
          <div className="ch-panel-chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--pal-border)" />
                <XAxis dataKey="label" tick={{ fill: 'var(--pal-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--pal-muted)', fontSize: 10 }} />
                <Tooltip
                  formatter={(v) => formatPalCurrency(v)}
                  contentStyle={{
                    background: 'var(--pal-surface)',
                    border: '1px solid var(--pal-border)',
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  fill="var(--pal-success)"
                  fillOpacity={0.15}
                  stroke="none"
                />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke="var(--pal-success)"
                  strokeWidth={2}
                  dot={{ fill: 'var(--pal-success)', r: 3 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </PanelCard>

        <PanelCard className="pal-dash-panel">
          <div className="ch-panel-label" style={{ marginBottom: 10 }}>
            OFFICE OPERATIONS (DETAIL)
          </div>
          {snapshot.officeBreakdown.length === 0 ? (
            <p className="ch-panel-muted" style={{ fontSize: 13 }}>
              No office operations in range.
            </p>
          ) : (
            snapshot.officeBreakdown.map((row) => (
              <div key={row.id} className="ch-panel-office-row">
                <div>
                  <div className="ch-panel-body" style={{ fontSize: 13 }}>
                    {officeTypeLabel(row.type)}
                  </div>
                  <div className="ch-panel-muted" style={{ fontSize: 10 }}>
                    {row.count} operations
                  </div>
                </div>
                <span className="ch-panel-data ch-panel-success">
                  {formatPalCurrency(row.totalAmount)}
                </span>
              </div>
            ))
          )}
        </PanelCard>

        <div className="ch-panel-bottom-row">
          <AuditTrailCard
            rows={auditRows}
            loading={loadingAudit}
            rangeStart={snapshot.rangeStart}
          />
          <LastEventCard event={lastEvent} />
        </div>
      </div>
    </div>
  );
}

export function canAccessCHOperationsPanel(userProfile, franchiseId) {
  return (
    isSwissFranchiseId(franchiseId) &&
    (canAccessAdminPanel(userProfile) || isFranchiseAdmin(userProfile))
  );
}
