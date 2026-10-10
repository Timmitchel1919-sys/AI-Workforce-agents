import { type MoneyMindScript } from "../../../contracts/index.js";
import type { MoneyMindRepoPort, MoneyMindRunResult } from "./money-mind-repo-port.js";
/**
 * The honest repository backend for a runtime that has no Money Mind source
 * (for example a Cloud Function without a checkout). It touches no
 * filesystem path, so nothing can be read, run, or planted into it: probes
 * report absence and every read or run fails with a clear NotFoundError.
 */
export declare class UnavailableMoneyMindRepo implements MoneyMindRepoPort {
    exists(): Promise<boolean>;
    readTextFile(): Promise<string>;
    listDirectory(): Promise<readonly {
        name: string;
        type: "file" | "dir";
    }[]>;
    hasScript(_script: MoneyMindScript): Promise<boolean>;
    runScript(_script: MoneyMindScript, _timeoutMs: number): Promise<MoneyMindRunResult>;
}
