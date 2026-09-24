import type {
  OperatorProfile,
  OperatorProfileStore,
} from "../../contracts/index.js";

/** In-memory `OperatorProfileStore` (tests, local runs). */
export class InMemoryOperatorProfileStore implements OperatorProfileStore {
  private readonly profiles = new Map<string, OperatorProfile>();

  async get(operatorId: string): Promise<OperatorProfile | undefined> {
    const profile = this.profiles.get(operatorId);
    return profile ? structuredClone(profile) : undefined;
  }

  async save(profile: OperatorProfile): Promise<void> {
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async remove(operatorId: string): Promise<void> {
    this.profiles.delete(operatorId);
  }
}
