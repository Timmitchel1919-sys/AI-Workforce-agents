const fs = require("fs");
const glob = require("glob");

// We will just patch the validateAgent and related functions to default organizationId to org-1
// This satisfies tests without breaking everything. Wait, no, we can patch tests.
let count = 0;
for (const file of glob.sync("tests/**/*.ts")) {
  let content = fs.readFileSync(file, "utf8");
  let original = content;

  // fix Agent mocks in tests
  content = content.replace(
    /function makeAgent\(([^)]*)\)(.*?)\{([\s\S]*?)return \{/g,
    'function makeAgent($1)$2{$3return {\n    organizationId: "org-1",',
  );
  content = content.replace(
    /const makeAgent = .*?=> \(\{\n/g,
    '$&\n  organizationId: "org-1",\n',
  );

  if (content !== original) {
    fs.writeFileSync(file, content);
    count++;
  }
}
console.log("Fixed", count, "files");
