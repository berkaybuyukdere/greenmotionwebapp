import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

function formatWhen(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Palantir Foundry–style collapsible activity rail (no raw JSON).
 */
export function FoundryActivityLog({
  title = 'Activity log',
  entries = [],
  formatEntry = (e) => e?.label || e?.action || 'Event',
  formatDetail = (e) => e?.detail || e?.subtitle || '',
  emptyMessage = 'No activity yet.',
  defaultOpen = true,
  maxVisible = 12,
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [expandedId, setExpandedId] = useState(null);
  const visible = entries.slice(0, maxVisible);

  return (
    <section className="fd-activity-log">
      <button
        type="button"
        className="fd-activity-log-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="fd-activity-log-title">{title}</span>
        <span className="fd-activity-log-count">{entries.length}</span>
      </button>
      {open && (
        <ol className="fd-activity-log-list">
          {visible.length === 0 ? (
            <li className="fd-activity-log-empty">{emptyMessage}</li>
          ) : (
            visible.map((entry) => {
              const id = entry.id || `${entry.action}-${entry.createdAt}`;
              const isExpanded = expandedId === id;
              const detail = formatDetail(entry);
              return (
                <li key={id} className="fd-activity-log-item">
                  <button
                    type="button"
                    className="fd-activity-log-row"
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                  >
                    <span className="fd-activity-log-dot" aria-hidden />
                    <span className="fd-activity-log-body">
                      <span className="fd-activity-log-primary">{formatEntry(entry)}</span>
                      <span className="fd-activity-log-when">{formatWhen(entry.createdAt)}</span>
                    </span>
                  </button>
                  {isExpanded && detail && (
                    <div className="fd-activity-log-detail">{detail}</div>
                  )}
                </li>
              );
            })
          )}
        </ol>
      )}
    </section>
  );
}
