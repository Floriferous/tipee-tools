# Architecture

**Status:** describes the code on `main`: an Effect 4 client generated from
Tipee's OpenAPI document, an MCP server with one tool per operation, and one
bundle of it shipped as a Claude Code plugin and a Claude Desktop extension.
The [README](README.md) tells the user's side; change both together.

## Shape

```
tipee-tools/
├── packages/
│   ├── core/                      # generated HttpApi, TipeeClient, operation catalogue, errors, test kit
│   │   ├── spec/                  # Tipee's OpenAPI document, one pinned version
│   │   └── scripts/               # generate.ts (patch + generate), refresh.ts (pnpm spec:refresh)
│   └── mcp/                       # toolkit, handlers, check, updates, telemetry, stdio server
├── plugins/
│   └── tipee/                     # the plugin, also workspace package @tipee-tools/plugin
│       ├── .claude-plugin/plugin.json   # name, version, userConfig (instance, api_key)
│       ├── .mcp.json                    # node ${CLAUDE_PLUGIN_ROOT}/server/tipee-mcp.mjs
│       ├── src/main.ts + tsdown.config  # bundles @tipee-tools/mcp into server/
│       ├── scripts/pack-mcpb.ts         # Claude Desktop manifest and .mcpb
│       ├── server/tipee-mcp.mjs         # the bundled server (pnpm build), committed
│       └── skills/tipee/                # user-facing skill and the rights table
├── .claude-plugin/marketplace.json      # lists ./plugins/tipee: the repo is the marketplace
├── .claude/skills/                      # contributor skills: tipee, effect-v4
├── .github/workflows/                   # verify.yml (checks, then releases), spec-refresh.yml
└── turbo.json                           # task graph: transit nodes, root lint/format, bundle outputs
```

## Why Effect 4

One library covers what would otherwise be five: `HttpApi` and `Schema` for
the generated API, its client and the tools' JSON Schemas; `HttpClient` for
timeouts, retries and typed failures; `Config` for settings, the key kept
`Redacted`; `McpServer`, `Tool` and `Toolkit` for the server; `@effect/vitest`
for tests on a controllable clock. [Effect 4.0][effect-40] is stable, but
`http`, `http-api` and `ai` are marked unstable and may change in a minor
release: the version is pinned exactly, Renovate moves the Effect packages
together, and `.claude/skills/effect-v4` keeps agents from writing v3.

## Why MCP

Both Claude apps launch an MCP server as a declared command with a declared
environment, so the key they collected reaches it without touching a file,
and Claude Desktop runs it with its own Node. Claude Code keeps plugin secrets
out of Bash commands, so a CLI would need key storage of its own for no gain.

## Generated, and patched in one place

`@effect/openapi-generator` turns the vendored document into
`packages/core/src/generated/TipeeApi.ts`, committed and never edited.
`HttpApi.reflect` yields the operation catalogue, and each operation becomes a
strict `Tool.dynamic` (69, plus `check_setup` and `update_plugin`), read-only
or destructive by its verb. Wherever the document disagrees with Tipee or with
what Claude needs, the fix is a JSON Patch in `packages/core/scripts/generate.ts`,
nowhere else; granting and revoking roles are left out. Every Monday a
workflow runs `pnpm spec:refresh --bump`, which fetches Tipee's newest stable
document and regenerates, and opens one PR with what moved and the version
bumped (a `needs-major` label when an operation disappears).

## One bundle, two channels

The plugin's only build bundles `@tipee-tools/mcp` and Effect into
`plugins/tipee/server/tipee-mcp.mjs` with tsdown, for Node 22.19 and without
JSDoc. The file is committed and `pnpm verify` fails when it is stale, so
installing the plugin installs nothing: Claude Code clones the marketplace and
runs it with `node`. `pnpm pack` wraps the same file in `tipee-<version>.mcpb`
with a manifest generated from the toolkit, so tool names and descriptions
cannot drift. Claude Desktop reads no skills, so the server's instructions,
the tool descriptions (every write asks Claude to confirm first) and the error
messages, each naming its fix, carry the guidance.

## Settings

The instance and the key come from the client: the plugin's `userConfig` in
Claude Code (through `.mcp.json`), the manifest's `user_config` in Claude
Desktop; both keep the key as a secret. The server reads `TIPEE_INSTANCE` and
`TIPEE_API_KEY` with `Config`. The instance is normalized (`ACME` and
`https://acme.tipee.net/` give `acme`) and refused unless it is one DNS label,
so no value sends the key to another host; the key is trimmed and `Redacted`.
A missing or invalid setting stops the server before it answers: it writes
why on stderr, which Claude keeps in its MCP logs, and records `server_failed`.
An unknown instance or a refused key is a tool error naming the setting to
fix. `TIPEE_POSTHOG_HOST`, `TIPEE_POSTHOG_KEY`, `TIPEE_RELEASES_URL`,
`TIPEE_DOWNLOAD_BASE`, `TIPEE_UPDATE_CHANNEL` and `TIPEE_OPENER` exist for
tests and forks, not users.

## Updates and telemetry

**Updates.** `check_setup` looks up GitHub's latest release each time, keeping
nothing on disk; a failed lookup means nothing to report. `update_plugin` acts
by the channel the server's path reveals. In Claude Desktop it downloads
`tipee-<version>.mcpb` to a temporary directory and checks it against the
release's `SHA256SUMS`; on macOS it opens the file, so Claude Desktop asks to
update and keeps the settings, and elsewhere it says where the file is. In
Claude Code it gives the update commands: marketplace auto-update is off by
default.

**Telemetry** is always on and disclosed in the README. Events go to PostHog's
EU cloud in batches that never delay a tool: a session at a launch's first
tool call, each call's tool, duration and outcome, and the failures that point
at a bug or at Tipee drifting from its document, by reason, status and field
paths, never with Tipee's text. An installation is a hash of the machine and
account names, grouped under its Tipee instance.

## Platforms and Node

Claude Desktop runs the extension with its own Node on macOS and Windows; on
Windows the update only downloads, and the user opens the file. The Linux beta
is untested. Claude Code needs `node` 22.19 or newer on its PATH, the first
22.x with `tls.setDefaultCACertificates`, which lets the server trust the
system's certificates where a network inspects HTTPS. Contributors use Node
24, which runs the TypeScript sources directly.

## Two skills

`.claude/skills/tipee` and `.claude/skills/effect-v4` brief whoever develops
this repository. `plugins/tipee/skills/tipee` explains the _product_ to its
users in Claude Code (the tools, confirming before every write, the
token-rights trap, redacted values) and never mentions the repository.

## Development

- `pnpm mcp` runs the server from source; `claude --plugin-dir ./plugins/tipee`
  loads the plugin after `pnpm build`.
- Turborepo runs `check`, `test`, `build` and `pack` per package, cached;
  transit nodes carry a dependency's change to its dependents.
- `pnpm fix` applies the fixers and regenerates; `pnpm verify` only checks
  (generate, lint, format, types, tests, bundle, pack, freshness of committed
  files) and is what CI runs. The pre-commit hook runs `pnpm fix`, then
  `check` and `test`.
- Every package is tested against the MSW fake of Tipee in
  `@tipee-tools/core/testing`, which enforces Tipee's real rules.
- `@effect/tsgo` makes `tsc`, oxlint and the editor report Effect diagnostics.
- Renovate proposes weekly updates behind a cooldown; pnpm refuses versions
  younger than a day, trust downgrades and exotic transitive sources.

## Releases

`main` is the Claude Code channel, and Claude Code installs a new plugin only
when its version changes. So a PR that changes what ships (the bundle, the
skill, `.mcp.json`, the manifest) bumps `plugin.json` and `SERVER_VERSION`,
Renovate and spec-refresh PRs included, and CI refuses shipped changes under a
released version. Merging a bump publishes the release: a job in `verify.yml`
tags `v<version>` and publishes the `.mcpb` verify built, as
`tipee-<version>.mcpb` and `tipee.mcpb` with `SHA256SUMS`, names every
installed update tool relies on. A broken release is fixed by a new patch.

## Not planned, and what would change that

- **A CLI or npm packages**: a user who wants Tipee in a terminal or another
  agent; a CLI on `effect/cli` would share the core.
- **A hosted connector** (remote MCP with OAuth): a company that wants a
  zero-install rollout, and someone to run the service and hold its keys.
- **Signing the `.mcpb`**: a signature that removes Claude Desktop's "not
  verified" warning, or an organization that requires one.
- **The MCP registry**: a Claude app or an allowlist that installs from it.
- **Anthropic's directory**: demand beyond those who find this repository.

[effect-40]: https://effect.website/blog/releases/effect/40
