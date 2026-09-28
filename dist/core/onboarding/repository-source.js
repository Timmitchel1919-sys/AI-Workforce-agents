import { parseProjectRepositoryRef } from "../registry/project-repository-ref.js";
import { isContentAllowlisted } from "./discovery.js";
export const environmentGitHubCredential = {
    token: () => {
        const value = process.env["AI_WORKFORCE_GITHUB_READ_TOKEN"];
        return value && value.trim() !== "" ? value.trim() : undefined;
    },
};
const API = "https://api.github.com";
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;
export class GitHubRepositoryReader {
    providers = ["github"];
    fetchImpl;
    credentials;
    maxContentFiles;
    maxFileBytes;
    timeoutMs;
    constructor(options = {}) {
        this.fetchImpl =
            options.fetch ?? globalThis.fetch;
        this.credentials = options.credentials ?? environmentGitHubCredential;
        this.maxContentFiles = options.maxContentFiles ?? 30;
        this.maxFileBytes = options.maxFileBytes ?? 200_000;
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }
    get privateAccess() {
        return this.credentials.token() !== undefined;
    }
    async read(request) {
        if (request.provider !== "github") {
            return {
                ok: false,
                code: "unsupported_provider",
                message: `provider "${request.provider}" has no repository reader`,
            };
        }
        const target = parseGitHubTarget(request.url);
        if (!target) {
            return {
                ok: false,
                code: "invalid_reference",
                message: "repository must be a credential-free https://github.com/<owner>/<name> URL",
            };
        }
        if (request.branch !== undefined && !BRANCH.test(request.branch)) {
            return {
                ok: false,
                code: "invalid_reference",
                message: "invalid branch name",
            };
        }
        const { owner, name } = target;
        const base = `${API}/repos/${owner}/${name}`;
        const repo = await this.get(base);
        if (!repo.ok)
            return repo.failure;
        const info = repo.value;
        const defaultBranch = typeof info.default_branch === "string" &&
            BRANCH.test(info.default_branch)
            ? info.default_branch
            : undefined;
        const branch = request.branch ?? defaultBranch;
        if (!branch) {
            return {
                ok: false,
                code: "unavailable",
                message: "default branch unavailable",
            };
        }
        const branchInfo = await this.get(`${base}/branches/${encodeURIComponent(branch)}`);
        if (!branchInfo.ok)
            return branchInfo.failure;
        const commit = branchInfo.value.commit;
        const commitSha = commit?.sha;
        const treeSha = commit?.commit?.tree?.sha;
        if (!isSha(commitSha) || !isSha(treeSha)) {
            return {
                ok: false,
                code: "unavailable",
                message: "branch commit unavailable",
            };
        }
        const tree = await this.get(`${base}/git/trees/${treeSha}?recursive=1`);
        if (!tree.ok)
            return tree.failure;
        const treeBody = tree.value;
        const entries = Array.isArray(treeBody.tree) ? treeBody.tree : [];
        const paths = [];
        const fetchable = [];
        for (const entry of entries) {
            if (typeof entry.path !== "string" || !safePath(entry.path))
                continue;
            paths.push(entry.path);
            if (entry.type === "blob" &&
                isContentAllowlisted(entry.path) &&
                (entry.size ?? 0) <= this.maxFileBytes) {
                fetchable.push(entry.path);
            }
        }
        // Root manifests first, then nested ones, capped.
        fetchable.sort((a, b) => a.split("/").length - b.split("/").length);
        const files = {};
        for (const path of fetchable.slice(0, this.maxContentFiles)) {
            const text = await this.raw(`${base}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${commitSha}`);
            if (text !== undefined)
                files[path] = text.slice(0, this.maxFileBytes);
        }
        return {
            ok: true,
            evidence: {
                provider: "github",
                url: `https://github.com/${owner}/${name}`,
                visibility: info.private === true
                    ? "private"
                    : info.private === false
                        ? "public"
                        : "unknown",
                defaultBranch: defaultBranch ?? branch,
                branch,
                commit: commitSha,
                paths,
                truncated: treeBody.truncated === true,
                files,
            },
        };
    }
    headers(accept) {
        const headers = {
            accept,
            "user-agent": "ai-workforce-onboarding",
            "x-github-api-version": "2022-11-28",
        };
        const token = this.credentials.token();
        if (token)
            headers["authorization"] = `Bearer ${token}`;
        return headers;
    }
    async get(url) {
        try {
            const response = await this.fetchImpl(url, {
                headers: this.headers("application/vnd.github+json"),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            if (response.ok)
                return { ok: true, value: await response.json() };
            return {
                ok: false,
                failure: this.failureFor(response.status, response.headers.get("x-ratelimit-remaining")),
            };
        }
        catch {
            return {
                ok: false,
                failure: {
                    ok: false,
                    code: "unavailable",
                    message: "the repository provider could not be reached",
                },
            };
        }
    }
    async raw(url) {
        try {
            const response = await this.fetchImpl(url, {
                headers: this.headers("application/vnd.github.raw+json"),
                signal: AbortSignal.timeout(this.timeoutMs),
            });
            return response.ok ? await response.text() : undefined;
        }
        catch {
            return undefined;
        }
    }
    failureFor(status, rateRemaining) {
        if (status === 404) {
            return {
                ok: false,
                code: "not_found_or_private",
                message: this.privateAccess
                    ? "repository not found, or the configured GitHub credential cannot read it"
                    : "repository not found or private: private repositories need the server-side GitHub integration, which is not configured",
            };
        }
        if (status === 401) {
            return {
                ok: false,
                code: "unauthorized",
                message: "the configured GitHub credential was rejected",
            };
        }
        if (status === 403 || status === 429) {
            return rateRemaining === "0" || status === 429
                ? {
                    ok: false,
                    code: "rate_limited",
                    message: "the GitHub API rate limit was reached; retry later",
                }
                : {
                    ok: false,
                    code: "unauthorized",
                    message: "access to the repository was denied",
                };
        }
        return {
            ok: false,
            code: "unavailable",
            message: `the repository provider returned an error (${status})`,
        };
    }
}
/** A reader that reports nothing is readable (no provider configured). */
export class UnavailableRepositoryReader {
    providers = [];
    privateAccess = false;
    async read() {
        return {
            ok: false,
            code: "unsupported_provider",
            message: "no repository reader is configured",
        };
    }
}
/** Exactly `https://github.com/<owner>/<name>` (optional `.git`, trailing `/`). */
export function parseGitHubTarget(url) {
    const ref = parseProjectRepositoryRef({ url, defaultBranch: "main" });
    if (!ref)
        return undefined;
    const parsed = new URL(ref.url);
    if (parsed.hostname.toLowerCase() !== "github.com")
        return undefined;
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length !== 2)
        return undefined;
    const owner = segments[0];
    const name = segments[1].replace(/\.git$/i, "");
    if (!/^[A-Za-z0-9-]{1,39}$/.test(owner))
        return undefined;
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(name) || name === "." || name === "..") {
        return undefined;
    }
    return { owner, name };
}
function isSha(value) {
    return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}
/** Repository-relative path with no traversal or control characters. */
function safePath(path) {
    return (path.length > 0 &&
        path.length < 400 &&
        !path.startsWith("/") &&
        !path.split("/").some((segment) => segment === ".." || segment === "") &&
        // eslint-disable-next-line no-control-regex
        !/[\u0000-\u001f]/.test(path));
}
