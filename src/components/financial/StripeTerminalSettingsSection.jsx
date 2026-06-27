import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plug, Save } from 'lucide-react';
import {
  stripeFinancialGetTerminalConfig,
  stripeFinancialSaveTerminalConfig,
  stripeFinancialTestTerminalConnection,
} from '../../services/stripeFinancialApi';

export function StripeTerminalSettingsSection({ franchiseId, canManage }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [readerId, setReaderId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [readerLabel, setReaderLabel] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await stripeFinancialGetTerminalConfig({ franchiseId });
      setCfg(res);
      setReaderId(res.readerId || '');
      setLocationId(res.locationId || '');
      setReaderLabel(res.readerLabel || '');
    } catch (e) {
      setMessage(e?.message || 'Failed to load terminal config');
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await stripeFinancialSaveTerminalConfig({
        franchiseId,
        readerId: readerId.trim(),
        locationId: locationId.trim(),
        readerLabel: readerLabel.trim(),
      });
      setMessage('Terminal settings saved.');
      await load();
    } catch (e) {
      setMessage(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setMessage('');
    try {
      if (readerId.trim()) {
        await stripeFinancialSaveTerminalConfig({
          franchiseId,
          readerId: readerId.trim(),
          locationId: locationId.trim(),
          readerLabel: readerLabel.trim(),
        });
      }
      const res = await stripeFinancialTestTerminalConnection({ franchiseId });
      setTestResult(res);
      setMessage(res.message);
      await load();
    } catch (e) {
      setMessage(e?.message || 'Test failed');
    } finally {
      setTesting(false);
    }
  };

  if (!/^CH/i.test(franchiseId || '')) {
    return null;
  }

  return (
    <div className="settings-card mt-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <span className="text-card-title">Stripe Terminal · Add device</span>
          <p className="text-caption mt-1">
            Pair your POS reader for rental deposits. Secret key stays on the server — only reader and location IDs are stored here.
          </p>
        </div>
        <Plug size={20} className="text-[var(--erpx-brand)]" />
      </div>

      {loading ? (
        <p className="text-caption flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <div className="pal-fin-terminal-meta mb-4">
            <div>
              <span className="text-caption">Publishable key</span>
              <p className="pal-fin-mono text-xs truncate max-w-md">
                {cfg?.publishableKey ? `${cfg.publishableKey.slice(0, 12)}…` : 'Not configured'}
              </p>
            </div>
            <div>
              <span className="text-caption">Server secret</span>
              <p className="text-xs">
                {cfg?.secretConfigured ? (
                  <span className="text-green-600 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Configured (Firebase secret)
                  </span>
                ) : (
                  <span className="text-amber-600">Missing STRIPE_CH_SECRET_KEY</span>
                )}
              </p>
            </div>
            <div>
              <span className="text-caption">Mode</span>
              <p className="text-xs uppercase">{cfg?.mode || 'unset'}</p>
            </div>
          </div>

          {canManage ? (
            <div className="pal-fin-form-grid pal-fin-form-grid-settings">
              <label className="pal-fin-field">
                <span>Reader label</span>
                <input
                  value={readerLabel}
                  onChange={(e) => setReaderLabel(e.target.value)}
                  placeholder="Front desk POS"
                />
              </label>
              <label className="pal-fin-field">
                <span>Reader ID (tmr_…)</span>
                <input
                  value={readerId}
                  onChange={(e) => setReaderId(e.target.value)}
                  placeholder="tmr_…"
                  className="pal-fin-mono"
                />
              </label>
              <label className="pal-fin-field pal-fin-field-full">
                <span>Location ID (tml_…, recommended)</span>
                <input
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  placeholder="tml_…"
                  className="pal-fin-mono"
                />
                <small>Payments use server → POS (Stripe cloud). Location ID helps reader management in Dashboard.</small>
              </label>
            </div>
          ) : (
            <p className="text-caption">Admin access required to edit terminal devices.</p>
          )}

          {cfg?.lastTestAt && (
            <p className={`text-xs mt-2 ${cfg.lastTestOk ? 'text-green-600' : 'text-amber-600'}`}>
              Last test: {new Date(cfg.lastTestAt).toLocaleString()} — {cfg.lastTestMessage}
            </p>
          )}

          {testResult && (
            <p className={`text-xs mt-2 ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
              {testResult.message}
            </p>
          )}

          {message && <p className="text-caption mt-2">{message}</p>}

          {canManage && (
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                className="gm-btn gm-btn-secondary gm-btn-sm"
                onClick={handleTest}
                disabled={testing || !readerId.trim()}
              >
                {testing ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                Test connection
              </button>
              <button
                type="button"
                className="gm-btn gm-btn-primary gm-btn-sm"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save device
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
