# Branching Strategy

`main` is the protected release branch. Normal work uses short-lived `codex/<scope>` branches from current `origin/main`; emergency fixes use the same review and test gates. Do not combine unrelated user changes with a phase commit.

Recommended protection: pull request required, no force-push/delete, required CI and Security workflows, resolved review threads, and linear history where practical. Commits should be scoped and imperative, for example `fix(security): harden auth configuration handling`.

Never commit `.env`, credentials, local Firebase state, test screenshots/traces, or unrelated dirty files. Deployment is a separate authorized action after merge; a pushed commit is not proof of deployment or health.
