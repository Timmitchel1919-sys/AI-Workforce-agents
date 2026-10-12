import { pick, pickList, } from "./rest.js";
const P = {
    s: (name, required = false, max = 1000) => ({
        name,
        type: "string",
        required,
        max,
    }),
    n: (name, required = false) => ({
        name,
        type: "number",
        required,
    }),
    b: (name) => ({ name, type: "boolean" }),
    l: (name, max = 50) => ({ name, type: "string[]", max }),
};
const RISK = {
    READ: "LOW",
    DRAFT: "MEDIUM",
    WRITE: "MEDIUM",
    PUBLISH: "HIGH",
    SEND: "HIGH",
    DEPLOY: "HIGH",
    DELETE: "CRITICAL",
};
function cap(capability, description, operation, permissions, params, http, extra = {}) {
    return {
        capability,
        description,
        operation,
        risk: RISK[operation],
        version: 1,
        permissions,
        params,
        sandbox: operation === "READ" ? "ALLOW" : "DENY",
        queueable: operation === "READ" || operation === "DRAFT",
        ...(http ? { http } : {}),
        ...extra,
    };
}
const unavailable = (capability, description, operation, why) => cap(capability, description, operation, [], [], undefined, {
    unavailable: why,
    queueable: false,
});
/* ---------------- GitHub ---------------- */
const GH_RESOURCE = /^(?<owner>[A-Za-z0-9-]{1,39})\/(?<repo>[A-Za-z0-9._-]{1,100})$/;
const ghRepo = { resourcePattern: GH_RESOURCE, resourceHint: "owner/repo" };
const decode = (b64) => {
    if (typeof b64 !== "string")
        return "";
    try {
        return Buffer.from(b64.replace(/\n/g, ""), "base64")
            .toString("utf8")
            .slice(0, 100_000);
    }
    catch {
        return "";
    }
};
export const GITHUB = {
    connectorId: "github",
    provider: "GitHub",
    name: "GitHub",
    description: "Source control: repositories, branches, files, commits, pull requests and issues.",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "2022-11-28",
    family: "source-control",
    authMethod: "token",
    authStyle: "bearer",
    scopes: ["repo"],
    oauth: {
        authorizeUrl: "https://github.com/login/oauth/authorize",
        tokenUrl: "https://github.com/login/oauth/access_token",
        scopes: ["repo"],
        clientIdEnv: "AI_WORKFORCE_GITHUB_OAUTH_CLIENT_ID",
        clientSecretEnv: "AI_WORKFORCE_GITHUB_OAUTH_CLIENT_SECRET",
    },
    defaultCredentialRef: "env:AI_WORKFORCE_GITHUB_READ_TOKEN",
    baseUrl: "https://api.github.com",
    allowedHosts: ["api.github.com"],
    defaultHeaders: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "ai-workforce-os",
    },
    events: ["push", "pull_request", "issues", "workflow_run"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    probe: "repository.discover",
    capabilities: [
        cap("repository.discover", "List the repositories the connected account can see.", "READ", ["repo:read"], [P.n("perPage")], { method: "GET", path: "/user/repos", query: ["perPage"] }, {
            account: true,
            transform: pickList("", {
                fullName: "full_name",
                private: "private",
                defaultBranch: "default_branch",
                url: "html_url",
            }),
        }),
        cap("repository.read", "Repository metadata.", "READ", ["repo:read"], [], { method: "GET", path: "/repos/{owner}/{repo}" }, {
            ...ghRepo,
            transform: pick({
                fullName: "full_name",
                description: "description",
                private: "private",
                defaultBranch: "default_branch",
                url: "html_url",
                openIssues: "open_issues_count",
                pushedAt: "pushed_at",
                archived: "archived",
            }),
        }),
        cap("repository.file.read", "Read one file (text, up to 100 KB).", "READ", ["contents:read"], [P.s("path", true, 400), P.s("ref", false, 200)], {
            method: "GET",
            path: "/repos/{owner}/{repo}/contents/{path}",
            query: ["ref"],
        }, {
            ...ghRepo,
            transform: (j) => {
                const o = j;
                return {
                    name: o["name"],
                    path: o["path"],
                    size: o["size"],
                    sha: o["sha"],
                    content: decode(o["content"]),
                };
            },
        }),
        cap("branch.read", "Branch head and protection state.", "READ", ["contents:read"], [P.s("branch", true, 250)], { method: "GET", path: "/repos/{owner}/{repo}/branches/{branch}" }, {
            ...ghRepo,
            transform: pick({
                name: "name",
                sha: "commit.sha",
                protected: "protected",
            }),
        }),
        cap("branch.create", "Create a branch from a commit.", "WRITE", ["contents:write"], [P.s("name", true, 250), P.s("sha", true, 64)], {
            method: "POST",
            path: "/repos/{owner}/{repo}/git/refs",
            build: (p) => ({
                ref: `refs/heads/${String(p["name"])}`,
                sha: p["sha"],
            }),
        }, {
            ...ghRepo,
            transform: pick({ ref: "ref", sha: "object.sha" }),
        }),
        cap("commit.create", "Create or update ONE file in a single commit.", "WRITE", ["contents:write"], [
            P.s("path", true, 400),
            P.s("message", true, 300),
            P.s("content", true, 100_000),
            P.s("branch", true, 250),
            P.s("sha", false, 64),
        ], {
            method: "PUT",
            path: "/repos/{owner}/{repo}/contents/{path}",
            build: (p) => ({
                message: p["message"],
                content: Buffer.from(String(p["content"]), "utf8").toString("base64"),
                branch: p["branch"],
                ...(p["sha"] ? { sha: p["sha"] } : {}),
            }),
        }, {
            ...ghRepo,
            transform: pick({
                commitSha: "commit.sha",
                path: "content.path",
                url: "commit.html_url",
            }),
        }),
        cap("pull_request.read", "Read one pull request.", "READ", ["pull_requests:read"], [P.n("number")], { method: "GET", path: "/repos/{owner}/{repo}/pulls/{number}" }, {
            ...ghRepo,
            transform: pick({
                number: "number",
                title: "title",
                state: "state",
                merged: "merged",
                head: "head.ref",
                base: "base.ref",
                url: "html_url",
                author: "user.login",
            }),
        }),
        cap("pull_request.list", "List pull requests.", "READ", ["pull_requests:read"], [P.s("state", false, 10)], { method: "GET", path: "/repos/{owner}/{repo}/pulls", query: ["state"] }, {
            ...ghRepo,
            transform: pickList("", {
                number: "number",
                title: "title",
                state: "state",
                head: "head.ref",
                base: "base.ref",
            }),
        }),
        cap("pull_request.create", "Open a pull request.", "WRITE", ["pull_requests:write"], [
            P.s("title", true, 250),
            P.s("head", true, 250),
            P.s("base", true, 250),
            P.s("body", false, 10_000),
            P.b("draft"),
        ], {
            method: "POST",
            path: "/repos/{owner}/{repo}/pulls",
            body: ["title", "head", "base", "body", "draft"],
        }, {
            ...ghRepo,
            transform: pick({ number: "number", url: "html_url", state: "state" }),
        }),
        cap("issue.read", "Read one issue.", "READ", ["issues:read"], [P.n("number")], { method: "GET", path: "/repos/{owner}/{repo}/issues/{number}" }, {
            ...ghRepo,
            transform: pick({
                number: "number",
                title: "title",
                state: "state",
                body: "body",
                url: "html_url",
            }),
        }),
        cap("issue.list", "List issues.", "READ", ["issues:read"], [P.s("state", false, 10)], { method: "GET", path: "/repos/{owner}/{repo}/issues", query: ["state"] }, {
            ...ghRepo,
            transform: pickList("", {
                number: "number",
                title: "title",
                state: "state",
            }),
        }),
        cap("issue.create", "Open an issue.", "WRITE", ["issues:write"], [P.s("title", true, 250), P.s("body", false, 10_000), P.l("labels", 10)], {
            method: "POST",
            path: "/repos/{owner}/{repo}/issues",
            body: ["title", "body", "labels"],
        }, {
            ...ghRepo,
            transform: pick({ number: "number", url: "html_url" }),
        }),
    ],
};
/* ---------------- Firebase ---------------- */
const FB_RESOURCE = /^(?<project>[a-z][a-z0-9-]{3,29})$/;
const fb = {
    resourcePattern: FB_RESOURCE,
    resourceHint: "firebase project id",
};
export const FIREBASE = {
    connectorId: "firebase",
    provider: "Firebase",
    name: "Firebase",
    description: "Hosting, functions, Firestore metadata and security configuration inspection; deployment through the governed hand-off.",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "v1beta1",
    family: "hosting",
    authMethod: "oauth2",
    authStyle: "bearer",
    scopes: ["https://www.googleapis.com/auth/firebase.readonly"],
    baseUrl: "https://firebase.googleapis.com",
    allowedHosts: [
        "firebase.googleapis.com",
        "firebasehosting.googleapis.com",
        "cloudfunctions.googleapis.com",
        "firestore.googleapis.com",
        "firebaserules.googleapis.com",
    ],
    events: ["deployment.completed"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    probe: "cloud.project.inspect",
    capabilities: [
        cap("cloud.project.inspect", "Firebase project metadata.", "READ", ["firebase.readonly"], [], { method: "GET", path: "/v1beta1/projects/{project}" }, {
            ...fb,
            transform: pick({
                projectId: "projectId",
                displayName: "displayName",
                state: "state",
                resources: "resources",
            }),
        }),
        cap("hosting.status", "Hosting sites of the project.", "READ", ["firebase.readonly"], [], {
            method: "GET",
            path: "/v1beta1/projects/{project}/sites",
            baseUrl: "https://firebasehosting.googleapis.com",
        }, {
            ...fb,
            transform: pickList("sites", {
                name: "name",
                defaultUrl: "defaultUrl",
                type: "type",
            }),
        }),
        cap("deployment.verify", "Latest hosting releases (deployment verification).", "READ", ["firebase.readonly"], [P.s("site", true, 100)], {
            method: "GET",
            path: "/v1beta1/sites/{site}/releases",
            baseUrl: "https://firebasehosting.googleapis.com",
            query: [],
        }, {
            ...fb,
            transform: pickList("releases", {
                name: "name",
                type: "type",
                releaseTime: "releaseTime",
                version: "version.name",
            }),
        }),
        cap("function.status", "Cloud Functions of the project.", "READ", ["cloud-platform.read-only"], [], {
            method: "GET",
            path: "/v2/projects/{project}/locations/-/functions",
            baseUrl: "https://cloudfunctions.googleapis.com",
        }, {
            ...fb,
            transform: pickList("functions", {
                name: "name",
                state: "state",
                updateTime: "updateTime",
            }),
        }),
        cap("firestore.metadata", "Firestore database metadata (no documents).", "READ", ["datastore.readonly"], [], {
            method: "GET",
            path: "/v1/projects/{project}/databases",
            baseUrl: "https://firestore.googleapis.com",
        }, {
            ...fb,
            transform: pickList("databases", {
                name: "name",
                type: "type",
                locationId: "locationId",
            }),
        }),
        cap("security.config.inspect", "Recent security rulesets.", "READ", ["firebase.readonly"], [], {
            method: "GET",
            path: "/v1/projects/{project}/rulesets",
            baseUrl: "https://firebaserules.googleapis.com",
            query: [],
        }, {
            ...fb,
            transform: pickList("rulesets", {
                name: "name",
                createTime: "createTime",
            }),
        }),
        cap("deployment.prepare", "Prepare a deployment (build artifacts and checks) for review.", "DRAFT", [], [P.s("environment", true, 20)], undefined, { ...fb, port: "deployment", sandbox: "ALLOW", queueable: false }),
        cap("deployment.execute", "Deploy through the governed deployment hand-off.", "DEPLOY", [], [P.s("environment", true, 20)], undefined, { ...fb, port: "deployment", sandbox: "DENY", queueable: false }),
    ],
};
/* ---------------- Google Workspace ---------------- */
const GOOGLE_OAUTH = {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientIdEnv: "AI_WORKFORCE_GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "AI_WORKFORCE_GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthorizeParams: { access_type: "offline", prompt: "consent" },
};
function b64url(text) {
    return Buffer.from(text, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
const mime = (p) => [
    `To: ${String(p["to"] ?? "")}`,
    ...(p["cc"] ? [`Cc: ${String(p["cc"])}`] : []),
    `Subject: ${String(p["subject"] ?? "").replace(/[\r\n]+/g, " ")}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    String(p["body"] ?? ""),
].join("\r\n");
const header = (msg, name) => {
    const headers = msg["payload"]?.["headers"];
    const h = Array.isArray(headers)
        ? headers.find((x) => x.name.toLowerCase() === name.toLowerCase())
        : undefined;
    return h?.value ?? "";
};
const bodyText = (msg) => {
    const walk = (part) => {
        if (!part)
            return "";
        const data = part["body"]?.["data"];
        if (part["mimeType"] === "text/plain" && typeof data === "string")
            return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        for (const sub of part["parts"] ?? []) {
            const t = walk(sub);
            if (t)
                return t;
        }
        return "";
    };
    return walk(msg["payload"]).slice(0, 20_000);
};
const GOOGLE_COMMON = {
    kind: "rest",
    version: "1.0.0",
    authMethod: "oauth2",
    authStyle: "bearer",
    environments: [
        "DEVELOPMENT",
        "TEST",
        "STAGING",
        "PRODUCTION",
    ],
    costClass: "FREE",
};
export const GOOGLE_DRIVE = {
    ...GOOGLE_COMMON,
    connectorId: "google-drive",
    provider: "Google",
    name: "Google Drive",
    description: "File search, metadata, document reading and creation, subject to the user's Drive permissions.",
    providerApiVersion: "v3",
    family: "documents",
    scopes: [
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/drive.file",
    ],
    oauth: {
        ...GOOGLE_OAUTH,
        scopes: [
            "https://www.googleapis.com/auth/drive.readonly",
            "https://www.googleapis.com/auth/drive.file",
        ],
    },
    baseUrl: "https://www.googleapis.com/drive/v3",
    allowedHosts: ["www.googleapis.com"],
    events: ["file.changed"],
    probe: "drive.search",
    capabilities: [
        cap("drive.search", "Search Drive files.", "READ", ["drive.readonly"], [P.s("q", true, 500), P.n("pageSize")], { method: "GET", path: "/files", query: ["q", "pageSize"] }, {
            account: true,
            transform: pickList("files", {
                id: "id",
                name: "name",
                mimeType: "mimeType",
                modifiedTime: "modifiedTime",
            }),
        }),
        cap("drive.file.metadata", "File metadata.", "READ", ["drive.readonly"], [P.s("fileId", true, 200)], { method: "GET", path: "/files/{fileId}" }, {
            account: true,
            transform: pick({
                id: "id",
                name: "name",
                mimeType: "mimeType",
                modifiedTime: "modifiedTime",
                owners: "owners",
            }),
        }),
        cap("drive.document.read", "Read a Google Doc as plain text.", "READ", ["drive.readonly"], [P.s("fileId", true, 200)], { method: "GET", path: "/files/{fileId}/export?mimeType=text%2Fplain" }, {
            account: true,
            transform: (j) => ({
                text: String(j["text"] ?? "").slice(0, 100_000),
            }),
        }),
        cap("drive.document.create", "Create an empty Google Doc.", "DRAFT", ["drive.file"], [P.s("name", true, 250), P.s("folderId", false, 200)], {
            method: "POST",
            path: "/files",
            build: (p) => ({
                name: p["name"],
                mimeType: "application/vnd.google-apps.document",
                ...(p["folderId"] ? { parents: [p["folderId"]] } : {}),
            }),
        }, {
            account: true,
            sandbox: "ALLOW",
            transform: pick({ id: "id", name: "name" }),
        }),
        cap("drive.folder.create", "Create a folder.", "WRITE", ["drive.file"], [P.s("name", true, 250), P.s("parentId", false, 200)], {
            method: "POST",
            path: "/files",
            build: (p) => ({
                name: p["name"],
                mimeType: "application/vnd.google-apps.folder",
                ...(p["parentId"] ? { parents: [p["parentId"]] } : {}),
            }),
        }, { account: true, transform: pick({ id: "id", name: "name" }) }),
        unavailable("drive.document.update", "Update document content.", "WRITE", "content updates need the Docs API scope, which is not implemented"),
    ],
};
export const GMAIL = {
    ...GOOGLE_COMMON,
    connectorId: "gmail",
    provider: "Google",
    name: "Gmail",
    description: "Search and read mail; draft messages; send only where explicitly approved.",
    providerApiVersion: "v1",
    family: "email",
    scopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.modify",
    ],
    oauth: {
        ...GOOGLE_OAUTH,
        scopes: [
            "https://www.googleapis.com/auth/gmail.readonly",
            "https://www.googleapis.com/auth/gmail.compose",
            "https://www.googleapis.com/auth/gmail.modify",
        ],
    },
    baseUrl: "https://gmail.googleapis.com/gmail/v1/users/me",
    allowedHosts: ["gmail.googleapis.com"],
    events: ["message.received"],
    probe: "email.label.list",
    capabilities: [
        cap("email.search", "Search messages.", "READ", ["gmail.readonly"], [P.s("q", true, 500), P.n("maxResults")], { method: "GET", path: "/messages", query: ["q", "maxResults"] }, {
            account: true,
            transform: pickList("messages", { id: "id", threadId: "threadId" }),
        }),
        cap("email.read", "Read one message (headers and plain text).", "READ", ["gmail.readonly"], [P.s("id", true, 100)], { method: "GET", path: "/messages/{id}?format=full" }, {
            account: true,
            transform: (m) => ({
                id: m["id"],
                from: header(m, "From"),
                to: header(m, "To"),
                subject: header(m, "Subject"),
                date: header(m, "Date"),
                snippet: m["snippet"],
                text: bodyText(m),
            }),
        }),
        cap("email.thread.read", "Read a thread.", "READ", ["gmail.readonly"], [P.s("id", true, 100)], { method: "GET", path: "/threads/{id}?format=metadata" }, {
            account: true,
            transform: (t) => ({
                id: t["id"],
                messages: (t["messages"] ?? [])
                    .slice(0, 50)
                    .map((m) => ({
                    id: m["id"],
                    from: header(m, "From"),
                    subject: header(m, "Subject"),
                    snippet: m["snippet"],
                })),
            }),
        }),
        cap("email.label.list", "List labels.", "READ", ["gmail.readonly"], [], { method: "GET", path: "/labels" }, {
            account: true,
            transform: pickList("labels", { id: "id", name: "name" }),
        }),
        cap("email.draft", "Create a draft (nothing is sent).", "DRAFT", ["gmail.compose"], [
            P.s("to", true, 320),
            P.s("subject", true, 300),
            P.s("body", true, 20_000),
            P.s("cc", false, 320),
        ], {
            method: "POST",
            path: "/drafts",
            build: (p) => ({ message: { raw: b64url(mime(p)) } }),
        }, { account: true, sandbox: "ALLOW", transform: pick({ id: "id" }) }),
        cap("email.send", "Send a message. External side effect.", "SEND", ["gmail.compose"], [
            P.s("to", true, 320),
            P.s("subject", true, 300),
            P.s("body", true, 20_000),
            P.s("cc", false, 320),
        ], {
            method: "POST",
            path: "/messages/send",
            build: (p) => ({ raw: b64url(mime(p)) }),
        }, {
            account: true,
            sandbox: { substitute: "email.draft" },
            transform: pick({ id: "id", threadId: "threadId" }),
        }),
        cap("email.archive", "Archive a message.", "WRITE", ["gmail.modify"], [P.s("id", true, 100)], {
            method: "POST",
            path: "/messages/{id}/modify",
            bodyStatic: { removeLabelIds: ["INBOX"] },
        }, { account: true, transform: pick({ id: "id" }) }),
        cap("email.label.modify", "Add or remove labels on a message.", "WRITE", ["gmail.modify"], [P.s("id", true, 100), P.l("addLabelIds", 10), P.l("removeLabelIds", 10)], {
            method: "POST",
            path: "/messages/{id}/modify",
            body: ["addLabelIds", "removeLabelIds"],
        }, { account: true, transform: pick({ id: "id" }) }),
    ],
};
export const GOOGLE_CALENDAR = {
    ...GOOGLE_COMMON,
    connectorId: "google-calendar",
    provider: "Google",
    name: "Google Calendar",
    description: "Events and availability; calendar changes are external side effects.",
    providerApiVersion: "v3",
    family: "calendar",
    scopes: [
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/calendar.events",
    ],
    oauth: {
        ...GOOGLE_OAUTH,
        scopes: [
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events",
        ],
    },
    baseUrl: "https://www.googleapis.com/calendar/v3",
    allowedHosts: ["www.googleapis.com"],
    events: ["event.changed"],
    probe: "calendar.event.search",
    capabilities: [
        cap("calendar.event.search", "Search events.", "READ", ["calendar.readonly"], [
            P.s("timeMin", false, 40),
            P.s("timeMax", false, 40),
            P.s("q", false, 200),
        ], {
            method: "GET",
            path: "/calendars/primary/events",
            query: ["timeMin", "timeMax", "q"],
        }, {
            account: true,
            transform: pickList("items", {
                id: "id",
                summary: "summary",
                start: "start.dateTime",
                end: "end.dateTime",
                status: "status",
            }),
        }),
        cap("calendar.availability.read", "Free/busy for a time range.", "READ", ["calendar.readonly"], [P.s("timeMin", true, 40), P.s("timeMax", true, 40)], {
            method: "POST",
            path: "/freeBusy",
            build: (p) => ({
                timeMin: p["timeMin"],
                timeMax: p["timeMax"],
                items: [{ id: "primary" }],
            }),
        }, { account: true, transform: (j) => ({ busy: getBusy(j) }) }),
        cap("calendar.event.create", "Create an event.", "WRITE", ["calendar.events"], [
            P.s("summary", true, 250),
            P.s("start", true, 40),
            P.s("end", true, 40),
            P.l("attendees", 50),
            P.s("description", false, 5000),
        ], {
            method: "POST",
            path: "/calendars/primary/events",
            build: (p) => ({
                summary: p["summary"],
                description: p["description"],
                start: { dateTime: p["start"] },
                end: { dateTime: p["end"] },
                ...(Array.isArray(p["attendees"])
                    ? {
                        attendees: p["attendees"].map((email) => ({
                            email,
                        })),
                    }
                    : {}),
            }),
        }, { account: true, transform: pick({ id: "id", url: "htmlLink" }) }),
        cap("calendar.event.update", "Update an event.", "WRITE", ["calendar.events"], [
            P.s("eventId", true, 100),
            P.s("summary", false, 250),
            P.s("start", false, 40),
            P.s("end", false, 40),
        ], {
            method: "PATCH",
            path: "/calendars/primary/events/{eventId}",
            build: (p) => ({
                ...(p["summary"] ? { summary: p["summary"] } : {}),
                ...(p["start"] ? { start: { dateTime: p["start"] } } : {}),
                ...(p["end"] ? { end: { dateTime: p["end"] } } : {}),
            }),
        }, { account: true, transform: pick({ id: "id", url: "htmlLink" }) }),
        cap("calendar.event.cancel", "Cancel (delete) an event.", "DELETE", ["calendar.events"], [P.s("eventId", true, 100)], { method: "DELETE", path: "/calendars/primary/events/{eventId}" }, { account: true, transform: () => ({ cancelled: true }) }),
        unavailable("calendar.invitation.respond", "Respond to an invitation.", "WRITE", "responding as an attendee is not implemented"),
    ],
};
function getBusy(j) {
    const cal = j["calendars"]?.["primary"];
    return cal?.["busy"] ?? [];
}
/* ---------------- Slack ---------------- */
const slackError = (j) => {
    const o = j;
    if (o?.["ok"] !== false)
        return undefined;
    const e = String(o["error"] ?? "error");
    if ([
        "invalid_auth",
        "not_authed",
        "token_revoked",
        "token_expired",
        "account_inactive",
    ].includes(e))
        return { kind: "AUTHENTICATION", message: `Slack: ${e}` };
    if ([
        "missing_scope",
        "not_in_channel",
        "channel_not_found",
        "restricted_action",
        "no_permission",
    ].includes(e))
        return { kind: "AUTHORIZATION", message: `Slack: ${e}` };
    if (e === "ratelimited")
        return { kind: "RATE_LIMIT", message: "Slack: ratelimited" };
    return { kind: "VALIDATION", message: `Slack: ${e}` };
};
export const SLACK = {
    connectorId: "slack",
    provider: "Slack",
    name: "Slack",
    description: "Channel discovery, reading and policy-controlled posting.",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "web-api",
    family: "chat",
    authMethod: "oauth2",
    authStyle: "bearer",
    scopes: ["channels:read", "channels:history", "chat:write", "search:read"],
    oauth: {
        authorizeUrl: "https://slack.com/oauth/v2/authorize",
        tokenUrl: "https://slack.com/api/oauth.v2.access",
        scopes: ["channels:read", "channels:history", "chat:write"],
        clientIdEnv: "AI_WORKFORCE_SLACK_OAUTH_CLIENT_ID",
        clientSecretEnv: "AI_WORKFORCE_SLACK_OAUTH_CLIENT_SECRET",
    },
    baseUrl: "https://slack.com/api",
    allowedHosts: ["slack.com"],
    events: ["message"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    probe: "chat.channel.list",
    capabilities: [
        cap("chat.channel.list", "List channels.", "READ", ["channels:read"], [P.n("limit")], { method: "GET", path: "/conversations.list", query: ["limit"] }, {
            account: true,
            bodyError: slackError,
            transform: pickList("channels", {
                id: "id",
                name: "name",
                isPrivate: "is_private",
                members: "num_members",
            }),
        }),
        cap("chat.read", "Read channel history.", "READ", ["channels:history"], [P.s("channel", true, 40), P.n("limit")], {
            method: "GET",
            path: "/conversations.history",
            query: ["channel", "limit"],
        }, {
            account: true,
            bodyError: slackError,
            transform: pickList("messages", {
                ts: "ts",
                user: "user",
                text: "text",
            }),
        }),
        cap("chat.thread.read", "Read a thread.", "READ", ["channels:history"], [P.s("channel", true, 40), P.s("ts", true, 40)], {
            method: "GET",
            path: "/conversations.replies",
            query: ["channel", "ts"],
        }, {
            account: true,
            bodyError: slackError,
            transform: pickList("messages", {
                ts: "ts",
                user: "user",
                text: "text",
            }),
        }),
        cap("chat.search", "Search messages.", "READ", ["search:read"], [P.s("query", true, 300)], { method: "GET", path: "/search.messages", query: ["query"] }, {
            account: true,
            bodyError: slackError,
            transform: pickList("messages.matches", {
                ts: "ts",
                channel: "channel.name",
                text: "text",
                user: "username",
            }),
        }),
        cap("chat.post", "Post a message to a channel. External side effect.", "SEND", ["chat:write"], [
            P.s("channel", true, 40),
            P.s("text", true, 4000),
            P.s("thread_ts", false, 40),
        ], {
            method: "POST",
            path: "/chat.postMessage",
            body: ["channel", "text", "thread_ts"],
        }, {
            account: true,
            bodyError: slackError,
            transform: pick({ channel: "channel", ts: "ts" }),
        }),
    ],
};
/* ---------------- Fireflies (replaceable meeting-intelligence provider) ---------------- */
const gqlError = (j) => {
    const errs = j?.["errors"];
    if (!Array.isArray(errs) || errs.length === 0)
        return undefined;
    const first = String(errs[0]["message"] ?? "error");
    if (/unauth|invalid.*key|token/i.test(first))
        return { kind: "AUTHENTICATION", message: first };
    if (/too many|rate/i.test(first))
        return { kind: "RATE_LIMIT", message: first };
    return { kind: "VALIDATION", message: first };
};
export const FIREFLIES = {
    connectorId: "fireflies",
    provider: "Fireflies",
    name: "Fireflies",
    description: "Meeting intelligence provider (replaceable): meetings, transcripts, summaries and action items.",
    kind: "graphql",
    version: "1.0.0",
    providerApiVersion: "graphql",
    family: "meeting-intelligence",
    authMethod: "api_key",
    authStyle: "bearer",
    scopes: [],
    baseUrl: "https://api.fireflies.ai/graphql",
    allowedHosts: ["api.fireflies.ai"],
    events: ["transcription.completed"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "METERED",
    probe: "meeting.list",
    capabilities: [
        cap("meeting.list", "Recent meetings.", "READ", [], [P.n("limit")], {
            method: "POST",
            path: "",
            graphql: {
                query: "query($limit:Int){ transcripts(limit:$limit){ id title date duration } }",
                variables: ["limit"],
            },
        }, {
            account: true,
            bodyError: gqlError,
            transform: pickList("data.transcripts", {
                id: "id",
                title: "title",
                date: "date",
                duration: "duration",
            }),
        }),
        cap("meeting.transcript.read", "One transcript (sentences).", "READ", [], [P.s("id", true, 100)], {
            method: "POST",
            path: "",
            graphql: {
                query: "query($id:String!){ transcript(id:$id){ id title date sentences{ text speaker_name } } }",
                variables: ["id"],
            },
        }, {
            account: true,
            bodyError: gqlError,
            transform: (j) => getPath2(j, "data.transcript"),
        }),
        cap("meeting.summary.read", "Meeting summary.", "READ", [], [P.s("id", true, 100)], {
            method: "POST",
            path: "",
            graphql: {
                query: "query($id:String!){ transcript(id:$id){ id title summary{ overview keywords } } }",
                variables: ["id"],
            },
        }, {
            account: true,
            bodyError: gqlError,
            transform: (j) => getPath2(j, "data.transcript"),
        }),
        cap("meeting.actionitems.read", "Action items of a meeting.", "READ", [], [P.s("id", true, 100)], {
            method: "POST",
            path: "",
            graphql: {
                query: "query($id:String!){ transcript(id:$id){ id title summary{ action_items } } }",
                variables: ["id"],
            },
        }, {
            account: true,
            bodyError: gqlError,
            transform: (j) => getPath2(j, "data.transcript"),
        }),
    ],
};
function getPath2(j, p) {
    return p
        .split(".")
        .reduce((cur, k) => cur && typeof cur === "object"
        ? cur[k]
        : undefined, j);
}
/* ---------------- WordPress (DRAFT → REVIEW → APPROVAL → PUBLISH) ---------------- */
export const WORDPRESS = {
    connectorId: "wordpress",
    provider: "WordPress",
    name: "WordPress",
    description: "Site inspection and content: draft first, review, approval, then publish.",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "wp/v2",
    family: "cms",
    authMethod: "basic",
    authStyle: "basic",
    scopes: [],
    requiresBaseUrl: true,
    allowedHosts: [],
    events: ["post.published"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    probe: "cms.site.inspect",
    capabilities: [
        cap("cms.site.inspect", "Site name, description and namespaces.", "READ", [], [], { method: "GET", path: "/wp-json" }, {
            account: true,
            transform: pick({
                name: "name",
                description: "description",
                url: "url",
                namespaces: "namespaces",
            }),
        }),
        cap("cms.post.list", "List posts.", "READ", [], [P.s("status", false, 20), P.n("per_page")], {
            method: "GET",
            path: "/wp-json/wp/v2/posts",
            query: ["status", "per_page"],
        }, {
            account: true,
            transform: pickList("", {
                id: "id",
                title: "title.rendered",
                status: "status",
                link: "link",
                modified: "modified",
            }),
        }),
        cap("cms.post.read", "Read one post.", "READ", [], [P.n("id")], { method: "GET", path: "/wp-json/wp/v2/posts/{id}" }, {
            account: true,
            transform: pick({
                id: "id",
                title: "title.rendered",
                status: "status",
                content: "content.rendered",
                link: "link",
            }),
        }),
        cap("cms.page.list", "List pages.", "READ", [], [P.n("per_page")], { method: "GET", path: "/wp-json/wp/v2/pages", query: ["per_page"] }, {
            account: true,
            transform: pickList("", {
                id: "id",
                title: "title.rendered",
                status: "status",
                link: "link",
            }),
        }),
        cap("cms.media.list", "Media metadata.", "READ", [], [P.n("per_page")], { method: "GET", path: "/wp-json/wp/v2/media", query: ["per_page"] }, {
            account: true,
            transform: pickList("", {
                id: "id",
                title: "title.rendered",
                mimeType: "mime_type",
                url: "source_url",
            }),
        }),
        cap("cms.draft.create", "Create a DRAFT post (never published).", "DRAFT", [], [P.s("title", true, 300), P.s("content", true, 100_000)], {
            method: "POST",
            path: "/wp-json/wp/v2/posts",
            build: (p) => ({
                title: p["title"],
                content: p["content"],
                status: "draft",
            }),
        }, {
            account: true,
            sandbox: "ALLOW",
            transform: pick({ id: "id", status: "status", link: "link" }),
        }),
        cap("cms.post.update", "Update a post's content (status unchanged).", "WRITE", [], [P.n("id"), P.s("title", false, 300), P.s("content", false, 100_000)], {
            method: "POST",
            path: "/wp-json/wp/v2/posts/{id}",
            build: (p) => ({
                ...(p["title"] ? { title: p["title"] } : {}),
                ...(p["content"] ? { content: p["content"] } : {}),
            }),
        }, { account: true, transform: pick({ id: "id", status: "status" }) }),
        cap("cms.post.publish", "Publish a post. Public external side effect.", "PUBLISH", [], [P.n("id")], {
            method: "POST",
            path: "/wp-json/wp/v2/posts/{id}",
            bodyStatic: { status: "publish" },
        }, {
            account: true,
            sandbox: "DENY",
            transform: pick({ id: "id", status: "status", link: "link" }),
        }),
    ],
};
/* ---------------- Figma ---------------- */
const FIGMA_KEY = /^(?<key>[A-Za-z0-9]{10,40})$/;
export const FIGMA = {
    connectorId: "figma",
    provider: "Figma",
    name: "Figma",
    description: "File inspection, components and design context (read).",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "v1",
    family: "design",
    authMethod: "token",
    authStyle: "x-figma-token",
    scopes: ["file_content:read"],
    oauth: {
        authorizeUrl: "https://www.figma.com/oauth",
        tokenUrl: "https://api.figma.com/v1/oauth/token",
        scopes: ["file_content:read"],
        clientIdEnv: "AI_WORKFORCE_FIGMA_OAUTH_CLIENT_ID",
        clientSecretEnv: "AI_WORKFORCE_FIGMA_OAUTH_CLIENT_SECRET",
    },
    baseUrl: "https://api.figma.com",
    allowedHosts: ["api.figma.com"],
    events: ["file.updated"],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    capabilities: [
        cap("design.file.read", "File name, version and pages.", "READ", ["file_content:read"], [], { method: "GET", path: "/v1/files/{key}?depth=1" }, {
            resourcePattern: FIGMA_KEY,
            resourceHint: "figma file key",
            transform: pick({
                name: "name",
                lastModified: "lastModified",
                version: "version",
                pages: "document.children",
            }),
        }),
        cap("design.component.list", "Components in a file.", "READ", ["file_content:read"], [], { method: "GET", path: "/v1/files/{key}/components" }, {
            resourcePattern: FIGMA_KEY,
            resourceHint: "figma file key",
            transform: pickList("meta.components", {
                key: "key",
                name: "name",
                description: "description",
            }),
        }),
        unavailable("design.write", "Modify a design.", "WRITE", "the Figma REST API does not offer general write access; not implemented"),
    ],
};
/* ---------------- Canva ---------------- */
export const CANVA = {
    connectorId: "canva",
    provider: "Canva",
    name: "Canva",
    description: "Design discovery and metadata (read) through the Canva Connect API.",
    kind: "rest",
    version: "1.0.0",
    providerApiVersion: "rest/v1",
    family: "design",
    authMethod: "oauth2",
    authStyle: "bearer",
    scopes: ["design:meta:read", "asset:read"],
    oauth: {
        authorizeUrl: "https://www.canva.com/api/oauth/authorize",
        tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
        scopes: ["design:meta:read", "asset:read"],
        clientIdEnv: "AI_WORKFORCE_CANVA_OAUTH_CLIENT_ID",
        clientSecretEnv: "AI_WORKFORCE_CANVA_OAUTH_CLIENT_SECRET",
    },
    baseUrl: "https://api.canva.com/rest/v1",
    allowedHosts: ["api.canva.com"],
    events: [],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    costClass: "FREE",
    probe: "design.list",
    capabilities: [
        cap("design.list", "Designs the account can see.", "READ", ["design:meta:read"], [P.s("query", false, 200)], { method: "GET", path: "/designs", query: ["query"] }, {
            account: true,
            transform: pickList("items", {
                id: "id",
                title: "title",
                url: "urls.view_url",
                updatedAt: "updated_at",
            }),
        }),
        cap("design.read", "One design's metadata.", "READ", ["design:meta:read"], [P.s("id", true, 100)], { method: "GET", path: "/designs/{id}" }, {
            account: true,
            transform: pick({
                id: "design.id",
                title: "design.title",
                url: "design.urls.view_url",
            }),
        }),
        cap("asset.read", "One asset's metadata.", "READ", ["asset:read"], [P.s("id", true, 100)], { method: "GET", path: "/assets/{id}" }, {
            account: true,
            transform: pick({
                id: "asset.id",
                name: "asset.name",
                type: "asset.type",
            }),
        }),
        unavailable("design.create", "Create a design.", "WRITE", "content operations are not implemented; the connector is read-only"),
    ],
};
/* ---------------- Execution environments (boundary only) ---------------- */
export const DOCKER = {
    connectorId: "docker",
    provider: "Docker",
    name: "Docker (execution environment)",
    description: "An execution environment, not a SaaS integration. Declared as a boundary: execution happens only through the governed environment adapters.",
    kind: "environment",
    version: "0.1.0",
    providerApiVersion: "n/a",
    family: "execution-environment",
    authMethod: "none",
    authStyle: "none",
    scopes: [],
    allowedHosts: [],
    events: [],
    environments: ["DEVELOPMENT", "TEST"],
    costClass: "FREE",
    capabilities: [
        unavailable("container.inspect", "Inspect containers.", "READ", "not exposed through the hub; use the governed environment adapters"),
        unavailable("container.logs", "Read container logs.", "READ", "not exposed through the hub; use the governed environment adapters"),
        unavailable("container.create", "Create a container.", "WRITE", "needs strict resource and security policy; not implemented"),
        unavailable("container.run", "Run a command in a container.", "WRITE", "needs strict resource and security policy; not implemented"),
        unavailable("container.stop", "Stop a container.", "WRITE", "not implemented"),
    ],
};
export const BLENDER = {
    connectorId: "blender",
    provider: "Blender",
    name: "Blender / 3D tooling",
    description: "A controlled creative/execution environment, not a SaaS API. Declared as a boundary only.",
    kind: "environment",
    version: "0.1.0",
    providerApiVersion: "n/a",
    family: "creative-environment",
    authMethod: "none",
    authStyle: "none",
    scopes: [],
    allowedHosts: [],
    events: [],
    environments: ["DEVELOPMENT", "TEST"],
    costClass: "FREE",
    capabilities: [
        unavailable("scene.inspect", "Inspect a scene.", "READ", "runs only inside a controlled environment, which is not configured"),
        unavailable("project.create", "Create a project.", "WRITE", "runs only inside a controlled environment, which is not configured"),
        unavailable("asset.generate", "Generate an asset.", "WRITE", "runs only inside a controlled environment, which is not configured"),
        unavailable("render.run", "Render.", "WRITE", "runs only inside a controlled environment, which is not configured"),
        unavailable("script.run", "Run an automation script.", "WRITE", "arbitrary scripts are never executed outside a sandboxed environment"),
    ],
};
export const BUILTIN_MANIFESTS = Object.freeze([
    GITHUB,
    FIREBASE,
    GOOGLE_DRIVE,
    GMAIL,
    GOOGLE_CALENDAR,
    SLACK,
    FIREFLIES,
    WORDPRESS,
    FIGMA,
    CANVA,
    DOCKER,
    BLENDER,
]);
export function manifestOf(connectorId) {
    return BUILTIN_MANIFESTS.find((m) => m.connectorId === connectorId);
}
