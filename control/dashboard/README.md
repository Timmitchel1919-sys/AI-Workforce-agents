# Operations console — serving

The dashboard is a **pure render** (`render.ts`) plus a **self-contained HTML
builder** (`buildDashboardHtml`). It ships no server, no framework, no external
asset, and no sample data — the real console gets its data from
`WorkforceQueryService` and acts through `WorkforceCommandService`.

Wire it to any HTTP layer you already run:

```ts
import { createServer } from "node:http";
import {
  WorkforceQueryService,
  WorkforceCommandService,
  buildDashboardHtml,
  type ControlPlaneContext,
} from "../../control/index.js";

const query = new WorkforceQueryService(ctx);
const command = new WorkforceCommandService(ctx);

createServer(async (req, res) => {
  const principal = authenticate(req); // YOUR auth — the control services trust this object

  if (req.method === "GET" && req.url === "/") {
    const snapshot = await query.getDashboardSnapshot(principal);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      buildDashboardHtml(snapshot, { commandEndpoint: "/api/control/command" }),
    );
    return;
  }

  if (req.method === "POST" && req.url === "/api/control/command") {
    const body = JSON.parse(await readBody(req));
    let result;
    switch (body.command) {
      case "approve":
        result = await command.approve(principal, {
          approvalId: body.approvalId,
          note: body.note,
        });
        break;
      case "reject":
        result = await command.reject(principal, {
          approvalId: body.approvalId,
          reason: body.reason,
        });
        break;
      // cancel_task / retry_task / pause_workflow / resume_workflow /
      // cancel_workflow / disable_agent / enable_agent similarly
      default:
        result = { ok: false, outcome: "rejected", reason: "unknown command" };
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(result));
    return;
  }

  res.statusCode = 404;
  res.end();
}).listen(8787);
```

Constraints (enforced by the services, not the UI):

- The UI never mutates state — it only calls the two services.
- Authorization is enforced in `WorkforceCommandService` / `WorkforceQueryService`
  from the `OperatorPrincipal` you pass; the UI is **not** a security boundary.
- Every command emits a `control_command` audit event (including denied /
  rejected).
- All operator-visible strings are redacted and HTML-escaped.
