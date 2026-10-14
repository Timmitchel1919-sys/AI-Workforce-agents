import { spawn } from "node:child_process";
const base = process.env.STAGING_BASE_URL?.trim();
if (!base) {
  console.error("STAGING VERIFICATION FAILED — STAGING_BASE_URL is missing");
  process.exit(1);
}
const child = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "run",
    "verify:production",
    "--",
    "--base",
    base,
    "--health-path",
    "/api/health",
    "--allow-host",
    ".web.app",
    "--allow-host",
    ".firebaseapp.com",
  ],
  { stdio: "inherit", shell: false },
);
child.on("exit", (code) => {
  if (code === 0) console.log("STAGING VERIFIED — READY FOR RELEASE REVIEW");
  else
    console.error("STAGING VERIFICATION FAILED — verifier returned a failure");
  process.exit(code ?? 1);
});
