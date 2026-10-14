# Test classification

Backend unit tests run through `npm run test:unit` and do not require Firebase. The explicit emulator integration set is:

- `firebase-adapters.test.ts`
- `firebase-function-adapter.test.ts`
- `firestore-append-only-security-events.test.ts`
- `onboarding-firestore-store.test.ts`
- `operator-profile.test.ts`

`npm run test:firebase` runs only that list under the Firebase Auth, Firestore and Storage emulators with the non-production project id `demo-ai-workforce`. The UI suite is isolated behind `ui/.test-tmp/` and runs with `npm --prefix ui run test:ci`.
