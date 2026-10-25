# Deployment Strategy

Production deployment is manual and explicitly authorized. The Firebase target is defined in `.firebaserc`; Hosting serves `ui/dist`, rewrites `/api/**` to `controlPlaneApi`, and falls back to `index.html`. Functions use Node 22 and run `functions:prepare` before deployment.

Safe sequence:

1. Confirm clean, reviewed commit and target project; never infer target from directory name.
2. Run `npm run verify:release`. Emulator or credential/infrastructure blockers must remain visible.
3. Build from lockfiles with supported Node versions. Verify production Firebase web config and fail-closed auth behavior without printing values.
4. Deploy to staging first using documented staging variables; `check-staging-config.mjs` refuses the production project.
5. Execute smoke, auth, authorization, responsive, and rollback checks.
6. Obtain explicit production approval, deploy Functions/Hosting with the intended project, then run `verify:production`.
7. Record commit, artifact/version, Firebase target, timestamps, command exit codes, and live evidence.

Rollback means redeploying a previously verified immutable artifact/commit and validating data/schema compatibility. Never delete production data or rotate credentials as an implicit rollback. A successful CLI deploy is only **deployed**; it is not **healthy** until post-deploy verification passes.
