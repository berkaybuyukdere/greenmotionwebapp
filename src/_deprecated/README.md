# Deprecated entry points (archived)

These files are **not** imported by `src/index.js` (production uses `App.js` only).

They used **legacy root-level** Firestore paths (`collection(db, 'araclar')`, etc.) instead of `franchises/{FRANCHISE_ID}/...` via `firebaseHelpers.js`.

**Do not** point `index.js` here without a full migration review.

To restore for reference: move the desired file back to `src/` and adjust imports manually.
