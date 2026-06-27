/**
 * Migration: Copy global protocolTemplates → franchises/CH/protocolTemplates
 *
 * Run once:
 *   cd green-motion-web
 *   node scripts/migrate-protocol-templates-to-franchise.mjs
 *
 * What it does:
 *   1. Reads every doc from the top-level `protocolTemplates` collection
 *   2. Writes each doc (same id) into `franchises/CH/protocolTemplates`
 *      (skips if destination doc already exists)
 *   3. Does NOT delete the source docs (safe to re-run)
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Locate service-account key ──────────────────────────────────────────────
// Try GOOGLE_APPLICATION_CREDENTIALS first, then well-known local paths.
function findServiceAccountKey() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return process.env.GOOGLE_APPLICATION_CREDENTIALS;
    }
    const candidates = [
        join(__dirname, '../keys/service-account.json'),
        join(__dirname, '../keys/serviceAccount.json'),
        join(__dirname, '../service-account.json'),
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return null;
}

const keyPath = findServiceAccountKey();

let db;
if (keyPath) {
    console.log('Using service account key:', keyPath);
    const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
    if (!getApps().length) {
        initializeApp({ credential: cert(serviceAccount) });
    }
    db = getFirestore();
} else {
    // Fall back to Application Default Credentials (gcloud auth application-default login)
    console.log('No local key found — using Application Default Credentials (firebase CLI / gcloud).');
    if (!getApps().length) {
        initializeApp({ projectId: 'greenmotionapp-33413' });
    }
    db = getFirestore();
}

// ── Migration ────────────────────────────────────────────────────────────────
const TARGET_FRANCHISE = 'CH';
const SOURCE_COLLECTION = 'protocolTemplates';
const DEST_COLLECTION = `franchises/${TARGET_FRANCHISE}/protocolTemplates`;

async function migrate() {
    console.log(`\nReading from:  ${SOURCE_COLLECTION}`);
    console.log(`Writing to:    ${DEST_COLLECTION}\n`);

    const sourceSnap = await db.collection(SOURCE_COLLECTION).get();
    if (sourceSnap.empty) {
        console.log('Source collection is empty — nothing to migrate.');
        return;
    }

    console.log(`Found ${sourceSnap.size} template(s) in source.\n`);

    let copied = 0;
    let skipped = 0;
    let failed = 0;

    for (const srcDoc of sourceSnap.docs) {
        const destRef = db.doc(`${DEST_COLLECTION}/${srcDoc.id}`);
        try {
            const destSnap = await destRef.get();
            if (destSnap.exists) {
                console.log(`  SKIP (already exists): ${srcDoc.id}`);
                skipped++;
                continue;
            }
            await destRef.set({
                ...srcDoc.data(),
                // stamp franchise context onto the doc
                franchiseId: TARGET_FRANCHISE,
                _migratedAt: new Date().toISOString(),
                _migratedFrom: SOURCE_COLLECTION,
            });
            console.log(`  COPIED: ${srcDoc.id}`);
            copied++;
        } catch (err) {
            console.error(`  ERROR for ${srcDoc.id}:`, err.message);
            failed++;
        }
    }

    console.log(`\n── Summary ──`);
    console.log(`  Copied : ${copied}`);
    console.log(`  Skipped: ${skipped} (already in destination)`);
    console.log(`  Failed : ${failed}`);
    console.log(`\nDone. Source docs are untouched — safe to re-run if needed.`);
}

migrate().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
});
