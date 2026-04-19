# HappyClaw Project Review

This review summarizes the highest-value issues found in the current codebase and the practical conclusion about cross-Mac portability.

## Top Findings

### P0: Startup is not reproducible

- `container/agent-runner/package.json` declares `@anthropic-ai/claude-agent-sdk` as `*`.
- `Makefile` runs `ensure-latest-sdk` on `make start`, which may update dependencies during startup.
- `container/Dockerfile` also installs external tooling dynamically during image builds.

Impact:
- The same commit can start with different runtime behavior on different days.
- Startup depends on network availability and third-party registries.
- Incidents are harder to reproduce and roll back.

Recommended direction:
- Pin runtime dependencies to explicit versions.
- Remove automatic SDK updates from the production startup path.
- Treat dependency refresh as an explicit maintenance action.

### P0: Cross-machine usability depends on local runtime state

- The repository is not enough to restore a working installation.
- Real state lives in `data/` plus host-level Claude/Codex state on some setups.
- The app persists encrypted provider config, session data, workspaces, memory, MCP config, and avatars outside git.

Impact:
- "`git pull` and use it on another Mac" is not an accurate claim.
- Backup and restore need to be documented as a first-class workflow.

Recommended direction:
- Document the difference between fresh install and stateful restore.
- Expand the official backup scope.
- Add a dedicated environment/doctor check command later.

### P1: CORS defaults are too permissive for a credentialed local app

- The current server allows localhost-style origins broadly while also allowing credentialed requests.
- In practice this increases risk for local same-site access patterns.

Impact:
- Local hostile or accidental pages may have more access than expected.

Recommended direction:
- Default to same-origin only.
- Make relaxed localhost CORS explicitly opt-in for development.

### P1: Tests are missing and the test entrypoint is inconsistent

- The repo exposes a `test` script and a `make test` target, but they are not aligned.
- Critical paths still lack a minimum smoke suite.

Impact:
- Reliability regressions are likely to surface late.
- Different contributors may run different validation commands.

Recommended direction:
- Standardize on one test entrypoint.
- Add a minimum smoke suite for startup, auth, DB init, and one or two key routes.

### P2: README overstates symmetry and hides operational prerequisites

- README currently mixes marketing, architecture, and setup steps.
- Several statements are no longer exact, including fixed MCP tool counts and configuration claims.

Impact:
- New users get a distorted picture of what is required to run the system.

Recommended direction:
- Rewrite README around fast setup, environment requirements, execution modes, data layout, backup/restore, and troubleshooting.

## Cross-Mac Portability Conclusion

Current conclusion:

> HappyClaw is portable as a codebase plus runtime state, but it is not a stateless app that can be cloned on another Mac and used immediately without environment preparation.

What must exist on the target Mac:

- Node.js 20+.
- Docker or OrbStack if container mode is needed.
- Restored `data/` state for DB/config/session/workspace continuity.
- Restored host-level Claude/Codex credentials if those modes depend on `~/.claude` or `~/.codex`.

What should be included in official backup scope:

- `data/db`
- `data/config`
- `data/groups`
- `data/sessions`
- `data/skills`
- `data/memory`
- `data/mcp-servers`
- `data/avatars`

What can remain out of scope:

- `data/ipc`
- `data/env`
- `data/streaming-buffer`
- build artifacts and local dependency directories

## README Rewrite Goals

The README should answer these questions first:

1. What is HappyClaw?
2. What do I need before I run it?
3. What is the shortest path to first launch?
4. What state is stored locally?
5. How do I back it up and restore it?

Everything else should move behind those answers.
