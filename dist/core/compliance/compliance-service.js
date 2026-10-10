import { createId, now } from "../shared.js";
export class ComplianceService {
    controlDefs = new Map();
    controlInstances = new Map();
    evidence = new Map();
    testRuns = new Map();
    createControlDefinition(def) {
        const cd = {
            ...def,
            controlId: createId("ctrl"),
            createdAt: now(),
            updatedAt: now(),
        };
        this.controlDefs.set(cd.controlId, cd);
        return cd;
    }
    getControlDefinition(controlId) {
        return this.controlDefs.get(controlId);
    }
    listControlDefinitions() {
        return Array.from(this.controlDefs.values());
    }
    createControlInstance(inst) {
        const ci = {
            ...inst,
            instanceId: createId("ci"),
        };
        this.controlInstances.set(ci.instanceId, ci);
        return ci;
    }
    getControlInstances(orgId) {
        return Array.from(this.controlInstances.values()).filter(c => c.organizationId === orgId);
    }
    addEvidence(ev) {
        const e = {
            ...ev,
            evidenceId: createId("ev"),
        };
        this.evidence.set(e.evidenceId, e);
        return e;
    }
    getEvidence(orgId) {
        return Array.from(this.evidence.values()).filter(e => e.organizationId === orgId);
    }
    recordTestRun(tr) {
        const t = {
            ...tr,
            testId: createId("tst"),
        };
        this.testRuns.set(t.testId, t);
        return t;
    }
    getTestRuns(orgId) {
        return Array.from(this.testRuns.values()).filter(t => t.organizationId === orgId);
    }
    updateControlInstanceStatus(instanceId, status, effectiveness, freshness) {
        const ci = this.controlInstances.get(instanceId);
        if (!ci)
            throw new Error("Control instance not found");
        ci.status = status;
        if (effectiveness)
            ci.effectiveness = effectiveness;
        if (freshness)
            ci.evidenceFreshness = freshness;
        if (status === "IMPLEMENTED" || status === "EFFECTIVE") {
            ci.lastTestedAt = now();
        }
        return ci;
    }
}
