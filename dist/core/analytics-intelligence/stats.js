export const rate = (numerator, denominator) => ({
    value: denominator > 0 ? numerator / denominator : null,
    numerator,
    denominator,
});
export function median(values) {
    if (values.length === 0)
        return null;
    const s = [...values].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const mean = (values) => values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;
/** Wilson score interval (95%): a range for a proportion that stays honest at small samples. */
export function wilson(successes, n) {
    if (n === 0)
        return [0, 1];
    const z = 1.96;
    const p = successes / n;
    const denom = 1 + (z * z) / n;
    const centre = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return [
        Math.max(0, (centre - margin) / denom),
        Math.min(1, (centre + margin) / denom),
    ];
}
export function quality(sample, established = 8) {
    return sample === 0
        ? "NO_DATA"
        : sample < established
            ? "LOW_CONFIDENCE"
            : "ESTABLISHED";
}
/** Ordinary least squares over (0..n-1, y). Returns slope/intercept and the residual spread. */
export function linearTrend(ys) {
    const n = ys.length;
    if (n < 3)
        return null;
    const xs = ys.map((_, i) => i);
    const mx = mean(xs);
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        num += (xs[i] - mx) * (ys[i] - my);
        den += (xs[i] - mx) ** 2;
    }
    const slope = den === 0 ? 0 : num / den;
    const intercept = my - slope * mx;
    const residual = Math.sqrt(ys.reduce((s, y, i) => s + (y - (intercept + slope * i)) ** 2, 0) /
        Math.max(1, n - 2));
    return { slope, intercept, residual };
}
/** Monday 00:00 UTC of the week containing `iso`. */
export function weekStart(iso) {
    const d = new Date(iso);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
}
export function lastWeeks(nowIso, count) {
    const out = [];
    const start = new Date(weekStart(nowIso));
    for (let i = count - 1; i >= 0; i--) {
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() - i * 7);
        out.push(d.toISOString().slice(0, 10));
    }
    return out;
}
export const ms = (a, b) => {
    if (!a || !b)
        return null;
    const d = Date.parse(b) - Date.parse(a);
    return Number.isFinite(d) && d >= 0 ? d : null;
};
