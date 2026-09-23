import { type CommandProbeDefinition, type CommandProbeExecutor, type ProbeExecutionResult } from "../../contracts/index.js";
export interface RawProcessResult {
    exitCode: number | null;
    signal: string | null;
    stdout: Buffer;
    stderr: Buffer;
    timedOut: boolean;
}
/**
 * The process seam. `run` receives only the validated, allowlisted definition —
 * a caller piping in an executable or extra args has no path through here.
 */
export type SpawnImplementation = (definition: CommandProbeDefinition) => Promise<RawProcessResult>;
export declare class RestrictedCommandProbeRunner implements CommandProbeExecutor {
    private readonly run;
    constructor(run?: SpawnImplementation);
    execute(definition: CommandProbeDefinition): Promise<ProbeExecutionResult>;
}
