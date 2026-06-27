#!/usr/bin/env node
/**
 * Cleanup script: soft-deletes all non-deleted exitIslemleri and iadeIslemleri
 * for franchise TR_NEVSEHIR, and also removes their linked frontDeskCustomers rows.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node cleanup-nevsehir.js
 *   -- OR --
 *   node cleanup-nevsehir.js   (uses Firebase default credentials via `firebase login`)
 *
 * The script uses the Firebase Admin SDK via Application Default Credentials.
 */

const admin = require('firebase-admin');

// Try to find a service account
let credential;
try {
    credential = admin.credential.applicationDefault();
} catch {
    credential = admin.credential.applicationDefault();
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential,
        projectId: 'greenmotionapp-33413',
    });
}

const db = admin.firestore();
const FRANCHISE = 'TR_NEVSEHIR';
const deletedBy = 'cleanup-script';

async function softDeleteAll(collectionName) {
    const colRef = db.collection('franchises').doc(FRANCHISE).collection(collectionName);
    const snap = await colRef.get();
    const toDelete = snap.docs.filter(d => !d.data().isDeleted);
    if (toDelete.length === 0) {
        console.log(`  ${collectionName}: nothing to clean up.`);
        return 0;
    }
    const batch = db.batch();
    let count = 0;
    for (const doc of toDelete) {
        batch.update(doc.ref, {
            isDeleted: true,
            deletedAt: admin.firestore.Timestamp.now(),
            deletedBy,
        });
        count++;
        if (count % 490 === 0) {
            await batch.commit();
            console.log(`  ${collectionName}: committed ${count} so far...`);
        }
    }
    await batch.commit();
    console.log(`  ✅ ${collectionName}: soft-deleted ${count} docs.`);
    return count;
}

async function removeFrontDeskCustomers() {
    const colRef = db.collection('franchises').doc(FRANCHISE).collection('frontDeskCustomers');
    const snap = await colRef.get();
    if (snap.empty) {
        console.log('  frontDeskCustomers: nothing to clean up.');
        return 0;
    }
    const batch = db.batch();
    for (const doc of snap.docs) {
        batch.delete(doc.ref);
    }
    await batch.commit();
    console.log(`  ✅ frontDeskCustomers: hard-deleted ${snap.size} docs.`);
    return snap.size;
}

(async () => {
    console.log(`\n🧹 Cleaning up TR_NEVSEHIR operations data...\n`);
    try {
        await softDeleteAll('exitIslemleri');
        await softDeleteAll('iadeIslemleri');
        await removeFrontDeskCustomers();
        console.log('\n✅ Cleanup complete. iOS and web listeners will update in real-time.\n');
    } catch (err) {
        console.error('❌ Error during cleanup:', err.message || err);
        process.exit(1);
    }
})();
