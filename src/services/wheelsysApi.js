import { httpsCallable } from 'firebase/functions';
import { functionsEu } from '../firebase/client';

function callableErrorMessage(err) {
  const code = err?.code ? String(err.code).replace('functions/', '') : '';
  const base = err?.message || 'WheelSys request failed.';
  const details = err?.details;
  if (details && typeof details === 'object') {
    if (details.code === 'WHEELSYS_SESSION_EXPIRED') {
      return 'WheelSys session expired. Open WheelSys login and save a new session.';
    }
    if (details.debugPreview) {
      return `${base} (${String(details.debugPreview).slice(0, 120)})`;
    }
  }
  if (code === 'failed-precondition') {
    return base;
  }
  return base;
}

function callEu(name, data = {}) {
  const fn = httpsCallable(functionsEu, name);
  return fn(data)
    .then((res) => res.data)
    .catch((err) => {
      throw new Error(callableErrorMessage(err));
    });
}

export function wheelsysSessionStatus({ franchiseId = 'CH', station = 'ZRH' } = {}) {
  return callEu('wheelsysSessionStatus', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
  });
}

export function wheelsysSaveSession({
  franchiseId = 'CH',
  station = 'ZRH',
  sessionCookie,
  ttlHours = 12,
} = {}) {
  return callEu('wheelsysSaveSession', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
    sessionCookie: String(sessionCookie || '').trim(),
    ttlHours,
  });
}

export function wheelsysStartWebLogin({ franchiseId = 'CH', station = 'ZRH' } = {}) {
  return callEu('wheelsysStartWebLogin', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
  });
}

export function wheelsysPollWebLogin({ sid } = {}) {
  return callEu('wheelsysPollWebLogin', { sid: String(sid || '').trim() });
}

export function wheelsysGetVehicleFleet({ franchiseId = 'CH', station = 'ZRH' } = {}) {
  return callEu('wheelsysGetVehicleFleet', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
  });
}

export function wheelsysPreviewVehicleMasterSync({ franchiseId = 'CH', station = 'ZRH' } = {}) {
  return callEu('wheelsysPreviewVehicleMasterSync', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
  });
}

export function wheelsysApplyVehicleMasterSync({
  franchiseId = 'CH',
  station = 'ZRH',
  useCachedFleet = true,
} = {}) {
  return callEu('wheelsysApplyVehicleMasterSync', {
    franchiseId: String(franchiseId || 'CH').toUpperCase(),
    station: String(station || 'ZRH').toUpperCase(),
    useCachedFleet,
  });
}
