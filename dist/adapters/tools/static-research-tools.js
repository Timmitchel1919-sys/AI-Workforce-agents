export class StaticResearchToolProvider {
    id;
    corpus;
    constructor(corpus, id = "static-research") {
        this.id = id;
        this.corpus = corpus.map((doc) => ({ ...doc }));
    }
    get tools() {
        return ["research.search", "research.fetch"];
    }
    async execute(request) {
        if (request.tool === "research.search") {
            return { output: { results: this.search(request.input) } };
        }
        if (request.tool === "research.fetch") {
            return { output: this.fetch(request.input) };
        }
        throw new Error(`unknown research tool: ${request.tool}`);
    }
    search(input) {
        const query = String(input?.query ?? "").toLowerCase();
        const terms = query.split(/\s+/).filter(Boolean);
        if (terms.length === 0)
            return [];
        return this.corpus
            .map((doc) => {
            const haystackTitle = doc.title.toLowerCase();
            const haystackBody = doc.content.toLowerCase();
            const keywords = (doc.keywords ?? []).map((k) => k.toLowerCase());
            const score = terms.reduce((total, term) => total +
                (haystackTitle.includes(term) ? 2 : 0) +
                (haystackBody.includes(term) ? 1 : 0) +
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
    }
    fetch(input) {
        const reference = String(input?.reference ?? "");
        const doc = this.corpus.find((d) => d.reference === reference);
        if (!doc) {
            return { reference, content: "", verified: false };
        }
        return {
            reference,
            title: doc.title,
            content: doc.content,
            sourceType: doc.sourceType,
            reputation: doc.reputation,
        };
    }
}
