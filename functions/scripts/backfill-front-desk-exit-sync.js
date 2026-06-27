/**
 * One-off backfill: copy missing handover fields from `frontDeskCustomers` rows
 * into their linked `exitIslemleri` documents.
 *
 * Why this exists:
 *   Early front-desk submissions did not write `customerNationalId`,
 *   `trRentalTermsSignatureURL`, `trRentalTermsLanguage` or `trRentalTermsAcceptedAt`
 *   onto the corresponding checkout. Web Operations needs those fields so
 *   reception can re-print PDFs without asking the customer again.
 *
 * Run from `green-motion-web/functions`:
 *
 *   # All franchises, dry run (no writes)
 *   node scripts/backfill-front-desk-exit-sync.js --dry-run
 *
 *   # Single franchise, real run
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
 *     node scripts/backfill-front-desk-exit-sync.js --franchise=TR_NEVSEHIR
 *
 *   # All franchises, real run
 *   GOOGLE_APPLICATION_CREDENTIALS=/abs/path/sa.json \
 *     node scripts/backfill-front-desk-exit-sync.js
 *
 * Flags:
 *   --dry-run                 Only log the patches that would be written.
 *   --franchise=<FRANCHISE>   Restrict the scan to a single franchise id.
 *   --limit=<N>               Cap how many front-desk rows per franchise.
 *   --verbose                 Print one line per scanned doc.
 *
 * Credentials:
 *   The script uses Application Default Credentials. Either run
 *   `firebase login:ci` ahead of time or set GOOGLE_APPLICATION_CREDENTIALS.
 *
 * Idempotency:
 *   - Empty / missing fields are filled only.
 *   - Fields already populated on the exit document are left untouched.
 *   - Safe to run repeatedly.
 */

const admin = require('firebase-admin');

const HANDOVER_FIELDS = [
  'customerNationalId',
  'trRentalTermsSignatureURL',
  'trRentalTermsLanguage',
  'trRentalTermsAcceptedAt',
];

if (!admin.apps.length) {
  admin.initializeApp();
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    franchise: null,
    limit: 5000,
    verbose: false,
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--dry-run' || raw === '-n') {
      args.dryRun = true;
    } else if (raw === '--verbose' || raw === '-v') {
      args.verbose = true;
    } else if (raw.startsWith('--franchise=')) {
      args.franchise = raw.slice('--franchise='.length).trim().toUpperCase();
    } else if (raw.startsWith('--limit=')) {
      const n = parseInt(raw.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) args.limit = n;
    }
  }
  return args;
}

function nonEmpty(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

async function listFranchiseIds(db) {
  const snap = await db.collection('franchises').get();
  return snap.docs.map((d) => d.id);
}

/**
 * Reads the linked exit doc and returns the patch payload (omitting fields the
 * exit already has). Returns null when there is nothing to write.
 */
async function buildPatch(db, franchiseId, frontDeskDoc) {
  const data = frontDeskDoc.data() || {};
  const linkedExitId = (data.linkedExitId || '').toString().trim();
  if (!linkedExitId) return { skipReason: 'no_linked_exit', patch: null };

  const exitRef = db
    .collection('franchises')
    .doc(franchiseId)
    .collection('exitIslemleri')
    .doc(linkedExitId);
  const exitSnap = await exitRef.get();
  if (!exitSnap.exists) {
    return { skipReason: 'exit_missing', patch: null };
  }
  const exitData = exitSnap.data() || {};

  const patch = {};
  for (const field of HANDOVER_FIELDS) {
    const fromHandover = data[field];
    if (!nonEmpty(fromHandover)) continue;
    if (nonEmpty(exitData[field])) continue;
    patch[field] = fromHandover;
  }
  if (Object.keys(patch).length === 0) {
    return { skipReason: 'already_filled', patch: null };
  }
  patch.backfillSource = 'frontDeskCustomers';
  patch.backfilledAt = admin.firestore.FieldValue.serverTimestamp();
  return { ref: exitRef, patch };
}

async function backfillFranchise(db, franchiseId, args) {
  const franchiseStart = Date.now();
  const handovers = await db
    .collection('franchises')
    .doc(franchiseId)
    .collection('frontDeskCustomers')
    .where('linkedExitId', '>', '')
    .limit(args.limit)
    .get();

  let scanned = 0;
  let patched = 0;
  let skipped = 0;
  const skipBuckets = Object.create(null);

  for (const doc of handovers.docs) {
    scanned += 1;
    let result;
    try {
      result = await buildPatch(db, franchiseId, doc);
    } catch (err) {
      console.error(`[${franchiseId}] ${doc.id}: build patch failed`, err);
      skipped += 1;
      skipBuckets.error = (skipBuckets.error || 0) + 1;
      continue;
    }

    if (!result.patch) {
      skipped += 1;
      const tag = result.skipReason || 'unknown';
      skipBuckets[tag] = (skipBuckets[tag] || 0) + 1;
      if (args.verbose) {
        console.log(`[${franchiseId}] skip ${doc.id} reason=${tag}`);
      }
      continue;
    }

    if (args.dryRun) {
      console.log(
        `[${franchiseId}][dry-run] would patch ${result.ref.path}`,
        Object.keys(result.patch).filter((k) => k !== 'backfilledAt' && k !== 'backfillSource')
      );
    } else {
      await result.ref.set(result.patch, { merge: true });
      console.log(
        `[${franchiseId}] patched ${result.ref.path}`,
        Object.keys(result.patch).filter((k) => k !== 'backfilledAt' && k !== 'backfillSource')
      );
    }
    patched += 1;
  }

  const elapsedMs = Date.now() - franchiseStart;
  console.log(
    `[${franchiseId}] scanned=${scanned} patched=${patched} skipped=${skipped} ` +
      `skipBuckets=${JSON.stringify(skipBuckets)} elapsedMs=${elapsedMs}`
  );
  return { scanned, patched, skipped };
}

async function main() {
  const args = parseArgs(process.argv);
  const db = admin.firestore();

  let franchiseIds;
  if (args.franchise) {
    franchiseIds = [args.franchise];
  } else {
    franchiseIds = await listFranchiseIds(db);
  }

  console.log(
    `[backfill] dryRun=${args.dryRun} limit=${args.limit} franchises=${franchiseIds.length}` +
      (args.franchise ? ` (filtered=${args.franchise})` : '')
  );

  const aggregate = { scanned: 0, patched: 0, skipped: 0 };
  for (const fid of franchiseIds) {
    try {
      const result = await backfillFranchise(db, fid, args);
      aggregate.scanned += result.scanned;
      aggregate.patched += result.patched;
      aggregate.skipped += result.skipped;
    } catch (err) {
      console.error(`[${fid}] backfill failed`, err);
    }
  }

  console.log(
    `[backfill] done total scanned=${aggregate.scanned} patched=${aggregate.patched} ` +
      `skipped=${aggregate.skipped}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
