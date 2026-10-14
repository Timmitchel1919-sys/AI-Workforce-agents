import { spawn } from "node:child_process";
const project = process.env.STAGING_FIREBASE_PROJECT_ID?.trim();
const base = process.env.STAGING_BASE_URL?.trim();
if (!project || !base) {
  console.error(
    "NOT READY FOR STAGING — explicit staging project and URL are required",
  );
  process.exit(1);
}
const check = spawn(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "staging:check"],
  { stdio: "inherit", shell: false },
);
check.on("exit", (code) => {
  if (code !== 0) process.exit(code ?? 1);
  const verify = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "verify:release"],
    { stdio: "inherit", shell: false },
  );
  verify.on("exit", (result) => {
    if (result !== 0) process.exit(result ?? 1);
    const firebase = spawn(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["firebase-tools", "deploy", "--project", project],
      { stdio: "inherit", shell: false },
    );
    firebase.on("exit", (deployCode) => process.exit(deployCode ?? 1));
  });
});
