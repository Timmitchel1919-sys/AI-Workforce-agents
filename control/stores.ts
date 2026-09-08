/**
 * Control-plane-owned operational state. These are the "smallest necessary"
 * state models the audit called for: an enabled/disabled flag per agent, and a
 * paused flag per workflow. Core definitions (the `AgentRegistry` entry, the
 * `Workflow`) are never mutated by the Control Plane.
 */
import {
  type AgentOperationalRecord,
  type Repository,
  type WorkflowControlRecord,
} from "../contracts/index.js";
import { InMemoryRepository, now } from "../core/index.js";

export class AgentOperationalStore {
  constructor(
    private readonly repo: Repository<AgentOperationalRecord> = new InMemoryRepository<AgentOperationalRecord>(),
  ) {}

  /** Unknown agents are enabled by default. */
  isEnabled(agentId: string): boolean {
    const record = this.repo.findById(agentId);
    return record ? record.enabled : true;
  }

  get(agentId: string): AgentOperationalRecord | undefined {
    return this.repo.findById(agentId);
  }

  list(): AgentOperationalRecord[] {
    return this.repo.list();
  }

  disable(agentId: string, by: string, reason: string): AgentOperationalRecord {
    const timestamp = now();
    const previous = this.repo.findById(agentId);
    const record: AgentOperationalRecord = {
      id: agentId,
      agentId,
      enabled: false,
      disabledBy: by,
      disabledReason: reason,
      disabledAt: timestamp,
      enabledBy: previous?.enabledBy,
      enabledAt: previous?.enabledAt,
      updatedAt: timestamp,
    };
    this.repo.upsert(record);
    return record;
  }

  enable(agentId: string, by: string): AgentOperationalRecord {
    const timestamp = now();
    const previous = this.repo.findById(agentId);
    const record: AgentOperationalRecord = {
      id: agentId,
      agentId,
      enabled: true,
      disabledBy: previous?.disabledBy,
      disabledReason: previous?.disabledReason,
      disabledAt: previous?.disabledAt,
      enabledBy: by,
      enabledAt: timestamp,
      updatedAt: timestamp,
    };
    this.repo.upsert(record);
    return record;
  }
}

export class WorkflowControlStore {
  constructor(
    private readonly repo: Repository<WorkflowControlRecord> = new InMemoryRepository<WorkflowControlRecord>(),
  ) {}

  isPaused(workflowId: string): boolean {
    return this.repo.findById(workflowId)?.paused ?? false;
  }

  get(workflowId: string): WorkflowControlRecord | undefined {
    return this.repo.findById(workflowId);
  }

  list(): WorkflowControlRecord[] {
    return this.repo.list();
  }

  pause(
    workflowId: string,
    by: string,
    reason: string | undefined,
  ): WorkflowControlRecord {
    const timestamp = now();
    const record: WorkflowControlRecord = {
      id: workflowId,
      workflowId,
      paused: true,
      pausedBy: by,
      pauseReason: reason,
      pausedAt: timestamp,
      updatedAt: timestamp,
    };
    this.repo.upsert(record);
    return record;
  }

  resume(workflowId: string, by: string): WorkflowControlRecord {
    const timestamp = now();
    const previous = this.repo.findById(workflowId);
    const record: WorkflowControlRecord = {
      id: workflowId,
      workflowId,
      paused: false,
      pausedBy: previous?.pausedBy,
      pauseReason: previous?.pauseReason,
      pausedAt: previous?.pausedAt,
      resumedBy: by,
      resumedAt: timestamp,
      updatedAt: timestamp,
    };
    this.repo.upsert(record);
    return record;
  }
}
