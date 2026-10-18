/**
 * R10 (ADR-0034) — the on-disk `docker/approved/images.json` registry
 * must stay a valid `ContainerPolicy` input. This test enforces the
 * contract between the approval helper's output and the production
 * composition's `AIW_CONTAINER_POLICY_JSON` parser.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(HERE, "..", "..", "docker", "approved", "images.json");

test("R10: docker/approved/images.json parses as a ContainerPolicy", () => {
  const raw = readFileSync(REGISTRY, "utf8");
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.approvedImages), "approvedImages is an array");
  assert.equal(parsed.requireDigest, true, "requireDigest MUST default to true");
  for (const image of parsed.approvedImages) {
    assert.equal(typeof image.name, "string", "image.name is a string");
    assert.ok(image.versions.length > 0, "every image lists at least one version");
    // When requireDigest=true, every entry MUST carry a digest.
    assert.match(
      image.digest ?? "",
      /^sha256:[a-f0-9]{64}$/,
      `${image.name} needs a sha256 digest`,
    );
  }
});
