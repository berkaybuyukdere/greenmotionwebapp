import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
  Shield,
} from 'lucide-react';
import WheelSysLoginPanel from './WheelSysLoginPanel';
import {
  wheelsysApplyVehicleMasterSync,
  wheelsysGetVehicleFleet,
  wheelsysPreviewVehicleMasterSync,
  wheelsysSessionStatus,
} from '../../services/wheelsysApi';
import { isFranchiseAdmin, isGlobalAdmin } from '../../utilities/userAccess';

function canApplyVehicleMasterSync(userProfile) {
  if (!userProfile) return false;
  const role = String(userProfile.role || '').toLowerCase();
  return isGlobalAdmin(userProfile)
    || isFranchiseAdmin(userProfile)
    || role === 'admin'
    || role === 'superadmin'
    || role === 'franchiseadmin';
}

function statusBadgeClass(ok) {
  return ok
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
    : 'bg-amber-500/15 text-amber-200 border-amber-500/30';
}

function MetricTile({ label, value, tone = 'default' }) {
  const toneClass =
    tone === 'warn'
      ? 'text-amber-300'
      : tone === 'ok'
        ? 'text-emerald-300'
        : 'text-[#E5E5EA]';
  return (
    <div className="rounded-lg border border-[var(--erpx-border)] bg-[#121214] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-[#8E8E93]">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

export default function WheelSysFleetListView({ franchiseId = 'CH', userProfile }) {
  const station = 'ZRH';
  const fid = String(franchiseId || 'CH').toUpperCase();

  const [session, setSession] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [vehicles, setVehicles] = useState([]);
  const [stats, setStats] = useState(null);
  const [fleetLoading, setFleetLoading] = useState(false);
  const [fleetError, setFleetError] = useState('');

  const [syncReport, setSyncReport] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  const [searchText, setSearchText] = useState('');
  const [hideDefleeted, setHideDefleeted] = useState(true);
  const [duplicateWarnings, setDuplicateWarnings] = useState([]);
  const [fleetTruncated, setFleetTruncated] = useState(false);

  const canApplySync = useMemo(
    () => canApplyVehicleMasterSync(userProfile),
    [userProfile],
  );
  const autoFleetFetchedRef = useRef(false);

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const data = await wheelsysSessionStatus({ franchiseId: fid, station });
      setSession(data);
    } catch (e) {
      setSession({ hasSession: false, isValid: false, error: e.message });
    } finally {
      setSessionLoading(false);
    }
  }, [fid, station]);

  const fleetFetchInFlightRef = useRef(false);

  const refreshFleet = useCallback(async (options = {}) => {
    // Full-fleet fetch is expensive — ignore repeat clicks while one is running.
    if (fleetFetchInFlightRef.current) return;
    fleetFetchInFlightRef.current = true;
    setFleetLoading(true);
    setFleetError('');
    try {
      const data = await wheelsysGetVehicleFleet({
        franchiseId: fid,
        station,
        force: options.force === true,
      });
      setVehicles(Array.isArray(data.vehicles) ? data.vehicles : []);
      setStats(data.stats || null);
      setDuplicateWarnings(Array.isArray(data.duplicateWarnings) ? data.duplicateWarnings : []);
      setFleetTruncated(data.truncated === true);
      setActionMessage(`Loaded ${data.vehicles?.length || 0} WheelSys vehicles.`);
    } catch (e) {
      setFleetError(e.message || 'Failed to load WheelSys fleet.');
      setVehicles([]);
      setStats(null);
    } finally {
      fleetFetchInFlightRef.current = false;
      setFleetLoading(false);
    }
  }, [fid, station]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (sessionLoading) return;
    const sessionOk = Boolean(session?.hasSession && session?.isValid);
    if (sessionOk && !autoFleetFetchedRef.current) {
      autoFleetFetchedRef.current = true;
      refreshFleet();
    }
    if (!sessionOk) {
      autoFleetFetchedRef.current = false;
    }
  }, [sessionLoading, session, refreshFleet]);

  const handlePreviewSync = async () => {
    setSyncLoading(true);
    setActionMessage('');
    try {
      const data = await wheelsysPreviewVehicleMasterSync({ franchiseId: fid, station });
      setSyncReport(data);
      setDuplicateWarnings(Array.isArray(data.duplicateWarnings) ? data.duplicateWarnings : []);
      setFleetTruncated(data.truncated === true);
      setActionMessage('Preview sync complete (dry-run, no writes).');
    } catch (e) {
      setActionMessage(e.message || 'Preview sync failed.');
    } finally {
      setSyncLoading(false);
    }
  };

  const handleApplySync = async () => {
    if (!window.confirm(
      'Apply Vehicle Master sync? This updates wheelsysVehicleId, category, and sync status on matched araclar only.',
    )) {
      return;
    }
    setApplyLoading(true);
    setActionMessage('');
    try {
      const data = await wheelsysApplyVehicleMasterSync({
        franchiseId: fid,
        station,
        useCachedFleet: true,
      });
      setSyncReport(data);
      setDuplicateWarnings(Array.isArray(data.duplicateWarnings) ? data.duplicateWarnings : []);
      setFleetTruncated(data.truncated === true);
      const partial = data.partialFailure ? ' (partial — some writes failed)' : '';
      const cacheNote = data.fleetFromCache ? ' [cached fleet]' : '';
      setActionMessage(
        `Apply complete${partial}${cacheNote} — ${data.summary?.matched || 0} matched, ` +
        `${data.apply?.vehicleWrites || 0} vehicle writes, ` +
        `${data.apply?.failedWrites || 0} failed writes.`,
      );
    } catch (e) {
      setActionMessage(e.message || 'Apply sync failed.');
    } finally {
      setApplyLoading(false);
    }
  };

  const filteredVehicles = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (hideDefleeted && v.isDefleeted) return false;
      if (!q) return true;
      return (
        String(v.plateNo || '').toLowerCase().includes(q)
        || String(v.status || '').toLowerCase().includes(q)
        || String(v.carGroup || '').toLowerCase().includes(q)
        || String(v.brandName || '').toLowerCase().includes(q)
        || String(v.modelName || '').toLowerCase().includes(q)
        || String(v.wheelsysVehicleId || v.id || '').includes(q)
      );
    });
  }, [vehicles, searchText, hideDefleeted]);

  const sessionOk = Boolean(session?.hasSession && session?.isValid);

  return (
    <div className="w-full min-w-0 space-y-4 p-4 md:p-6 text-[#E5E5EA]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm text-[#8E8E93]">
            <Database size={16} />
            WheelSys · Fleet List
          </div>
          <h1 className="text-xl font-semibold mt-1">Vehicle Master (vehicleview)</h1>
          <p className="text-sm text-[#8E8E93] max-w-3xl mt-1">
            Official WheelSys fleet from
            {' '}
            <code className="text-xs">mainviewex.aspx/GetData</code>
            {' '}
            (viewName=vehicleview). Use Preview Sync before Apply — only safe partial merges
            (wheelsysVehicleId, category, sync status).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--erpx-border)] px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            onClick={() => refreshFleet({ force: true })}
            disabled={fleetLoading}
          >
            <RefreshCw size={14} className={fleetLoading ? 'animate-spin' : ''} />
            Refresh Fleet
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md border border-[var(--erpx-border)] px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
            onClick={handlePreviewSync}
            disabled={syncLoading || applyLoading}
          >
            <Search size={14} />
            Preview Sync
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-md bg-[#6C5CE7] px-3 py-2 text-sm font-medium text-white hover:bg-[#5b4bd6] disabled:opacity-50"
            onClick={handleApplySync}
            disabled={applyLoading || syncLoading || !canApplySync}
            title={canApplySync ? 'Apply Vehicle Master sync' : 'Admin role required'}
          >
            <Shield size={14} />
            Apply Sync
          </button>
        </div>
      </div>

      <WheelSysLoginPanel
        franchiseId={fid}
        station={station}
        sessionOk={sessionOk}
        sessionLoading={sessionLoading}
        onSessionSaved={async () => {
          autoFleetFetchedRef.current = true;
          await refreshSession();
          await refreshFleet({ force: true });
        }}
      />

      <div className="rounded-xl border border-[var(--erpx-border)] bg-[#0f0f11] p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-[#8E8E93]">Session</span>
          {sessionLoading ? (
            <span className="text-sm text-[#8E8E93]">Checking…</span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${statusBadgeClass(sessionOk)}`}
            >
              {sessionOk ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              {sessionOk ? 'Active (shared with iOS)' : 'Sign in above to continue'}
            </span>
          )}
          <button
            type="button"
            className="text-xs text-[#8E8E93] hover:text-white underline-offset-2 hover:underline"
            onClick={refreshSession}
          >
            Re-check
          </button>
        </div>
        {userProfile?.email && (
          <p className="text-[11px] text-[#636366]">
            Signed in as
            {' '}
            {userProfile.email}
          </p>
        )}
      </div>

      {actionMessage && (
        <div className="rounded-lg border border-[var(--erpx-border)] bg-[#121214] px-3 py-2 text-sm">
          {actionMessage}
        </div>
      )}

      {fleetError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {fleetError}
        </div>
      )}

      {fleetTruncated && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Fleet list may be truncated (pagination cap). Contact support if counts look low.
        </div>
      )}

      {duplicateWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <div className="font-medium mb-1">
            {duplicateWarnings.length}
            {' '}
            duplicate plate
            {duplicateWarnings.length === 1 ? '' : 's'}
            {' '}
            resolved (active ZRH record chosen)
          </div>
          <ul className="text-xs space-y-0.5 text-amber-200/90">
            {duplicateWarnings.slice(0, 6).map((w) => (
              <li key={w.normalizedPlate}>
                {w.normalizedPlate}
                :
                ids
                {' '}
                {(w.rowIds || []).join(', ')}
                {' '}
                → chosen
                {' '}
                {w.chosenId}
              </li>
            ))}
          </ul>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <MetricTile label="Total" value={stats.total ?? '—'} />
          <MetricTile label="Active" value={stats.activeCount ?? '—'} tone="ok" />
          <MetricTile label="Defleeted" value={stats.defleetedCount ?? '—'} />
          <MetricTile label="Rented" value={stats.rentedCount ?? '—'} />
          <MetricTile label="Available" value={stats.availableCount ?? '—'} />
          <MetricTile label="Non-revenue" value={stats.nonRevenueCount ?? '—'} />
          <MetricTile label="0 km" value={stats.zeroMileageCount ?? '—'} />
          <MetricTile label="0 fuel" value={stats.zeroFuelCount ?? '—'} />
        </div>
      )}

      {syncReport?.summary && (
        <div className="rounded-xl border border-[var(--erpx-border)] bg-[#0f0f11] p-4 space-y-3">
          <h2 className="text-sm font-semibold">Sync report</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            <MetricTile label="Matched" value={syncReport.summary.matched ?? 0} tone="ok" />
            <MetricTile label="Unmatched Firebase" value={syncReport.summary.unmatchedFirebase ?? 0} tone="warn" />
            <MetricTile label="Unmatched WheelSys" value={syncReport.summary.unmatchedWheelSys ?? 0} />
            <MetricTile label="Category fixes" value={syncReport.summary.categoryFixes ?? 0} />
            <MetricTile label="Ambiguous" value={syncReport.summary.ambiguous ?? 0} tone="warn" />
            <MetricTile label="Missing categories" value={(syncReport.summary.missingCategoryDocs || []).length} />
          </div>
          {syncReport.samples?.categoryFixes?.length > 0 && (
            <div>
              <div className="text-xs uppercase tracking-wide text-[#8E8E93] mb-1">Category fixes (sample)</div>
              <ul className="text-xs space-y-1 text-[#C7C7CC]">
                {syncReport.samples.categoryFixes.slice(0, 8).map((row) => (
                  <li key={`${row.plate}-${row.wheelsysVehicleId}`}>
                    {row.plate}
                    :
                    {' '}
                    {row.firebaseCategory || '—'}
                    {' '}
                    →
                    {' '}
                    {row.wheelsysCategory}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl border border-[var(--erpx-border)] bg-[#0f0f11] overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--erpx-border)] px-4 py-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8E8E93]" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search plate, status, group, model…"
              className="w-full rounded-md border border-[var(--erpx-border)] bg-[#121214] pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-[#8E8E93]">
            <input
              type="checkbox"
              checked={hideDefleeted}
              onChange={(e) => setHideDefleeted(e.target.checked)}
            />
            Hide defleeted
          </label>
          <span className="text-xs text-[#8E8E93]">
            Showing
            {' '}
            {filteredVehicles.length}
            {' '}
            /
            {' '}
            {vehicles.length}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-[#121214] text-left text-[#8E8E93]">
              <tr>
                <th className="px-4 py-2 font-medium">Plate</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Group</th>
                <th className="px-4 py-2 font-medium">Brand</th>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Mileage</th>
                <th className="px-4 py-2 font-medium">Fuel</th>
                <th className="px-4 py-2 font-medium">WheelSys ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-[#8E8E93]">
                    {fleetLoading ? 'Loading fleet…' : 'No vehicles loaded. Click Refresh Fleet.'}
                  </td>
                </tr>
              ) : (
                filteredVehicles.map((v) => (
                  <tr
                    key={`${v.wheelsysVehicleId || v.id}-${v.plateNo}`}
                    className="border-t border-[var(--erpx-border)] hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-2 font-medium">{v.plateNo || '—'}</td>
                    <td className="px-4 py-2 text-[#C7C7CC]">{v.status || '—'}</td>
                    <td className="px-4 py-2">{v.carGroup || v.effectiveCategory || '—'}</td>
                    <td className="px-4 py-2">{v.brandName || '—'}</td>
                    <td className="px-4 py-2">{v.modelName || '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{v.mileage != null ? v.mileage : '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{v.fuel != null ? v.fuel : '—'}</td>
                    <td className="px-4 py-2 tabular-nums">{v.wheelsysVehicleId || v.id}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
