/**
 * Restore TR_SABIHAGOKCEN users from BigQuery changelog + reopen franchise.
 * Recreates Firebase Auth (same uid/email) and Firestore users/{uid} profiles.
 * Passwords cannot be recovered — users must use "Forgot password" after restore.
 *
 * Also deletes deprecated franchises/TR_SABIHA document.
 *
 * Run: cd functions && node scripts/restore-tr-sabihagokcen-users.js
 */
const admin = require('firebase-admin');

const FRANCHISE_ID = 'TR_SABIHAGOKCEN';
const DEPRECATED_ID = 'TR_SABIHA';

const BQ_QUERY = `
WITH ranked AS (
  SELECT *,
    ROW_NUMBER() OVER (PARTITION BY document_id ORDER BY timestamp DESC) AS rn
  FROM \`greenmotionapp-33413.firestore_export.users_raw_changelog\`
  WHERE JSON_VALUE(data, '$.franchiseId') = '${FRANCHISE_ID}'
)
SELECT document_id, data
FROM ranked WHERE rn = 1
`;

if (!admin.apps.length) {
  admin.initializeApp();
}

function parseFirestoreJson(dataStr) {
  try {
    return JSON.parse(dataStr);
  } catch {
    return null;
  }
}

function reviveTimestamp(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (obj._seconds != null) {
    return admin.firestore.Timestamp.fromMillis(
      Number(obj._seconds) * 1000 + Math.floor((obj._nanoseconds || 0) / 1e6)
    );
  }
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = reviveTimestamp(v);
  }
  return out;
}

function buildUserDoc(raw, uid) {
  const doc = { ...raw };
  delete doc.uid;
  doc.franchiseId = FRANCHISE_ID;
  doc.defaultFranchiseId = doc.defaultFranchiseId || FRANCHISE_ID;
  doc.countryCode = doc.countryCode || 'TR';
  doc.currency = doc.currency || 'TRY';
  doc.isActive = doc.isActive !== false;
  doc.isDemo = !!doc.isDemo;
  doc.isDemoAccount = !!doc.isDemoAccount;
  if (doc.createdAt) doc.createdAt = reviveTimestamp(doc.createdAt);
  if (doc.updatedAt) doc.updatedAt = reviveTimestamp(doc.updatedAt);
  if (doc.demoExpiresAt) doc.demoExpiresAt = reviveTimestamp(doc.demoExpiresAt);
  if (doc.lastTokenUpdate) doc.lastTokenUpdate = reviveTimestamp(doc.lastTokenUpdate);
  if (doc.activeSessionAt) doc.activeSessionAt = reviveTimestamp(doc.activeSessionAt);
  doc.restoredAt = admin.firestore.FieldValue.serverTimestamp();
  doc.restoredFrom = 'bigquery-users_raw_changelog';
  doc.updatedAt = admin.firestore.FieldValue.serverTimestamp();
  return doc;
}

async function queryBigQueryUsers() {
  const fs = require('fs');
  const path = require('path');
  const { execSync } = require('child_process');
  const sqlPath = path.join(__dirname, '_restore-users-query.sql');
  fs.writeFileSync(sqlPath, BQ_QUERY.trim(), 'utf8');
  const out = execSync(
    `bq query --use_legacy_sql=false --project_id=greenmotionapp-33413 --format=json --quiet < "${sqlPath}"`,
    { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, shell: '/bin/bash' }
  );
  try {
    fs.unlinkSync(sqlPath);
  } catch {
    /* ignore */
  }
  const rows = JSON.parse(out);
  return rows
    .map((row) => {
      const raw = parseFirestoreJson(row.data);
      if (!raw?.email) return null;
      return { uid: row.document_id, raw };
    })
    .filter(Boolean);
}

async function restoreAuthUser(auth, uid, email, displayName) {
  try {
    await auth.getUser(uid);
    await auth.updateUser(uid, { email, emailVerified: true, disabled: false });
    return 'updated';
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    await auth.createUser({
      uid,
      email,
      emailVerified: true,
      disabled: false,
      displayName: displayName || undefined,
    });
    return 'created';
  }
}

async function deleteDeprecatedSabiha(db) {
  const ref = db.collection('franchises').doc(DEPRECATED_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    console.log(`[delete] ${DEPRECATED_ID} already absent`);
    return;
  }
  await ref.delete();
  console.log(`[delete] Removed franchises/${DEPRECATED_ID}`);
}

async function main() {
  const db = admin.firestore();
  const auth = admin.auth();

  let users;
  try {
    users = await queryBigQueryUsers();
  } catch (e) {
    console.error('BigQuery failed — install @google-cloud/bigquery in functions/ if needed:', e.message);
    process.exit(1);
  }

  console.log(`[restore] Found ${users.length} user profiles in BigQuery for ${FRANCHISE_ID}`);

  let authCreated = 0;
  let authUpdated = 0;
  let firestoreWritten = 0;

  for (const { uid, raw } of users) {
    const email = String(raw.email || '').trim().toLowerCase();
    const displayName = [raw.firstName, raw.lastName].filter(Boolean).join(' ').trim();
    const authResult = await restoreAuthUser(auth, uid, email, displayName);
    if (authResult === 'created') authCreated += 1;
    else authUpdated += 1;

    const profile = buildUserDoc(raw, uid);
    await db.collection('users').doc(uid).set(profile, { merge: false });
    firestoreWritten += 1;
    console.log(`[restore] ${uid} ${email} (${raw.role}) auth=${authResult}`);
  }

  await db.collection('franchises').doc(FRANCHISE_ID).set(
    {
      franchiseId: FRANCHISE_ID,
      isActive: true,
      status: 'active',
      currentUserCount: users.length,
      closedAt: admin.firestore.FieldValue.delete(),
      closedBy: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await deleteDeprecatedSabiha(db);

  console.log('\n[restore] Done.');
  console.log(`  Auth created: ${authCreated}, updated: ${authUpdated}`);
  console.log(`  Firestore users written: ${firestoreWritten}`);
  console.log('  Users must reset passwords via Forgot password (passwords are not in backup).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
