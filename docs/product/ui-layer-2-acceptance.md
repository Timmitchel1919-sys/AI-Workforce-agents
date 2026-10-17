# Layer 2 acceptance (Layers 30–32)

Layer 2 is accepted only when the automated suite and browser QA confirm:

- workspace context, saved layouts/views and adaptive dashboards remain local UI state;
- notifications are derived only from authorized Control Plane approval and audit responses;
- notification filters and navigation never approve, deploy, delete, spend, change policy/permissions, or run commands;
- contextual commands, inspector and global search do not widen authorization;
- the assistant remains explicitly advisory and `NOT CONNECTED` without a configured provider;
- keyboard and responsive navigation remain operable;
- protected data stays behind the Control Plane and the frontend does not access Firestore directly;
- no acceptance interaction causes an unintended backend mutation.

The release evidence must include the exact test/build commands, browser route exercised, commit, push, deployment target and production bundle verification. A document alone is not proof that a gate ran.

