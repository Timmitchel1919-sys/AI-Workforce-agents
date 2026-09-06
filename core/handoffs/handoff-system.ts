import { type Handoff, validateHandoff } from "../../contracts/index.js";
import { createId, now } from "../shared.js";
export type NewHandoff = Omit<Handoff, "id" | "createdAt">;
export class HandoffSystem {
  private readonly handoffs: Handoff[] = [];
  create(input: NewHandoff): Handoff { const handoff: Handoff = { id: createId("handoff"), createdAt: now(), ...input }; validateHandoff(handoff); this.handoffs.push(handoff); return handoff; }
  forTask(taskId: string): Handoff[] { return this.handoffs.filter((handoff) => handoff.taskId === taskId); }
}
