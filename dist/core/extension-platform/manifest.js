/**
 * Manifest validation. Extensions are declarative: this is also the "sandbox" — no executable
 * content, no secrets, no unknown permission scopes, bounded size. Pure functions.
 */
import { DEPENDENCY_KINDS, EXTENSION_LIMITS, EXTENSION_PERMISSION_CATALOG, EXTENSION_TYPES, } from "../../contracts/extension-platform.js";
import { RISK_LEVELS } from "../../contracts/security-governance.js";
import { containsSecret } from "../prompt-intelligence/secret-scan.js";
import { isValidRange, parseVersion } from "./semver.js";
const ID = /^[a-z][a-z0-9.-]{2,62}$/;
/** Keys that would smuggle executable content into a declarative manifest. */
const EXECUTABLE_KEYS = new Set([
    "code",
    "script",
    "eval",
    "js",
    "wasm",
    "exec",
    "onload",
    "handler",
]);
function walkKeys(value, path, out, depth = 0) {
    if (depth > 8) {
        out.push({ level: "ERROR", path, message: "nesting is too deep" });
        return;
    }
    if (Array.isArray(value)) {
        value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, out, depth + 1));
        return;
    }
    if (value && typeof value === "object") {
        for (const [k, v] of Object.entries(value)) {
            if (EXECUTABLE_KEYS.has(k.toLowerCase()))
                out.push({
                    level: "ERROR",
                    path: `${path}.${k}`,
                    message: "extensions are declarative: executable content is not accepted",
                });
            walkKeys(v, `${path}.${k}`, out, depth + 1);
        }
    }
}
const text = (v, max = EXTENSION_LIMITS.textField) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const list = (v, max = EXTENSION_LIMITS.listItems) => Array.isArray(v) &&
    v.length <= max &&
    v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 300);
export function validateManifest(input) {
    const findings = [];
    const err = (path, message) => findings.push({ level: "ERROR", path, message });
    const warn = (path, message) => findings.push({ level: "WARNING", path, message });
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        err("manifest", "the manifest must be an object");
        return { findings };
    }
    let serialized = "";
    try {
        serialized = JSON.stringify(input);
    }
    catch {
        err("manifest", "the manifest is not valid JSON data");
        return { findings };
    }
    if (serialized.length > EXTENSION_LIMITS.manifestBytes)
        err("manifest", "the manifest is too large");
    if (containsSecret(serialized))
        err("manifest", "the manifest contains something that looks like a secret");
    walkKeys(input, "manifest", findings);
    const m = input;
    if (typeof m["id"] !== "string" || !ID.test(m["id"]))
        err("id", "id must be lowercase letters, digits, '.' or '-' (3–63 characters)");
    if (!text(m["name"], 80))
        err("name", "name is required (max 80 characters)");
    if (!text(m["description"], 500))
        err("description", "description is required (max 500 characters)");
    if (typeof m["version"] !== "string" || !parseVersion(m["version"]))
        err("version", "version must be x.y.z");
    if (!EXTENSION_TYPES.includes(m["type"]))
        err("type", `type must be one of ${EXTENSION_TYPES.join(", ")}`);
    if (!text(m["author"], 120))
        err("author", "author/source is required");
    if (!list(m["capabilities"], EXTENSION_LIMITS.capabilities) ||
        m["capabilities"].length === 0)
        err("capabilities", "at least one capability is required");
    const deps = m["dependencies"] ?? [];
    if (!Array.isArray(deps) || deps.length > EXTENSION_LIMITS.dependencies)
        err("dependencies", "dependencies must be a short list");
    else
        deps.forEach((d, i) => {
            const dep = d;
            if (!dep ||
                !DEPENDENCY_KINDS.includes(dep["kind"]))
                err(`dependencies[${i}].kind`, `kind must be one of ${DEPENDENCY_KINDS.join(", ")}`);
            if (typeof dep?.["id"] !== "string" ||
                dep["id"].length === 0 ||
                dep["id"].length > 120)
                err(`dependencies[${i}].id`, "id is required");
            if (dep?.["range"] !== undefined &&
                (typeof dep["range"] !== "string" || !isValidRange(dep["range"])))
                err(`dependencies[${i}].range`, "range must look like ^1.2.0, ~1.2.0, >=1.0.0 or *");
        });
    const perms = m["permissions"] ?? [];
    if (!list(perms, 30))
        err("permissions", "permissions must be a list of scopes");
    else {
        const catalog = new Map(EXTENSION_PERMISSION_CATALOG.map((p) => [p.scope, p]));
        for (const p of perms) {
            const entry = catalog.get(p);
            if (!entry)
                err("permissions", `unknown permission scope "${p}"`);
            else if (!entry.grantable)
                err("permissions", `"${p}" is never granted to an extension`);
        }
        if (new Set(perms).size !== perms.length)
            warn("permissions", "duplicate scopes");
    }
    if (m["compatibility"] !== undefined) {
        const c = m["compatibility"];
        if (typeof c !== "object" ||
            (c["platform"] !== undefined &&
                (typeof c["platform"] !== "string" || !isValidRange(c["platform"]))))
            err("compatibility.platform", "platform must be a version range");
    }
    if (m["spec"] === undefined ||
        typeof m["spec"] !== "object" ||
        m["spec"] === null)
        err("spec", "spec is required");
    else if (EXTENSION_TYPES.includes(m["type"]))
        validateSpec(m["type"], m["spec"], err, warn);
    const hasError = findings.some((f) => f.level === "ERROR");
    if (hasError)
        return { findings };
    return {
        manifest: {
            id: m["id"],
            name: m["name"].trim(),
            description: m["description"].trim(),
            version: m["version"],
            type: m["type"],
            author: m["author"].trim(),
            capabilities: m["capabilities"],
            dependencies: (m["dependencies"] ??
                []),
            permissions: (m["permissions"] ?? []),
            ...(m["compatibility"]
                ? {
                    compatibility: m["compatibility"],
                }
                : {}),
            ...(m["configSchema"]
                ? {
                    configSchema: m["configSchema"],
                }
                : {}),
            spec: m["spec"],
        },
        findings,
    };
}
function schemaOk(s) {
    const o = s;
    return (!!o &&
        o["type"] === "object" &&
        typeof o["properties"] === "object" &&
        o["properties"] !== null &&
        Object.keys(o["properties"]).length <= 30);
}
function validateSpec(type, spec, err, warn) {
    if (type === "SKILL") {
        const s = spec;
        if (!text(s.capability, 200))
            err("spec.capability", "capability is required");
        if (!text(s.instructions, 8000))
            err("spec.instructions", "instructions are required (max 8000 characters)");
        for (const k of [
            "prerequisites",
            "tools",
            "expectedOutputs",
            "validation",
        ])
            if (!list(s[k]))
                err(`spec.${k}`, `${k} must be a list`);
        if (Array.isArray(s.expectedOutputs) && s.expectedOutputs.length === 0)
            err("spec.expectedOutputs", "define at least one expected output");
        if (Array.isArray(s.validation) && s.validation.length === 0)
            warn("spec.validation", "no validation requirement is defined");
    }
    else if (type === "AGENT") {
        const s = spec;
        if (typeof s.agentId !== "string" || !ID.test(s.agentId))
            err("spec.agentId", "agentId must be lowercase letters, digits, '.' or '-'");
        if (!text(s.role, 200))
            err("spec.role", "role is required");
        if (!list(s.capabilities) || s.capabilities.length === 0)
            err("spec.capabilities", "at least one capability is required");
        if (!list(s.tools))
            err("spec.tools", "tools must be a list");
        if (!text(s.inputContract, 2000))
            err("spec.inputContract", "input contract is required");
        if (!text(s.outputContract, 2000))
            err("spec.outputContract", "output contract is required");
        if (!list(s.validation))
            err("spec.validation", "validation must be a list");
        if (!s.modelRequirements || typeof s.modelRequirements !== "object")
            err("spec.modelRequirements", "model requirements are required");
        if (!s.costProfile ||
            !["low", "medium", "high"].includes(String(s.costProfile.tier)))
            err("spec.costProfile", "cost profile tier must be low, medium or high");
    }
    else if (type === "TOOL") {
        const s = spec;
        if (typeof s.toolId !== "string" || !ID.test(s.toolId))
            err("spec.toolId", "toolId must be lowercase letters, digits, '.' or '-'");
        if (!text(s.purpose, 500))
            err("spec.purpose", "purpose is required");
        if (!schemaOk(s.inputSchema))
            err("spec.inputSchema", "an object input schema is required");
        if (!schemaOk(s.outputSchema))
            err("spec.outputSchema", "an object output schema is required");
        if (!RISK_LEVELS.includes(s.risk))
            err("spec.risk", `risk must be one of ${RISK_LEVELS.join(", ")}`);
        if (!["none", "vault", "oauth"].includes(String(s.authentication)))
            err("spec.authentication", "authentication must be none, vault or oauth");
        if (!["gateway", "sandbox", "read_only"].includes(String(s.environment)))
            err("spec.environment", "execution environment must be gateway, sandbox or read_only");
        if (!s.audit ||
            typeof s.audit.logInputs !== "boolean" ||
            typeof s.audit.logOutputs !== "boolean")
            err("spec.audit", "audit requirements are required");
        if (s.environment === "gateway" && !s.backingCapability)
            err("spec.backingCapability", "a gateway tool must name the Tool Gateway capability that performs the work");
    }
    else if (type === "WORKFLOW") {
        const s = spec;
        const stages = s.stages;
        if (!Array.isArray(stages) ||
            stages.length === 0 ||
            stages.length > EXTENSION_LIMITS.stages) {
            err("spec.stages", "a workflow needs 1–30 stages");
            return;
        }
        const ids = new Set();
        stages.forEach((st, i) => {
            if (!st ||
                typeof st.id !== "string" ||
                !/^[a-z][a-z0-9_-]{0,40}$/.test(st.id))
                err(`spec.stages[${i}].id`, "stage id is required");
            else if (ids.has(st.id))
                err(`spec.stages[${i}].id`, "duplicate stage id");
            else
                ids.add(st.id);
            if (!text(st?.title, 200))
                err(`spec.stages[${i}].title`, "title is required");
            if (!text(st?.taskType, 60))
                err(`spec.stages[${i}].taskType`, "task type is required");
        });
        // dependencies must point at EARLIER stages: that also rules out cycles.
        const seen = new Set();
        stages.forEach((st, i) => {
            for (const d of st?.dependsOn ?? [])
                if (!seen.has(d))
                    err(`spec.stages[${i}].dependsOn`, `"${d}" must be an earlier stage`);
            if (st?.id)
                seen.add(st.id);
        });
    }
}
