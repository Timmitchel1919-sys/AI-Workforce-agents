/**
 * Firebase Functions Gen 2 entrypoint for the AI Workforce Control Plane.
 *
 * The heavy runtime graph (Firebase adapters, agents, model providers) is
 * deliberately NOT imported at module scope: the Functions deploy analyzer
 * loads this module to enumerate exports and aborts after ~10s, while the full
 * graph takes far longer to import. Instead the runtime is loaded dynamically
 * on the first request and cached by the adapter singleton per instance.
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
export const CONTROL_PLANE_FUNCTION_NAME = "controlPlaneApi";
export const CONTROL_PLANE_REGION = "us-central1";
export const CONTROL_PLANE_MEMORY = "512MiB";
export const CONTROL_PLANE_CPU = 1;
export const CONTROL_PLANE_TIMEOUT_SECONDS = 60;
export const CONTROL_PLANE_MAX_INSTANCES = 2;
// The Firebase platform injects this value only into this Function's runtime.
// The underlying OpenAI provider reads the same server-side variable lazily.
const openAiApiKey = defineSecret("OPENAI_API_KEY");
export const controlPlaneApi = onRequest({
    region: CONTROL_PLANE_REGION,
    memory: CONTROL_PLANE_MEMORY,
    cpu: CONTROL_PLANE_CPU,
    timeoutSeconds: CONTROL_PLANE_TIMEOUT_SECONDS,
    maxInstances: CONTROL_PLANE_MAX_INSTANCES,
    // The HTTPS endpoint is reachable publicly; the Control Plane itself
    // authenticates and authorizes every protected route.
    invoker: "public",
    cors: false,
    secrets: [openAiApiKey],
}, async (request, response) => {
    const handler = await loadControlPlaneHandler();
    await handler(request, response);
});
/**
 * Lazily assembles the HTTP handler for the production runtime. Importing the
 * graph costs tens of seconds with its provider SDKs, so it only happens on a
 * cold start (first request of an instance) rather than during module scan or
 * every warm invocation.
 */
async function loadControlPlaneHandler() {
    const [{ createControlPlaneHttpsAdapter }, { createProductionControlPlaneRuntime },] = await Promise.all([
        import("./control-plane-function.js"),
        import("../api/production-control-plane.js"),
    ]);
    return createControlPlaneHttpsAdapter(createProductionControlPlaneRuntime);
}
