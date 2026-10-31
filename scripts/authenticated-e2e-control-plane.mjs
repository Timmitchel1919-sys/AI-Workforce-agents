import { createServer } from "node:http";
import { getAuth } from "firebase-admin/auth";
import { createFirebaseServices } from "../dist/adapters/firebase/firebase-services.js";
import { bootstrapInitialAdministrator } from "../dist/api/bootstrap-initial-admin.js";
import { createProductionControlPlaneRuntime } from "../dist/api/production-control-plane.js";

const host = "127.0.0.1";
const port = 8787;
const collectionPrefix = "e2e_";
const ownerUid = "e2e-owner";
const pendingUid = "e2e-pending";
const viewerUid = "e2e-viewer";
const ownerEmail = process.env.AIW_E2E_OWNER_EMAIL;
const pendingEmail = process.env.AIW_E2E_PENDING_EMAIL;
const viewerEmail = process.env.AIW_E2E_VIEWER_EMAIL;
const password = process.env.AIW_E2E_PASSWORD;

if (!ownerEmail || !pendingEmail || !viewerEmail || !password) {
  throw new Error("missing generated authenticated E2E identity configuration");
}

const services = await createFirebaseServices();
const auth = getAuth();

async function replaceUser(uid, email, displayName) {
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (error?.code !== "auth/user-not-found") throw error;
  }
  await auth.createUser({
    uid,
    email,
    password,
    displayName,
    emailVerified: true,
  });
}

await replaceUser(ownerUid, ownerEmail, "E2E Owner");
await replaceUser(pendingUid, pendingEmail, "E2E Pending");
await replaceUser(viewerUid, viewerEmail, "E2E Viewer");
const bootstrap = await bootstrapInitialAdministrator({
  services,
  uid: ownerUid,
  collectionPrefix,
});
if (
  bootstrap.outcome !== "created" &&
  bootstrap.outcome !== "already_provisioned"
) {
  throw new Error(
    `authenticated E2E administrator bootstrap ${bootstrap.outcome}`,
  );
}

const now = new Date().toISOString();
await services.firestore
  .collection(`${collectionPrefix}operators`)
  .doc(viewerUid)
  .set({
    id: viewerUid,
    status: "active",
    role: "viewer",
    allowedProjects: ["ai-workforce"],
    email: viewerEmail,
    displayName: "E2E Viewer",
    emailVerified: true,
    requestedAt: now,
    updatedAt: now,
    decidedBy: ownerUid,
    decidedAt: now,
    revision: 1,
  });

const runtime = await createProductionControlPlaneRuntime({
  services,
  collectionPrefix,
});
const server = createServer((request, response) => {
  void Promise.resolve(runtime.handler(request, response)).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});

server.listen(port, host, () => {
  console.log(
    `Authenticated E2E Control Plane listening on http://${host}:${port}`,
  );
});

const close = async () => {
  await runtime.flush();
  server.close(() => process.exit(0));
};
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
