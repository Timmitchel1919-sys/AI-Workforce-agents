/** Wrap a definition + a plain handler into a `Tool`. */
export function makeInMemoryTool(definition, handler) {
    return {
        ...definition,
        async execute(input, context) {
            return handler(input, context);
        },
    };
}
/**
 * Build the two research tools (`research.search` / `research.fetch`) over a
 * fixed corpus, using the supplied definitions for policy metadata.
 */
export function mockResearchTools(corpus, definitions) {
    const docs = corpus.map((doc) => ({ ...doc }));
    const search = makeInMemoryTool(definitions.search, (input) => {
        const query = String(input?.query ?? "").toLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);
        if (terms.length === 0)
            return { results: [] };
        const results = docs
            .map((doc) => {
            const title = doc.title.toLowerCase();
            const body = doc.content.toLowerCase();
            const keywords = (doc.keywords ?? []).map((k) => k.toLowerCase());
            const score = terms.reduce((total, term) => total +
                (title.includes(term) ? 2 : 0) +
                (body.includes(term) ? 1 : 0) +
                (keywords.some((k) => k.includes(term)) ? 2 : 0), 0);
            return { doc, score };
        })
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)
            .map((row) => ({
            title: row.doc.title,
            reference: row.doc.reference,
            snippet: row.doc.content.slice(0, 160),
            sourceType: row.doc.sourceType,
        }));
        return { results };
    });
    const fetch = makeInMemoryTool(definitions.fetch, (input) => {
        const reference = String(input?.reference ?? "");
        const doc = docs.find((d) => d.reference === reference);
        if (!doc)
            return { reference, content: "", verified: false };
        return {
            reference,
            title: doc.title,
            content: doc.content,
            sourceType: doc.sourceType,
            reputation: doc.reputation,
        };
    });
    return { search, fetch };
}
