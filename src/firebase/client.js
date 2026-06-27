import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
    initializeFirestore,
    persistentLocalCache,
    persistentMultipleTabManager,
} from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
    apiKey: 'AIzaSyDKL5-CYr9UN7PmZQqk3sL_AZg5SdlXF2g',
    authDomain: 'greenmotionapp-33413.firebaseapp.com',
    projectId: 'greenmotionapp-33413',
    storageBucket: 'greenmotionapp-33413.firebasestorage.app',
    messagingSenderId: '831733588823',
    appId: '1:831733588823:web:f14cf8021b5f3991b49412',
    measurementId: 'G-PPZXXGSYBZ',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/** Offline persistence — repeat visits show cached fleet data immediately while network syncs. */
export const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const storage = getStorage(app);
/** Default callables (auth, admin, front desk) — us-central1. */
export const functionsApp = getFunctions(app, 'us-central1');

/** Firestore-adjacent callables (migration, health) — same region as DB (europe-west6). */
export const functionsEu = getFunctions(app, 'europe-west6');
export default app;
