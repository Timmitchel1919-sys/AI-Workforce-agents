/**
 * Small text/JSON helpers shared by the model-facing General Agents
 * (Project Manager, Developer, QA). Pure, no dependencies. The Research Agent
 * keeps its own local copies (unchanged) to avoid touching working code.
 */
export function truncate(text, max) {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}
export function dedupe(values) {
    return [...new Set(values.filter((v) => typeof v === "string" && v.trim()))];
}
export function toStringArray(value) {
    return Array.isArray(value)
        ? value.filter((v) => typeof v === "string" && v.trim() !== "")
        : [];
}
/** Tolerant JSON-object extraction: try the whole text, then the first `{...}` span. */
export function extractJsonObject(text) {
    const parse = (candidate) => {
        try {
            const value = JSON.parse(candidate);
            return value && typeof value === "object" && !Array.isArray(value)
                ? value
                : null;
        }
        catch {
            return null;
        }
    };
    const direct = parse(text.trim());
    if (direct)
        return direct;
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    return start >= 0 && end > start ? parse(text.slice(start, end + 1)) : null;
}
