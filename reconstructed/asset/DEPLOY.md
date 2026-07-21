# Asset Matrix — go-live on Firebase (Google sign-in, work emails only)

The app is deploy-ready with a Google auth gate that only admits
`@ghlogisticsllc.com` and `@ajgtransport.com` accounts (same as the GH Driver
Hub). These steps must be run **from your machine with your Google/Firebase
account** — the build sandbox can't log into your Firebase.

## 1. Create the Firebase project (Console — one time)
1. https://console.firebase.google.com → **Add project** (e.g. `asset-matrix-gh`).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable** → Save.
3. **Authentication → Settings → Authorized domains** → add the domain you'll host on
   (`<project>.web.app` is added automatically; add a custom domain later if you use one).
4. **Project settings → General → Your apps → Web (</>)** → register an app →
   copy the **firebaseConfig** values.

## 2. Point the app at your project
```bash
cd reconstructed/asset
cp .env.example .env.local        # then paste your config values into .env.local
# edit .firebaserc → replace REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID with your project id
```

## 3. Install the CLI, log in, build, deploy
```bash
npm install -g firebase-tools
firebase login                    # opens your browser — use your GH work account
cd reconstructed/asset
npm install
npm run build                     # produces dist/ (reads .env.local)
firebase deploy --only hosting,firestore:rules
```
Firebase prints the live URL: `https://<project>.web.app`.

## 4. Verify
- Open the URL → you should see the **Sign in with Google** screen.
- Sign in with a `@ghlogisticsllc.com` / `@ajgtransport.com` account → the Matrix loads.
- Sign in with any other Google account → **rejected** ("Access restricted to …").

## Notes
- **Auth is enforced two ways:** the app blocks non-work emails at sign-in, and
  `firestore.rules` blocks non-work emails at the database. Both are already wired.
- **Data today is per-browser (localStorage).** Sign-in gates *access*; making the
  board *shared* across users is the next step (migrate fleet/drivers/schedule to
  Firestore — the schedule layer already has the write-through seam).
- Never remove the two work domains from `src/firebase.ts` (`REQUIRED_DOMAINS`).
