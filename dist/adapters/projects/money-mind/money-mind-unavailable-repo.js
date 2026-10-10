import { NotFoundError, } from "../../../contracts/index.js";
const UNAVAILABLE = "money-mind repository is not available in this runtime (no source configured)";
/**
 * The honest repository backend for a runtime that has no Money Mind source
 * (for example a Cloud Function without a checkout). It touches no
 * filesystem path, so nothing can be read, run, or planted into it: probes
 * report absence and every read or run fails with a clear NotFoundError.
 */
export class UnavailableMoneyMindRepo {
    async exists() {
        return false;
    }
    async readTextFile() {
        throw new NotFoundError(UNAVAILABLE);
    }
    async listDirectory() {
        throw new NotFoundError(UNAVAILABLE);
    }
    async hasScript(_script) {
        return false;
    }
    async runScript(_script, _timeoutMs) {
        throw new NotFoundError(UNAVAILABLE);
    }
}
