/**
 * Layer 3 `ContextSource`: adds the instructions of ENABLED skills that match the task to the
 * execution prompt. A briefing only — enforcement stays with the governor and gateways.
 */
import type { ContextFragment, ContextRequest, ContextSource } from "../../contracts/prompt-intelligence.js";
import type { ExtensionPlatform } from "./registry.js";
export declare class SkillContextSource implements ContextSource {
    private readonly platform;
    readonly id = "extension-skills";
    readonly categories: "development"[];
    constructor(platform: ExtensionPlatform);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
