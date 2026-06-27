/**
 * One-time / idempotent migration: ensure legacy users have explicit scope metadata.
 * - Sets scopeLevel to "single" when missing.
 * - Sets franchiseMemberships to { [franchiseId]: true } when missing and franchiseId exists.
 *
 * Usage (run from `green-motion-web/functions` so `firebase-admin` resolves; set GOOGLE_APPLICATION_CREDENTIALS):
 *   cd green-motion-web/functions && node ../scripts/migrate-user-franchise-memberships.mjs
 *
 * Dry run (no writes):
 *   DRY_RUN=1 node green-motion-web/scripts/migrate-user-franchise-memberships.mjs
 */
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

function initAdmin() {
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) {
    const raw = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(raw) });
  } else {
    initializeApp({ credential: applicationDefault() });
  }
}

initAdmin();
const db = getFirestore();

async function main() {
  const snap = await db.collection('users').get();
  let updated = 0;
  let skipped = 0;

  for (const docSnap of snap.docs) {
    const d = docSnap.data() || {};
    const fid = String(d.franchiseId || '').trim().toUpperCase();
    const hasScope = d.scopeLevel != null && String(d.scopeLevel).trim() !== '';
    const hasMem =
      d.franchiseMemberships != null &&
      typeof d.franchiseMemberships === 'object' &&
      Object.keys(d.franchiseMemberships).length > 0;

    if (hasScope && hasMem) {
      skipped += 1;
      continue;
    }

    const patch = {};
    if (!hasScope) {
      patch.scopeLevel = d.scopeLevel || 'single';
    }
    if (!hasMem && fid) {
      patch.franchiseMemberships = { [fid]: true };
    }
    if (Object.keys(patch).length === 0) {
      skipped += 1;
      continue;
    }

    patch.migratedFranchiseMembershipsAt = FieldValue.serverTimestamp();

    if (DRY) {
      console.log('[dry-run] would update', docSnap.id, patch);
    } else {
      await docSnap.ref.set(patch, { merge: true });
    }
    updated += 1;
  }

  console.log(DRY ? 'Dry run complete.' : 'Migration complete.', { updated, skipped, total: snap.size });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
