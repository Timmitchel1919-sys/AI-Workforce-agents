import {
  NotFoundError,
  type MoneyMindScript,
} from "../../../contracts/index.js";
import type {
  MoneyMindRepoPort,
  MoneyMindRunResult,
} from "./money-mind-repo-port.js";

const UNAVAILABLE =
  "money-mind repository is not available in this runtime (no source configured)";

/**
 * The honest repository backend for a runtime that has no Money Mind source
 * (for example a Cloud Function without a checkout). It touches no
 * filesystem path, so nothing can be read, run, or planted into it: probes
 * report absence and every read or run fails with a clear NotFoundError.
 */
export class UnavailableMoneyMindRepo implements MoneyMindRepoPort {
  async exists(): Promise<boolean> {
    return false;
  }
  async readTextFile(): Promise<string> {
    throw new NotFoundError(UNAVAILABLE);
  }
  async listDirectory(): Promise<
    readonly { name: string; type: "file" | "dir" }[]
  > {
    throw new NotFoundError(UNAVAILABLE);
  }
  async hasScript(_script: MoneyMindScript): Promise<boolean> {
    return false;
  }
  async runScript(
    _script: MoneyMindScript,
    _timeoutMs: number,
  ): Promise<MoneyMindRunResult> {
    throw new NotFoundError(UNAVAILABLE);
  }
}
