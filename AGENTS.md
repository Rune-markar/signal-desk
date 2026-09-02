# Remote-first project guide

## Source-of-truth boundaries

- Read `remote-environment.json` and `REMOTE_ENVIRONMENT.md` before changing setup, runtime, deployment, storage, or authentication behavior.
- Git is the source of truth for code. Notion is the source of truth for operating decisions and handoffs. Production data and secrets remain in their designated services.
- Treat the shared VPS as a reproducible development and verification host, not as the only backup or an implicit production server.

## Before editing

- Run `git status --short --branch`, identify the current commit, and preserve unrelated work.
- Use a task branch or Git worktree for concurrent work.
- Run `npm run remote:check`. If it reports a runtime or role mismatch, correct the host instead of weakening the manifest without evidence.

## Verification and deployment

- Run `npm run remote:verify` before handoff.
- Set `REMOTE_HOST_ROLE` explicitly for specialized hosts.
- Run `npm run remote:guard-deploy` before any publication, but remember that the guard does not replace explicit user authorization.
- Record the verified commit, host role, checks, push state, deploy state, and remaining local-only checks in Notion.

## Security

- Never copy or commit OAuth tokens, browser profiles, private keys, `.env` files, Wrangler state, credential stores, or production data.
- Development services listen on localhost by default. Use SSH forwarding, an authenticated tunnel, or a private VPN when remote browser access is needed.
- Do not expose Codex app-server or unauthenticated development ports directly to the internet.
