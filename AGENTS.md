# Agent instructions — AI Workforce

These rules apply to every AI coding agent working in this repository
(Codex, Claude Code, and others).

## Release rule: ship after every prompt

The repository owner requires that **every completed prompt ends with a
commit, a push, and a frontend deploy**. Do not wait to be asked.

After finishing the requested work in a prompt:

1. **Validate** with the real scripts (never invent scripts):
   - UI (`ui/`): `npx tsc -b`, `npm run lint`, `npx vitest run --environment jsdom`, `npm run build`
   - Backend (repo root), only if backend files changed: `npm run check`
   - If validation fails, fix it. If it cannot be fixed, **do not ship** —
     report the failure instead.
2. **Commit** on `main` with a Conventional Commit message
   (`feat(ui): …`, `fix(auth): …`). Review `git diff` first; commit only the
   work of the prompt. Never commit secrets or `.env` values.
3. **Push** to GitHub: `git push origin main`
   (https://github.com/Timmitchel1919-sys/AI-Workforce-agents).
   - Never force-push. If the push is rejected, fetch, integrate with a normal
     merge/rebase of your own commits, re-validate, and push again.
4. **Deploy the frontend** to the existing Firebase Hosting project
   `ai-workforce-agents`:
   `firebase deploy --only hosting --project ai-workforce-agents`
   - Live URLs: https://ai-workforce-agents.web.app and
     https://ai-workforce-agents.firebaseapp.com
   - Do not create another Firebase project.
   - Deploy Functions (`--only functions`) only when backend code changed.
5. **Report** the commit SHA, push result, and deploy result (hosting URL)
   at the end of the response. If any step was skipped or failed, say so.

## Guardrails that still apply

- Firebase Auth → ID token → Control Plane API → backend authorization is the
  only data path. No direct frontend Firestore access.
- Roles are server-assigned custom claims; UI never sends or trusts a role.
- No fabricated telemetry in the UI; label presentation content as such.
