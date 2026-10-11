/**
 * Agent action protocol (Layer 6).
 *
 * The model provider is text-in / text-out, so the loop speaks a small,
 * closed JSON protocol: the model replies with exactly ONE action object per
 * turn. Anything else is a malformed reply and is bounced back for repair —
 * it is never interpreted loosely, and nothing in a reply is ever executed
 * except through the governed tool session.
 */

export const AGENT_ACTIONS = [
  "list_tree",
  "read_file",
  "create_file",
  "update_file",
  "rename_file",
  "delete_file",
  "run_command",
  "list_capabilities",
  "use_capability",
  "finish",
] as const;
export type AgentActionName = (typeof AGENT_ACTIONS)[number];

export const FINISH_STATUSES = [
  "success",
  "blocked",
  "approved",
  "changes_requested",
] as const;
export type FinishStatus = (typeof FINISH_STATUSES)[number];

export type AgentAction =
  | { action: "list_tree"; path?: string }
  | { action: "read_file"; path: string }
  | { action: "create_file"; path: string; content: string }
  | {
      action: "update_file";
      path: string;
      content: string;
      expectedHash?: string;
    }
  | { action: "rename_file"; from: string; to: string }
  | { action: "delete_file"; path: string }
  | { action: "run_command"; command: string }
  | { action: "list_capabilities" }
  | {
      action: "use_capability";
      capability: string;
      parameters: Record<string, unknown>;
      resource?: string;
    }
  | {
      action: "finish";
      status: FinishStatus;
      summary: string;
      evidence?: string[];
    };

export type ParsedAction =
  | { ok: true; action: AgentAction; reason?: string }
  | { ok: false; error: string };

const MAX_REPLY_CHARS = 400_000;
const MAX_PATH = 300;
const MAX_COMMAND = 300;
const MAX_CONTENT = 200_000;
const MAX_SUMMARY = 2000;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_EVIDENCE_ITEM = 300;

/** The first balanced top-level JSON object in `text`, string-aware. */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function text(
  obj: Record<string, unknown>,
  key: string,
  max: number,
  { required = true, allowEmpty = false } = {},
): { value?: string; error?: string } {
  const v = obj[key];
  if (v === undefined || v === null) {
    return required ? { error: `"${key}" is required` } : {};
  }
  if (typeof v !== "string") return { error: `"${key}" must be a string` };
  if (!allowEmpty && v.trim() === "")
    return { error: `"${key}" must not be empty` };
  if (v.length > max) return { error: `"${key}" is too long (max ${max})` };
  if (key !== "content" && v.includes("\0"))
    return { error: `"${key}" contains an invalid character` };
  return { value: v };
}

/** Strictly validate one model reply into one action. */
export function parseAction(reply: string): ParsedAction {
  if (typeof reply !== "string" || reply.trim() === "")
    return { ok: false, error: "the reply was empty" };
  if (reply.length > MAX_REPLY_CHARS)
    return { ok: false, error: "the reply was too long" };
  const json = extractJsonObject(reply);
  if (!json)
    return { ok: false, error: "the reply did not contain a JSON object" };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "the JSON object could not be parsed" };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { ok: false, error: "the reply must be a JSON object" };
  const obj = raw as Record<string, unknown>;
  const name = obj["action"];
  if (
    typeof name !== "string" ||
    !(AGENT_ACTIONS as readonly string[]).includes(name)
  ) {
    return {
      ok: false,
      error: `"action" must be one of: ${AGENT_ACTIONS.join(", ")}`,
    };
  }
  const reasonField = text(obj, "reason", 300, { required: false });
  const reason = reasonField.value;
  const fail = (e: string | undefined): ParsedAction | undefined =>
    e ? { ok: false, error: e } : undefined;

  switch (name as AgentActionName) {
    case "list_tree": {
      const p = text(obj, "path", MAX_PATH, { required: false });
      return (
        fail(p.error) ?? {
          ok: true,
          action: {
            action: "list_tree",
            ...(p.value ? { path: p.value } : {}),
          },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "read_file":
    case "delete_file": {
      const p = text(obj, "path", MAX_PATH);
      return (
        fail(p.error) ?? {
          ok: true,
          action: {
            action: name as "read_file" | "delete_file",
            path: p.value!,
          },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "create_file": {
      const p = text(obj, "path", MAX_PATH);
      const c = text(obj, "content", MAX_CONTENT, { allowEmpty: true });
      return (
        fail(p.error) ??
        fail(c.error) ?? {
          ok: true,
          action: { action: "create_file", path: p.value!, content: c.value! },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "update_file": {
      const p = text(obj, "path", MAX_PATH);
      const c = text(obj, "content", MAX_CONTENT, { allowEmpty: true });
      const h = text(obj, "expectedHash", 80, { required: false });
      return (
        fail(p.error) ??
        fail(c.error) ??
        fail(h.error) ?? {
          ok: true,
          action: {
            action: "update_file",
            path: p.value!,
            content: c.value!,
            ...(h.value ? { expectedHash: h.value } : {}),
          },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "rename_file": {
      const f = text(obj, "from", MAX_PATH);
      const t = text(obj, "to", MAX_PATH);
      return (
        fail(f.error) ??
        fail(t.error) ?? {
          ok: true,
          action: { action: "rename_file", from: f.value!, to: t.value! },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "list_capabilities":
      return {
        ok: true,
        action: { action: "list_capabilities" },
        ...(reason ? { reason } : {}),
      };
    case "use_capability": {
      const cap = text(obj, "capability", 100);
      const res = text(obj, "resource", 300, { required: false });
      const params = obj["parameters"] ?? {};
      if (
        params === null ||
        typeof params !== "object" ||
        Array.isArray(params)
      )
        return { ok: false, error: '"parameters" must be an object' };
      if (JSON.stringify(params).length > 64_000)
        return { ok: false, error: '"parameters" is too large' };
      return (
        fail(cap.error) ??
        fail(res.error) ?? {
          ok: true,
          action: {
            action: "use_capability",
            capability: cap.value!,
            parameters: params as Record<string, unknown>,
            ...(res.value ? { resource: res.value } : {}),
          },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "run_command": {
      const c = text(obj, "command", MAX_COMMAND);
      return (
        fail(c.error) ?? {
          ok: true,
          action: { action: "run_command", command: c.value! },
          ...(reason ? { reason } : {}),
        }
      );
    }
    case "finish": {
      const status = obj["status"];
      if (
        typeof status !== "string" ||
        !(FINISH_STATUSES as readonly string[]).includes(status)
      ) {
        return {
          ok: false,
          error: `"status" must be one of: ${FINISH_STATUSES.join(", ")}`,
        };
      }
      const s = text(obj, "summary", MAX_SUMMARY);
      if (s.error) return { ok: false, error: s.error };
      const ev = obj["evidence"];
      let evidence: string[] | undefined;
      if (ev !== undefined) {
        if (
          !Array.isArray(ev) ||
          ev.length > MAX_EVIDENCE_ITEMS ||
          ev.some((e) => typeof e !== "string" || e.length > MAX_EVIDENCE_ITEM)
        ) {
          return {
            ok: false,
            error: `"evidence" must be at most ${MAX_EVIDENCE_ITEMS} short strings`,
          };
        }
        evidence = ev as string[];
      }
      return {
        ok: true,
        action: {
          action: "finish",
          status: status as FinishStatus,
          summary: s.value!,
          ...(evidence ? { evidence } : {}),
        },
        ...(reason ? { reason } : {}),
      };
    }
  }
}
