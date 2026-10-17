export interface CommandDescriptor {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
}
export interface AllowedExecutable {
    readonly executable: string;
    /** Each entry is a pattern that must match an exact argv element. */
    readonly argPatterns?: readonly ReadonlyArray<string | RegExp>[];
    /** Maximum allowed timeout in milliseconds. Default 5 minutes. */
    readonly maxTimeoutMs?: number;
    readonly riskLevel?: "low" | "medium" | "high";
    readonly requiresApproval?: boolean;
}
export interface CommandPolicy {
    readonly allowedExecutables: readonly AllowedExecutable[];
    readonly maxArgLength: number;
    readonly maxArgs: number;
    readonly defaultMaxTimeoutMs: number;
    readonly envAllowlist: readonly string[];
}
export declare const DEFAULT_COMMAND_POLICY: CommandPolicy;
export type CommandPolicyDecision = {
    readonly outcome: "allowed";
} | {
    readonly outcome: "requires_approval";
    readonly reason: string;
} | {
    readonly outcome: "denied";
    readonly reason: string;
};
export declare function evaluateCommand(descriptor: CommandDescriptor, policy?: CommandPolicy): CommandPolicyDecision;
export declare function validateCommandDescriptor(descriptor: CommandDescriptor): void;
