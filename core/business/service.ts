/**
 * Business Operating Layer service.
 *
 * Separate from the Control Plane: it holds the organisational model (departments, managers,
 * workforce membership, objectives, KPIs, initiatives, decisions) and turns objectives into
 * execution PLAN PROPOSALS. It never starts a run, creates a task or a project, or talks to a
 * provider; agents, projects and workflows stay owned by their own registries (injected ports).
 * Nothing is hard-deleted: departments are archived and decisions are superseded, so history
 * stays intact.
 */
import { randomBytes } from "node:crypto";
import {
  BUSINESS_PRIORITIES,
  EXECUTIVE_FUNCTIONS,
  MEASURED_METRICS,
  OBJECTIVE_LEVELS,
  OBJECTIVE_STATUSES,
  type BoardView,
  type BusinessObjective,
  type BusinessPriority,
  type BusinessProfile,
  type DecisionRecord,
  type Department,
  type ExecutionPlanProposal,
  type ExecutiveFunction,
  type Initiative,
  type Kpi,
  type KpiStatus,
  type Measurement,
  type MeasuredMetric,
  type ObjectiveLevel,
  type ObjectiveStatus,
  type OrgNode,
  type PlanTask,
} from "../../contracts/business-layer.js";
import type { WorkflowStage } from "../../contracts/extension-platform.js";
import type { Repository } from "../../contracts/persistence.js";
import { SyncCache } from "../knowledge-memory/memory-service.js";
import type { GovernanceLedger } from "../security-governance/ledger.js";

export class BusinessError extends Error {
  constructor(
    public readonly code:
      "invalid_request" | "not_found" | "invalid_state" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "BusinessError";
  }
}

export interface BusinessRepos {
  profile: Repository<BusinessProfile>;
  departments: Repository<Department>;
  objectives: Repository<BusinessObjective>;
  initiatives: Repository<Initiative>;
  decisions: Repository<DecisionRecord>;
}

export interface BusinessPorts {
  projectExists(projectId: string): boolean;
  agentExists(agentId: string): boolean;
  measure(metric: MeasuredMetric, projectId?: string): Measurement;
  workflowTemplates(): {
    extensionId: string;
    name: string;
    version: string;
    stages: WorkflowStage[];
  }[];
  projectHealth?(
    projectId: string,
  ): { state: string; reasons: string[] } | undefined;
  /** Optional: keep an adopted decision in the Knowledge layer. */
  remember?(decision: DecisionRecord): void;
  ledger: GovernanceLedger;
  clock: () => string;
}

const DEFAULT_DEPARTMENTS: {
  name: string;
  executiveFunction: ExecutiveFunction;
  description: string;
}[] = [
  {
    name: "Engineering",
    executiveFunction: "TECHNOLOGY",
    description: "Builds and maintains software.",
  },
  {
    name: "IT",
    executiveFunction: "TECHNOLOGY",
    description: "Infrastructure, environments and devices.",
  },
  {
    name: "Finance",
    executiveFunction: "FINANCE",
    description: "Budget, cost and financial analysis.",
  },
  {
    name: "Marketing",
    executiveFunction: "PRODUCT",
    description: "Content, campaigns and communication.",
  },
  {
    name: "Operations",
    executiveFunction: "OPERATIONS",
    description: "Day-to-day delivery and process.",
  },
  {
    name: "Research",
    executiveFunction: "STRATEGY",
    description: "Investigation and analysis.",
  },
  {
    name: "Design",
    executiveFunction: "PRODUCT",
    description: "UI, UX, 3D and motion design.",
  },
  {
    name: "Business",
    executiveFunction: "STRATEGY",
    description: "Direction, planning and decisions.",
  },
  {
    name: "Security",
    executiveFunction: "SECURITY",
    description: "Security review and compliance.",
  },
];

const DEFAULT_STAGES: WorkflowStage[] = [
  { id: "analyze", title: "Analyse the request", taskType: "ANALYSIS" },
  {
    id: "plan",
    title: "Plan the change",
    taskType: "PLANNING",
    dependsOn: ["analyze"],
  },
  {
    id: "code",
    title: "Implement",
    taskType: "DEVELOPMENT",
    agentRole: "developer",
    dependsOn: ["plan"],
  },
  { id: "test", title: "Test", taskType: "TESTING", dependsOn: ["code"] },
  { id: "review", title: "Review", taskType: "REVIEW", dependsOn: ["test"] },
  {
    id: "security",
    title: "Security check",
    taskType: "SECURITY",
    dependsOn: ["review"],
  },
  {
    id: "approval",
    title: "Human approval",
    taskType: "APPROVAL",
    requiresApproval: true,
    dependsOn: ["security"],
  },
];

const id = (prefix: string) => `${prefix}-${randomBytes(4).toString("hex")}`;
const short = (
  v: unknown,
  name: string,
  max: number,
  required = true,
): string => {
  if (v === undefined || v === null || v === "") {
    if (required)
      throw new BusinessError("invalid_request", `${name} is required`);
    return "";
  }
  if (typeof v !== "string")
    throw new BusinessError("invalid_request", `${name} must be text`);
  const t = v.trim();
  if (required && t === "")
    throw new BusinessError("invalid_request", `${name} is required`);
  if (t.length > max)
    throw new BusinessError(
      "invalid_request",
      `${name} is too long (max ${max})`,
    );
  return t;
};
const oneOf = <T extends string>(
  v: unknown,
  list: readonly T[],
  name: string,
): T => {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v))
    throw new BusinessError(
      "invalid_request",
      `${name} must be one of ${list.join(", ")}`,
    );
  return v as T;
};
const num = (v: unknown, name: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new BusinessError("invalid_request", `${name} must be a number`);
  return v;
};
const isoDate = (v: unknown, name: string): string | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v)))
    throw new BusinessError("invalid_request", `${name} must be a date`);
  return v;
};

export function kpiStatus(kpi: Kpi, m: Measurement | undefined): KpiStatus {
  let current: number | null = null;
  let sample = 0;
  let note = "";
  if (kpi.source.kind === "MEASURED") {
    current = m?.value ?? null;
    sample = m?.sample ?? 0;
    note = m?.note ?? "";
  } else {
    const last = kpi.readings[kpi.readings.length - 1];
    current = last ? last.value : null;
    sample = kpi.readings.length;
    note = last
      ? `manual reading from ${last.at.slice(0, 10)}`
      : "no reading has been recorded";
  }
  const base = {
    kpiId: kpi.kpiId,
    name: kpi.name,
    unit: kpi.unit,
    target: kpi.target,
    sample,
  };
  if (current === null)
    return {
      ...base,
      current: null,
      attainmentPercent: null,
      state: "NO_DATA",
      note: note || "no data yet",
    };
  const { target } = kpi;
  const b = kpi.baseline;
  let pct: number;
  if (kpi.direction === "HIGHER_IS_BETTER") {
    const from = b ?? 0;
    pct =
      target === from
        ? current >= target
          ? 100
          : 0
        : ((current - from) / (target - from)) * 100;
  } else if (b !== undefined) {
    pct =
      b === target
        ? current <= target
          ? 100
          : 0
        : ((b - current) / (b - target)) * 100;
  } else {
    pct =
      current <= target ? 100 : current === 0 ? 100 : (target / current) * 100;
  }
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  const state =
    pct >= 100
      ? "ACHIEVED"
      : pct >= 70
        ? "ON_TRACK"
        : pct >= 40
          ? "AT_RISK"
          : "OFF_TRACK";
  return {
    ...base,
    current,
    attainmentPercent: pct,
    state,
    note: `${note}${note ? "; " : ""}state thresholds: ≥70% on track, ≥40% at risk`,
  };
}

export class BusinessService {
  private readonly profile: Repository<BusinessProfile>;
  private readonly departments: Repository<Department>;
  private readonly objectives: Repository<BusinessObjective>;
  private readonly initiatives: Repository<Initiative>;
  private readonly decisions: Repository<DecisionRecord>;

  constructor(
    repos: BusinessRepos,
    private readonly ports: BusinessPorts,
  ) {
    this.profile = new SyncCache(repos.profile);
    this.departments = new SyncCache(repos.departments);
    this.objectives = new SyncCache(repos.objectives);
    this.initiatives = new SyncCache(repos.initiatives);
    this.decisions = new SyncCache(repos.decisions);
    this.seedDefaults("system");
  }

  private now(): string {
    return this.ports.clock();
  }
  private led(
    op: string,
    actor: string,
    detail: Record<string, string | number | boolean>,
    result = "OK",
  ): void {
    this.ports.ledger.record(`business.${op}`, { actor, result, detail });
  }

  /* ----------------------------- profile / structure ----------------------------- */

  seedDefaults(by: string): void {
    if (!this.profile.findById("business"))
      this.profile.upsert({
        id: "business",
        name: "My AI Workforce",
        mission: "",
        updatedAt: this.now(),
        updatedBy: by,
      });
    for (const d of DEFAULT_DEPARTMENTS) {
      const departmentId = `dept-${d.name.toLowerCase()}`;
      if (this.departments.findById(departmentId)) continue;
      const now = this.now();
      this.departments.upsert({
        id: departmentId,
        departmentId,
        ...d,
        agentIds: [],
        projectIds: [],
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
        updatedBy: by,
      });
    }
  }

  getProfile(): BusinessProfile {
    return this.profile.findById("business")!;
  }
  configure(
    input: { name?: unknown; mission?: unknown },
    by: string,
  ): BusinessProfile {
    const cur = this.getProfile();
    const next = {
      ...cur,
      ...(input.name !== undefined
        ? { name: short(input.name, "name", 100) }
        : {}),
      ...(input.mission !== undefined
        ? { mission: short(input.mission, "mission", 1000, false) }
        : {}),
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.profile.upsert(next);
    this.led("configured", by, { name: next.name });
    return next;
  }

  listDepartments(includeArchived = false): Department[] {
    return this.departments
      .list()
      .filter((d) => includeArchived || d.status === "ACTIVE")
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  department(departmentId: string): Department {
    const d = this.departments.findById(departmentId);
    if (!d) throw new BusinessError("not_found", "department not found");
    return d;
  }

  createDepartment(input: Record<string, unknown>, by: string): Department {
    const name = short(input["name"], "name", 80);
    if (
      this.departments
        .list()
        .some(
          (d) =>
            d.name.toLowerCase() === name.toLowerCase() &&
            d.status === "ACTIVE",
        )
    )
      throw new BusinessError(
        "conflict",
        "a department with this name already exists",
      );
    const departmentId = id("dept");
    const now = this.now();
    const d: Department = {
      id: departmentId,
      departmentId,
      name,
      description: short(input["description"], "description", 500, false),
      executiveFunction: oneOf(
        input["executiveFunction"] ?? "OPERATIONS",
        EXECUTIVE_FUNCTIONS,
        "executiveFunction",
      ),
      agentIds: [],
      projectIds: [],
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.departments.upsert(d);
    this.led("department_created", by, { departmentId, name });
    return d;
  }

  updateDepartment(
    departmentId: string,
    input: Record<string, unknown>,
    by: string,
  ): Department {
    const d = this.department(departmentId);
    const next: Department = {
      ...d,
      ...(input["name"] !== undefined
        ? { name: short(input["name"], "name", 80) }
        : {}),
      ...(input["description"] !== undefined
        ? {
            description: short(input["description"], "description", 500, false),
          }
        : {}),
      ...(input["executiveFunction"] !== undefined
        ? {
            executiveFunction: oneOf(
              input["executiveFunction"],
              EXECUTIVE_FUNCTIONS,
              "executiveFunction",
            ),
          }
        : {}),
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("department_updated", by, { departmentId });
    return next;
  }

  /** Departments are archived, never deleted; a department with active objectives cannot be archived. */
  archiveDepartment(departmentId: string, by: string): Department {
    const d = this.department(departmentId);
    const open = this.objectives
      .list()
      .filter(
        (o) =>
          o.departmentId === departmentId &&
          (o.status === "ACTIVE" || o.status === "DRAFT"),
      );
    if (open.length > 0)
      throw new BusinessError(
        "invalid_state",
        `${open.length} open objective(s) still belong to this department`,
      );
    const next = {
      ...d,
      status: "ARCHIVED" as const,
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("department_archived", by, { departmentId });
    return next;
  }

  assignAgent(departmentId: string, agentId: string, by: string): Department {
    const d = this.department(departmentId);
    const a = short(agentId, "agentId", 120);
    if (!this.ports.agentExists(a))
      throw new BusinessError(
        "not_found",
        "that agent is not in the agent registry",
      );
    if (d.agentIds.includes(a)) return d;
    const next = {
      ...d,
      agentIds: [...d.agentIds, a],
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("agent_assigned", by, { departmentId, agentId: a });
    return next;
  }
  unassignAgent(departmentId: string, agentId: string, by: string): Department {
    const d = this.department(departmentId);
    if (!d.agentIds.includes(agentId))
      throw new BusinessError(
        "not_found",
        "that agent is not in this department",
      );
    const next = {
      ...d,
      agentIds: d.agentIds.filter((x) => x !== agentId),
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("agent_unassigned", by, { departmentId, agentId });
    return next;
  }
  setManager(
    departmentId: string,
    input: Record<string, unknown>,
    by: string,
  ): Department {
    const d = this.department(departmentId);
    const kind = oneOf(input["kind"], ["USER", "AGENT"] as const, "kind");
    const ref = short(input["ref"], "ref", 120);
    if (kind === "AGENT" && !this.ports.agentExists(ref))
      throw new BusinessError(
        "not_found",
        "that agent is not in the agent registry",
      );
    const responsibilities = Array.isArray(input["responsibilities"])
      ? (input["responsibilities"] as unknown[])
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.slice(0, 200))
          .slice(0, 10)
      : [];
    const next = {
      ...d,
      manager: { kind, ref, responsibilities },
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("manager_set", by, { departmentId, kind, ref });
    return next;
  }
  linkProject(departmentId: string, projectId: string, by: string): Department {
    const d = this.department(departmentId);
    if (!this.ports.projectExists(projectId))
      throw new BusinessError("not_found", "project not found");
    if (d.projectIds.includes(projectId)) return d;
    const next = {
      ...d,
      projectIds: [...d.projectIds, projectId],
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.departments.upsert(next);
    this.led("project_linked", by, { departmentId, projectId });
    return next;
  }

  /** BUSINESS → BOARD → EXECUTIVE → DEPARTMENTS → MANAGERS → WORKFORCE → PROJECTS. */
  organization(): OrgNode {
    const profile = this.getProfile();
    const depts = this.listDepartments();
    const executive = EXECUTIVE_FUNCTIONS.map((f): OrgNode => ({
      kind: "EXECUTIVE",
      id: f,
      name: f.charAt(0) + f.slice(1).toLowerCase(),
      children: depts
        .filter((d) => d.executiveFunction === f)
        .map((d): OrgNode => ({
          kind: "DEPARTMENT",
          id: d.departmentId,
          name: d.name,
          children: [
            ...(d.manager
              ? [
                  {
                    kind: "MANAGER" as const,
                    id: d.manager.ref,
                    name: `${d.manager.kind === "USER" ? "Owner" : "Agent"} ${d.manager.ref}`,
                    children: [],
                  },
                ]
              : []),
            ...d.agentIds.map((a): OrgNode => ({
              kind: "AGENT",
              id: a,
              name: a,
              children: [],
            })),
            ...d.projectIds.map((p): OrgNode => ({
              kind: "PROJECT",
              id: p,
              name: p,
              children: [],
            })),
          ],
        })),
    }));
    return {
      kind: "BUSINESS",
      id: "business",
      name: profile.name,
      children: [
        {
          kind: "BOARD",
          id: "board",
          name: "Board (the owner)",
          children: executive,
        },
      ],
    };
  }

  /* ------------------------------- objectives ------------------------------- */

  listObjectives(
    filter: {
      status?: ObjectiveStatus;
      level?: ObjectiveLevel;
      projectId?: string;
    } = {},
  ): BusinessObjective[] {
    return this.objectives
      .list()
      .filter(
        (o) =>
          (!filter.status || o.status === filter.status) &&
          (!filter.level || o.level === filter.level) &&
          (!filter.projectId || o.projectId === filter.projectId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  objective(objectiveId: string): BusinessObjective {
    const o = this.objectives.findById(objectiveId);
    if (!o) throw new BusinessError("not_found", "objective not found");
    return o;
  }

  createObjective(
    input: Record<string, unknown>,
    by: string,
  ): BusinessObjective {
    const level = oneOf(
      input["level"] ?? "OPERATIONAL",
      OBJECTIVE_LEVELS,
      "level",
    );
    const departmentId =
      typeof input["departmentId"] === "string" && input["departmentId"]
        ? input["departmentId"]
        : undefined;
    if (departmentId) this.department(departmentId);
    const parent =
      typeof input["parentObjectiveId"] === "string" &&
      input["parentObjectiveId"]
        ? input["parentObjectiveId"]
        : undefined;
    if (parent) this.objective(parent);
    const projectId =
      typeof input["projectId"] === "string" && input["projectId"]
        ? input["projectId"]
        : undefined;
    if (projectId && !this.ports.projectExists(projectId))
      throw new BusinessError("not_found", "project not found");
    if (level === "PROJECT" && !projectId)
      throw new BusinessError(
        "invalid_request",
        "a project objective needs a projectId",
      );
    const objectiveId = id("obj");
    const now = this.now();
    const targetDate = isoDate(input["targetDate"], "targetDate");
    const o: BusinessObjective = {
      id: objectiveId,
      objectiveId,
      level,
      title: short(input["title"], "title", 160),
      description: short(input["description"], "description", 2000, false),
      strategy: short(input["strategy"], "strategy", 2000, false),
      ownerFunction: oneOf(
        input["ownerFunction"] ?? "OPERATIONS",
        EXECUTIVE_FUNCTIONS,
        "ownerFunction",
      ),
      ...(departmentId ? { departmentId } : {}),
      ...(parent ? { parentObjectiveId: parent } : {}),
      ...(projectId ? { projectId } : {}),
      priority: oneOf(
        input["priority"] ?? "NORMAL",
        BUSINESS_PRIORITIES,
        "priority",
      ),
      status: "DRAFT",
      ...(targetDate ? { targetDate } : {}),
      kpis: [],
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.objectives.upsert(o);
    this.led("objective_created", by, { objectiveId, level });
    return o;
  }

  updateObjective(
    objectiveId: string,
    input: Record<string, unknown>,
    by: string,
  ): BusinessObjective {
    const o = this.objective(objectiveId);
    const targetDate =
      input["targetDate"] !== undefined
        ? isoDate(input["targetDate"], "targetDate")
        : o.targetDate;
    const { targetDate: _t, ...rest } = o;
    void _t;
    const next: BusinessObjective = {
      ...rest,
      ...(input["title"] !== undefined
        ? { title: short(input["title"], "title", 160) }
        : {}),
      ...(input["description"] !== undefined
        ? {
            description: short(
              input["description"],
              "description",
              2000,
              false,
            ),
          }
        : {}),
      ...(input["strategy"] !== undefined
        ? { strategy: short(input["strategy"], "strategy", 2000, false) }
        : {}),
      ...(input["priority"] !== undefined
        ? {
            priority: oneOf(input["priority"], BUSINESS_PRIORITIES, "priority"),
          }
        : {}),
      ...(targetDate ? { targetDate } : {}),
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.objectives.upsert(next);
    this.led("objective_updated", by, { objectiveId });
    return next;
  }

  setObjectiveStatus(
    objectiveId: string,
    status: unknown,
    by: string,
  ): BusinessObjective {
    const o = this.objective(objectiveId);
    const s = oneOf(status, OBJECTIVE_STATUSES, "status");
    if (o.status === "ACHIEVED" || o.status === "CANCELLED")
      throw new BusinessError(
        "invalid_state",
        `a ${o.status.toLowerCase()} objective is closed`,
      );
    const next = { ...o, status: s, updatedAt: this.now(), updatedBy: by };
    this.objectives.upsert(next);
    this.led("objective_status", by, { objectiveId, status: s });
    return next;
  }

  addKpi(
    objectiveId: string,
    input: Record<string, unknown>,
    by: string,
  ): BusinessObjective {
    const o = this.objective(objectiveId);
    if (o.kpis.length >= 12)
      throw new BusinessError(
        "invalid_state",
        "an objective can have at most 12 KPIs",
      );
    const sourceKind = oneOf(
      input["sourceKind"] ?? "MANUAL",
      ["MANUAL", "MEASURED"] as const,
      "sourceKind",
    );
    let source: Kpi["source"] = { kind: "MANUAL" };
    if (sourceKind === "MEASURED") {
      const metric = oneOf(input["metric"], MEASURED_METRICS, "metric");
      const projectId =
        typeof input["projectId"] === "string" && input["projectId"]
          ? input["projectId"]
          : o.projectId;
      if (projectId && !this.ports.projectExists(projectId))
        throw new BusinessError("not_found", "project not found");
      source = {
        kind: "MEASURED",
        metric,
        ...(projectId ? { projectId } : {}),
      };
    }
    const baseline =
      input["baseline"] !== undefined && input["baseline"] !== null
        ? num(input["baseline"], "baseline")
        : undefined;
    const kpi: Kpi = {
      kpiId: id("kpi"),
      name: short(input["name"], "name", 100),
      description: short(input["description"], "description", 400, false),
      unit: short(input["unit"] ?? "", "unit", 20, false),
      direction: oneOf(
        input["direction"] ?? "HIGHER_IS_BETTER",
        ["HIGHER_IS_BETTER", "LOWER_IS_BETTER"] as const,
        "direction",
      ),
      target: num(input["target"], "target"),
      ...(baseline !== undefined ? { baseline } : {}),
      source,
      readings: [],
    };
    const next = {
      ...o,
      kpis: [...o.kpis, kpi],
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.objectives.upsert(next);
    this.led("kpi_added", by, { objectiveId, kpiId: kpi.kpiId });
    return next;
  }

  recordReading(
    objectiveId: string,
    kpiId: string,
    value: unknown,
    note: unknown,
    by: string,
  ): BusinessObjective {
    const o = this.objective(objectiveId);
    const k = o.kpis.find((x) => x.kpiId === kpiId);
    if (!k) throw new BusinessError("not_found", "KPI not found");
    if (k.source.kind !== "MANUAL")
      throw new BusinessError(
        "invalid_state",
        "this KPI is measured from platform data; readings cannot be entered",
      );
    const reading = {
      at: this.now(),
      value: num(value, "value"),
      by,
      ...(typeof note === "string" && note ? { note: note.slice(0, 200) } : {}),
    };
    const next = {
      ...o,
      kpis: o.kpis.map((x) =>
        x.kpiId === kpiId
          ? { ...x, readings: [...x.readings, reading].slice(-200) }
          : x,
      ),
      updatedAt: this.now(),
      updatedBy: by,
    };
    this.objectives.upsert(next);
    this.led("kpi_reading", by, { objectiveId, kpiId });
    return next;
  }

  kpiStatuses(o: BusinessObjective): KpiStatus[] {
    return o.kpis.map((k) =>
      kpiStatus(
        k,
        k.source.kind === "MEASURED"
          ? this.ports.measure(k.source.metric, k.source.projectId)
          : undefined,
      ),
    );
  }

  /* ------------------------------- initiatives / plans ------------------------------- */

  listInitiatives(objectiveId?: string): Initiative[] {
    return this.initiatives
      .list()
      .filter((i) => !objectiveId || i.objectiveId === objectiveId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  initiative(initiativeId: string): Initiative {
    const i = this.initiatives.findById(initiativeId);
    if (!i) throw new BusinessError("not_found", "initiative not found");
    return i;
  }

  createInitiative(input: Record<string, unknown>, by: string): Initiative {
    const o = this.objective(short(input["objectiveId"], "objectiveId", 80));
    const projectIds = Array.isArray(input["projectIds"])
      ? (input["projectIds"] as unknown[])
          .filter((x): x is string => typeof x === "string")
          .slice(0, 10)
      : [];
    for (const p of projectIds)
      if (!this.ports.projectExists(p))
        throw new BusinessError("not_found", `project "${p}" not found`);
    const initiativeId = id("init");
    const now = this.now();
    const i: Initiative = {
      id: initiativeId,
      initiativeId,
      objectiveId: o.objectiveId,
      title: short(input["title"], "title", 160),
      strategy: short(input["strategy"], "strategy", 2000, false) || o.strategy,
      projectIds,
      status: "PROPOSED",
      plans: [],
      createdAt: now,
      updatedAt: now,
      updatedBy: by,
    };
    this.initiatives.upsert(i);
    this.led("initiative_created", by, {
      initiativeId,
      objectiveId: o.objectiveId,
    });
    return i;
  }

  setInitiativeStatus(
    initiativeId: string,
    status: unknown,
    by: string,
  ): Initiative {
    const i = this.initiative(initiativeId);
    const s = oneOf(
      status,
      ["PROPOSED", "ACTIVE", "COMPLETED", "CANCELLED"] as const,
      "status",
    );
    if (i.status === "COMPLETED" || i.status === "CANCELLED")
      throw new BusinessError(
        "invalid_state",
        `a ${i.status.toLowerCase()} initiative is closed`,
      );
    const next = { ...i, status: s, updatedAt: this.now(), updatedBy: by };
    this.initiatives.upsert(next);
    this.led("initiative_status", by, { initiativeId, status: s });
    return next;
  }

  /**
   * OBJECTIVE → STRATEGY → INITIATIVE → PROJECT → WORKFLOW → TASK → AGENT. Produces a PROPOSAL:
   * this layer never creates a project, a task or a run. Approving it only records the owner's
   * go-ahead and hands over the objective text for Prompt Intelligence.
   */
  proposePlan(
    initiativeId: string,
    input: Record<string, unknown>,
    by: string,
  ): ExecutionPlanProposal {
    const i = this.initiative(initiativeId);
    const o = this.objective(i.objectiveId);
    if (o.status === "CANCELLED" || o.status === "ACHIEVED")
      throw new BusinessError("invalid_state", "the objective is closed");
    const projectId =
      typeof input["projectId"] === "string" && input["projectId"]
        ? input["projectId"]
        : (i.projectIds[0] ?? o.projectId);
    if (projectId && !this.ports.projectExists(projectId))
      throw new BusinessError("not_found", "project not found");
    const templates = this.ports.workflowTemplates();
    const templateId =
      typeof input["templateId"] === "string" ? input["templateId"] : undefined;
    const template = templateId
      ? templates.find((t) => t.extensionId === templateId)
      : undefined;
    if (templateId && !template)
      throw new BusinessError(
        "not_found",
        "that workflow template is not enabled",
      );
    const stages = template?.stages ?? DEFAULT_STAGES;
    const dept = o.departmentId
      ? this.departments.findById(o.departmentId)
      : undefined;
    const workforce = dept?.agentIds ?? [];
    const tasks: PlanTask[] = stages.map((s) => ({
      taskKey: s.id,
      title: s.title,
      taskType: s.taskType,
      ...(s.agentRole ? { agentRole: s.agentRole } : {}),
      suggestedAgentIds: [
        "DEVELOPMENT",
        "TESTING",
        "ANALYSIS",
        "PLANNING",
      ].includes(s.taskType)
        ? workforce.slice(0, 3)
        : [],
      requiresApproval: s.requiresApproval === true,
      dependsOn: s.dependsOn ?? [],
    }));
    const plan: ExecutionPlanProposal = {
      planId: id("plan"),
      objectiveId: o.objectiveId,
      initiativeId: i.initiativeId,
      ...(projectId ? { projectId } : {}),
      needsProject: !projectId,
      workflow: {
        source: template ? "extension" : "default",
        ...(template ? { templateId: template.extensionId } : {}),
        name: template?.name ?? "Standard development loop",
      },
      tasks,
      promptObjective:
        `${o.title} — ${i.title}.${i.strategy ? ` Strategy: ${i.strategy}` : ""}${o.description ? ` Context: ${o.description}` : ""}`.slice(
          0,
          1500,
        ),
      generatedAt: this.now(),
      status: "PROPOSED",
    };
    this.initiatives.upsert({
      ...i,
      plans: [...i.plans, plan].slice(-10),
      updatedAt: this.now(),
      updatedBy: by,
    });
    this.led("plan_proposed", by, { initiativeId, planId: plan.planId });
    return plan;
  }

  decidePlan(
    initiativeId: string,
    planId: string,
    decision: "APPROVED" | "REJECTED",
    by: string,
  ): Initiative {
    const i = this.initiative(initiativeId);
    const plan = i.plans.find((p) => p.planId === planId);
    if (!plan) throw new BusinessError("not_found", "plan not found");
    if (plan.status !== "PROPOSED")
      throw new BusinessError(
        "invalid_state",
        `the plan is already ${plan.status.toLowerCase()}`,
      );
    if (decision === "APPROVED" && plan.needsProject)
      throw new BusinessError(
        "invalid_state",
        "the plan needs a project: onboard or link one first",
      );
    const at = this.now();
    const next: Initiative = {
      ...i,
      plans: i.plans.map((p) =>
        p.planId === planId
          ? { ...p, status: decision, decidedBy: by, decidedAt: at }
          : p,
      ),
      status:
        decision === "APPROVED" && i.status === "PROPOSED"
          ? "ACTIVE"
          : i.status,
      updatedAt: at,
      updatedBy: by,
    };
    this.initiatives.upsert(next);
    this.led("plan_decided", by, { initiativeId, planId, decision });
    return next;
  }

  /* ------------------------------- decisions ------------------------------- */

  listDecisions(
    filter: { objectiveId?: string; projectId?: string } = {},
  ): DecisionRecord[] {
    return this.decisions
      .list()
      .filter(
        (d) =>
          (!filter.objectiveId || d.links.objectiveId === filter.objectiveId) &&
          (!filter.projectId || d.links.projectId === filter.projectId),
      )
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }
  decision(decisionId: string): DecisionRecord {
    const d = this.decisions.findById(decisionId);
    if (!d) throw new BusinessError("not_found", "decision not found");
    return d;
  }

  recordDecision(input: Record<string, unknown>, by: string): DecisionRecord {
    const links: DecisionRecord["links"] = {};
    for (const k of [
      "objectiveId",
      "initiativeId",
      "projectId",
      "taskId",
    ] as const) {
      const v = input[k];
      if (typeof v === "string" && v) links[k] = v;
    }
    if (links.objectiveId) this.objective(links.objectiveId);
    if (links.initiativeId) this.initiative(links.initiativeId);
    if (links.projectId && !this.ports.projectExists(links.projectId))
      throw new BusinessError("not_found", "project not found");
    const list = (v: unknown, max: number): string[] =>
      Array.isArray(v)
        ? (v as unknown[])
            .filter((x): x is string => typeof x === "string" && x.length > 0)
            .map((x) => x.slice(0, 300))
            .slice(0, max)
        : [];
    const decisionId = id("dec");
    const now = this.now();
    const decidedAt = isoDate(input["decidedAt"], "decidedAt") ?? now;
    const d: DecisionRecord = {
      id: decisionId,
      decisionId,
      title: short(input["title"], "title", 160),
      decision: short(input["decision"], "decision", 2000),
      decidedAt,
      owner: short(input["owner"] ?? by, "owner", 80),
      context: short(input["context"], "context", 2000, false),
      alternatives: list(input["alternatives"], 10),
      rationale: short(input["rationale"], "rationale", 2000, false),
      actions: list(input["actions"], 10),
      links,
      status: "PROPOSED",
      createdAt: now,
      updatedAt: now,
    };
    this.decisions.upsert(d);
    this.led("decision_recorded", by, { decisionId });
    return d;
  }

  adoptDecision(decisionId: string, by: string): DecisionRecord {
    const d = this.decision(decisionId);
    if (d.status !== "PROPOSED")
      throw new BusinessError(
        "invalid_state",
        `the decision is already ${d.status.toLowerCase()}`,
      );
    const next = { ...d, status: "ADOPTED" as const, updatedAt: this.now() };
    this.decisions.upsert(next);
    this.led("decision_adopted", by, { decisionId });
    try {
      this.ports.remember?.(next);
    } catch {
      /* the decision record is authoritative; keeping a knowledge copy is best-effort */
    }
    return next;
  }

  /** A decision is never edited or deleted; a new one supersedes it and keeps the link. */
  supersedeDecision(
    decisionId: string,
    replacement: Record<string, unknown>,
    by: string,
  ): { old: DecisionRecord; next: DecisionRecord } {
    const old = this.decision(decisionId);
    if (old.status !== "ADOPTED")
      throw new BusinessError(
        "invalid_state",
        "only an adopted decision can be superseded",
      );
    const created = this.recordDecision(
      {
        ...replacement,
        links: undefined,
        objectiveId: old.links.objectiveId,
        projectId: old.links.projectId,
        initiativeId: old.links.initiativeId,
      },
      by,
    );
    const next = this.adoptDecision(created.decisionId, by);
    const linked = { ...next, supersedes: old.decisionId };
    this.decisions.upsert(linked);
    const closed = {
      ...old,
      status: "SUPERSEDED" as const,
      supersededBy: linked.decisionId,
      updatedAt: this.now(),
    };
    this.decisions.upsert(closed);
    this.led("decision_superseded", by, { decisionId, by: linked.decisionId });
    return { old: closed, next: linked };
  }

  /* --------------------------------- board --------------------------------- */

  board(): BoardView {
    const profile = this.getProfile();
    const objectives = this.listObjectives().filter(
      (o) => o.status !== "CANCELLED",
    );
    const rows = objectives.map((o) => ({
      objectiveId: o.objectiveId,
      title: o.title,
      level: o.level,
      priority: o.priority,
      status: o.status,
      ownerFunction: o.ownerFunction,
      kpis: this.kpiStatuses(o),
    }));
    const all = rows.flatMap((r) => r.kpis);
    const count = (s: KpiStatus["state"]) =>
      all.filter((k) => k.state === s).length;
    const risks: BoardView["risks"] = [];
    const now = this.now();
    for (const o of objectives) {
      if (o.status === "ACTIVE" && o.targetDate && o.targetDate < now)
        risks.push({
          kind: "OVERDUE",
          message: `"${o.title}" passed its target date ${o.targetDate.slice(0, 10)}`,
          ref: o.objectiveId,
        });
      if (o.status === "ACTIVE" && o.kpis.length === 0)
        risks.push({
          kind: "UNMEASURED",
          message: `"${o.title}" has no KPI, so progress cannot be measured`,
          ref: o.objectiveId,
        });
      if (o.projectId) {
        const h = this.ports.projectHealth?.(o.projectId);
        if (
          h &&
          (h.state === "AT_RISK" ||
            h.state === "CRITICAL" ||
            h.state === "BLOCKED")
        )
          risks.push({
            kind: "PROJECT_HEALTH",
            message:
              `${o.projectId} is ${h.state}: ${h.reasons[0] ?? ""}`.trim(),
            ref: o.objectiveId,
          });
      }
    }
    for (const r of rows)
      for (const k of r.kpis)
        if (k.state === "OFF_TRACK")
          risks.push({
            kind: "KPI_OFF_TRACK",
            message: `KPI "${k.name}" is off track (${k.attainmentPercent}% of target)`,
            ref: r.objectiveId,
          });
    return {
      business: { name: profile.name, mission: profile.mission },
      objectives: rows,
      initiatives: this.listInitiatives()
        .filter((i) => i.status !== "CANCELLED")
        .slice(0, 50)
        .map((i) => ({
          initiativeId: i.initiativeId,
          objectiveId: i.objectiveId,
          title: i.title,
          status: i.status,
          projectIds: i.projectIds,
        })),
      risks: risks.slice(0, 50),
      performance: {
        kpis: all.length,
        withData: all.filter((k) => k.state !== "NO_DATA").length,
        onTrack: count("ON_TRACK"),
        atRisk: count("AT_RISK"),
        offTrack: count("OFF_TRACK"),
        achieved: count("ACHIEVED"),
      },
      recentDecisions: this.listDecisions().slice(0, 5),
      generatedAt: now,
    };
  }
}

export type { BusinessPriority };
