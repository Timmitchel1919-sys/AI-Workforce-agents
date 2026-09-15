/**
 * Firebase Functions Gen 2 entrypoint for the AI Workforce Control Plane.
 *
 * It binds runtime configuration and the server-only OpenAI secret, then
 * delegates every HTTP request to the pre-composed Control Plane runtime.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { createProductionControlPlaneRuntime } from "../api/production-control-plane.js";
import { createControlPlaneHttpsAdapter } from "./control-plane-function.js";

export const CONTROL_PLANE_FUNCTION_NAME = "controlPlaneApi";
export const CONTROL_PLANE_REGION = "us-central1";
export const CONTROL_PLANE_MEMORY = "512MiB" as const;
export const CONTROL_PLANE_CPU = 1;
export const CONTROL_PLANE_TIMEOUT_SECONDS = 60;
export const CONTROL_PLANE_MAX_INSTANCES = 2;

// The Firebase platform injects this value only into this Function's runtime.
// The underlying OpenAI provider reads the same server-side variable lazily.
const openAiApiKey = defineSecret("OPENAI_API_KEY");

const handler = createControlPlaneHttpsAdapter(
  createProductionControlPlaneRuntime,
);

/**
 * Stable Gen 2 HTTPS Function identifier for DEPLOY-1C's future Hosting
 * rewrite. No Hosting rewrite is configured in DEPLOY-1B.
 */
export const controlPlaneApi = onRequest(
  {
    region: CONTROL_PLANE_REGION,
    memory: CONTROL_PLANE_MEMORY,
    cpu: CONTROL_PLANE_CPU,
    timeoutSeconds: CONTROL_PLANE_TIMEOUT_SECONDS,
    maxInstances: CONTROL_PLANE_MAX_INSTANCES,
    cors: false,
    secrets: [openAiApiKey],
  },
  handler,
);
