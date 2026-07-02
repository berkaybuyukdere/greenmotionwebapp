import React from 'react';
import { ExternalLink } from 'lucide-react';
import { PalantirWorkbench, PalantirCommandBar } from '../palantir/PalantirWorkbench';
import { StripeStatusBadge } from '../StripeListUI';

function formatStripeMoney(amount, currency) {
  if (amount == null) return '—';
  const major = Number(amount) / 100;
  const cur = String(currency || 'chf').toUpperCase();
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(major);
  } catch {
    return `${major.toFixed(2)} ${cur}`;
  }
}

function formatUnix(ts) {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
}

function formatBool(v) {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return '—';
}

function DetailRow({ label, value, mono = false, href }) {
  const content = href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="pal-fin-drawer-link">
      {value}
      <ExternalLink size={12} />
    </a>
  ) : (
    <span className={mono ? 'pal-fin-mono pal-fin-drawer-mono' : undefined}>{value ?? '—'}</span>
  );
  return (
    <div className="pal-fin-drawer-row">
      <dt className="pal-fin-drawer-label">{label}</dt>
      <dd className="pal-fin-drawer-value">{content}</dd>
    </div>
  );
}

function DetailSection({ title, children }) {
  return (
    <section className="pal-fin-drawer-section">
      <h3 className="pal-fin-drawer-section-title">{title}</h3>
      <dl className="pal-fin-drawer-dl">{children}</dl>
    </section>
  );
}

const STATUS_VARIANT = {
  warning_needs_response: 'warning',
  needs_response: 'warning',
  under_review: 'info',
  warning_under_review: 'info',
  won: 'success',
  lost: 'danger',
  charge_refunded: 'neutral',
};

function disputeStatusVariant(status) {
  return STATUS_VARIANT[status] || 'neutral';
}

export function StripeChargebackDetailDrawer({ open, dispute, loading, onClose }) {
  if (!open || !dispute) return null;

  const charge = dispute.chargeDetails;
  const evidence = dispute.evidenceDetails || {};

  return (
    <PalantirWorkbench onClose={onClose} size="fit">
      <PalantirCommandBar
        eyebrow="Chargeback"
        title={dispute.id}
        subtitle={dispute.reason ? String(dispute.reason).replace(/_/g, ' ') : 'Dispute detail'}
        onClose={onClose}
      />
      <div className="pal-fin-drawer-body">
        {loading ? (
          <p className="pal-fin-drawer-loading">Loading dispute from Stripe…</p>
        ) : (
          <>
            <div className="pal-fin-drawer-hero">
              <StripeStatusBadge
                variant={disputeStatusVariant(dispute.status)}
                label={String(dispute.status || '').replace(/_/g, ' ')}
              />
              <span className="pal-fin-drawer-hero-amount">
                {formatStripeMoney(dispute.amount, dispute.currency)}
              </span>
            </div>

            <DetailSection title="Dispute">
              <DetailRow label="Dispute ID" value={dispute.id} mono />
              <DetailRow label="Status" value={String(dispute.status || '').replace(/_/g, ' ')} />
              <DetailRow label="Reason" value={dispute.reason ? String(dispute.reason).replace(/_/g, ' ') : '—'} />
              <DetailRow label="Network reason code" value={dispute.networkReasonCode} mono />
              <DetailRow label="Amount" value={formatStripeMoney(dispute.amount, dispute.currency)} />
              <DetailRow label="Opened" value={formatUnix(dispute.created)} />
              <DetailRow label="Live mode" value={formatBool(dispute.livemode)} />
              <DetailRow label="Charge refundable" value={formatBool(dispute.isChargeRefundable)} />
            </DetailSection>

            <DetailSection title="Evidence">
              <DetailRow label="Evidence due" value={formatUnix(dispute.evidenceDueBy || evidence.due_by)} />
              <DetailRow label="Has evidence" value={formatBool(dispute.hasEvidence ?? evidence.has_evidence)} />
              <DetailRow label="Past due" value={formatBool(dispute.pastDue ?? evidence.past_due)} />
              <DetailRow label="Submission count" value={String(dispute.submissionCount ?? evidence.submission_count ?? '—')} />
            </DetailSection>

            <DetailSection title="Linked payment">
              <DetailRow label="Charge ID" value={dispute.charge} mono />
              <DetailRow label="Payment intent" value={dispute.paymentIntent} mono />
            </DetailSection>

            {charge && (
              <DetailSection title="Charge details">
                <DetailRow label="Charge status" value={charge.status} />
                <DetailRow label="Captured" value={formatBool(charge.captured)} />
                <DetailRow label="Disputed" value={formatBool(charge.disputed)} />
                <DetailRow label="Amount" value={formatStripeMoney(charge.amount, charge.currency)} />
                <DetailRow label="Captured amount" value={formatStripeMoney(charge.amountCaptured, charge.currency)} />
                <DetailRow label="Refunded amount" value={formatStripeMoney(charge.amountRefunded, charge.currency)} />
                <DetailRow label="Description" value={charge.description || '—'} />
                <DetailRow label="Customer name" value={charge.billingName} />
                <DetailRow label="Customer email" value={charge.billingEmail} />
                <DetailRow
                  label="Card"
                  value={
                    charge.cardBrand || charge.cardLast4
                      ? `${String(charge.cardBrand || '').toUpperCase()} •••• ${charge.cardLast4 || '????'}`
                      : '—'
                  }
                />
                <DetailRow label="Card country" value={charge.cardCountry} />
                <DetailRow label="Charge created" value={formatUnix(charge.created)} />
                {charge.receiptUrl && (
                  <DetailRow label="Receipt" value="Open receipt" href={charge.receiptUrl} />
                )}
              </DetailSection>
            )}

            {Array.isArray(dispute.balanceTransactions) && dispute.balanceTransactions.length > 0 && (
              <DetailSection title="Balance transactions">
                {dispute.balanceTransactions.map((bt) => (
                  <DetailRow
                    key={bt.id || bt}
                    label={typeof bt === 'object' ? bt.id : String(bt)}
                    value={
                      typeof bt === 'object'
                        ? formatStripeMoney(bt.amount, bt.currency)
                        : String(bt)
                    }
                    mono
                  />
                ))}
              </DetailSection>
            )}

            {dispute.metadata && Object.keys(dispute.metadata).length > 0 && (
              <DetailSection title="Metadata">
                {Object.entries(dispute.metadata).map(([k, v]) => (
                  <DetailRow key={k} label={k} value={String(v)} mono />
                ))}
              </DetailSection>
            )}
          </>
        )}
      </div>
    </PalantirWorkbench>
  );
}
