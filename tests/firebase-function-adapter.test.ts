import assert from "node:assert/strict";
import { createServer, request as requestFromHttp } from "node:http";
import test from "node:test";
import {
  createControlPlaneHttpsAdapter,
  type ControlPlaneHttpRuntime,
} from "../functions/control-plane-function.js";

interface ResponseSnapshot {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

async function request(
  handler: ReturnType<typeof createControlPlaneHttpsAdapter>,
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<ResponseSnapshot> {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    return await new Promise<ResponseSnapshot>((resolve, reject) => {
      const client = requestFromHttp(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path,
          method: options.method ?? "GET",
          headers: options.headers,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          });
        },
      );
      client.on("error", reject);
      if (options.body) client.write(options.body);
      client.end();
    });
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function runtime(
  handler: ControlPlaneHttpRuntime["handler"],
): ControlPlaneHttpRuntime {
  return { handler };
}

test("Firebase HTTPS adapter preserves health, path, and JSON response semantics", async () => {
  const handler = createControlPlaneHttpsAdapter(async () =>
    runtime((req, res) => {
      assert.equal(req.url, "/api/health");
      assert.equal(req.method, "GET");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    }),
  );

  const response = await request(handler, "/api/health");
  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json");
  assert.deepEqual(response.body, { status: "ok" });
});

test("Firebase HTTPS adapter preserves dashboard authorization headers", async () => {
  const handler = createControlPlaneHttpsAdapter(async () =>
    runtime((req, res) => {
      assert.equal(req.url, "/api/dashboard");
      assert.equal(req.headers.authorization, "Bearer controlled-test-token");
      res.writeHead(401, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: { message: "authentication required" } }),
      );
    }),
  );

  const response = await request(handler, "/api/dashboard", {
    headers: { authorization: "Bearer controlled-test-token" },
  });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    error: { message: "authentication required" },
  });
});

test("Firebase HTTPS adapter preserves unknown API routes", async () => {
  const handler = createControlPlaneHttpsAdapter(async () =>
    runtime((req, res) => {
      assert.equal(req.url, "/api/unknown-route");
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    }),
  );

  const response = await request(handler, "/api/unknown-route");
  assert.equal(response.status, 404);
  assert.deepEqual(response.body, { error: { message: "not found" } });
});

test("Firebase HTTPS adapter preserves POST method and body without parsing it", async () => {
  const payload = JSON.stringify({ action: "pause" });
  const handler = createControlPlaneHttpsAdapter(async () =>
    runtime((req, res) => {
      assert.equal(req.url, "/api/commands/pause-workflow");
      assert.equal(req.method, "POST");
      const chunks: Buffer[] = [];
      void (async () => {
        for await (const chunk of req) chunks.push(chunk as Buffer);
        assert.equal(Buffer.concat(chunks).toString("utf8"), payload);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      })();
    }),
  );

  const response = await request(handler, "/api/commands/pause-workflow", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});

test("Firebase HTTPS adapter initializes the Control Plane once per warm instance", async () => {
  let initializations = 0;
  const handler = createControlPlaneHttpsAdapter(async () => {
    initializations += 1;
    return runtime((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
  });

  await request(handler, "/api/health");
  await request(handler, "/api/health");
  assert.equal(initializations, 1);
});

test("Firebase HTTPS adapter returns a safe error when runtime initialization fails", async () => {
  const handler = createControlPlaneHttpsAdapter(async () => {
    throw new Error("OPENAI_API_KEY=should-never-reach-the-client");
  });

  const response = await request(handler, "/api/health");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, {
    error: { message: "control plane unavailable" },
  });
  assert.doesNotMatch(
    JSON.stringify(response.body),
    /OPENAI_API_KEY|should-never/,
  );
});
