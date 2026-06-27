/**
 * Normalize WheelSys session cookie (matches iOS WheelSysCookieCache.authOnly).
 * @param {string} raw
 * @returns {{ ok: boolean, cookie: string, message?: string }}
 */
export function normalizeWheelsysSessionCookie(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return { ok: false, cookie: '', message: 'Cookie is empty.' };
  }

  let wheelsys = '';
  let sid = '';
  for (const part of trimmed.split(';')) {
    const piece = part.trim();
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const name = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (name === '.wheelsys') wheelsys = value;
    if (name === '__Secure-SID') sid = value;
  }

  if (!wheelsys || !sid) {
    return {
      ok: false,
      cookie: '',
      message: 'Cookie must include both .wheelsys=… and __Secure-SID=… (copy from WheelSys after login).',
    };
  }

  return {
    ok: true,
    cookie: `.wheelsys=${wheelsys}; __Secure-SID=${sid}`,
  };
}

export const WHEELSYS_LOGIN_URL = 'https://ch.wheelsys.greenmotion.com/ui/';
