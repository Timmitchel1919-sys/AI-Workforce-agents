# Staging release validation

Staging is always a separate Firebase project and Auth/Firestore/Storage dataset. No production project id may be used.

1. Create the staging project manually in Firebase Console and enable Auth, Firestore, Storage, Hosting and App Check.
2. Set `STAGING_FIREBASE_PROJECT_ID` and `STAGING_BASE_URL` in the shell; keep credentials out of git.
3. Run `npm run test:firebase` for emulator integration tests.
4. Run `npm run verify:release`; it must print `READY FOR STAGING`.
5. Run `npm run staging:deploy`, which requires the explicit staging project and never uses the default project implicitly.
6. Run `npm run staging:verify` and review the protected-route and health results.
7. Production deployment remains a separate, explicitly authorized operation.

Staging starts with `APP_CHECK_MODE=monitor`, then moves to `enforced` only after acceptance. Firestore and Storage client rules remain deny-all.
