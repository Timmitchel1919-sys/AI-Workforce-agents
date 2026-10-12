/**
 * Layer 3 `ContextSource`: adds the instructions of ENABLED skills that match the task to the
 * execution prompt. A briefing only — enforcement stays with the governor and gateways.
 */
import type {
  ContextFragment,
  ContextRequest,
  ContextSource,
} from "../../contracts/prompt-intelligence.js";
import type { ExtensionPlatform } from "./registry.js";

export class SkillContextSource implements ContextSource {
  readonly id = "extension-skills";
  readonly categories = ["development" as const];

  constructor(private readonly platform: ExtensionPlatform) {}

  fetch(request: ContextRequest): readonly ContextFragment[] {
    const i = request.intent;
    const text = `${i.objective} ${i.target ?? ""} ${i.scope ?? ""}`;
    return this.platform
      .skillsFor({ text, limit: 3 })
      .map((s): ContextFragment => ({
        category: "development",
        key: `skill.${s.extensionId}`,
        value: `Skill "${s.name}" (${s.version}): ${s.spec.instructions} Expected outputs: ${s.spec.expectedOutputs.join("; ")}. Validation: ${s.spec.validation.join("; ")}.`,
        source: this.id,
        origin: `Skill ${s.name} v${s.version}`,
        authority: "curated",
        precedence: "general_default",
        sensitivity: "internal",
        projectId: request.projectId,
        mandatory: false,
      }));
  }
}
