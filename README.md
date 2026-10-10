# NMMI Islamic Library — Firebase + GitHub version

This is the Firebase/GitHub-deployable version of the library circulation app:
book catalog, student roster with photos, issue/return tracking, barcode
scanning, bulk CSV import for books and students, and a realtime shared
database so every staff member sees the same data live.

It uses:
- **React + Vite** for the app itself
- **Firebase Firestore** for data (books, students, transactions, classes)
- **Firebase Storage** for student photos
- **Firebase Authentication** (Email/Password) for staff sign-in
- **Firebase Hosting** to serve the built site
- **GitHub Actions** to auto-deploy on every push to `main`

> Note: this starts with a fresh, empty database. Data you entered in the
> earlier Claude-hosted version does not transfer automatically — but the
> app re-seeds the same starter book list and sample students on first run,
> exactly like before.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → follow the wizard (Google Analytics is optional, you can skip it).
2. In your new project, go to **Build → Firestore Database → Create database**. Choose **production mode** and a region close to you.
3. ~~Storage~~ — **skipped for now.** Firebase Storage now requires the paid Blaze (pay-as-you-go) plan, so student photo uploads are disabled in this version. (It has a generous free monthly quota even on Blaze, so it's safe to turn on later if you want photos — just enable Storage in the console and ask Claude to re-add the feature.)
4. Go to **Build → Authentication → Get started**. Under **Sign-in method**, enable **Email/Password**.
5. Still in Authentication, go to the **Users** tab → **Add user**. Create an email + password for yourself (and anyone else who should be able to use the app). This is how staff will sign in — there's no public self-signup, by design.
6. Go to **Project settings** (gear icon) → **General** → scroll to **Your apps** → click the **Web** icon (`</>`) → register an app (any nickname). Firebase will show you a `firebaseConfig` object — keep this tab open, you'll need the values in step 3 below.

## 2. Get the code running locally

You'll need [Node.js](https://nodejs.org) (version 18 or later) installed.

```bash
cd nmmi-library-firebase
npm install
cp .env.example .env
```

Open `.env` and fill in the values from the `firebaseConfig` object you saw in step 1.6:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Then run it:

```bash
npm run dev
```

Open the printed `localhost` URL, sign in with the staff email/password you created in step 1.5, and the app should load (and auto-seed the starter catalog).

## 3. Lock down the database (important)

By default, a fresh Firestore project is **closed to everyone** until you
deploy rules — the rules in this project (`firestore.rules`) open it up to
**signed-in users only**, which is what makes the sign-in screen actually
mean something (unlike a password only checked in client-side JavaScript,
which anyone could bypass).

Install the Firebase CLI once, globally:

```bash
npm install -g firebase-tools
firebase login
```

Then, from the project folder:

```bash
firebase use --add        # pick your Firebase project, give it the alias "default"
firebase deploy --only firestore:rules
```

(`storage.rules` is included in this repo for when you enable Storage later —
it isn't deployed yet since Storage itself isn't turned on.)

## 4. Deploy to Firebase Hosting (manual, one-off)

```bash
npm run build
firebase deploy --only hosting
```

Firebase will print your live URL (something like `https://your-project.web.app`).

## 5. Push to GitHub and auto-deploy on every push

1. Create a new repository on GitHub and push this folder to it.
2. In the repo, go to **Settings → Secrets and variables → Actions** and add these **Repository secrets**:
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`
   - `FIREBASE_SERVICE_ACCOUNT` — see below for how to generate this
3. For `FIREBASE_SERVICE_ACCOUNT`: in the Firebase Console go to **Project settings → Service accounts → Generate new private key**. This downloads a JSON file — paste its *entire contents* as the secret value.
4. Push to `main`. The workflow in `.github/workflows/deploy.yml` will build the app and deploy it to Firebase Hosting automatically. Check the **Actions** tab on GitHub to watch it run.

## What's different from the Claude-hosted version

- **Sign-in**: instead of one shared password, each staff member signs in
  with their own email/password (created by you in the Firebase Console —
  there's no in-app "create an account" flow). You can also just create one
  shared staff account and hand out those same credentials if you'd rather
  keep it simple.
- **Photos**: disabled for now — Firebase Storage requires the paid Blaze
  plan. Students show a colored initial instead of a photo. Turn it back on
  later by enabling Storage in the console and asking Claude to re-add it.
- **Barcode scanning**: now uses the `@zxing/library` npm package (bundled
  into the app) instead of loading it from a CDN at runtime — same scanning
  behavior, just bundled properly.
- **Realtime sync**: same as before — Firestore's `onSnapshot` keeps every
  signed-in device in sync live, so two staff members issuing books at the
  same time both see up-to-date availability.

## Project structure

```
src/
  App.jsx            — the whole app (UI + Firestore/Storage/Auth logic)
  main.jsx           — React mount point
  firebaseClient.js  — Firebase initialization (reads .env)
index.html
firebase.json        — Hosting + rules config
firestore.rules
storage.rules
.github/workflows/deploy.yml — GitHub Actions auto-deploy
```
