import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Search, Upload, X } from 'lucide-react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../firebase/client';
import {
  PalantirWorkbench,
  PalantirCommandBar,
} from '../palantir/PalantirWorkbench';
import { StripeDataTable, StripeStatusBadge } from '../StripeListUI';
import { StripeMailOrderDetailDrawer } from './StripeMailOrderDetailDrawer';
import { PalantirFinKpiCard, PalantirFinKpiRow } from './PalantirFinKpiCard';
import { useConfirmDirtyClose } from '../../utilities/useConfirmDirtyClose';
import {
  defaultResCodeValue,
  formatResCodeForSubmit,
  isResCodeComplete,
  normalizeResCodeInput,
  resCodeNumberPart,
} from '../../utilities/resCodeInput';
import {
  stripeFinancialGetConfig,
  stripeFinancialListMailOrders,
  stripeFinancialCreateMailOrderPayment,
  stripeFinancialAttachMailOrderDocuments,
  stripeFinancialSendMailOrderEmail,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';
import { isPaymentLinkMailOrder } from '../../utilities/stripeCustomerGroups';
import { resolveMailOrderCustomerLabel, sumMailOrderDailyKpi } from '../../utilities/stripeDailyTotals';
import {
  MAIL_ORDER_REMINDER_SMTP_ENABLED,
  MAIL_ORDER_LINK_VALID_DAYS,
  formatMailOrderDate,
  getMailOrderReminderDisplay,
  reminderToneClass,
} from '../../utilities/mailOrderReminderUtils';

function formatStripeMoney(amount, currency) {
  if (amount == null) return '—';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return formatCurrency(major);
  }
}

const emptyForm = {
  category: 'damage',
  resNo: defaultResCodeValue(),
  customerName: '',
  customerEmail: '',
  mailContent: '',
  unitAmountMajor: '',
  currency: 'chf',
};

const CATEGORY_OPTIONS = [
  { id: 'traffic_fine', title: 'Traffic fines', sub: 'SMTP · traffic fines mailbox', tone: 'traffic' },
  { id: 'damage', title: 'Damage', sub: 'SMTP · damage mailbox', tone: 'damage' },
  { id: 'extra', title: 'Extra', sub: 'Misc. charges · damage mailbox', tone: 'extra' },
];

function categoryBtnClass(category, active, tone) {
  const base = 'pal-fin-category-btn';
  if (!active) return base;
  const toneClass =
    tone === 'traffic'
      ? 'pal-fin-category-btn-active-traffic'
      : tone === 'damage' || tone === 'extra'
        ? 'pal-fin-category-btn-active-damage'
        : '';
  return `${base} pal-fin-category-btn-active ${toneClass}`.trim();
}

function categoryLabel(category) {
  if (category === 'traffic_fine') return 'Traffic fines';
  if (category === 'damage') return 'Damage';
  if (category === 'extra') return 'Extra';
  return category || '—';
}

function mailPreviewSubject({ category, resNo }) {
  const res = formatResCodeForSubmit(resNo) || 'RES-—';
  const label = category === 'traffic_fine' ? 'Traffic fine' : category === 'extra' ? 'Extra charge' : 'Damage';
  return `${label} payment request — ${res}`;
}

function MailComposePreview({ to, subject, body, onBodyChange, files = [] }) {
  return (
    <section className="pal-fin-mail-compose" aria-label="E-mail preview">
      <div className="pal-fin-mail-compose-toolbar">E-mail preview</div>
      <div className="pal-fin-mail-compose-fields">
        <div className="pal-fin-mail-compose-row">
          <span className="pal-fin-mail-compose-label">To</span>
          <span className="text-sm text-[var(--erpx-ink-secondary)]">{to || '—'}</span>
        </div>
        <div className="pal-fin-mail-compose-row">
          <span className="pal-fin-mail-compose-label">Subject</span>
          <span className="text-sm font-medium text-[var(--erpx-ink)]">{subject || '—'}</span>
        </div>
        <div className="pal-fin-mail-compose-row pal-fin-mail-compose-row-body">
          <span className="pal-fin-mail-compose-label">Body</span>
          <textarea
            className="pal-fin-mail-compose-input pal-fin-mail-compose-textarea"
            value={body}
            onChange={(e) => onBodyChange?.(e.target.value)}
            placeholder="Message body for the customer e-mail…"
          />
        </div>
      </div>
      <div className="pal-fin-mail-compose-preview">
        {body?.trim() ? body : 'Message body for the customer e-mail…'}
        {'\n\n'}
        [Pay button — amount shown after send]
      </div>
      {files.length > 0 && (
        <div className="pal-fin-mail-compose-attachments">
          <span className="pal-fin-mail-compose-label">Attachments</span>
          <ul>
            {files.map((f) => (
              <li key={f.name}>{f.name}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ReminderCell({ reminder, slotLabel }) {
  const display = getMailOrderReminderDisplay(reminder, slotLabel);
  return (
    <div className="pal-fin-reminder-cell">
      <span className={`pal-fin-status ${reminderToneClass(display.tone)}`}>
        <span className="pal-fin-status-dot" />
        {display.label}
      </span>
      {display.plannedAt && (
        <span className="pal-fin-reminder-date">{formatMailOrderDate(display.plannedAt)}</span>
      )}
    </div>
  );
}

export function StripeMailOrderView({ franchiseId, showFinancialTotals = true, canPerformOperations = true }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [mailOrders, setMailOrders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [reminderFilter, setReminderFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState(null);
  const [stripeMode, setStripeMode] = useState('unset');

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const [cfg, mailRes] = await Promise.all([
        stripeFinancialGetConfig({ franchiseId }),
        stripeFinancialListMailOrders({ franchiseId, limit: 200 }),
      ]);
      setConfigured(cfg?.configured !== false);
      setStripeMode(cfg?.mode || 'unset');
      setMailOrders((mailRes.orders || []).filter(isPaymentLinkMailOrder));
    } catch (e) {
      setError(e?.message || 'Failed to load mail orders');
      setMailOrders([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    let rows = mailOrders;
    if (filter === 'paid') rows = rows.filter((o) => o.status === 'paid');
    if (filter === 'unpaid') rows = rows.filter((o) => o.status !== 'paid');
    if (filter === 'sent') rows = rows.filter((o) => o.emailSentAt);

    if (reminderFilter === 'due') {
      rows = rows.filter((o) => o.reminder1?.shouldSend || o.reminder2?.shouldSend);
    } else if (reminderFilter === 'planned') {
      rows = rows.filter(
        (o) => o.reminder1?.status === 'planned' || o.reminder2?.status === 'planned',
      );
    }

    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (o) =>
        o.resNo?.toLowerCase().includes(q) ||
        o.mailContent?.toLowerCase().includes(q) ||
        o.customerName?.toLowerCase().includes(q) ||
        o.customerEmail?.toLowerCase().includes(q),
    );
  }, [mailOrders, filter, reminderFilter, search]);

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'All', count: mailOrders.length },
      { id: 'paid', label: 'Paid', count: mailOrders.filter((o) => o.status === 'paid').length },
      { id: 'unpaid', label: 'Unpaid', count: mailOrders.filter((o) => o.status !== 'paid').length },
      { id: 'sent', label: 'Email sent', count: mailOrders.filter((o) => o.emailSentAt).length },
    ],
    [mailOrders],
  );

  const kpi = useMemo(() => {
    let paidCount = 0;
    let unpaidCount = 0;
    let paidVol = 0;
    let unpaidVol = 0;
    let trafficCount = 0;
    let damageCount = 0;
    let extraCount = 0;
    for (const o of mailOrders) {
      const amt = Number(o.amount) || 0;
      if (o.status === 'paid') {
        paidCount += 1;
        paidVol += amt;
      } else {
        unpaidCount += 1;
        unpaidVol += amt;
      }
      if (o.category === 'traffic_fine') trafficCount += 1;
      else if (o.category === 'extra') extraCount += 1;
      else damageCount += 1;
    }
    return { paidCount, unpaidCount, paidVol, unpaidVol, trafficCount, damageCount, extraCount };
  }, [mailOrders]);

  const todayKpi = useMemo(() => sumMailOrderDailyKpi(mailOrders), [mailOrders]);

  const formDirty = useMemo(
    () =>
      Boolean(
        resCodeNumberPart(form.resNo) ||
          form.customerName.trim() ||
          form.customerEmail.trim() ||
          form.mailContent.trim() ||
          form.unitAmountMajor.trim() ||
          files.length,
      ),
    [form, files],
  );

  const requestCloseNewPayment = useConfirmDirtyClose({
    isDirty: formDirty && !saving,
    onClose: () => {
      if (saving) return;
      setShowNewPayment(false);
      setForm(emptyForm);
      setFiles([]);
      setError('');
    },
    enabled: showNewPayment,
  });

  const uploadDocuments = async (mailOrderId) => {
    if (!files.length) return [];
    const uploaded = [];
    for (const file of files.slice(0, 20)) {
      const path = `franchises/${franchiseId}/stripeMailOrders/${mailOrderId}/documents/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' });
      uploaded.push({
        name: file.name,
        storagePath: path,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      });
    }
    if (uploaded.length) {
      await stripeFinancialAttachMailOrderDocuments({ franchiseId, mailOrderId, documents: uploaded });
    }
    return uploaded;
  };

  const submitNewPayment = async () => {
    const resNo = formatResCodeForSubmit(form.resNo);
    const customerName = form.customerName.trim();
    const customerEmail = form.customerEmail.trim();
    if (!isResCodeComplete(form.resNo)) {
      setError('RES number is required.');
      return;
    }
    if (!customerName) {
      setError('Customer name is required.');
      return;
    }
    const major = parseFloat(String(form.unitAmountMajor).replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter a valid price.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const unitAmount = Math.round(major * 100);
      const apiCategory = form.category === 'extra' ? 'damage' : form.category;
      const result = await stripeFinancialCreateMailOrderPayment({
        franchiseId,
        category: apiCategory,
        resNo,
        customerName,
        customerEmail,
        mailContent: form.mailContent.trim(),
        unitAmount,
        currency: form.currency,
        skipEmail: true,
      });
      if (files.length && result.mailOrderId) {
        await uploadDocuments(result.mailOrderId);
      }
      if (customerEmail) {
        await stripeFinancialSendMailOrderEmail({ franchiseId, mailOrderId: result.mailOrderId });
      }
      setShowNewPayment(false);
      setForm(emptyForm);
      setFiles([]);
      await load();
    } catch (e) {
      setError(e?.message || 'Could not send payment mail');
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        key: 'res',
        header: 'RES',
        render: (row) => <span className="pal-fin-product-name">{row.resNo || row.productName}</span>,
      },
      {
        key: 'customer',
        header: 'Customer',
        render: (row) => (
          <div>
            <div>{resolveMailOrderCustomerLabel(row)}</div>
            <div className="pal-fin-product-desc">{row.customerEmail}</div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        render: (row) => (
          <StripeStatusBadge
            sharp
            variant={row.category === 'traffic_fine' ? 'traffic_fine' : 'damage'}
            label={categoryLabel(row.category)}
          />
        ),
      },
      {
        key: 'amount',
        header: 'Price',
        render: (row) => (
          <span className="font-semibold tabular-nums">{formatStripeMoney(row.amount, row.currency)}</span>
        ),
      },
      {
        key: 'payment',
        header: 'Payment',
        render: (row) => (
          <StripeStatusBadge
            sharp
            variant={row.status === 'paid' ? 'paid' : 'unpaid'}
            label={row.status === 'paid' ? 'Paid' : 'Unpaid'}
          />
        ),
      },
      {
        key: 'valid',
        header: 'Link valid until',
        render: (row) => formatMailOrderDate(row.linkValidUntil),
      },
      {
        key: 'r1',
        header: '1st reminder',
        render: (row) => <ReminderCell reminder={row.reminder1} slotLabel="1st" />,
      },
      {
        key: 'r2',
        header: '2nd reminder',
        render: (row) => <ReminderCell reminder={row.reminder2} slotLabel="2nd" />,
      },
    ],
    [],
  );

  return (
    <div className="pal-fin-root pal-analytics-page pal-fin-stripe-page">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Mail order</h1>
          <p className="pal-fin-subtitle">
            Payment link e-mails — active for {MAIL_ORDER_LINK_VALID_DAYS} days. Traffic fines and damage use separate SMTP.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
        </div>
        <div className="pal-fin-command-actions pal-fin-command-actions-symmetric">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm pal-fin-action-btn" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button type="button" className="gm-btn gm-btn-primary gm-btn-sm pal-fin-action-btn" onClick={() => { setShowNewPayment(true); setError(''); }} disabled={!canPerformOperations}>
            <Plus size={15} />
            New payment
          </button>
        </div>
      </header>

      {!configured && <div className="pal-fin-alert">Stripe CH secret key missing.</div>}
      {!MAIL_ORDER_REMINDER_SMTP_ENABLED && (
        <div className="pal-fin-info-banner">
          Reminder e-mails are planned only — automatic sending is off.
        </div>
      )}
      {error && !showNewPayment && <div className="pal-fin-alert">{error}</div>}

      {showFinancialTotals ? (
        <PalantirFinKpiRow>
          <PalantirFinKpiCard
            label="Unpaid"
            value={formatStripeMoney(kpi.unpaidVol, 'chf')}
            sub={`${kpi.unpaidCount} open payment${kpi.unpaidCount === 1 ? '' : 's'}`}
            tone="unpaid"
          />
          <PalantirFinKpiCard
            label="Paid"
            value={formatStripeMoney(kpi.paidVol, 'chf')}
            sub={`${kpi.paidCount} completed`}
            tone="paid"
          />
          <PalantirFinKpiCard
            label="Traffic fines"
            value={kpi.trafficCount}
            sub="Mail order records"
            tone="default"
          />
          <PalantirFinKpiCard
            label="Damage"
            value={kpi.damageCount}
            sub="Mail order records"
            tone="revenue"
          />
        </PalantirFinKpiRow>
      ) : (
        <PalantirFinKpiRow>
          <PalantirFinKpiCard
            label="Today · Unpaid"
            value={todayKpi.unpaidCount}
            sub={`${todayKpi.unpaidCount} open today`}
            tone="unpaid"
          />
          <PalantirFinKpiCard
            label="Today · Paid"
            value={todayKpi.paidCount}
            sub={`${todayKpi.paidCount} completed today`}
            tone="paid"
          />
        </PalantirFinKpiRow>
      )}

      <div className="pal-fin-toolbar">
        <label className="pal-fin-search">
          <Search size={16} className="text-[var(--erpx-ink-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by RES, customer, mail content…"
          />
        </label>
        <div className="pal-fin-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`pal-fin-chip pal-fin-chip-symmetric ${filter === chip.id ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="pal-fin-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="pal-fin-chips pal-fin-chips-reminder">
          <button type="button" className={`pal-fin-chip pal-fin-chip-symmetric ${reminderFilter === 'all' ? 'pal-fin-chip-active' : ''}`} onClick={() => setReminderFilter('all')}>All reminders</button>
          <button type="button" className={`pal-fin-chip pal-fin-chip-symmetric ${reminderFilter === 'due' ? 'pal-fin-chip-active' : ''}`} onClick={() => setReminderFilter('due')}>Due now</button>
          <button type="button" className={`pal-fin-chip pal-fin-chip-symmetric ${reminderFilter === 'planned' ? 'pal-fin-chip-active' : ''}`} onClick={() => setReminderFilter('planned')}>Planned</button>
        </div>
      </div>

      <div className="pal-fin-grid-single">
        <div className="pal-fin-main pal-fin-main-full">
          <StripeDataTable
            dense
            columns={columns}
            rows={filtered}
            loading={loading}
            emptyMessage="No mail orders yet. Create a new payment."
            onRowClick={setDrawerOrder}
            selectedRowId={drawerOrder?.id}
          />
        </div>
      </div>

      {drawerOrder && (
        <StripeMailOrderDetailDrawer order={drawerOrder} onClose={() => setDrawerOrder(null)} />
      )}

      {showNewPayment && (
        <PalantirWorkbench onClose={requestCloseNewPayment} size="large">
          <PalantirCommandBar
            eyebrow="Mail order · New payment"
            title="Send payment request"
            subtitle={`Customer receives e-mail with embedded Pay button. Link valid ${MAIL_ORDER_LINK_VALID_DAYS} days.`}
            onClose={requestCloseNewPayment}
            actions={
              <button type="button" className="gm-btn gm-btn-primary gm-btn-sm" onClick={submitNewPayment} disabled={saving}>
                {saving ? 'Sending…' : 'Send payment e-mail'}
              </button>
            }
          />
          <div className="p-6 max-w-2xl mx-auto w-full space-y-3 pal-fin-new-payment-body pal-fin-new-payment-body-compact">
            {error && <div className="pal-fin-alert">{error}</div>}

            <div className="pal-fin-category-toggle pal-fin-category-toggle-3">
              {CATEGORY_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={categoryBtnClass(opt.id, form.category === opt.id, opt.tone)}
                  onClick={() => setForm((f) => ({ ...f, category: opt.id }))}
                >
                  <span className="pal-fin-category-btn-title">{opt.title}</span>
                  <span className="pal-fin-category-btn-sub">{opt.sub}</span>
                </button>
              ))}
            </div>

            <label className="block">
              <span className="pal-fin-field-label">RES code *</span>
              <input
                className="pal-fin-input pal-fin-mono"
                value={form.resNo}
                onChange={(e) => setForm((f) => ({ ...f, resNo: normalizeResCodeInput(e.target.value) }))}
                placeholder="17505"
              />
              <span className="text-caption">Type number only — RES- is prefilled.</span>
            </label>
            <div className="pal-fin-inline-form-row">
              <label className="block">
                <span className="pal-fin-field-label">Customer name *</span>
                <input className="pal-fin-input" value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} />
              </label>
              <label className="block">
                <span className="pal-fin-field-label">Customer email *</span>
                <input type="email" className="pal-fin-input" value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} />
              </label>
            </div>
            <MailComposePreview
              to={form.customerEmail}
              subject={mailPreviewSubject({ category: form.category, resNo: form.resNo })}
              body={form.mailContent}
              onBodyChange={(value) => setForm((f) => ({ ...f, mailContent: value }))}
              files={files}
            />
            <div className="pal-fin-inline-form-row">
              <label className="block">
                <span className="pal-fin-field-label">Price (CHF) *</span>
                <input className="pal-fin-input" inputMode="decimal" value={form.unitAmountMajor} onChange={(e) => setForm((f) => ({ ...f, unitAmountMajor: e.target.value }))} placeholder="1500.00" />
              </label>
              <label className="block">
                <span className="pal-fin-field-label">Currency</span>
                <select className="pal-fin-input" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                  <option value="chf">CHF</option>
                  <option value="eur">EUR</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="pal-fin-field-label">Attachments</span>
              <div className="pal-fin-upload-zone">
                <input
                  type="file"
                  multiple
                  id="mail-order-files"
                  className="sr-only"
                  onChange={(e) => setFiles(Array.from(e.target.files || []))}
                />
                <label htmlFor="mail-order-files" className="gm-btn gm-btn-secondary gm-btn-sm cursor-pointer">
                  <Upload size={14} />
                  Add files
                </label>
                {files.length > 0 && (
                  <ul className="pal-fin-doc-list mt-2">
                    {files.map((f) => (
                      <li key={f.name}>{f.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            </label>
          </div>
        </PalantirWorkbench>
      )}
    </div>
  );
}
