# AI Workforce Agent Instructions

This repository contains the AI Workforce platform.

All AI coding agents must follow the project architecture and development rules.

Read and follow:

- docs/development/architecture.md
- docs/development/coding-standards.md
- docs/development/parallel-development.md
- docs/development/branching-strategy.md
- docs/development/testing-strategy.md
- docs/development/deployment-strategy.md

Core rules:

- Use TypeScript strict mode.
- Use ESM / NodeNext.
- Do not break existing architecture.
- Frontend must not access Firestore directly.
- Frontend communicates through the Control Plane.
- Never commit secrets.
- Add or update tests for implementations.
- Run tests and builds before declaring work complete.
- Parallel agents must not modify the same files simultaneously.
- Shared interfaces and contracts must be defined before parallel implementation.
- Each parallel implementation lane should use an isolated Git branch/worktree.
