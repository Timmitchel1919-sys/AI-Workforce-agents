/**
 * EO-6.2 — derived at READ time from the actually-composed registry, the
 * same "connected vs capable" shape as `deriveReleaseCapabilities`
 * (core/release/release-capabilities.ts). `enforcement` is true only when a
 * real model provider is registered; with none registered — production's
 * state today — the budget gate and usage ledger exist but are INERT: no
 * call is ever made, so nothing is ever recorded or enforced.
 */
import type { CostCenterCapabilities } from "../../contracts/index.js";

export interface CostCenterCapabilityInputs {
  providers: { list(): string[] };
}

export function deriveCostCenterCapabilities(inputs: CostCenterCapabilityInputs): CostCenterCapabilities {
  return {
    get enforcement() {
      return inputs.providers.list().length > 0;
    },
    get providerIds() {
      return inputs.providers.list();
    },
  };
}
