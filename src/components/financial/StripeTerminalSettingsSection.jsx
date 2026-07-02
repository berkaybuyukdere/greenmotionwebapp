import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Plug, Plus, Save, Star, Trash2 } from 'lucide-react';
import {
  stripeFinancialGetTerminalConfig,
  stripeFinancialListTerminals,
  stripeFinancialUpsertTerminal,
  stripeFinancialDeleteTerminal,
  stripeFinancialTestTerminalConnection,
} from '../../services/stripeFinancialApi';

const emptyTerminal = { readerLabel: '', readerId: '', locationId: '', isDefault: false };

export function StripeTerminalSettingsSection({ franchiseId, canManage }) {
  const [loading, setLoading] = useState(true);
  const [readers, setReaders] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState(emptyTerminal);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configRes, listRes] = await Promise.all([
        stripeFinancialGetTerminalConfig({ franchiseId }),
        stripeFinancialListTerminals({ franchiseId }),
      ]);
      setCfg(configRes);
      setReaders(listRes.readers || configRes.readers || []);
    } catch (e) {
      setMessage(e?.message || 'Failed to load terminal config');
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setEditingId('');
    setForm({ ...emptyTerminal, isDefault: readers.length === 0 });
  };

  const startEdit = (reader) => {
    setEditingId(reader.id);
    setForm({
      readerLabel: reader.readerLabel || '',
      readerId: reader.readerId || '',
      locationId: reader.locationId || '',
      isDefault: reader.isDefault === true,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await stripeFinancialUpsertTerminal({
        franchiseId,
        terminalId: editingId && editingId !== 'legacy' ? editingId : undefined,
        ...form,
      });
      setMessage('Terminal saved.');
      startNew();
      await load();
    } catch (e) {
      setMessage(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (terminalId) => {
    if (!window.confirm('Remove this terminal from ERP?')) return;
    try {
      await stripeFinancialDeleteTerminal({ franchiseId, terminalId });
      if (editingId === terminalId) startNew();
      await load();
    } catch (e) {
      setMessage(e?.message || 'Delete failed');
    }
  };

  const handleTest = async (reader) => {
    setTestingId(reader.readerId);
    setMessage('');
    try {
      await stripeFinancialUpsertTerminal({
        franchiseId,
        terminalId: reader.id !== 'legacy' ? reader.id : undefined,
        readerId: reader.readerId,
        locationId: reader.locationId,
        readerLabel: reader.readerLabel,
        isDefault: reader.isDefault,
      });
      const res = await stripeFinancialTestTerminalConnection({
        franchiseId,
        readerId: reader.readerId,
      });
      setMessage(res.message);
      await load();
    } catch (e) {
      setMessage(e?.message || 'Test failed');
    } finally {
      setTestingId('');
    }
  };

  if (!/^CH/i.test(franchiseId || '')) {
    return null;
  }

  return (
    <div className="settings-card mt-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <span className="text-card-title">Stripe Terminal · POS devices</span>
          <p className="text-caption mt-1">
            Connect multiple POS readers for rental deposits. Staff choose which terminal when starting a deposit.
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
                    <CheckCircle2 size={12} /> Configured
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

          {readers.length > 0 && (
            <div className="pal-fin-terminal-list mb-4">
              {readers.map((reader) => (
                <div key={reader.id || reader.readerId} className="pal-fin-terminal-row">
                  <div>
                    <p className="font-medium text-sm flex items-center gap-1">
                      {reader.readerLabel || reader.readerId}
                      {reader.isDefault && (
                        <span className="pal-fin-badge pal-fin-badge-info">
                          <Star size={10} /> Default
                        </span>
                      )}
                    </p>
                    <p className="pal-fin-mono text-xs text-[var(--erpx-ink-muted)]">{reader.readerId}</p>
                    {reader.lastTestMessage && (
                      <p className={`text-xs mt-1 ${reader.lastTestOk ? 'text-green-600' : 'text-amber-600'}`}>
                        {reader.lastTestMessage}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-1">
                    {canManage && (
                      <>
                        <button type="button" className="gm-btn gm-btn-ghost gm-btn-xs" onClick={() => startEdit(reader)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="gm-btn gm-btn-secondary gm-btn-xs"
                          disabled={testingId === reader.readerId}
                          onClick={() => handleTest(reader)}
                        >
                          {testingId === reader.readerId ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Plug size={12} />
                          )}
                          Test
                        </button>
                        {reader.id !== 'legacy' && (
                          <button
                            type="button"
                            className="gm-btn gm-btn-ghost gm-btn-xs text-red-600"
                            onClick={() => handleDelete(reader.id)}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {canManage ? (
            <>
              <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm mb-3" onClick={startNew}>
                <Plus size={14} /> Add terminal
              </button>
              <div className="pal-fin-form-grid pal-fin-form-grid-settings">
                <label className="pal-fin-field">
                  <span>Reader label</span>
                  <input
                    value={form.readerLabel}
                    onChange={(e) => setForm((f) => ({ ...f, readerLabel: e.target.value }))}
                    placeholder="Front desk POS"
                  />
                </label>
                <label className="pal-fin-field">
                  <span>Reader ID (tmr_…)</span>
                  <input
                    value={form.readerId}
                    onChange={(e) => setForm((f) => ({ ...f, readerId: e.target.value }))}
                    placeholder="tmr_…"
                    className="pal-fin-mono"
                  />
                </label>
                <label className="pal-fin-field pal-fin-field-full">
                  <span>Location ID (tml_…)</span>
                  <input
                    value={form.locationId}
                    onChange={(e) => setForm((f) => ({ ...f, locationId: e.target.value }))}
                    placeholder="tml_…"
                    className="pal-fin-mono"
                  />
                </label>
                <label className="pal-fin-check pal-fin-field-full">
                  <input
                    type="checkbox"
                    checked={form.isDefault}
                    onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))}
                  />
                  <span>Default terminal for new deposits</span>
                </label>
              </div>
              <button type="button" className="gm-btn gm-btn-primary gm-btn-sm mt-3" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingId ? 'Update terminal' : 'Save terminal'}
              </button>
            </>
          ) : (
            <p className="text-caption">Admin access required to edit terminal devices.</p>
          )}

          {message && <p className="text-caption mt-2">{message}</p>}
        </>
      )}
    </div>
  );
}
