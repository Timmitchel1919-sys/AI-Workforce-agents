import type { OperatorProfile, OperatorProfileStore } from "../../contracts/index.js";
/** In-memory `OperatorProfileStore` (tests, local runs). */
export declare class InMemoryOperatorProfileStore implements OperatorProfileStore {
    private readonly profiles;
    get(operatorId: string): Promise<OperatorProfile | undefined>;
    save(profile: OperatorProfile): Promise<void>;
    remove(operatorId: string): Promise<void>;
}
