#!/usr/bin/env node
/**
 * R10 (ADR-0034) — Approve a base image for the Docker container runner.
 *
 * Pulls an image reference, extracts its content-addressable digest, runs
 * an opt-in Trivy scan, and writes an entry into
 * `docker/approved/images.json`. The output of this script is intended to
 * be the input of `AIW_CONTAINER_POLICY_JSON` — a reviewer still has to
 * paste it into deployment config.
 *
 * Usage:
 *   node scripts/approve-image.mjs <name>:<version>
 *   node scripts/approve-image.mjs node:22 --scan           # Trivy required
 *   node scripts/approve-image.mjs node:22 --severity HIGH  # scan threshold
 *
 * Fails CLOSED on:
 *   - docker not reachable;
 *   - digest cannot be resolved (manifest unreachable, tag doesn't exist);
 *   - --scan requested but Trivy reports findings >= severity threshold.
 *
 * Nothing in this script talks to the Control Plane; approval is a human
 * decision. The script just gathers the evidence a reviewer needs.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT = path.basename(process.argv[1] ?? "approve-image.mjs");

function usage(detail) {
  console.error(`${SCRIPT}: ${detail}`);
  console.error(
    `usage: ${SCRIPT} <name>:<version> [--scan] [--severity LEVEL] [--out <path>]`,
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = { scan: false, severity: "HIGH", out: "docker/approved/images.json" };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--scan") args.scan = true;
    else if (a === "--severity") args.severity = (argv[++i] ?? "HIGH").toUpperCase();
    else if (a === "--out") args.out = argv[++i] ?? args.out;
    else if (a.startsWith("--")) usage(`unknown flag ${a}`);
    else positional.push(a);
  }
  if (positional.length !== 1) usage("exactly one <name>:<version> is required");
  const [imageRef] = positional;
  const m = /^([A-Za-z0-9][A-Za-z0-9._/-]*):([A-Za-z0-9._-]+)$/.exec(imageRef);
  if (!m) usage(`image ref must be <name>:<version>, got ${imageRef}`);
  return { ...args, name: m[1], version: m[2] };
}

function run(cmd, cmdArgs) {
  const r = spawnSync(cmd, cmdArgs, { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

function requireDocker() {
  const r = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (r.code !== 0) {
    console.error(`${SCRIPT}: docker daemon not reachable (${r.stderr.trim()})`);
    process.exit(1);
  }
}

function resolveDigest(name, version) {
  // Pull first so the inspect has local evidence; a public image may
  // already be cached. We never trust a locally retagged image.
  const pull = run("docker", ["pull", `${name}:${version}`]);
  if (pull.code !== 0) {
    console.error(`${SCRIPT}: docker pull failed: ${pull.stderr.trim()}`);
    process.exit(1);
  }
  const inspect = run("docker", [
    "inspect",
    "--format",
    "{{index .RepoDigests 0}}",
    `${name}:${version}`,
  ]);
  if (inspect.code !== 0) {
    console.error(`${SCRIPT}: docker inspect failed: ${inspect.stderr.trim()}`);
    process.exit(1);
  }
  const line = inspect.stdout.trim();
  // Expected shape: <name>@sha256:<hex>
  const digestMatch = /@(sha256:[a-f0-9]{64})$/.exec(line);
  if (!digestMatch) {
    console.error(`${SCRIPT}: no sha256 digest in ${line}`);
    process.exit(1);
  }
  return digestMatch[1];
}

function runTrivy(name, version, severity) {
  const check = run("trivy", ["--version"]);
  if (check.code !== 0) {
    console.error(`${SCRIPT}: --scan requested but trivy is not installed`);
    process.exit(1);
  }
  console.log(`${SCRIPT}: scanning ${name}:${version} (severity>=${severity})…`);
  const r = run("trivy", [
    "image",
    "--quiet",
    "--severity",
    severity,
    "--exit-code",
    "1",
    "--no-progress",
    `${name}:${version}`,
  ]);
  if (r.code !== 0) {
    console.error(r.stdout);
    console.error(r.stderr);
    console.error(`${SCRIPT}: Trivy reported findings at ${severity}+; refusing to approve.`);
    process.exit(1);
  }
}

function updateRegistry(outPath, entry) {
  const abs = path.resolve(process.cwd(), outPath);
  mkdirSync(path.dirname(abs), { recursive: true });
  let registry = { approvedImages: [], requireDigest: true };
  if (existsSync(abs)) {
    try {
      registry = JSON.parse(readFileSync(abs, "utf8"));
    } catch {
      console.error(`${SCRIPT}: cannot parse existing ${abs}; refusing to overwrite`);
      process.exit(1);
    }
  }
  const existing = registry.approvedImages.find((i) => i.name === entry.name);
  if (existing) {
    if (!existing.versions.includes(entry.version)) {
      existing.versions.push(entry.version);
    }
    existing.digest = entry.digest;
  } else {
    registry.approvedImages.push({
      name: entry.name,
      versions: [entry.version],
      digest: entry.digest,
    });
  }
  writeFileSync(abs, JSON.stringify(registry, null, 2) + "\n", "utf8");
  return abs;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  requireDocker();
  if (args.scan) runTrivy(args.name, args.version, args.severity);
  const digest = resolveDigest(args.name, args.version);
  const written = updateRegistry(args.out, {
    name: args.name,
    version: args.version,
    digest,
  });
  console.log(
    JSON.stringify(
      {
        approved: true,
        name: args.name,
        version: args.version,
        digest,
        registry: written,
        scan: args.scan ? { severity: args.severity, result: "clean" } : "skipped",
      },
      null,
      2,
    ),
  );
}

main();
