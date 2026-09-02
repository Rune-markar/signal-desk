# Remote environment operations

This repository is designed to run from local computers or a shared VPS without copying an active working directory between machines.

## Sources of truth

- Git is the source of truth for code and history.
- The project Notion page is the source of truth for operating decisions, handoffs, and verification records.
- The configured hosting or storage service is the source of truth for production data and secrets.
- A VPS checkout is reproducible infrastructure, not the only backup and not a substitute for Git.

## Host roles

Set `REMOTE_HOST_ROLE` before running checks when the host performs a specialized role. The available roles and their requirements are declared in `remote-environment.json`. The default role is `development`.

Never copy OAuth tokens, browser profiles, private keys, `.env` files, Wrangler state, or credential stores between computers. Authenticate each authorized host independently.

## Commands

```text
npm run remote:check
npm run remote:setup
npm run remote:verify
npm run remote:guard-deploy
```

- `remote:check` verifies Git, Node, required tools, the selected host role, and environment-variable presence without printing secret values.
- `remote:setup` runs the version-controlled bootstrap commands for the current operating system.
- `remote:verify` runs the project verification commands after the readiness check passes.
- `remote:guard-deploy` verifies that the selected host role is authorized to publish. It does not deploy by itself.

## VPS workflow

1. Connect with a dedicated non-root SSH account and a separate SSH key for each client device.
2. Clone the repository on the VPS; do not synchronize `node_modules`, virtual environments, build caches, or active Git working trees.
3. Set `REMOTE_HOST_ROLE=development`, then run `npm run remote:setup` and `npm run remote:verify`.
4. Use a task branch or Git worktree for each concurrent change.
5. Commit and push completed work, then record the commit and verification result in Notion.
6. Perform browser, Passkey, notification, media-device, PowerShell-only, and LAN-only checks on the designated local host.

Development servers should listen on localhost by default. Use SSH port forwarding, an authenticated tunnel, or a private VPN when remote browser access is required. Do not expose Codex app-server or unauthenticated development ports directly to the internet.
