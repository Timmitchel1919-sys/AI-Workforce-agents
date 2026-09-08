/**
 * Assemble the whole operations console into ONE self-contained HTML document
 * from a `DashboardSnapshot`. No external assets, no framework, no build step.
 *
 * An HTTP layer serves it as:
 *
 *   res.end(buildDashboardHtml(await query.getDashboardSnapshot(principal), {
 *     commandEndpoint: "/api/control/command",
 *   }));
 *
 * The Approve / Reject buttons POST `{ command, approvalId }` to
 * `commandEndpoint`; wire that to `WorkforceCommandService`. With no endpoint
 * the buttons explain that a command endpoint must be configured.
 */
import { type DashboardSnapshot } from "../../contracts/index.js";
import { DASHBOARD_VIEWS, escapeHtml, renderSnapshotBody } from "./render.js";

export interface BuildDashboardHtmlOptions {
  /** URL the Approve/Reject buttons POST to. */
  commandEndpoint?: string;
  title?: string;
}

const STYLE = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,sans-serif;background:#0b0d10;color:#e6e8eb}
header.top{display:flex;gap:.25rem;flex-wrap:wrap;padding:.5rem .75rem;background:#14171c;border-bottom:1px solid #262b33;position:sticky;top:0}
header.top button{background:#1c2128;color:#e6e8eb;border:1px solid #2d333b;border-radius:6px;padding:.35rem .7rem;cursor:pointer}
header.top button[aria-current=true]{background:#2f81f7;border-color:#2f81f7;color:#fff}
main{padding:1rem;max-width:1200px;margin:0 auto}
h1{font-size:1.3rem;margin:.2rem 0 1rem}
h2,h3,h4{margin:1.2rem 0 .5rem}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{border:1px solid #262b33;padding:.4rem .5rem;text-align:left;vertical-align:top}
th{background:#14171c}
.empty,.muted{color:#8b949e}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:.6rem}
.tile{background:#14171c;border:1px solid #262b33;border-radius:8px;padding:.8rem}
.tile__value{font-size:1.6rem;font-weight:600}
.tile__label{color:#8b949e;font-size:12px}
.badge{display:inline-block;padding:.05rem .45rem;border-radius:999px;font-size:11px;background:#30363d;margin-left:.25rem}
.badge--unknown{background:#484f58}
.badge--healthy,.badge--completed,.badge--available,.badge--executed,.badge--pass,.badge--allowed{background:#1a7f37}
.badge--failed,.badge--unavailable,.badge--denied,.badge--rejected,.badge--high-risk{background:#a40e26}
.badge--degraded,.badge--blocked,.badge--awaiting-approval,.badge--paused,.badge--waiting,.badge--medium-risk{background:#9a6700}
.progress{height:8px;background:#262b33;border-radius:999px;overflow:hidden;margin:.4rem 0}
.progress__bar{height:100%;background:#2f81f7}
.stages{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:.4rem}
.stage{background:#14171c;border:1px solid #262b33;border-radius:6px;padding:.35rem .6rem}
.stage--completed{border-color:#1a7f37}.stage--failed,.stage--blocked,.stage--skipped{border-color:#a40e26}
.stage__err{color:#ff7b72;font-size:11px}
.wf,.project,.approval{background:#14171c;border:1px solid #262b33;border-radius:8px;padding:1rem;margin:.7rem 0}
.approval--high{border-color:#a40e26}
.approval dl{display:grid;grid-template-columns:5rem 1fr;gap:.15rem .6rem;margin:.5rem 0}
.approval dt{color:#8b949e}
.actions{display:flex;gap:.5rem}
.actions button{padding:.35rem .9rem;border-radius:6px;border:1px solid #2d333b;background:#1a7f37;color:#fff;cursor:pointer}
.actions button.danger{background:#a40e26}
.banner--error{background:#a40e26;color:#fff;padding:.6rem 1rem;border-radius:6px;margin-bottom:1rem}
.err{color:#ff7b72}
code{background:#262b33;padding:.05rem .3rem;border-radius:4px}
`;

function nav(): string {
  return DASHBOARD_VIEWS.map(
    (view, i) =>
      `<button data-nav="${view}"${i === 0 ? ' aria-current="true"' : ""}>${escapeHtml(view[0]!.toUpperCase() + view.slice(1))}</button>`,
  ).join("");
}

function clientScript(commandEndpoint: string | undefined): string {
  const endpoint = commandEndpoint ? JSON.stringify(commandEndpoint) : "null";
  return `
const ENDPOINT=${endpoint};
document.querySelectorAll('[data-nav]').forEach(function(b){
  b.addEventListener('click',function(){
    var id=b.getAttribute('data-nav');
    document.querySelectorAll('[data-nav]').forEach(function(x){x.removeAttribute('aria-current')});
    b.setAttribute('aria-current','true');
    document.querySelectorAll('section[data-view]').forEach(function(s){
      s.hidden = s.getAttribute('data-view')!==id;
    });
  });
});
document.querySelectorAll('button[data-command]').forEach(function(b){
  b.addEventListener('click',async function(){
    var command=b.getAttribute('data-command');
    var approvalId=b.getAttribute('data-approval');
    if(!ENDPOINT){alert('No command endpoint is configured for this console.');return;}
    if(b.getAttribute('data-confirm')==='true' && !confirm('This is a HIGH-RISK approval. '+command+'?'))return;
    var reason = command==='reject' ? (prompt('Reason for rejection:')||'') : undefined;
    b.disabled=true;
    try{
      var r=await fetch(ENDPOINT,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({command:command,approvalId:approvalId,reason:reason})});
      var j=await r.json();
      alert((j.ok?'OK: ':'Not applied: ')+(j.reason||r.status));
      location.reload();
    }catch(e){alert('Request failed: '+e);b.disabled=false;}
  });
});
`;
}

export function buildDashboardHtml(
  snapshot: DashboardSnapshot,
  options: BuildDashboardHtmlOptions = {},
): string {
  const title = options.title ?? "AI Workforce — Operations Console";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">${nav()}</header>
<main id="app">
<p class="muted">Operator: ${escapeHtml(snapshot.operator.id)} (${escapeHtml(snapshot.operator.role)}) · generated ${escapeHtml(snapshot.generatedAt)}</p>
${renderSnapshotBody(snapshot)}
</main>
<script>${clientScript(options.commandEndpoint)}</script>
</body>
</html>`;
}
