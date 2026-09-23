/**
 * DeclarativeEnvironmentProbe — deterministic, fact-table-driven reference
 * probe. It answers detection from a compiled, trusted fact record instead of
 * probing a live machine.
 *
 * EO-2A uses this as the ONLY probe wired into the core detection flow: tests
 * and the offline reference runtime get fully deterministic discovery while the
 * real platform probes (VS Code, vswhere, Xcode, Docker, ...) arrive in later
 * tracks behind the same {@link EnvironmentProbe} port.
 */
import {
  type Availability,
  type DetectedEnvironment,
  type EnvironmentType,
  type OsName,
  type ToolchainDescriptor,
  type VersionInfo,
  parseVersion,
} from "../../contracts/index.js";
import { type ProbeInput } from "../../core/environments/environment-probe.js";

export interface DeclarativeEnvironmentFact {
  /** `"*"` = any host; otherwise exact hostId. */
  hostId: string | "*";
  /** `"*"` = any platform; otherwise must match `os.os`. */
  platform?: OsName | "*";
  environmentType: EnvironmentType;
  detected?: boolean;
  version?: VersionInfo | string;
  installation?: string;
  toolchains?: readonly ToolchainDescriptor[];
  availability?: Availability;
  evidence?: readonly string[];
  confidence?: number;
  warnings?: readonly string[];
  /** Overrides the auto id (`declarative_<type>`), unique per coexisting probe. */
  id?: string;
}

export class DeclarativeEnvironmentProbe {
  readonly id: string;
  readonly environmentType: EnvironmentType;
  private readonly fact: DeclarativeEnvironmentFact;

  constructor(fact: DeclarativeEnvironmentFact) {
    if (!fact || typeof fact !== "object") {
      throw new Error("declarative environment probe requires a fact");
    }
    this.fact = fact;
    this.environmentType = fact.environmentType;
    this.id = fact.id ?? `declarative_${fact.environmentType}`;
  }

  supports(os: ProbeInput["os"]): boolean {
    const platform = this.fact.platform ?? "*";
    return platform === "*" || platform === os.os;
  }

  async detect(input: ProbeInput): Promise<DetectedEnvironment> {
    const version =
      typeof this.fact.version === "string"
        ? parseVersion(this.fact.version)
        : this.fact.version;
    if (this.fact.hostId !== "*" && this.fact.hostId !== input.hostId) {
      return {
        environmentType: this.environmentType,
        detected: false,
        toolchains: [],
        availability: "unavailable",
        evidence: [
          `probe applies to host "${this.fact.hostId}", not "${input.hostId}"`,
        ],
        confidence: 1,
        warnings: [],
      };
    }
    const detected = this.fact.detected ?? false;
    return {
      environmentType: this.environmentType,
      detected,
      version,
      installation: this.fact.installation,
      toolchains: this.fact.toolchains ?? [],
      availability: detected
        ? (this.fact.availability ?? "available")
        : "unavailable",
      evidence: this.fact.evidence ?? [],
      confidence: this.fact.confidence ?? (detected ? 1 : 0),
      warnings: this.fact.warnings ?? [],
    };
  }
}
