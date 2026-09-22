function safeProcessEnv() {
    try {
        return globalThis.process?.env ?? {};
    }
    catch {
        return {};
    }
}
export function loadMoneyMindConfig(input = {}, env = safeProcessEnv()) {
    const repoPath = (input.repoPath ?? env.MONEY_MIND_REPO_PATH ?? "").trim();
    if (!repoPath)
        return undefined;
    return { repoPath };
}
