export class SkillContextSource {
    platform;
    id = "extension-skills";
    categories = ["development"];
    constructor(platform) {
        this.platform = platform;
    }
    fetch(request) {
        const i = request.intent;
        const text = `${i.objective} ${i.target ?? ""} ${i.scope ?? ""}`;
        return this.platform
            .skillsFor({ text, limit: 3 })
            .map((s) => ({
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
