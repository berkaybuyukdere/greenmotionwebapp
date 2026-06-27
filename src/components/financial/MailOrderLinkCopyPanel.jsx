import React, { useMemo, useState } from 'react';
import { Copy, Code2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  buildFuseMetrixPaymentButtonHtml,
  buildMailOrderPaymentButtonHtml,
  buildPaymentButtonPlainLabel,
} from '../../utilities/mailOrderPaymentButtonHtml';

async function copyToClipboard({ html, plain }) {
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    const item = new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([plain], { type: 'text/plain' }),
    });
    await navigator.clipboard.write([item]);
    return;
  }
  await navigator.clipboard.writeText(html);
}

export function MailOrderLinkCopyPanel({ url, productName, amountLabel }) {
  const [copiedMode, setCopiedMode] = useState(null);
  const [showSource, setShowSource] = useState(false);
  const [error, setError] = useState('');

  const buttonLabel = productName ? `Pay — ${productName}` : 'Pay securely online';
  const fuseMetrixHtml = useMemo(
    () =>
      buildFuseMetrixPaymentButtonHtml({
        url,
        label: buttonLabel,
        amountLabel,
      }),
    [url, buttonLabel, amountLabel]
  );
  const fullHtml = useMemo(
    () =>
      buildMailOrderPaymentButtonHtml({
        url,
        label: buttonLabel,
        amountLabel,
      }),
    [url, buttonLabel, amountLabel]
  );
  const plainLabel = useMemo(
    () => buildPaymentButtonPlainLabel({ label: buttonLabel, amountLabel }),
    [buttonLabel, amountLabel]
  );

  const flashCopied = (mode) => {
    setCopiedMode(mode);
    setError('');
    setTimeout(() => setCopiedMode(null), 2500);
  };

  const copyHtml = async (html, mode, plain = plainLabel) => {
    try {
      await copyToClipboard({ html, plain });
      flashCopied(mode);
    } catch {
      try {
        await navigator.clipboard.writeText(html);
        flashCopied(mode);
      } catch {
        setError('Copy failed — use the HTML box below and copy manually (Cmd+C).');
      }
    }
  };

  if (!url) return null;

  return (
    <div className="pal-fin-link-box">
      <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--erpx-ink-muted)] mb-2">
        Email payment button
      </p>

      <div className="pal-fin-fusemetrix-guide">
        <p className="pal-fin-fusemetrix-guide-title">FuseMetrix / FMX Send e-mail</p>
        <ol className="pal-fin-fusemetrix-steps">
          <li>
            In the editor toolbar, click <strong>Source</strong> (top-left, next to formatting).
          </li>
          <li>
            Place the cursor where the button should appear (e.g. after your message).
          </li>
          <li>
            Click <strong>Copy for FuseMetrix</strong> below, then paste with <strong>Cmd+V</strong>.
          </li>
          <li>
            Click <strong>Source</strong> again — the green Pay button should appear.
          </li>
        </ol>
        <p className="pal-fin-fusemetrix-hint">
          Türkçe: Araç çubuğunda <strong>Source</strong> → imleci yerleştir → FuseMetrix HTML kopyala → yapıştır →
          tekrar <strong>Source</strong>.
        </p>
      </div>

      <div className="pal-fin-pay-button-preview">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="pal-fin-pay-button-anchor"
        >
          {buttonLabel}
          {amountLabel ? ` — ${amountLabel}` : ''}
        </a>
      </div>

      {error && <p className="pal-fin-copy-error">{error}</p>}

      <div className="pal-fin-link-actions">
        <button
          type="button"
          className="gm-btn gm-btn-primary gm-btn-sm"
          onClick={() => copyHtml(fuseMetrixHtml, 'fusemetrix')}
        >
          <Code2 size={14} />
          {copiedMode === 'fusemetrix' ? 'Copied for FuseMetrix' : 'Copy for FuseMetrix'}
        </button>
        <button
          type="button"
          className="gm-btn gm-btn-secondary gm-btn-sm"
          onClick={() => copyHtml(fullHtml, 'html')}
        >
          <Code2 size={14} />
          {copiedMode === 'html' ? 'HTML copied' : 'Copy full HTML'}
        </button>
        <button
          type="button"
          className="gm-btn gm-btn-secondary gm-btn-sm"
          onClick={() => copyHtml(`<a href="${url}">${plainLabel}</a>`, 'visual', url)}
        >
          <Copy size={14} />
          {copiedMode === 'visual' ? 'Copied' : 'Paste in visual mode'}
        </button>
        <button
          type="button"
          className="gm-btn gm-btn-ghost gm-btn-sm"
          onClick={() => copyHtml(url, 'link', url)}
        >
          <Copy size={14} />
          {copiedMode === 'link' ? 'Link copied' : 'Link only'}
        </button>
      </div>

      <button
        type="button"
        className="pal-fin-source-toggle"
        onClick={() => setShowSource((v) => !v)}
      >
        {showSource ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showSource ? 'Hide HTML code' : 'Show HTML code (manual copy)'}
      </button>

      {showSource && (
        <textarea
          className="pal-fin-html-source"
          readOnly
          value={fuseMetrixHtml}
          onFocus={(e) => e.target.select()}
        />
      )}
    </div>
  );
}
