/** Honest default: nothing can execute until a real runtime is configured. */
export class UnavailableTaskRuntime {
    id = "unavailable";
    async execute() {
        return {
            kind: "failure",
            error: "no execution runtime is configured",
            classification: "APPROVAL",
        };
    }
}
/**
 * Evidence-based verification: a claimed success is verified only if it
 * carries evidence and every reported check passed; test tasks must report
 * checks; review tasks must carry a verdict.
 */
export class EvidenceVerifier {
    verify(task, claimed) {
        if (claimed.claimed !== "success")
            return { verified: false, detail: "no success claimed" };
        if (claimed.evidence.length === 0) {
            return { verified: false, detail: "success claimed without evidence" };
        }
        const failed = claimed.checks.filter((c) => !c.passed);
        if (failed.length > 0) {
            return {
                verified: false,
                detail: `failed checks: ${failed.map((c) => c.name).join(", ")}`,
            };
        }
        if (task.type === "TEST" && claimed.checks.length === 0) {
            return { verified: false, detail: "a test task must report its checks" };
        }
        if ((task.type === "REVIEW" || task.type === "SECURITY") &&
            claimed.verdict === undefined) {
            return { verified: false, detail: "a review task must report a verdict" };
        }
        return {
            verified: true,
            detail: `${claimed.evidence.length} evidence item(s), ${claimed.checks.length} check(s) passed`,
        };
    }
}
