import { spawnSync } from "node:child_process";
const project = "demo-ai-workforce";
if (
  process.env.FIREBASE_PROJECT_ID &&
  process.env.FIREBASE_PROJECT_ID !== project
)
  throw new Error(
    "Firebase emulator tests require FIREBASE_PROJECT_ID=demo-ai-workforce",
  );
const java = spawnSync(
  process.platform === "win32" ? "java.exe" : "java",
  ["-version"],
  { stdio: "ignore" },
);
if (java.error || java.status !== 0) {
  console.error("BLOCKED — FIRESTORE EMULATOR REQUIRES JAVA");
  process.exit(1);
}
console.log(`Emulator runtime valid for ${project}; Java available.`);
