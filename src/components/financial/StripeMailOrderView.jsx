import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  RefreshCw,
  Pencil,
  Trash2,
  Link2,
  Search,
  CreditCard,
} from 'lucide-react';
import { MailOrderLinkCopyPanel } from './MailOrderLinkCopyPanel';
import {
  PalantirWorkbench,
  PalantirCommandBar,
  PalantirInspectorRow,
} from '../palantir/PalantirWorkbench';
import { StripePaymentMethodCell } from './StripePaymentMethodCell';
import { PaymentMethodBadges } from './PaymentMethodBadges';
import {
  stripeFinancialGetConfig,
  stripeFinancialListProducts,
  stripeFinancialCreateProduct,
  stripeFinancialUpdateProduct,
  stripeFinancialDeleteProduct,
  stripeFinancialCreateMailOrderPaymentLink,
  stripeFinancialListMailOrders,
  stripeFinancialListAudit,
} from '../../services/stripeFinancialApi';
import { formatCurrency } from '../../utilities/dateFormatters';

const CURRENCIES = [
  { id: 'chf', label: 'CHF' },
  { id: 'eur', label: 'EUR' },
  { id: 'usd', label: 'USD' },
  { id: 'try', label: 'TRY' },
];

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
  name: '',
  description: '',
  unitAmountMajor: '',
  currency: 'chf',
  active: true,
  saveCustomerInfo: false,
};

export function StripeMailOrderView({ franchiseId }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [products, setProducts] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [paymentLink, setPaymentLink] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [saveCustomerForCheckout, setSaveCustomerForCheckout] = useState(false);
  const [mailOrders, setMailOrders] = useState([]);
  const [audit, setAudit] = useState([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [stripeMode, setStripeMode] = useState('unset');
  const [detailOpen, setDetailOpen] = useState(false);

  const load = useCallback(async () => {
    if (!franchiseId) return;
    setLoading(true);
    setError('');
    try {
      const cfg = await stripeFinancialGetConfig({ franchiseId });
      setConfigured(cfg?.configured !== false);
      setStripeMode(cfg?.mode || 'unset');
      const [res, mailRes] = await Promise.all([
        stripeFinancialListProducts({ franchiseId, limit: 100, activeOnly: true }),
        stripeFinancialListMailOrders({ franchiseId, limit: 200 }),
      ]);
      setProducts(res.products || []);
      setMailOrders(mailRes.orders || []);
      const auditRes = await stripeFinancialListAudit({ franchiseId, limit: 30 });
      setAudit(auditRes.entries || []);
    } catch (e) {
      setError(e?.message || 'Failed to load mail-order products');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [franchiseId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (selected) {
      setSaveCustomerForCheckout(selected.saveCustomerInfo === true);
    }
  }, [selected]);

  const paymentStatusByProduct = useMemo(() => {
    const map = {};
    for (const order of mailOrders) {
      const pid = order.productId;
      if (!pid) continue;
      const prev = map[pid];
      if (!prev || String(order.createdAt || '') > String(prev.createdAt || '')) {
        map[pid] = order;
      }
    }
    return map;
  }, [mailOrders]);

  const enrichedProducts = useMemo(
    () =>
      products.map((p) => {
        const order = paymentStatusByProduct[p.id];
        return {
          ...p,
          paymentStatus: order?.status === 'paid' ? 'paid' : order ? 'unpaid' : 'none',
          latestMailOrder: order || null,
        };
      }),
    [products, paymentStatusByProduct]
  );

  const filtered = useMemo(() => {
    let rows = enrichedProducts;
    if (filter === 'paid') rows = rows.filter((p) => p.paymentStatus === 'paid');
    if (filter === 'unpaid') rows = rows.filter((p) => p.paymentStatus === 'unpaid');
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q) ||
        p.id?.toLowerCase().includes(q)
    );
  }, [enrichedProducts, filter, search]);

  const filterChips = useMemo(
    () => [
      { id: 'all', label: 'All', count: enrichedProducts.length },
      {
        id: 'paid',
        label: 'Paid',
        count: enrichedProducts.filter((p) => p.paymentStatus === 'paid').length,
      },
      {
        id: 'unpaid',
        label: 'Unpaid',
        count: enrichedProducts.filter((p) => p.paymentStatus === 'unpaid').length,
      },
    ],
    [enrichedProducts]
  );

  const openCreate = () => {
    setForm(emptyForm);
    setModal('create');
    setError('');
  };

  const openEdit = (product) => {
    setForm({
      name: product.name || '',
      description: product.description || '',
      unitAmountMajor: product.unitAmount != null ? String(Number(product.unitAmount) / 100) : '',
      currency: product.currency || 'chf',
      active: product.active !== false,
      saveCustomerInfo: product.saveCustomerInfo === true,
    });
    setModal('edit');
    setSelected(product);
    setError('');
  };

  const saveProduct = async () => {
    if (!franchiseId) return;
    const name = form.name.trim();
    if (!name) {
      setError('Product name is required.');
      return;
    }
    const major = parseFloat(String(form.unitAmountMajor).replace(',', '.'));
    if (!Number.isFinite(major) || major <= 0) {
      setError('Enter a valid price.');
      return;
    }
    const unitAmount = Math.round(major * 100);

    setSaving(true);
    setError('');
    try {
      if (modal === 'create') {
        await stripeFinancialCreateProduct({
          franchiseId,
          name,
          description: form.description.trim(),
          unitAmount,
          currency: form.currency,
          active: form.active,
          saveCustomerInfo: form.saveCustomerInfo,
        });
      } else if (modal === 'edit' && selected) {
        await stripeFinancialUpdateProduct({
          franchiseId,
          productId: selected.id,
          name,
          description: form.description.trim(),
          unitAmount,
          currency: form.currency,
          active: form.active,
          saveCustomerInfo: form.saveCustomerInfo,
        });
      }
      setModal(null);
      await load();
    } catch (e) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (product, e) => {
    e?.stopPropagation?.();
    if (!window.confirm(`Permanently delete "${product.name}" from Stripe? This cannot be undone.`)) {
      return;
    }
    setError('');
    try {
      const result = await stripeFinancialDeleteProduct({ franchiseId, productId: product.id });
      if (result?.message && !result?.hardDeleted) {
        // Soft-deleted in Stripe — still removed from catalog list.
      }
      if (selected?.id === product.id) {
        setSelected(null);
        setDetailOpen(false);
      }
      await load();
    } catch (err) {
      setError(err?.message || 'Delete failed');
    }
  };

  const createPaymentLink = async () => {
    if (!selected) return;
    setLinkLoading(true);
    setError('');
    setPaymentLink('');
    try {
      const res = await stripeFinancialCreateMailOrderPaymentLink({
        franchiseId,
        productId: selected.id,
        customerEmail: customerEmail.trim() || undefined,
        saveCustomerInfo: saveCustomerForCheckout,
      });
      setPaymentLink(res.url || '');
      const mailRes = await stripeFinancialListMailOrders({ franchiseId, limit: 200 });
      setMailOrders(mailRes.orders || []);
    } catch (e) {
      const msg = e?.message || 'Could not create checkout link';
      setError(msg);
    } finally {
      setLinkLoading(false);
    }
  };

  const openProductDetail = (row) => {
    setSelected(row);
    setPaymentLink(row.latestMailOrder?.paymentUrl || '');
    setCustomerEmail('');
    setError('');
    setDetailOpen(true);
  };

  const paymentStatusLabel = (status) => {
    if (status === 'paid') return 'Paid';
    if (status === 'unpaid') return 'Unpaid';
    return 'No link';
  };

  const closeProductDetail = () => {
    setDetailOpen(false);
  };

  return (
    <div className="pal-fin-root">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe</p>
          <h1 className="pal-fin-title">Mail order</h1>
          <p className="pal-fin-subtitle">
            Product catalog and secure checkout links. Customer can pay with card wallets and local methods via Stripe.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
        </div>
        <div className="pal-fin-command-actions">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm" onClick={load} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            Sync
          </button>
          <button type="button" className="gm-btn gm-btn-primary gm-btn-sm" onClick={openCreate}>
            <Plus size={15} />
            New product
          </button>
        </div>
      </header>

      {!configured && (
        <div className="pal-fin-alert" style={{ borderColor: 'var(--erpx-amber-border)', background: 'var(--erpx-amber-bg)', color: 'var(--erpx-amber)' }}>
          Stripe CH secret key missing on Cloud Functions. Set STRIPE_CH_SECRET_KEY and redeploy.
        </div>
      )}

      {error && <div className="pal-fin-alert">{error}</div>}

      <div className="pal-fin-toolbar">
        <label className="pal-fin-search">
          <Search size={16} className="text-[var(--erpx-ink-muted)]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter products…"
          />
        </label>
        <div className="pal-fin-chips">
          {filterChips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`pal-fin-chip ${filter === chip.id ? 'pal-fin-chip-active' : ''}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
              <span className="pal-fin-chip-count">{chip.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pal-fin-grid-single">
        <div className="pal-fin-main pal-fin-main-full">
          <div className="pal-fin-table-wrap">
            <table className="pal-fin-table pal-fin-table-dense">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Payment</th>
                  <th>Payment status</th>
                  <th>Stripe ID</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="pal-fin-empty">
                      Loading catalog…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="pal-fin-empty">
                      No products. Create one to start mail order.
                    </td>
                  </tr>
                ) : (
                  filtered.map((row) => (
                    <tr
                      key={row.id}
                      className={selected?.id === row.id ? 'pal-fin-row-selected' : ''}
                      onClick={() => openProductDetail(row)}
                    >
                      <td>
                        <div className="pal-fin-product-name">{row.name}</div>
                        {row.description ? (
                          <div className="pal-fin-product-desc">{row.description}</div>
                        ) : null}
                      </td>
                      <td className="font-semibold tabular-nums">
                        {formatStripeMoney(row.unitAmount, row.currency)}
                      </td>
                      <td>
                        <StripePaymentMethodCell brand="link" methodType="link" />
                      </td>
                      <td>
                        <span
                          className={`pal-fin-status ${
                            row.paymentStatus === 'paid'
                              ? 'pal-fin-status-paid'
                              : row.paymentStatus === 'unpaid'
                                ? 'pal-fin-status-unpaid'
                                : 'pal-fin-status-neutral'
                          }`}
                        >
                          <span className="pal-fin-status-dot" />
                          {paymentStatusLabel(row.paymentStatus)}
                        </span>
                      </td>
                      <td className="pal-fin-mono">{row.id}</td>
                      <td>
                        <div className="pal-fin-row-actions">
                          <button
                            type="button"
                            className="gm-btn gm-btn-ghost gm-btn-sm"
                            title="Edit"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEdit(row);
                            }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="gm-btn gm-btn-ghost gm-btn-sm"
                            title="Delete permanently"
                            onClick={(e) => deleteProduct(row, e)}
                          >
                            <Trash2 size={14} className="text-[var(--erpx-red)]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {detailOpen && selected && (
        <PalantirWorkbench onClose={closeProductDetail} size="fit">
          <PalantirCommandBar
            eyebrow="Mail order · Checkout"
            title={selected.name}
            subtitle="Generate a secure Stripe checkout link for this product."
            onClose={closeProductDetail}
          />
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <PalantirInspectorRow label="Amount" value={formatStripeMoney(selected.unitAmount, selected.currency)} />
            <PalantirInspectorRow
              label="Payment status"
              value={paymentStatusLabel(selected.paymentStatus || 'none')}
            />
            <PalantirInspectorRow label="Stripe ID" value={selected.id} mono />
            <PalantirInspectorRow
              label="Save customer"
              value={selected.saveCustomerInfo ? 'Default: Yes' : 'Default: No'}
            />
            <PaymentMethodBadges title="Checkout methods" compact methods={['link']} />

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)]">
                Customer email
              </span>
              <input
                type="email"
                className="pal-fin-input"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="Prefill on Stripe Checkout"
              />
            </label>

            <label className="pal-fin-check">
              <input
                type="checkbox"
                checked={saveCustomerForCheckout}
                onChange={(e) => setSaveCustomerForCheckout(e.target.checked)}
              />
              <span>
                <strong>Save customer &amp; payment method</strong> in Stripe for this checkout.
              </span>
            </label>

            <button
              type="button"
              className="gm-btn gm-btn-primary w-full"
              disabled={linkLoading || !selected.active}
              onClick={createPaymentLink}
            >
              <Link2 size={16} />
              {linkLoading ? 'Creating checkout…' : 'Generate checkout link'}
            </button>

            {paymentLink && (
              <MailOrderLinkCopyPanel
                url={paymentLink}
                productName={selected.name}
                amountLabel={formatStripeMoney(selected.unitAmount, selected.currency)}
              />
            )}

            {audit.length > 0 && (
              <div className="pal-fin-audit">
                <p className="pal-fin-inspector-title">Recent activity</p>
                {audit.slice(0, 5).map((e) => (
                  <div key={e.id} className="pal-fin-audit-item">
                    <strong>{e.action}</strong>
                    {e.detail?.productId && (
                      <span className="pal-fin-mono"> · {e.detail.productId}</span>
                    )}
                    <div>{e.createdAt || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </PalantirWorkbench>
      )}

      {modal && (
        <PalantirWorkbench onClose={() => !saving && setModal(null)} size="large">
          <PalantirCommandBar
            eyebrow="Mail order · Product"
            title={modal === 'create' ? 'Create product' : 'Edit product'}
            subtitle="Catalog entry synced to Stripe. Configure default customer retention for checkout."
            onClose={() => !saving && setModal(null)}
            actions={
              <button type="button" className="gm-btn gm-btn-primary gm-btn-sm" onClick={saveProduct} disabled={saving}>
                {saving ? 'Saving…' : 'Save to Stripe'}
              </button>
            }
          />
          <div className="p-6 max-w-xl mx-auto w-full space-y-4">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)]">
                Product name *
              </span>
              <input
                className="pal-fin-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={250}
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)]">
                Description
              </span>
              <textarea
                className="pal-fin-input min-h-[88px]"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>

            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)]">
                  Price *
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="pal-fin-input"
                  value={form.unitAmountMajor}
                  onChange={(e) => setForm((f) => ({ ...f, unitAmountMajor: e.target.value }))}
                  placeholder="1500.00"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)]">
                  Currency
                </span>
                <select
                  className="pal-fin-input"
                  value={form.currency}
                  onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="pal-fin-check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
              />
              <span>Product is active and available for mail order</span>
            </label>

            <label className="pal-fin-check">
              <input
                type="checkbox"
                checked={form.saveCustomerInfo}
                onChange={(e) => setForm((f) => ({ ...f, saveCustomerInfo: e.target.checked }))}
              />
              <span>
                <CreditCard size={14} className="inline mr-1 align-text-bottom" />
                <strong>Default: save customer &amp; payment info</strong> when generating checkout links for this
                product (can be overridden per link in the inspector).
              </span>
            </label>
          </div>
        </PalantirWorkbench>
      )}
    </div>
  );
}
