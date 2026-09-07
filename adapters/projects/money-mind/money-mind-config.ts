/**
 * Explicit, fail-safe configuration for the real Money Mind filesystem
 * backend. Resolution order: explicit input -> `MONEY_MIND_REPO_PATH` env var
 * -> unavailable. This never throws — an unavailable configuration is a valid,
 * expected state (no local checkout on this machine, CI, a fresh clone) and
 * the wiring layer decides what to do (typically: don't register
 * `NodeMoneyMindRepo`, and Money Mind operations simply aren't offered).
 */
export interface MoneyMindConfig {
  repoPath: string;
}

export interface MoneyMindConfigInput {
  repoPath?: string;
}

type EnvLike = Record<string, string | undefined>;

function safeProcessEnv(): EnvLike {
  try {
    return (globalThis as { process?: { env?: EnvLike } }).process?.env ?? {};
  } catch {
    return {};
  }
}

export function loadMoneyMindConfig(
  input: MoneyMindConfigInput = {},
  env: EnvLike = safeProcessEnv(),
): MoneyMindConfig | undefined {
  const repoPath = (input.repoPath ?? env.MONEY_MIND_REPO_PATH ?? "").trim();
  if (!repoPath) return undefined;
  return { repoPath };
}
