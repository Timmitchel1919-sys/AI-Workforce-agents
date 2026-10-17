import { spawn } from "node:child_process";
const stages = [
  ["typecheck", "npm", ["run", "typecheck"]],
  ["lint", "npm", ["run", "lint", "--", "--quiet"]],
  ["format", "npm", ["run", "format:check"]],
  ["backend unit tests", "npm", ["run", "test:unit"]],
  ["Firebase emulator tests", "npm", ["run", "test:firebase"]],
  ["UI tests", "npm", ["--prefix", "ui", "run", "test:ci"]],
  ["backend build", "npm", ["run", "build"]],
  ["UI build", "npm", ["--prefix", "ui", "run", "build"]],
  ["security checks", "npm", ["run", "security:check"]],
  ["git diff check", "git", ["diff", "--check"]],
];
function resolveCommand(command) {
  if (process.platform === "win32") {
    if (command === "npm") return "npm.cmd";
    if (command === "npx") return "npx.cmd";
  }
  return command;
}

function run(command, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommand(command), args, {
      stdio: "inherit",
      // Windows cannot execute .cmd shims with shell:false in some Node/npm
      // installations; use the platform command shell only for those shims.
      shell:
        process.platform === "win32" &&
        (command === "npm" || command === "npx"),
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code ?? 1}`));
        return;
      }
      resolve();
    });
  });
}

for (const [name, executable, args] of stages) {
  console.log(`\n=== ${name} ===`);
  try {
    await run(executable, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`NOT READY FOR STAGING — ${name} failed: ${message}`);
    process.exitCode = 1;
    break;
  }
}
if (process.exitCode === undefined) {
  console.log("READY FOR STAGING");
}
