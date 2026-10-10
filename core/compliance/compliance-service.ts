import type {
  ComplianceEvidence,
  ControlDefinition,
  ControlInstance,
  ControlTestRun,
  ControlStatus,
  EvidenceFreshness,
} from "../../contracts/compliance.js";
import { createId, now } from "../shared.js";

export class ComplianceService {
  private controlDefs = new Map<string, ControlDefinition>();
  private controlInstances = new Map<string, ControlInstance>();
  private evidence = new Map<string, ComplianceEvidence>();
  private testRuns = new Map<string, ControlTestRun>();

  createControlDefinition(
    def: Omit<ControlDefinition, "controlId" | "createdAt" | "updatedAt">,
  ): ControlDefinition {
    const cd: ControlDefinition = {
      ...def,
      controlId: createId("ctrl"),
      createdAt: now(),
      updatedAt: now(),
    };
    this.controlDefs.set(cd.controlId, cd);
    return cd;
  }

  getControlDefinition(controlId: string): ControlDefinition | undefined {
    return this.controlDefs.get(controlId);
  }

  listControlDefinitions(): ControlDefinition[] {
    return Array.from(this.controlDefs.values());
  }

  createControlInstance(
    inst: Omit<ControlInstance, "instanceId">,
  ): ControlInstance {
    const ci: ControlInstance = {
      ...inst,
      instanceId: createId("ci"),
    };
    this.controlInstances.set(ci.instanceId, ci);
    return ci;
  }

  getControlInstances(orgId: string): ControlInstance[] {
    return Array.from(this.controlInstances.values()).filter(
      (c) => c.organizationId === orgId,
    );
  }

  addEvidence(ev: Omit<ComplianceEvidence, "evidenceId">): ComplianceEvidence {
    const e: ComplianceEvidence = {
      ...ev,
      evidenceId: createId("ev"),
    };
    this.evidence.set(e.evidenceId, e);
    return e;
  }

  getEvidence(orgId: string): ComplianceEvidence[] {
    return Array.from(this.evidence.values()).filter(
      (e) => e.organizationId === orgId,
    );
  }

  recordTestRun(tr: Omit<ControlTestRun, "testId">): ControlTestRun {
    const t: ControlTestRun = {
      ...tr,
      testId: createId("tst"),
    };
    this.testRuns.set(t.testId, t);
    return t;
  }

  getTestRuns(orgId: string): ControlTestRun[] {
    return Array.from(this.testRuns.values()).filter(
      (t) => t.organizationId === orgId,
    );
  }

  updateControlInstanceStatus(
    instanceId: string,
    status: ControlStatus,
    effectiveness?: string,
    freshness?: EvidenceFreshness,
  ) {
    const ci = this.controlInstances.get(instanceId);
    if (!ci) throw new Error("Control instance not found");
    ci.status = status;
    if (effectiveness)
      ci.effectiveness = effectiveness as ControlInstance["effectiveness"];
    if (freshness) ci.evidenceFreshness = freshness;
    if (status === "IMPLEMENTED" || status === "EFFECTIVE") {
      ci.lastTestedAt = now();
    }
    return ci;
  }
}
