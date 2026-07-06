import React, { useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { StripePaymentsDepositsTab } from './StripePaymentsDepositsTab';
import { StripePaymentsDirectTab } from './StripePaymentsDirectTab';
import { StripePaymentsLogsTab } from './StripePaymentsLogsTab';
import { StripeMailOrderView } from './StripeMailOrderView';
import { StripeNewPaymentModal } from './StripeNewPaymentModal';
import { useStripeFinFeedback } from './StripeFinFeedback';
import { stripeFinancialGetConfig } from '../../services/stripeFinancialApi';
import { logPaymentUiAction } from '../../utilities/logPaymentUiAction';

const TABS = [
  { id: 'deposits', label: 'Deposits' },
  { id: 'direct', label: 'Direct payment' },
  { id: 'logs', label: 'Logs' },
  { id: 'mailorder', label: 'Mail order' },
];

export function StripePaymentsHub({
  franchiseId,
  showFinancialTotals = true,
  fleetCars = [],
  canPerformOperations = true,
  initialTab = 'deposits',
}) {
  const [tab, setTab] = useState(initialTab);
  const [showNewPayment, setShowNewPayment] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [stripeMode, setStripeMode] = useState('unset');
  const { showFeedback, showSuccess, toast } = useStripeFinFeedback();

  React.useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  React.useEffect(() => {
    stripeFinancialGetConfig({ franchiseId })
      .then((cfg) => setStripeMode(cfg?.mode || 'unset'))
      .catch(() => setStripeMode('unset'));
  }, [franchiseId]);

  const bumpRefresh = () => setRefreshToken((n) => n + 1);

  return (
    <div className="pal-fin-root pal-analytics-page pal-fin-stripe-page">
      <header className="pal-fin-command">
        <div>
          <p className="pal-fin-eyebrow">Finance · Stripe · Switzerland</p>
          <h1 className="pal-fin-title">Payments</h1>
          <p className="pal-fin-subtitle">
            Deposits, direct charges, activity logs and mail order — one workspace for CH terminal payments.
          </p>
          {stripeMode === 'live' && <span className="pal-fin-mode-live mt-2">Live mode</span>}
          {stripeMode === 'test' && <span className="pal-fin-mode-test mt-2">Test mode</span>}
        </div>
        <div className="pal-fin-command-actions pal-fin-command-actions-symmetric">
          <button type="button" className="gm-btn gm-btn-secondary gm-btn-sm pal-fin-action-btn" onClick={bumpRefresh}>
            <RefreshCw size={15} />
            Refresh
          </button>
          {canPerformOperations && (
            <button
              type="button"
              className="gm-btn gm-btn-primary gm-btn-sm pal-fin-action-btn"
              onClick={() => {
                logPaymentUiAction(franchiseId, 'new_payment_open');
                setShowNewPayment(true);
              }}
            >
              <Plus size={15} />
              New payment
            </button>
          )}
        </div>
      </header>

      <nav className="pal-stripe-subnav" role="tablist" aria-label="Payments sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`pal-stripe-subnav-btn ${tab === t.id ? 'pal-stripe-subnav-btn-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'deposits' && (
        <StripePaymentsDepositsTab
          franchiseId={franchiseId}
          showFinancialTotals={showFinancialTotals}
          canPerformOperations={canPerformOperations}
          refreshToken={refreshToken}
        />
      )}
      {tab === 'direct' && (
        <StripePaymentsDirectTab
          franchiseId={franchiseId}
          canPerformOperations={canPerformOperations}
          refreshToken={refreshToken}
        />
      )}
      {tab === 'logs' && <StripePaymentsLogsTab franchiseId={franchiseId} />}
      {tab === 'mailorder' && (
        <StripeMailOrderView
          franchiseId={franchiseId}
          showFinancialTotals={showFinancialTotals}
          canPerformOperations={canPerformOperations}
          embedded
        />
      )}

      {showNewPayment && (
        <StripeNewPaymentModal
          franchiseId={franchiseId}
          fleetCars={fleetCars}
          onClose={() => setShowNewPayment(false)}
          onFeedback={showFeedback}
          onSuccess={() => {
            showSuccess('Payment recorded', 'Stripe synced — check Deposits or Logs.');
            setShowNewPayment(false);
            bumpRefresh();
          }}
        />
      )}

      {toast}
    </div>
  );
}
