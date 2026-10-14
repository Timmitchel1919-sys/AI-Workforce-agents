import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";

const project = process.env.STAGING_FIREBASE_PROJECT_ID?.trim();
const base = process.env.STAGING_BASE_URL?.trim();
const production = JSON.parse(readFileSync(resolve(".firebaserc"), "utf8"))
  .projects?.default;
const fail = (reason) => {
  console.error(`NOT READY FOR STAGING — ${reason}`);
  process.exit(1);
};
if (!project) fail("STAGING_FIREBASE_PROJECT_ID is missing");
if (!base) fail("STAGING_BASE_URL is missing");
let url;
try {
  url = new URL(base);
} catch {
  fail("STAGING_BASE_URL is not a valid URL");
}
if (url.protocol !== "https:") fail("STAGING_BASE_URL must use HTTPS");
if (project === production || url.hostname.includes("ai-workforce-agents"))
  fail("staging must not target the production Firebase project");
if (
  process.env.STAGING_EXPECTED_VERSION &&
  !process.env.STAGING_EXPECTED_VERSION.trim()
)
  fail("STAGING_EXPECTED_VERSION is empty");
console.log("STAGING CONFIG VALID");
