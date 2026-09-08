/**
 * Firebase infrastructure adapters (ADR-0011), exercised against hand-written
 * in-memory fakes of the `firebase-admin` seams. `firebase-admin` itself is
 * never imported here — `npm test` stays fully offline.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  FirestoreRepository,
  FirebaseOperatorDirectory,
  FirestoreEventPublisher,
  FirebaseObjectStore,
  loadFirebaseConfig,
  type DecodedTokenLike,
  type FirebaseAuthLike,
  type FirestoreCollectionLike,
  type FirestoreDocRefLike,
  type FirestoreLike,
  type StorageBucketLike,
  type StorageFileLike,
} from "../adapters/index.js";
import type { Entity } from "../contracts/index.js";

/* ---------- Firestore fake -------------------------------------------------- */

class FakeCollection implements FirestoreCollectionLike {
  readonly store = new Map<string, Record<string, unknown>>();
  doc(id: string): FirestoreDocRefLike {
    const store = this.store;
    return {
      async set(data) {
        store.set(id, structuredClone(data));
      },
      async get() {
        const d = store.get(id);
        return {
          exists: d !== undefined,
          data: () => (d ? structuredClone(d) : undefined),
        };
      },
      async delete() {
        store.delete(id);
      },
    };
  }
  async get() {
    return {
      docs: [...this.store.entries()].map(([id, d]) => ({
        id,
        data: () => structuredClone(d),
      })),
    };
  }
  async listDocuments() {
    return [...this.store.keys()].map((id) => this.doc(id));
  }
}
class FakeFirestore implements FirestoreLike {
  readonly cols = new Map<string, FakeCollection>();
  collection(path: string): FakeCollection {
    let c = this.cols.get(path);
    if (!c) {
      c = new FakeCollection();
      this.cols.set(path, c);
    }
    return c;
  }
}

interface Widget extends Entity {
  id: string;
  label: string;
  note?: string;
}

test("firestore-repo: round-trips entities and strips undefined", async () => {
  const col = new FakeFirestore().collection("widgets");
  const repo = new FirestoreRepository<Widget>(col);

  await repo.upsert({ id: "w1", label: "one", note: undefined });
  await repo.upsert({ id: "w2", label: "two", note: "n" });

  assert.deepEqual(await repo.findById("w1"), { id: "w1", label: "one" });
  assert.equal((await repo.list()).length, 2);
  assert.ok(!("note" in (col.store.get("w1") as object)));

  assert.equal(await repo.delete("w1"), true);
  assert.equal(await repo.delete("w1"), false);
  assert.equal(await repo.findById("w1"), undefined);

  await repo.clear();
  assert.deepEqual(await repo.list(), []);
});

/* ---------- Auth fake ----------------------------------------------------- */

class FakeAuth implements FirebaseAuthLike {
  constructor(private readonly tokens: Record<string, DecodedTokenLike>) {}
  async verifyIdToken(idToken: string): Promise<DecodedTokenLike> {
    const decoded = this.tokens[idToken];
    if (!decoded) throw new Error("token expired or invalid");
    return decoded;
  }
}

test("operator-directory: maps verified claims to a principal", async () => {
  const dir = new FirebaseOperatorDirectory(
    new FakeAuth({
      "tok-op": { uid: "u1", role: "operator", allowedProjects: ["aims"] },
      "tok-admin": { uid: "u2", role: "admin", allowedProjects: "*" },
      "tok-badrole": { uid: "u3", role: "superuser", allowedProjects: "*" },
      "tok-noproj": { uid: "u4", role: "viewer" },
      "tok-badproj": { uid: "u5", role: "viewer", allowedProjects: [1, 2] },
    }),
  );

  assert.deepEqual(await dir.resolve("tok-op"), {
    id: "u1",
    role: "operator",
    allowedProjects: ["aims"],
  });
  assert.deepEqual(await dir.resolve("tok-admin"), {
    id: "u2",
    role: "admin",
    allowedProjects: "*",
  });
  assert.equal(await dir.resolve("tok-badrole"), null);
  assert.equal(await dir.resolve("tok-noproj"), null);
  assert.equal(await dir.resolve("tok-badproj"), null);
  assert.equal(await dir.resolve("unknown-token"), null);
  assert.equal(await dir.resolve(""), null);
});

/* ---------- Event publisher --------------------------------------------- */

test("event-publisher: writes a record and never throws", async () => {
  const col = new FakeFirestore().collection("control_events");
  let n = 0;
  const publisher = new FirestoreEventPublisher(col, {
    now: () => "2026-01-01T00:00:00.000Z",
    generateId: () => `evt-${++n}`,
  });

  publisher.publish({
    kind: "snapshot_invalidated",
    reason: "test",
    correlationId: "c1",
  });
  await new Promise((r) => setImmediate(r));

  assert.equal(col.store.size, 1);
  assert.deepEqual(col.store.get("evt-1"), {
    id: "evt-1",
    at: "2026-01-01T00:00:00.000Z",
    kind: "snapshot_invalidated",
    reason: "test",
    correlationId: "c1",
  });
});

test("event-publisher: a failing Firestore write is swallowed via onError", async () => {
  const errors: unknown[] = [];
  const badCol = {
    doc: () => ({
      set: () => Promise.reject(new Error("permission denied")),
      get: () => Promise.resolve({ exists: false, data: () => undefined }),
      delete: () => Promise.resolve(),
    }),
    get: () => Promise.resolve({ docs: [] }),
    listDocuments: () => Promise.resolve([]),
  } as unknown as FirestoreCollectionLike;

  const publisher = new FirestoreEventPublisher(badCol, {
    generateId: () => "evt-x",
    onError: (e) => errors.push(e),
  });
  assert.doesNotThrow(() =>
    publisher.publish({ kind: "snapshot_invalidated", reason: "x" }),
  );
  await new Promise((r) => setImmediate(r));
  assert.equal(errors.length, 1);
});

/* ---------- Object store ----------------------------------------------- */

class FakeFile implements StorageFileLike {
  constructor(
    readonly name: string,
    private readonly files: Map<
      string,
      { data: Buffer; contentType: string; updated: string }
    >,
  ) {}
  async save(
    data: Buffer | string,
    options?: { contentType?: string },
  ): Promise<unknown> {
    this.files.set(this.name, {
      data: Buffer.isBuffer(data) ? data : Buffer.from(data),
      contentType: options?.contentType ?? "application/octet-stream",
      updated: "2026-01-01T00:00:00.000Z",
    });
    return undefined;
  }
  async download(): Promise<[Buffer]> {
    const f = this.files.get(this.name);
    if (!f) throw new Error("not found");
    return [f.data];
  }
  async exists(): Promise<[boolean]> {
    return [this.files.has(this.name)];
  }
  async getMetadata(): Promise<[Record<string, unknown>]> {
    const f = this.files.get(this.name);
    return [
      {
        size: f?.data.length ?? 0,
        contentType: f?.contentType ?? "",
        updated: f?.updated ?? "",
      },
    ];
  }
  async delete(): Promise<unknown> {
    this.files.delete(this.name);
    return undefined;
  }
  async getSignedUrl(options: {
    action: "read";
    expires: number;
  }): Promise<[string]> {
    return [`https://signed.example/${this.name}?e=${options.expires}`];
  }
}
class FakeBucket implements StorageBucketLike {
  readonly files = new Map<
    string,
    { data: Buffer; contentType: string; updated: string }
  >();
  file(key: string): StorageFileLike {
    return new FakeFile(key, this.files);
  }
  async getFiles(options: {
    prefix: string;
  }): Promise<[readonly StorageFileLike[]]> {
    return [
      [...this.files.keys()]
        .filter((k) => k.startsWith(options.prefix))
        .map((k) => new FakeFile(k, this.files)),
    ];
  }
}

test("object-store: put / head / get / list / signedUrl / delete", async () => {
  const store = new FirebaseObjectStore(new FakeBucket());

  const meta = await store.put({
    key: "projects/aims/knowledge/spec.md",
    data: "# spec\n",
    contentType: "text/markdown",
  });
  assert.equal(meta.key, "projects/aims/knowledge/spec.md");
  assert.equal(meta.contentType, "text/markdown");
  assert.ok(meta.size > 0);

  const bytes = await store.get("projects/aims/knowledge/spec.md");
  assert.equal(Buffer.from(bytes!).toString("utf8"), "# spec\n");

  const listed = await store.list("projects/aims/");
  assert.equal(listed.length, 1);

  const url = await store.signedUrl("projects/aims/knowledge/spec.md", 60);
  assert.match(url!, /^https:\/\/signed\.example\//);

  assert.equal(await store.delete("projects/aims/knowledge/spec.md"), true);
  assert.equal(await store.get("projects/aims/knowledge/spec.md"), undefined);
  assert.equal(await store.head("missing"), undefined);
  assert.equal(await store.signedUrl("missing", 60), undefined);
  assert.equal(await store.delete("missing"), false);
});

/* ---------- Config ----------------------------------------------------- */

test("config: resolves project id and bucket from the environment", () => {
  const cfg = loadFirebaseConfig({
    FIREBASE_PROJECT_ID: "ai-workforce-agents",
  });
  assert.equal(cfg.projectId, "ai-workforce-agents");
  assert.equal(cfg.storageBucket, "ai-workforce-agents.appspot.com");
  assert.equal(cfg.emulated, false);

  const emu = loadFirebaseConfig({
    GOOGLE_CLOUD_PROJECT: "demo",
    FIRESTORE_EMULATOR_HOST: "localhost:8080",
    FIREBASE_STORAGE_BUCKET: "demo-bucket",
  });
  assert.equal(emu.projectId, "demo");
  assert.equal(emu.storageBucket, "demo-bucket");
  assert.equal(emu.emulated, true);

  assert.throws(() => loadFirebaseConfig({}), /project id/);
});
