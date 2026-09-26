/**
 * EO-5.6 — ENVIRONMENT graph fragment. Pure: derives nodes/edges only from
 * authoritative routing verdicts and (optionally) the read-only registry.
 * Nothing is fabricated; instance nodes expose display-safe fields only.
 */
import type {
  GraphFragment,
  WorkforceGraphEdge,
  WorkforceGraphNode,
} from "../../contracts/graph.js";
import { createHash } from "node:crypto";
import type { TaskEnvironmentRoutingSummary } from "../../contracts/orchestration.js";
import {
  formatVersion,
  type EnvironmentInstance,
  type EnvironmentType,
} from "../../contracts/environments.js";
import type { EnvironmentRegistry } from "../environments/environment-registry.js";
import { byId, safeMetadata, truncate } from "./graph-util.js";
import { toGraphState } from "./graph-state.js";

const MAX_LABEL = 120;
export const MAX_INSTANCE_NODES = 20;

export interface EnvironmentFragmentInput {
  projectId: string;
  /** Already filtered to this project by the caller; still verify projectId. */
  tasks: readonly {
    id: string;
    projectId: string;
    environmentRequirements?: readonly string[];
  }[];
  /** Redacted routing verdicts from SoftwareFactoryOrchestrator.programDetail().routes. */
  routes: readonly TaskEnvironmentRoutingSummary[];
  /** Optional read-only registry view; absent => no instance nodes. */
  registry?: Pick<EnvironmentRegistry, "listInstances">;
}

type RouteStatus = Exclude<TaskEnvironmentRoutingSummary["status"], "skipped">;

const PRECEDENCE: readonly RouteStatus[] = [
  "routed",
  "requires_provisioning",
  "no_environment",
  "unsupported",
];
const rank = (s: RouteStatus): number => PRECEDENCE.indexOf(s);
const better = (a: RouteStatus, b: RouteStatus): RouteStatus =>
  rank(a) <= rank(b) ? a : b;

const NAME_BY_CODE: Readonly<Record<string, string>> = {
  docker: "Docker",
  "vs-code": "VS Code",
  "visual-studio": "Visual Studio",
  "android-studio": "Android Studio",
  xcode: "Xcode",
  unity: "Unity",
  unreal: "Unreal Engine",
};

const TYPE_BY_CODE: Readonly<Record<string, EnvironmentType>> = {
  docker: "docker",
  "vs-code": "visual_studio_code",
  "visual-studio": "visual_studio",
  "android-studio": "android_studio",
  xcode: "xcode",
  unity: "unity",
  unreal: "unreal_engine",
};

export function buildEnvironmentFragment(
  input: EnvironmentFragmentInput,
): GraphFragment {
  const { projectId } = input;
  const taskIds = new Set(
    input.tasks.filter((t) => t.projectId === projectId).map((t) => t.id),
  );
  const routes = input.routes.filter(
    (r): r is TaskEnvironmentRoutingSummary & { status: RouteStatus } =>
      taskIds.has(r.taskId) &&
      r.code !== "none" &&
      r.status !== "skipped" &&
      // Codes become node ids: keep them well-formed and out of the
      // router/instance id namespaces so ids cannot collide.
      SAFE_CODE.test(r.code) &&
      !/^(router|instance)-/.test(r.code),
  );
  if (routes.length === 0) return { nodes: [], edges: [] };

  const routerId = `env-router-${projectId}`;
  const nodes: WorkforceGraphNode[] = [
    {
      id: routerId,
      type: "ENVIRONMENT_ROUTER",
      label: "Environment Router",
      status: "active",
      state: toGraphState("active"),
      projectId,
      referenceId: projectId,
    },
  ];
  const edgeMap = new Map<string, WorkforceGraphEdge>();
  const addEdge = (e: WorkforceGraphEdge): void => {
    if (!edgeMap.has(e.id)) edgeMap.set(e.id, e);
  };

  interface CodeAgg {
    best: RouteStatus;
    tasks: Set<string>;
    routed: Set<string>;
  }
  const byCode = new Map<string, CodeAgg>();
  const byTask = new Map<string, RouteStatus>();

  for (const r of routes) {
    const agg = byCode.get(r.code) ?? {
      best: r.status,
      tasks: new Set<string>(),
      routed: new Set<string>(),
    };
    agg.best = better(agg.best, r.status);
    agg.tasks.add(r.taskId);
    if (r.status === "routed") agg.routed.add(r.taskId);
    byCode.set(r.code, agg);

    const prev = byTask.get(r.taskId);
    byTask.set(r.taskId, prev ? better(prev, r.status) : r.status);

    if (r.status === "routed") {
      addEdge({
        id: `task-executes-${r.taskId}-${r.code}`,
        type: "EXECUTES_IN",
        source: `task-${r.taskId}`,
        target: `env-${r.code}`,
        status: r.status,
      });
    }
  }

  for (const [taskId, status] of byTask) {
    addEdge({
      id: `task-routed-${taskId}`,
      type: "ROUTED_TO",
      source: `task-${taskId}`,
      target: routerId,
      status,
    });
  }

  const typesInUse = new Map<EnvironmentType, string>();
  for (const [code, agg] of byCode) {
    const envType = TYPE_BY_CODE[code];
    if (envType && !typesInUse.has(envType)) typesInUse.set(envType, code);
    nodes.push({
      id: `env-${code}`,
      type: "ENVIRONMENT",
      label: truncate(NAME_BY_CODE[code] ?? code, MAX_LABEL),
      status: agg.best,
      state: toGraphState(agg.best),
      projectId,
      referenceId: code,
      metadata: safeMetadata({
        code,
        routedTasks: agg.routed.size,
        totalTasks: agg.tasks.size,
        environmentType: envType,
      }),
    });
    addEdge({
      id: `env-router-to-${code}`,
      type: "ROUTED_TO",
      source: routerId,
      target: `env-${code}`,
      status: agg.best,
    });
  }

  if (input.registry && typesInUse.size > 0) {
    const instances = input.registry
      .listInstances()
      .filter((i) => typesInUse.has(i.environmentType))
      .slice()
      .sort(byId)
      .slice(0, MAX_INSTANCE_NODES);
    for (const inst of instances) {
      const opaque = opaqueInstanceId(projectId, inst.id);
      nodes.push(instanceNode(inst, projectId, opaque));
      addEdge({
        id: `env-instance-of-${opaque}`,
        type: "BELONGS_TO",
        source: `env-instance-${opaque}`,
        target: `env-${typesInUse.get(inst.environmentType)!}`,
      });
    }
  }

  return {
    nodes: nodes.sort(byId),
    edges: [...edgeMap.values()].sort(byId),
  };
}

const SAFE_CODE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * Registry instance ids embed a hash of host id + install path, so they are
 * never exposed. The graph id is a per-project opaque digest instead.
 */
function opaqueInstanceId(projectId: string, instanceId: string): string {
  return createHash("sha256")
    .update(`${projectId}|${instanceId}`)
    .digest("hex")
    .slice(0, 12);
}

function instanceNode(
  inst: EnvironmentInstance,
  projectId: string,
  opaque: string,
): WorkforceGraphNode {
  return {
    id: `env-instance-${opaque}`,
    type: "ENVIRONMENT",
    label: truncate(inst.name, MAX_LABEL),
    status: inst.availability,
    state: toGraphState(inst.availability),
    projectId,
    referenceId: opaque,
    // Whitelist only — never hostId, installation, fingerprint, safeMetadata.
    metadata: safeMetadata({
      environmentType: inst.environmentType,
      availability: inst.availability,
      version: inst.version ? formatVersion(inst.version) : undefined,
      trustLevel: inst.trustLevel,
    }),
  };
}
