# Green Motion Web App (ERPX)

React ERP web client for Green Motion fleet operations. Pairs with the iOS app and Firebase backend (`greenmotionapp-33413`).

## Live site

- https://greenmotionapp-33413.web.app
- https://vehiclesentinel.com (custom domain, when configured)

## Requirements

- Node.js 18–22
- Firebase CLI (`npm install -g firebase-tools`)
- Access to Firebase project `greenmotionapp-33413`

## Setup

```bash
git clone https://github.com/berkaybuyukdere/greenmotionwebapp.git
cd greenmotionwebapp
npm install
cp .env.development.local.example .env.development.local   # optional, for local mail API
firebase login
npm start
```

Dev server: http://localhost:3000

## Build & deploy

```bash
npm run build
firebase deploy --only hosting
# or
npm run deploy
```

## Related repo

Mobile app, Cloud Functions, and Firestore rules live in the main monorepo:

- https://github.com/berkaybuyukdere/GreenMotionERP

Keep `roleScope`, franchise helpers, and Firestore rules in sync across both repos.

## Project layout

```
src/
  App.js                 # Main ERP shell
  views/                 # Dashboard, login
  components/            # Feature modules (office ops, fleet, Stripe, admin, …)
  utilities/             # roleScope, firebaseHelpers, franchiseHelpers
  firebase/client.js     # Firebase web SDK config
public/                  # Static assets + customer forms
functions/               # Legacy web-scoped Cloud Functions (if used)
```
