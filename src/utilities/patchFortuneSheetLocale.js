import { EXCEL_FONT_ARRAY, buildFontJson } from './fortuneSheetFonts';

let patched = false;

/**
 * Extends Fortune Sheet font list via webpack module cache (CRA dev/prod).
 * Never throws — safe to call before Workbook mounts.
 */
export function patchFortuneSheetLocale(fontList = EXCEL_FONT_ARRAY) {
    if (patched) return true;
    try {
        if (typeof __webpack_require__ === 'undefined') return false;

        const cache = __webpack_require__.c;
        if (!cache || typeof cache !== 'object') return false;

        const fontjson = buildFontJson(fontList);

        for (const id of Object.keys(cache)) {
            const exp = cache[id]?.exports;
            if (!exp || typeof exp.locale !== 'function' || exp.__erpxLocalePatch) continue;

            const originalLocale = exp.locale;
            exp.locale = (ctx) => {
                const loc = originalLocale(ctx);
                if (loc && loc.fontarray !== fontList) {
                    loc.fontarray = fontList;
                    loc.fontjson = { ...(loc.fontjson || {}), ...fontjson };
                }
                return loc;
            };
            exp.__erpxLocalePatch = true;
            patched = true;
            return true;
        }
    } catch (err) {
        console.warn('[Excel] font locale patch skipped:', err?.message);
    }
    return false;
}
