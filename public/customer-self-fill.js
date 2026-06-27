/**
 * Shared logic for public customer QR forms (return + checkout).
 * Collection: franchises/{franchiseId}/{returnFormData|checkoutFormData}/{token}
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDIdbUXKcAHeUKv8ffOUhC23BRZnqG6LU0',
  authDomain: 'greenmotionapp-33413.firebaseapp.com',
  projectId: 'greenmotionapp-33413',
  storageBucket: 'greenmotionapp-33413.firebasestorage.app',
  messagingSenderId: '831733588823',
  appId: '1:831733588823:ios:d73e18c83ad1a386b49412',
};

const FRANCHISE_RE = /^[A-Z0-9_-]{1,64}$/;

export function parseFormParams(hashRoute) {
  const search = new URLSearchParams(window.location.search || '');
  let token = search.get('token');
  let franchise = search.get('franchise') || search.get('franchiseId');
  const hash = window.location.hash || '';
  const qi = hash.indexOf('?');
  if (qi >= 0) {
    const hp = new URLSearchParams(hash.slice(qi + 1));
    if (!token) token = hp.get('token');
    if (!franchise) franchise = hp.get('franchise') || hp.get('franchiseId');
  }
  if (!token && hashRoute) {
    const hashPath = hash.replace(/^#/, '').split('?')[0].replace(/^\//, '');
    if (hashPath === hashRoute) {
      const hp = new URLSearchParams(hash.split('?')[1] || '');
      token = hp.get('token');
      franchise = hp.get('franchise') || hp.get('franchiseId');
    }
  }
  const fr = franchise && String(franchise).trim().toUpperCase();
  return {
    token: token && String(token).trim(),
    franchiseId: fr && FRANCHISE_RE.test(fr) ? fr : null,
  };
}

export function portalBranding(franchiseId, formKind) {
  const fr = String(franchiseId || '').toUpperCase();
  const action = formKind === 'checkout' ? 'Check-out' : 'Return';
  if (fr.startsWith('DE')) {
    return { office: 'Germany · Green Motion', action: `Vehicle ${action}` };
  }
  if (fr.startsWith('TR')) {
    return { office: 'Türkiye · Green Motion', action: `Vehicle ${action}` };
  }
  if (fr.startsWith('CH') || fr.startsWith('GB') || fr.startsWith('UK')) {
    return { office: 'Green Motion', action: `Vehicle ${action}` };
  }
  return { office: 'Green Motion', action: `Vehicle ${action}` };
}

function isSubmittedData(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.submittedAt) return true;
  const sig = data.signatureBase64;
  return typeof sig === 'string' && sig.length > 40;
}

export function initCustomerSelfFillForm({
  formKind,
  hashRoute,
  els,
}) {
  const app = initializeApp(FIREBASE_CONFIG);
  const db = getFirestore(app);

  const { token, franchiseId } = parseFormParams(hashRoute);
  const collectionName = formKind === 'checkout' ? 'checkoutFormData' : 'returnFormData';
  const storageKey =
    token && franchiseId ? `${formKind}Submitted_${franchiseId}_${token}` : null;

  let isLocked = false;
  let hasSignature = false;

  const brand = portalBranding(franchiseId, formKind);
  if (els.kicker) els.kicker.textContent = brand.office;
  if (els.title) els.title.textContent = brand.action;
  if (els.subtitle) {
    els.subtitle.textContent =
      formKind === 'checkout'
        ? 'Enter your details to confirm vehicle collection.'
        : 'Enter your details to confirm vehicle return.';
  }

  function docRef() {
    return doc(db, 'franchises', franchiseId, collectionName, token);
  }

  function showPanel(id) {
    ['loading', 'form', 'invalid', 'success'].forEach((k) => {
      const node = els.panels[k];
      if (node) node.classList.toggle('csf-hidden', k !== id);
    });
  }

  function lockSubmitted() {
    isLocked = true;
    if (storageKey) {
      try {
        localStorage.setItem(storageKey, '1');
      } catch (_) {
        /* ignore */
      }
    }
    showPanel('success');
    if (els.submitBtn) {
      els.submitBtn.disabled = true;
      els.submitBtn.textContent = 'Submitted';
    }
  }

  function setFieldError(id, visible) {
    const input = els.inputs[id];
    const err = els.errors[id];
    if (input) input.classList.toggle('error', visible);
    if (err) err.classList.toggle('visible', visible);
  }

  // ── Signature pad (fixed resolution — no resize data loss) ──
  const canvas = els.sigCanvas;
  const ctx = canvas.getContext('2d');
  const CSS_W = 640;
  const CSS_H = 160;
  canvas.width = CSS_W;
  canvas.height = CSS_H;
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function fillCanvasWhite() {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CSS_W, CSS_H);
    ctx.fillStyle = '#0f172a';
  }

  fillCanvasWhite();

  let drawing = false;
  let lastX = 0;
  let lastY = 0;

  function getPos(e) {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches && e.touches.length ? e.touches[0] : e;
    const scaleX = CSS_W / rect.width;
    const scaleY = CSS_H / rect.height;
    return {
      x: (src.clientX - rect.left) * scaleX,
      y: (src.clientY - rect.top) * scaleY,
    };
  }

  function startDraw(e) {
    e.preventDefault();
    drawing = true;
    const p = getPos(e);
    lastX = p.x;
    lastY = p.y;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function moveDraw(e) {
    e.preventDefault();
    if (!drawing) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastX, lastY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastX = p.x;
    lastY = p.y;
    hasSignature = true;
  }

  function endDraw() {
    drawing = false;
  }

  canvas.addEventListener('mousedown', startDraw);
  canvas.addEventListener('mousemove', moveDraw);
  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw, { passive: false });
  canvas.addEventListener('touchmove', moveDraw, { passive: false });
  canvas.addEventListener('touchend', endDraw);

  if (els.sigClear) {
    els.sigClear.addEventListener('click', () => {
      fillCanvasWhite();
      hasSignature = false;
    });
  }

  function signatureBase64() {
    try {
      const png = canvas.toDataURL('image/png');
      if (png && png.includes(',')) return png.split(',')[1];
    } catch (_) {
      /* fallback */
    }
    const off = document.createElement('canvas');
    off.width = CSS_W;
    off.height = CSS_H;
    const offCtx = off.getContext('2d');
    offCtx.fillStyle = '#ffffff';
    offCtx.fillRect(0, 0, CSS_W, CSS_H);
    offCtx.drawImage(canvas, 0, 0);
    const jpeg = off.toDataURL('image/jpeg', 0.82);
    return jpeg.split(',')[1];
  }

  async function checkAlreadySubmitted() {
    try {
      const snap = await getDoc(docRef());
      if (snap.exists() && isSubmittedData(snap.data())) {
        lockSubmitted();
        return true;
      }
    } catch (err) {
      console.warn('[customer-self-fill] pre-check', err);
    }
    return false;
  }

  async function submit() {
    if (isLocked || !token || !franchiseId) return;

    if (await checkAlreadySubmitted()) return;

    const firstName = (els.inputs.firstName?.value || '').trim();
    const lastName = (els.inputs.lastName?.value || '').trim();
    const email = (els.inputs.email?.value || '').trim().toLowerCase();
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let valid = true;
    setFieldError('firstName', !firstName);
    if (!firstName) valid = false;
    setFieldError('lastName', !lastName);
    if (!lastName) valid = false;
    setFieldError('email', !emailRe.test(email));
    if (!emailRe.test(email)) valid = false;
    setFieldError('signature', !hasSignature);
    if (!hasSignature) valid = false;
    if (!valid) return;

    const sig = signatureBase64();
    if (!sig || sig.length < 40) {
      setFieldError('signature', true);
      return;
    }

    const btn = els.submitBtn;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="csf-spinner"></span>Submitting…';
    }

    const payload = {
      token,
      franchiseId,
      firstName,
      lastName,
      email,
      signatureBase64: sig,
      submittedAt: new Date().toISOString(),
    };

    try {
      const ref = docRef();
      const existing = await getDoc(ref);
      if (existing.exists() && isSubmittedData(existing.data())) {
        lockSubmitted();
        return;
      }
      if (!existing.exists()) {
        await setDoc(ref, payload);
      } else {
        await updateDoc(ref, payload);
      }
      lockSubmitted();
    } catch (err) {
      console.error('[customer-self-fill] submit', err);
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Submit details';
      }
      const code = String(err?.code || '');
      const msg = String(err?.message || err || 'Unknown error');
      if (code.includes('permission-denied')) {
        if (await checkAlreadySubmitted()) return;
        alert(
          'Could not save your form (permission denied). Please ask staff to refresh the QR code and try again.'
        );
      } else {
        alert(`Submission failed: ${msg}\nPlease try again or ask staff for a new QR code.`);
      }
    }
  }

  // Boot
  if (!token || token.length < 10 || !franchiseId) {
    showPanel('invalid');
    return;
  }

  if (storageKey) {
    try {
      if (localStorage.getItem(storageKey) === '1') {
        lockSubmitted();
        return;
      }
    } catch (_) {
      /* ignore */
    }
  }

  showPanel('loading');
  checkAlreadySubmitted().then((done) => {
    if (!done) showPanel('form');
  });

  if (els.form) {
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit();
    });
  }
}
