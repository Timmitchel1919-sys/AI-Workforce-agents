const BLOCKED_PACKAGES = new Set([
    "event-stream", // Known compromised historical package
    "flatmap-stream",
    "pepipost",
    "shazam-api",
]);
const FORBIDDEN_PATTERNS = [
    /^eval-/i,
    /-malicious$/i,
    /^typosquat-/i,
];
/**
 * Dependency admission policy engine (Step 10 & 20).
 * Prevents AI agents and developers from casually installing untrusted,
 * typo-squatted, or compromised npm packages.
 */
export class PackageAdmissionPolicy {
    evaluate(request) {
        const pkgName = request.packageName.toLowerCase().trim();
        // 1. Explicit blacklists
        if (BLOCKED_PACKAGES.has(pkgName)) {
            return {
                allowed: false,
                packageName: request.packageName,
                requestedVersion: request.requestedVersion,
                reason: `Package '${request.packageName}' is explicitly blacklisted due to known supply-chain compromises.`,
                decidedAt: new Date().toISOString(),
            };
        }
        // 2. Pattern matching
        for (const pattern of FORBIDDEN_PATTERNS) {
            if (pattern.test(pkgName)) {
                return {
                    allowed: false,
                    packageName: request.packageName,
                    requestedVersion: request.requestedVersion,
                    reason: `Package '${request.packageName}' matches suspicious package naming pattern.`,
                    decidedAt: new Date().toISOString(),
                };
            }
        }
        // 3. Reason requirement
        if (!request.reason || request.reason.trim().length < 15) {
            return {
                allowed: false,
                packageName: request.packageName,
                requestedVersion: request.requestedVersion,
                reason: "Package admission requires a detailed technical justification (minimum 15 characters).",
                decidedAt: new Date().toISOString(),
            };
        }
        return {
            allowed: true,
            packageName: request.packageName,
            requestedVersion: request.requestedVersion,
            reason: "Package admission policy criteria satisfied.",
            decidedAt: new Date().toISOString(),
        };
    }
}
