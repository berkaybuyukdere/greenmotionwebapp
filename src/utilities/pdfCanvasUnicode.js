/**
 * Renders Unicode text (Turkish, etc.) to a PNG for embedding in jsPDF.
 * jsPDF's built-in Helvetica only supports WinAnsi — Turkish glyphs break without this.
 */

const PX_PER_MM = 96 / 25.4;
const DEFAULT_BLOCK_WIDTH_MM = 180;

function wrapLines(ctx, text, maxWidthPx) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        if (ctx.measureText(test).width <= maxWidthPx) {
            line = test;
        } else {
            if (line) lines.push(line);
            if (ctx.measureText(w).width > maxWidthPx) {
                let chunk = '';
                for (const ch of w) {
                    const t2 = chunk + ch;
                    if (ctx.measureText(t2).width <= maxWidthPx) chunk = t2;
                    else {
                        if (chunk) lines.push(chunk);
                        chunk = ch;
                    }
                }
                line = chunk;
            } else {
                line = w;
            }
        }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
}

/**
 * @returns {{ dataUrl: string, widthMm: number, heightMm: number }}
 */
export function renderParagraphsToImage(paragraphs, options = {}) {
    const {
        maxWidthMm = DEFAULT_BLOCK_WIDTH_MM,
        fontSizePx = 11,
        lineHeightPx = 15,
        paragraphGapPx = 8,
        font = '500 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        color = '#3c3c3c',
    } = options;

    const maxWidthPx = maxWidthMm * PX_PER_MM;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = font;

    let allLines = [];
    const paras = Array.isArray(paragraphs) ? paragraphs : [paragraphs];
    for (let i = 0; i < paras.length; i++) {
        const p = paras[i];
        if (i > 0) allLines.push({ gap: true });
        const wrapped = wrapLines(ctx, p, maxWidthPx);
        wrapped.forEach((ln) => allLines.push({ text: ln }));
    }

    const gapCount = allLines.filter((x) => x.gap).length;
    const textLines = allLines.filter((x) => x.text).length;
    const heightPx = textLines * lineHeightPx + gapCount * paragraphGapPx + 12;
    const widthPx = Math.ceil(maxWidthPx);

    canvas.width = widthPx;
    canvas.height = Math.ceil(heightPx);
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, canvas.width, canvas.height);
    c2.fillStyle = color;
    c2.font = font;
    c2.textBaseline = 'top';
    let y = 0;
    for (const item of allLines) {
        if (item.gap) {
            y += paragraphGapPx;
            continue;
        }
        c2.fillText(item.text, 0, y);
        y += lineHeightPx;
    }

    const dataUrl = canvas.toDataURL('image/png', 1.0);
    return {
        dataUrl,
        widthMm: maxWidthMm,
        heightMm: canvas.height / PX_PER_MM,
    };
}

/** Single-line title + optional subtitle (for PDF header, Turkish). */
export function renderTitleBlockImage(title, subtitle, options = {}) {
    const { titleSize = 22, subSize = 10, maxWidthMm = 120 } = options;
    const maxWidthPx = maxWidthMm * PX_PER_MM;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${titleSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const w1 = ctx.measureText(title).width;
    let w2 = 0;
    if (subtitle) {
        ctx.font = `400 ${subSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        w2 = ctx.measureText(subtitle).width;
    }
    const widthPx = Math.ceil(Math.min(Math.max(w1, w2) + 8, maxWidthPx));
    const heightPx = subtitle ? titleSize + subSize + 18 : titleSize + 14;
    canvas.width = widthPx;
    canvas.height = heightPx;
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, canvas.width, canvas.height);
    c2.fillStyle = '#141414';
    c2.font = `700 ${titleSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    c2.textBaseline = 'top';
    c2.fillText(title, 0, 0);
    if (subtitle) {
        c2.fillStyle = '#787878';
        c2.font = `400 ${subSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        c2.fillText(subtitle, 0, titleSize + 4);
    }
    return {
        dataUrl: canvas.toDataURL('image/png', 1.0),
        widthMm: canvas.width / PX_PER_MM,
        heightMm: canvas.height / PX_PER_MM,
    };
}

/**
 * One info row: bold label (left) + value (wrapped), matching iOS-style rows.
 */
export function renderInfoRowImage(label, value, options = {}) {
    const {
        maxWidthMm = 120,
        labelWidthMm = 52,
        fontPx = 10,
        labelFontPx = 9,
    } = options;
    const maxWidthPx = maxWidthMm * PX_PER_MM;
    const labelWidthPx = labelWidthMm * PX_PER_MM;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `600 ${labelFontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const valueFont = `400 ${fontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;

    ctx.font = `600 ${labelFontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const labelLines = wrapLines(ctx, String(label), labelWidthPx);
    ctx.font = valueFont;
    const valueMax = maxWidthPx - labelWidthPx - 6;
    const vLines = wrapLines(ctx, String(value ?? ''), valueMax);
    const lineH = 13;
    const rowLines = Math.max(labelLines.length, vLines.length, 1);
    const heightPx = rowLines * lineH + 4;

    canvas.width = Math.ceil(maxWidthPx);
    canvas.height = Math.ceil(heightPx);
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, canvas.width, canvas.height);
    c2.fillStyle = '#505050';
    c2.font = `600 ${labelFontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    c2.textBaseline = 'top';
    labelLines.forEach((ln, i) => {
        c2.fillText(ln, 0, i * lineH);
    });
    c2.fillStyle = '#282828';
    c2.font = valueFont;
    vLines.forEach((ln, i) => {
        c2.fillText(ln, labelWidthPx, i * lineH);
    });

    return {
        dataUrl: canvas.toDataURL('image/png', 1.0),
        widthMm: maxWidthMm,
        heightMm: canvas.height / PX_PER_MM,
    };
}

/** Small label for map column (Turkish / EN with special chars). */
export function renderSmallLabelImage(text, options = {}) {
    const { fontPx = 8, maxWidthMm = 55 } = options;
    const maxWidthPx = maxWidthMm * PX_PER_MM;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = `700 ${fontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    const lines = wrapLines(ctx, text, maxWidthPx);
    const lineH = 11;
    const heightPx = lines.length * lineH + 4;
    canvas.width = Math.ceil(maxWidthPx);
    canvas.height = Math.ceil(heightPx);
    const c2 = canvas.getContext('2d');
    c2.fillStyle = '#ffffff';
    c2.fillRect(0, 0, canvas.width, canvas.height);
    c2.fillStyle = '#3c3c3c';
    c2.font = `700 ${fontPx}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    c2.textBaseline = 'top';
    lines.forEach((ln, i) => c2.fillText(ln, 0, i * lineH));
    return {
        dataUrl: canvas.toDataURL('image/png', 1.0),
        widthMm: maxWidthMm,
        heightMm: canvas.height / PX_PER_MM,
    };
}
