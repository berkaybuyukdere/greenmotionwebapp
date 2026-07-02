import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Mail, Plus, Save, Trash2 } from 'lucide-react';
import {
  stripeFinancialDeleteDepositEmailTemplate,
  stripeFinancialListDepositEmailTemplates,
  stripeFinancialSaveDepositEmailTemplate,
} from '../../services/stripeFinancialApi';

const PLACEHOLDER_HINT =
  'Placeholders: {{CUSTOMER_NAME}}, {{RES_CODE}}, {{DEPOSIT_AMOUNT}}, {{PLATE}}';

const emptyForm = { name: '', subject: '', bodyHtml: '' };

export function StripeDepositEmailTemplatesSection({ franchiseId, canManage }) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    try {
      const res = await stripeFinancialListDepositEmailTemplates({ franchiseId });
      setTemplates(res.templates || []);
    } catch (e) {
      setMessage(e?.message || 'Failed to load templates');
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const startNew = () => {
    setEditingId('');
    setForm(emptyForm);
    setMessage('');
  };

  const startEdit = (tpl) => {
    setEditingId(tpl.id);
    setForm({ name: tpl.name, subject: tpl.subject, bodyHtml: tpl.bodyHtml });
    setMessage('');
  };

  const handleSave = async () => {
    if (!canManage) return;
    setSaving(true);
    setMessage('');
    try {
      await stripeFinancialSaveDepositEmailTemplate({
        franchiseId,
        templateId: editingId || undefined,
        ...form,
      });
      setMessage('Template saved.');
      startNew();
      await load();
    } catch (e) {
      setMessage(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId) => {
    if (!canManage || !window.confirm('Delete this email template?')) return;
    try {
      await stripeFinancialDeleteDepositEmailTemplate({ franchiseId, templateId });
      if (editingId === templateId) startNew();
      await load();
    } catch (e) {
      setMessage(e?.message || 'Delete failed');
    }
  };

  if (!/^CH/i.test(franchiseId || '')) return null;

  return (
    <div className="settings-card mt-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <span className="text-card-title">Deposit email templates</span>
          <p className="text-caption mt-1">
            HTML templates used when sending deposit confirmation emails after terminal authorization.
          </p>
        </div>
        <Mail size={20} className="text-[var(--erpx-brand)]" />
      </div>

      {loading ? (
        <p className="text-caption flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </p>
      ) : (
        <>
          {templates.length > 0 && (
            <div className="pal-fin-template-list mb-4">
              {templates.map((tpl) => (
                <div key={tpl.id} className="pal-fin-template-row">
                  <button type="button" className="pal-fin-template-name" onClick={() => startEdit(tpl)}>
                    {tpl.name}
                  </button>
                  {canManage && (
                    <button
                      type="button"
                      className="gm-btn gm-btn-ghost gm-btn-xs"
                      onClick={() => handleDelete(tpl.id)}
                      aria-label="Delete template"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {canManage && (
            <>
              <div className="flex gap-2 mb-3">
                <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={startNew}>
                  <Plus size={14} /> New template
                </button>
              </div>
              <div className="pal-fin-form-grid pal-fin-form-grid-settings">
                <label className="pal-fin-field">
                  <span>Template name</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Standard deposit confirmation"
                  />
                </label>
                <label className="pal-fin-field pal-fin-field-full">
                  <span>Email subject</span>
                  <input
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Deposit authorization · {{RES_CODE}}"
                  />
                </label>
                <label className="pal-fin-field pal-fin-field-full">
                  <span>HTML body</span>
                  <textarea
                    rows={8}
                    value={form.bodyHtml}
                    onChange={(e) => setForm((f) => ({ ...f, bodyHtml: e.target.value }))}
                    placeholder="<p>Dear {{CUSTOMER_NAME}}, …</p>"
                    className="pal-fin-mono text-xs"
                  />
                  <small>{PLACEHOLDER_HINT}</small>
                </label>
              </div>
              <button
                type="button"
                className="gm-btn gm-btn-primary gm-btn-sm mt-3"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingId ? 'Update template' : 'Save template'}
              </button>
            </>
          )}

          {message && <p className="text-caption mt-2">{message}</p>}
        </>
      )}
    </div>
  );
}
