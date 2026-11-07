# Blender MCP Setup Notes

Operator-facing setup notes for installing the Blender MCP server on a local workstation so Claude (Desktop or compatible MCP clients) can drive Blender.

These notes document a local developer workstation workflow. They are not a CI step, not part of the deployment pipeline, and do not add a runtime dependency to the AI Workforce platform. Nothing in this repo imports or executes the installer.

## Scope

- Target host: operator's own workstation (currently documented for Windows; macOS/Linux variants follow the same safety model).
- MCP client: Claude Desktop (standard MCP client location documented below).
- Blender: a locally installed Blender build (3.x or later) owned by the operator.
- Not in scope: running Blender headless in cloud sessions, bundling Blender with platform services, or exposing MCP endpoints over the network.

## Install source

- Vendor-supplied PowerShell installer: `https://www.mcp-for-blender.com/install.ps1`
- The domain is third-party. Treat the script as untrusted until reviewed. Do not use the common `irm | iex` piped-execution pattern.
- Trusted alternative worth evaluating before adopting the vendor script: the community reference implementation at `https://github.com/ahujasid/blender-mcp` (Apache-2.0). Some vendor scripts wrap this project; others ship their own addon.

## Prerequisites

- Windows 10 or 11 with PowerShell 5.1+ or PowerShell 7+.
- Blender installed, launched at least once (so its user config directory exists).
- Claude Desktop installed and launched at least once (so `claude_desktop_config.json` exists).
- A dedicated working directory for the install, for example `C:\BlenderMCP`.

## Install procedure

Run these steps on the operator's workstation. Do not run them in cloud sessions, CI runners, or shared build hosts.

1. Create a dedicated folder.
   ```powershell
   mkdir C:\BlenderMCP
   Set-Location C:\BlenderMCP
   ```
2. Download the installer without executing it.
   ```powershell
   Invoke-WebRequest -Uri https://www.mcp-for-blender.com/install.ps1 -OutFile .\install.ps1
   ```
3. Review `install.ps1` end-to-end before running. Record the following in a local notes file:
   - Every outbound URL the script contacts.
   - Every filesystem path it writes to (Blender addon directory, Claude Desktop config, `%APPDATA%`, `Program Files`, `PATH`).
   - Every registry key, scheduled task, or service it creates.
   - Whether it requires elevation (admin).
   - Whether it disables PowerShell execution policy or TLS verification (either is a stop-and-reassess signal).
4. Run the installer explicitly, not piped.
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\install.ps1
   ```
   Keep the terminal open; capture its output to a log for the audit trail.
5. Verify (next section) before enabling the integration for any sensitive project.

## Expected modifications

A typical Blender MCP installer modifies these locations. Confirm the actual installer matches before trusting it:

- Blender addon directory: `%APPDATA%\Blender Foundation\Blender\<version>\scripts\addons\` — a Python addon package is added here.
- Blender user preferences — the addon is enabled and persisted.
- Claude Desktop MCP config: `%APPDATA%\Claude\claude_desktop_config.json` — a new entry under `mcpServers` points at the Blender MCP server executable or script, with stdio transport.
- Possibly `PATH` or a shim in `%LOCALAPPDATA%` for the server launcher.

Record the exact paths the installer touches; they are the uninstall surface.

## Verification

1. Inspect `claude_desktop_config.json`:
   ```powershell
   Get-Content "$env:APPDATA\Claude\claude_desktop_config.json"
   ```
   Confirm a new `mcpServers` entry exists and its `command` and `args` point at files inside `C:\BlenderMCP` or a known install path.
2. Restart Claude Desktop so it picks up the new MCP server.
3. Launch Blender. In `Edit -> Preferences -> Add-ons`, confirm the Blender MCP addon is listed and enabled.
4. Smoke test from Claude Desktop with Blender running. A minimal prompt such as "create a red cube" should produce a cube in the running Blender session. If nothing happens, check the MCP server's stdout in Claude Desktop's developer logs.

## Rollback

- Remove the `mcpServers` entry added to `claude_desktop_config.json`.
- Disable and remove the Blender addon through Blender's Preferences panel, then delete the addon directory under `%APPDATA%\Blender Foundation\...\addons\`.
- Delete `C:\BlenderMCP` (or whichever install directory was used).
- If the installer added a PATH entry, remove it from User or System environment variables.
- Restart Claude Desktop and Blender.

## Security considerations

- The installer is third-party. Reviewed-then-run is the baseline; piped execution is not acceptable for operator workstations that also hold production credentials.
- The MCP server runs as the operator's user account. Treat it as having full read/write over anything that user can touch, including Blender files, saved credentials in the user profile, and any local repos.
- Do not install on a host that also runs unattended production jobs or holds long-lived cloud credentials for production. Use a workstation account that is sandboxed from production secrets.
- Keep `install.ps1`, the audit notes from step 3, and the resulting `claude_desktop_config.json` diff in a local, version-controlled notes folder outside this repo. Do not commit real config files containing API keys or local paths.

## Environment notes

- This integration does not belong in this repo's `environment` setup scripts, CI workflows, or deployment pipeline. No change to this platform's runtime is required to use Blender MCP locally.
- If a future requirement to drive Blender from platform-hosted agents emerges, that is a separate architecture decision (headless Blender, sandboxed render workers, content provenance controls) and should be proposed via an ADR.
