# Environment Discovery Foundation (EO-2A)

The Environment Orchestration layer separates five concepts that are easy to
conflate:

| Concept                 | Represents                                        | Truth source                   |
| ----------------------- | ------------------------------------------------- | ------------------------------ |
| `EnvironmentDescriptor` | _Type support_ — what the workforce _can_ support | version-controlled catalog     |
| `EnvironmentInstance`   | _Installed_ — what is actually on a machine       | live detection                 |
| `HostInstance`          | _Machine_ — a real, reachable host                | live detection                 |
| `CapabilityDeclaration` | _Can perform_ — a typed, evidenced claim          | mapping from detection facts   |
| `Availability`          | _Currently usable_ — usable right now             | detection / operational action |

The three guardrails that make the foundation trustworthy:

1. **Never infer an environment from an OS.** A Windows machine does not imply
   Visual Studio; a macOS machine does not imply Xcode. Only a probe that ran
   and reported can create an `EnvironmentInstance`.
2. **Never fake availability.** A descriptor or a stale record is never
   `available`. Availability flips to `unavailable` the moment a previously
   detected environment is not re-detected.
3. **No arbitrary execution and no secrets.** The only process-execution
   adapter is the restricted command probe (fixed, allowlisted definitions,
   no shell). No registry record accepts credentials. Unrestricted `command`
   endpoints are deliberately absent.

## Host model

A `HostInstance` (see `contracts/environments.ts`) records identity (`hostId`,
name), platform (`os`, `architecture`), kind (`HostType`), trust level,
capability declarations, a stable fingerprint, and safe last-seen metadata
(`lastDetectedAt`, `lastVerifiedAt`, `lastHealthCheckAt`). Host kinds are
platform-neutral: `local_workstation`, `dedicated_runner`, `cloud_runner`,
`container_host`, `mac_build_host`.

Cost-center metadata (`costCenter`) exists for cloud/GPU/ephemeral machines and
never contains a secret.

## Descriptor ≠ Instance

- **Registering a descriptor** declares support. It changes nothing about any
  machine.
- **Registering an instance** requires a _known_ descriptor, a _known_ host,
  OS compatibility with the descriptor's `minimumOs`, well-formed capabilities,
  and a unique stable fingerprint. Anything else is a `ValidationError`.

## Discovery flow

```
DetectHostRequest → applicable probes → DetectedEnvironment[] → registry
```

`EnvironmentDetector` (core) picks the probes applicable to the host platform,
runs them (a throwing probe becomes a warning, never a fatal error), and feeds
the results into the `EnvironmentRegistry`. Because fingerprints are derived
deterministically from `host + type + version + installation`, discovery is
idempotent: re-running the same pass refreshes the same instances instead of
duplicating them.

The only probe shipped in EO-2A is the deterministic
`DeclarativeEnvironmentProbe` (a compiled fact table) used by tests. Real
platform probes (VS Code, Visual Studio via `vswhere`, Xcode, Docker, Unity,
Unreal, cloud runners) implement the same `EnvironmentProbe` port in later
tracks.

## Lifecycle

| Step             | Action                                | Audited as                |
| ---------------- | ------------------------------------- | ------------------------- |
| Discover         | probe reports a new environment       | `environment_discovered`  |
| Register         | first-time host + instances persisted | `host_registered`         |
| Refresh          | re-detected (same fingerprint)        | `environment_refreshed`   |
| Mark unavailable | previously seen, now missing          | `environment_unavailable` |
| Remove           | explicit deregistration               | (registry-only today)     |

A missing environment is **marked unavailable**, never dropped and never kept
`available`.

## Capability discovery

`HostCapabilityDiscovery` maps _detection facts_ (never OS) to a typed
`CapabilityReport`:

- `command_execution_available` — a probe executed
- `container_runtime_available` — Docker detected
- `web_build_capable` — a web build environment **plus** a Node toolchain
- `desktop_build_capable`, `mobile_build_capable`, `game_build_capable` — the
  matching build environments detected
- `gpu_available` — never inferred; only a declared fact can set it

A `.NET` toolchain alone is noticeably **not** `desktop_build_capable`, and a
Node toolchain alone is not `web_build_capable`. Capabilities are conservative.

## Capability ≠ Permission

A capability is a machine claim ("this host can build for the web"). It is not
authorization. Permissions remain the exclusive domain of the existing
`PermissionSystem` and Control Plane; environment capability never grants or
denies an action by itself.

## Router integration

`EnvironmentRouter.route(requirement)` returns:

- `ROUTED` — a real, currently-`available` instance on an `available` host,
- `REQUIRES_PROVISIONING` — a descriptor supports the requirement but no usable
  instance is registered,
- `NO_AVAILABLE_ENVIRONMENT` — nothing supports it.

The router never routes to an imaginary environment: a macOS-only Xcode
descriptor on a Windows host is `REQUIRES_PROVISIONING`, never `ROUTED`.
`AgentQualificationRouter` keeps the question "does the agent declare the
capability?" separate from "is a real environment installed?" — a qualified
agent without an environment is `REQUIRES_PROVISIONING`, and an unqualified
agent is rejected even when an environment exists.

## Restricted probe boundary

`RestrictedCommandProbeRunner` (`adapters/execution`) is the only process
execution in the foundation. Every `CommandProbeDefinition` is a bare,
allowlisted executable basename plus a fixed argument list — there is **no**
function that accepts an arbitrary command string, no shell, no environment
injection, fixed timeouts, bounded output, secret redaction, and safe exit
metadata. `validateCommandProbeDefinition` rejects path-y executables and
dot-paths up front.

## Trust levels

`DECLARED` (operator/owner statement), `DETECTED` (probe evidence), `VERIFIED`
(confirmed by an independent check). Hosts default to `DETECTED` during live
discovery; declared facts feed capability mapping but never fabricate
availability.

## Registry refresh

Registry writes are synchronous and validated; the durable collections
(`hosts`, `environment_instances`) hydrate once at startup through the existing
`FirebaseRepositoryProvider` — never directly from the frontend. Re-running
discovery refreshes in place via stable fingerprints. Production seeds
**descriptors only**; no fake hosts are ever seeded.

## Control Plane API

Safe, read-only, authenticated endpoints (all behind the existing Control
Plane auth + `view` capability):

- `GET /api/environments/descriptors[/:id]`
- `GET /api/environments/instances[/:id]`
- `GET /api/hosts[/:id]`
- `GET /api/hosts/:id/capabilities`

Privileged refresh/mutation operations are not exposed; they will be gated by
permissions and approvals when future tracks add them.
