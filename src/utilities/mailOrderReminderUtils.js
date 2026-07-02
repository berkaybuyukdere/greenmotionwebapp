/** Reminder e-mail sending is disabled until explicitly enabled in backend + UI. */
export const MAIL_ORDER_REMINDER_SMTP_ENABLED = false;

export const MAIL_ORDER_LINK_VALID_DAYS = 30;

function parseDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMailOrderDate(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatMailOrderDateTime(value) {
  const d = parseDate(value);
  if (!d) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function reminderToneClass(tone) {
  if (tone === 'success') return 'pal-fin-status-paid';
  if (tone === 'danger') return 'pal-fin-status-unpaid';
  if (tone === 'info') return 'pal-fin-status-hold';
  if (tone === 'warning') return 'pal-fin-status-pending';
  return 'pal-fin-status-neutral';
}

export function getMailOrderReminderDisplay(reminder, slotLabel) {
  if (!reminder) {
    return { label: 'No link yet', tone: 'neutral', plannedAt: null, shouldSend: false, slotLabel };
  }
  return {
    ...reminder,
    slotLabel,
    sendHint: reminder.shouldSend
      ? MAIL_ORDER_REMINDER_SMTP_ENABLED
        ? 'Should send'
        : 'Should send (manual — SMTP off)'
      : 'Do not send yet',
  };
}
