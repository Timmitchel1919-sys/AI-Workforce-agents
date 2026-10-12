export function parseVersion(v) {
    const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v).trim());
    return m
        ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
        : undefined;
}
export function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    if (!x || !y)
        return 0;
    return x.major - y.major || x.minor - y.minor || x.patch - y.patch;
}
export function satisfies(version, range) {
    const v = parseVersion(version);
    if (!v)
        return false;
    const r = (range ?? "*").trim();
    if (r === "" || r === "*")
        return true;
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(\d{1,6}\.\d{1,6}\.\d{1,6})$/.exec(r);
    if (!m)
        return false;
    const op = m[1] ?? "=";
    const base = m[2];
    const c = compareVersions(version, base);
    switch (op) {
        case "=":
            return c === 0;
        case ">=":
            return c >= 0;
        case ">":
            return c > 0;
        case "<=":
            return c <= 0;
        case "<":
            return c < 0;
        case "~": {
            const b = parseVersion(base);
            return c >= 0 && v.major === b.major && v.minor === b.minor;
        }
        case "^": {
            const b = parseVersion(base);
            if (c < 0)
                return false;
            if (b.major > 0)
                return v.major === b.major;
            if (b.minor > 0)
                return v.major === 0 && v.minor === b.minor;
            return v.major === 0 && v.minor === 0 && v.patch === b.patch;
        }
        default:
            return false;
    }
}
export function isValidRange(range) {
    if (range === undefined)
        return true;
    const r = range.trim();
    return (r === "" ||
        r === "*" ||
        /^(\^|~|>=|<=|>|<|=)?\s*\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(r));
}
