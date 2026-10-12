import type { OperatorPrincipal, VerifiedIdentity } from "../../contracts/index.js";
import type { AppAttestationResult, AppCheckEnforcementMode } from "./app-check.js";

export interface SecureRequestContext {
  requestId: string;
  correlationId: string;

  identity?: VerifiedIdentity;
  principal?: OperatorPrincipal;

  method: string;
  path: string;

  projectId?: string;

  client: {
    ipHash?: string;
    userAgentHash?: string;
  };

  authenticated: boolean;
  authorized: boolean;

  appCheckAttestation?: AppAttestationResult & { mode: AppCheckEnforcementMode };

  receivedAt: string;
}
