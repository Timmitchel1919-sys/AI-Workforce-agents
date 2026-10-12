/**
 * Facet extraction: a small, closed vocabulary of project facts (hosting,
 * theme, database, framework, auth …) read out of memory text. Two ACTIVE
 * decision memories of one project that state DIFFERENT values for the same
 * facet are a knowledge conflict. This is a heuristic, deliberately narrow: it
 * flags likely contradictions for a human, it does not understand arbitrary prose.
 */
const CLOSED = {
    deployment: [
        "firebase hosting",
        "cloud run",
        "vercel",
        "netlify",
        "github pages",
        "aws amplify",
        "app engine",
    ],
    database: [
        "firestore",
        "postgres",
        "postgresql",
        "mysql",
        "mongodb",
        "supabase",
        "sqlite",
    ],
    framework: ["react", "vue", "angular", "svelte", "next.js", "nextjs"],
    auth: ["firebase auth", "auth0", "oauth", "clerk", "supabase auth"],
};
const MIGRATION = /\b(migrat\w*|moved?|switch\w*|replac\w*|now)\b[^.]*\b(to|with|by)\b/i;
const NEGATION = /\b(not|never|no longer|don't|do not|without|geen)\b[^.]{0,20}$/i;
function mentions(text, values) {
    const lower = text.toLowerCase();
    const out = [];
    for (const value of values) {
        let from = 0;
        for (;;) {
            const at = lower.indexOf(value, from);
            if (at < 0)
                break;
            out.push({ value, at });
            from = at + value.length;
        }
    }
    return out.sort((a, b) => a.at - b.at);
}
/** Open-ended theme facet: "<X> theme" → X, minus any project words. */
function themeOf(text, drop) {
    const m = /\b(?:uses?|using|is|has|with|adopted?)\s+(?:the\s+)?([a-z0-9][a-z0-9 -]{1,48}?)\s+theme\b/i.exec(text);
    if (!m)
        return undefined;
    const words = m[1]
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => !drop.includes(w));
    return words.length > 0 ? words.join(" ") : undefined;
}
export function extractFacets(text, projectWords = []) {
    const facets = {};
    const drop = projectWords.map((w) => w.toLowerCase());
    for (const [facet, values] of Object.entries(CLOSED)) {
        const found = mentions(text, values).filter((m) => !NEGATION.test(text.slice(Math.max(0, m.at - 24), m.at)));
        const distinct = [...new Set(found.map((f) => f.value))];
        if (distinct.length === 0)
            continue;
        // "migrated from X to Y" states Y; otherwise the first value stated.
        const chosen = distinct.length > 1 && MIGRATION.test(text)
            ? found[found.length - 1].value
            : found[0].value;
        facets[facet] =
            chosen === "nextjs"
                ? "next.js"
                : chosen === "postgresql"
                    ? "postgres"
                    : chosen;
    }
    const theme = themeOf(text, drop);
    if (theme)
        facets["theme"] = theme;
    return facets;
}
/** Facets in which two memories disagree. */
export function disagreements(a, b) {
    const out = [];
    for (const facet of Object.keys(a)) {
        if (b[facet] !== undefined && b[facet] !== a[facet])
            out.push({ facet, a: a[facet], b: b[facet] });
    }
    return out;
}
