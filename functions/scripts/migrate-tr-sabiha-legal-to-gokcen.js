/**
 * One-time: copy kiosk/legal PDF text fields from deprecated franchises/TR_SABIHA
 * into franchises/TR_SABIHAGOKCEN (merge — only fills empty target fields).
 *
 * Run from repo root:
 *   cd functions && node scripts/migrate-tr-sabiha-legal-to-gokcen.js
 *
 * Requires: firebase login OR GOOGLE_APPLICATION_CREDENTIALS
 */
const admin = require('firebase-admin');
const { resolveOperationalFranchiseId } = require('../franchiseIdResolve');

const SOURCE_ID = 'TR_SABIHA';
const TARGET_ID = 'TR_SABIHAGOKCEN';

const LEGAL_FIELDS = [
  'pdfLegalTextTr',
  'pdfLegalTextEn',
  'pdfLegalTextCheckoutTr',
  'pdfLegalTextCheckoutEn',
  'pdfLegalTextReturnTr',
  'pdfLegalTextReturnEn',
  'pdfLegalTextDamageTr',
  'pdfLegalTextDamageEn',
  'termsConditionsTr',
  'termsConditionsEn',
  'termsConditionsDe',
  'privacyPolicyTr',
  'privacyPolicyEn',
  'privacyPolicyDe',
];

if (!admin.apps.length) {
  admin.initializeApp();
}

function nonEmpty(v) {
  const s = String(v || '').trim();
  return s.length ? s : null;
}

async function main() {
  const db = admin.firestore();
  const sourceRef = db.collection('franchises').doc(SOURCE_ID);
  const targetRef = db.collection('franchises').doc(TARGET_ID);

  const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);

  if (!sourceSnap.exists) {
    console.log(`[migrate] Source ${SOURCE_ID} does not exist — nothing to copy.`);
    return;
  }
  if (!targetSnap.exists) {
    console.error(`[migrate] Target ${TARGET_ID} does not exist — create it first.`);
    process.exit(1);
  }

  const source = sourceSnap.data() || {};
  const target = targetSnap.data() || {};
  const updates = {};
  let copied = 0;

  for (const key of LEGAL_FIELDS) {
    const fromSource = nonEmpty(source[key]);
    if (!fromSource) continue;
    const existingTarget = nonEmpty(target[key]);
    if (!existingTarget) {
      updates[key] = fromSource;
      copied += 1;
      console.log(`[migrate] will set ${key} (${fromSource.length} chars)`);
    } else {
      console.log(`[migrate] skip ${key} — already set on ${TARGET_ID}`);
    }
  }

  if (!copied) {
    console.log('[migrate] No fields to merge.');
    return;
  }

  updates.migratedFromDeprecatedFranchise = SOURCE_ID;
  updates.migratedAt = admin.firestore.FieldValue.serverTimestamp();
  await targetRef.set(updates, { merge: true });
  console.log(`[migrate] Merged ${copied} field(s) into ${TARGET_ID}.`);

  await sourceRef.set(
    {
      deprecated: true,
      deprecatedReason: 'Use TR_SABIHAGOKCEN for kiosk/legal; data merged to canonical franchise.',
      deprecatedAt: admin.firestore.FieldValue.serverTimestamp(),
      canonicalFranchiseId: resolveOperationalFranchiseId(SOURCE_ID),
    },
    { merge: true }
  );
  console.log(`[migrate] Marked ${SOURCE_ID} as deprecated (document kept; delete manually in console if desired).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
