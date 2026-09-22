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
export interface BuildDashboardHtmlOptions {
    /** URL the Approve/Reject buttons POST to. */
    commandEndpoint?: string;
    title?: string;
}
export declare function buildDashboardHtml(snapshot: DashboardSnapshot, options?: BuildDashboardHtmlOptions): string;
