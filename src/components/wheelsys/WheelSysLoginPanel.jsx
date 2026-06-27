import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, LogIn } from 'lucide-react';
import {
  wheelsysPollWebLogin,
  wheelsysStartWebLogin,
} from '../../services/wheelsysApi';

export default function WheelSysLoginPanel({
  franchiseId = 'CH',
  station = 'ZRH',
  sessionOk = false,
  sessionLoading = false,
  onSessionSaved,
}) {
  const fid = String(franchiseId || 'CH').toUpperCase();
  const [sid, setSid] = useState('');
  const [iframeSrc, setIframeSrc] = useState('');
  const [phase, setPhase] = useState('idle');
  const [message, setMessage] = useState('');
  const savedRef = useRef(false);

  const beginLogin = useCallback(async () => {
    setPhase('starting');
    setMessage('');
    try {
      const data = await wheelsysStartWebLogin({ franchiseId: fid, station });
      const nextSid = String(data.sid || '').trim();
      if (!nextSid) throw new Error('Could not start WheelSys login.');
      const path = String(data.proxyPath || `/wheelsys-login-proxy/ui/?sid=${nextSid}`);
      setSid(nextSid);
      setIframeSrc(`${window.location.origin}${path}`);
      setPhase('login');
    } catch (e) {
      setPhase('error');
      setMessage(e.message || 'Failed to open WheelSys login.');
    }
  }, [fid, station]);

  useEffect(() => {
    savedRef.current = false;
    if (sessionLoading || sessionOk) {
      setPhase(sessionOk ? 'ready' : 'idle');
      setSid('');
      setIframeSrc('');
      return undefined;
    }
    beginLogin();
    return undefined;
  }, [sessionLoading, sessionOk, beginLogin]);

  useEffect(() => {
    if (!sid || sessionOk || savedRef.current) return undefined;

    let cancelled = false;
    const tick = async () => {
      try {
        const result = await wheelsysPollWebLogin({ sid });
        if (cancelled || savedRef.current) return;
        if (result.expired) {
          setPhase('error');
          setMessage('Login session expired. Refresh the page to try again.');
          return;
        }
        if (result.ready && result.saved) {
          savedRef.current = true;
          setPhase('saving');
          setMessage('Session captured — loading fleet…');
          if (onSessionSaved) await onSessionSaved();
          setPhase('ready');
        }
      } catch (_) {
        /* poll until login completes */
      }
    };

    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [sid, sessionOk, onSessionSaved]);

  if (sessionLoading) {
    return (
      <div className="rounded-xl border border-[var(--erpx-border)] bg-[#0f0f11] p-4 flex items-center gap-2 text-sm text-[#8E8E93]">
        <Loader2 size={16} className="animate-spin" />
        Checking WheelSys session…
      </div>
    );
  }

  if (sessionOk || phase === 'ready') {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 flex flex-wrap items-center gap-2">
        <CheckCircle2 size={18} className="text-emerald-300" />
        <div>
          <div className="text-sm font-medium text-emerald-200">WheelSys session active</div>
          <p className="text-xs text-emerald-200/80 mt-0.5">
            Shared with iOS and server sync. Fleet loads automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--erpx-border)] bg-[#0f0f11] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--erpx-border)] px-4 py-3">
        <LogIn size={16} className="text-[#8E8E93]" />
        <div>
          <div className="text-sm font-medium">WheelSys sign-in</div>
          <p className="text-xs text-[#8E8E93]">
            Sign in below — session is captured automatically (same as iOS).
          </p>
        </div>
        {(phase === 'starting' || phase === 'saving') && (
          <Loader2 size={16} className="ml-auto animate-spin text-[#8E8E93]" />
        )}
      </div>

      {phase === 'error' ? (
        <div className="p-4 space-y-3">
          <p className="text-sm text-amber-200">{message || 'Login failed.'}</p>
          <button
            type="button"
            onClick={beginLogin}
            className="rounded-md bg-[#6C5CE7] px-3 py-2 text-sm font-medium text-white hover:bg-[#5b4bd6]"
          >
            Retry login
          </button>
        </div>
      ) : (
        <iframe
          title="WheelSys login"
          src={iframeSrc || 'about:blank'}
          className="w-full bg-white"
          style={{ height: 'min(560px, 70vh)', border: 0 }}
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      )}

      {message && phase !== 'error' && (
        <p className="px-4 py-2 text-xs text-[#8E8E93] border-t border-[var(--erpx-border)]">
          {message}
        </p>
      )}
    </div>
  );
}
