# 0032. Autonomous Software Factory Orchestration

## Context
With the introduction of the V1 Specialist Workforce (ADR-0030) and their specialized execution boundaries (ADR-0031), we now have a capable team of specialized agents (PM, Architect, Developers, QA, etc.). However, the `SoftwareFactoryOrchestrator` currently acts as a passive registry of DAG tasks. It requires external actors to define programs, map dependencies, and repeatedly invoke `tick()` to drive execution.

To truly automate the Software Factory pipeline, we need autonomous orchestration logic that coordinates these specialists to execute full end-to-end software factory pipelines from a single high-level objective, without human micromanagement.

## Decision
We will implement an **Autonomous Software Factory Orchestrator** pattern by extending the `SoftwareFactoryOrchestrator` to include a `planFromObjective` capability that leverages the `V1_SPECIALIST_WORKFORCE` (specifically `pm-v1` or equivalent) to decompose high-level goals into executable Software Factory Programs and Workstreams. 

Additionally, we will implement an autonomous **Tick Daemon/Worker** that continuously advances active Software Factory Programs, dispatching the created tasks to the correct V1 Specialists based on `requiredCapabilities` and `assignedAgentId`.

## Implementation Details
1. **`planFromObjective` in `SoftwareFactoryOrchestrator`**:
   - Accepts a high-level project objective.
   - Dispatches a planning task to the `pm-v1` specialist.
   - Parses the resulting plan into a `SoftwareFactoryProgram` and a default `Workstream`.
   - Adds the dependencies and task DAG into the Workstream using `addTask`.

2. **Autonomous Ticking**:
   - Provide a background loop (or rely on a `tick` API endpoint called by a cron job) that continuously evaluates active programs.
   - Tasks are resolved to specific specialists (e.g., `frontend-dev-v1`, `qa-v1`) based on their capabilities, ensuring the correct V1 agent handles the specific segment of the pipeline.

## Consequences
- The Software Factory becomes a true "Factory", capable of taking an objective and autonomously coordinating a team of specialists to deliver it.
- Reduced need for manual API calls to build the workstream DAG.
- Better utilization of the V1 Specialist Workforce across the lifecycle.
