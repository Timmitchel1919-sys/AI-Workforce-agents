import re

with open("api/http-api.ts", "r") as f:
    content = f.read()

# Fix the missing `url` declaration
content = re.sub(
    r'const path = ctx\.path; const method = ctx\.method;\n',
    r'const path = ctx.path; const method = ctx.method;\n    const url = new URL(req.url ?? "/", "http://localhost");\n',
    content
)

# Add Content-Type checking inside readJsonBody
read_json_body_replacement = """
async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  // Security Foundation V1 Step 5: Content-Type enforcement
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/json")) {
    throw new ValidationError("Expected Content-Type: application/json");
  }

  // Firebase HTTPS Functions uses Express and may have parsed the JSON body
"""
content = re.sub(
    r'async function readJsonBody\(\s*req: IncomingMessage,\s*maxBytes: number,\s*\): Promise<Record<string, unknown>> \{\s*// Firebase HTTPS Functions uses Express',
    read_json_body_replacement.strip(),
    content
)

with open("api/http-api.ts", "w") as f:
    f.write(content)
