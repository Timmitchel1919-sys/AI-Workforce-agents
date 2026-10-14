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
const command =
  process.platform === "win32" ? (name) => `${name}.cmd` : (name) => name;
for (const [name, executable, args] of stages) {
  console.log(`\n=== ${name} ===`);
  const code = await new Promise((resolve) => {
    const child = spawn(command(executable), args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) {
    console.error(`NOT READY FOR STAGING — ${name} failed`);
    process.exit(code);
  }
}
console.log("READY FOR STAGING");
