# Target architecture

**Status: decided 2026-09-13; phase 1 implemented the same day.** This
document records where tipee-tools is going and why. The [README](README.md)
describes what exists today. When the two disagree, the README is right about
the present and this file is right about the direction; update both as
phases land.

Two decisions taken after the first draft reshaped it: **everything is
written on Effect 4** (pinned exactly), and **the MCP server is
the v1 product**, with the CLI dropped rather than ported. The reasoning is
in the sections below; the original CLI-first plan survives as phase 3.

## Goals

- **Any company, any agent, any terminal.** A person at any company using
  Tipee should be able to install the tools and point them at their own
  instance in minutes, whether they work in Claude Code, another coding
  agent, or a plain shell.
- **Skills travel with the tools.** The CLI and the MCP server are only as
  useful as the instructions that tell an agent how and when to use them.
  Skills are a first-class deliverable, versioned and installed together with
  the code.
- **One source of truth.** A single repository produces every distribution
  channel. No channel carries logic the others lack.
- **The development loop stays instant.** No build step while developing;
  building is a publishing concern only.
- **Secrets never leave the machine.** API keys live in per-user storage,
  never in the repository, in chat, or in CI.

Non-goals for now: a terminal CLI and Windows support. Each has a place in
the phases below, neither blocks v1.

## Constraints that shaped the design

Each of these was checked against primary sources in September 2026.

1. **Publishing requires a build.** Node type-strips `.ts` files by default
   since 22.18 / 23.6, but refuses to do so for files under `node_modules`,
   explicitly to discourage publishing TypeScript sources
   ([Node.js TypeScript docs][node-ts]). The no-build model survives in
   development only; published packages ship compiled `dist/`.
2. **A Claude Code plugin can carry the whole product.** A plugin bundles
   `skills/`, a `.mcp.json`, and a `bin/` directory whose executables are put
   on the Bash tool's `PATH` while the plugin is enabled. If the plugin root
   has a `package.json` and an npm or Bun lockfile, Claude Code runs a frozen,
   scripts-disabled install into the plugin cache on installation; pnpm
   lockfiles are ignored ([Plugins reference][plugins-ref]).
3. **Plugins can collect credentials at install time.** A `userConfig` block
   prompts when the plugin is enabled; `sensitive` values go to the macOS
   Keychain. Values are substituted as `${user_config.KEY}` in MCP server
   configs and skills, and exported as `CLAUDE_PLUGIN_OPTION_<KEY>` to MCP
   servers and hooks. They are **not** exported to Bash tool commands
   ([Plugins reference][plugins-ref]).
4. **A repository can be its own marketplace.** `.claude-plugin/marketplace.json`
   lists plugins by relative path; users add it with
   `/plugin marketplace add owner/repo` and get background updates. Private
   repositories work but need a git credential helper or SSH for the
   background pull ([Plugin marketplaces][marketplaces]).
5. **SKILL.md is the cross-agent format.** The Agent Skills format is read by
   Claude Code, Codex, Cursor and dozens of other harnesses. The `skills`
   CLI installs from a repository's `skills/` directory or a direct path into
   the agent's skill directory; it does not install from npm
   ([vercel-labs/skills][skills-cli], [Vercel announcement][skills-announce]).
   Stripe is the reference pattern: skills in a repo, installable with that
   CLI, plus a native subcommand in their own CLI that installs them without
   Node ([Stripe skills][stripe-skills], [stripe-cli agentskills][stripe-agentskills]).
6. **The "recommend my plugin" nudge is closed to us.** A CLI can emit a
   `<claude-code-hint />` line that makes Claude Code offer a plugin install,
   but only for plugins in Anthropic's official marketplace
   ([Plugin hints][hints]).
7. **MCPB bundles are for Claude Desktop.** The `.mcpb` format gives
   one-click installation of a local MCP server with a user-config dialog,
   in Claude for macOS and Windows ([MCP Bundles][mcpb],
   [Desktop Extensions][dxt]).
8. **Single binaries are cheap.** `bun build --compile` cross-compiles to
   macOS, Linux and Windows from one runner and can embed assets
   ([Bun executables][bun-compile]); Node's own SEA is stable and gained a
   one-step `--build-sea` flag in 25.5 ([Node SEA][node-sea],
   [Node 25.5 release note][node-build-sea]). Either turns a Homebrew tap
   into a plain binary formula with no Node dependency.
9. **Publishing is tokenless.** npm trusted publishing over GitHub Actions
   OIDC generates provenance automatically and needs no long-lived token;
   `pnpm publish` performs the OIDC exchange natively
   ([npm trusted publishers][npm-oidc], [Tokenless publishing playbook][oidc-playbook]).

## Why Effect 4

Effect replaces four hand-rolled pieces with one coherent model, and the
MCP server becomes a composition of layers rather than a program:

| Concern                                                             | Effect 4 module                              | What it replaced                      |
| :------------------------------------------------------------------ | :------------------------------------------- | :------------------------------------ |
| Wire validation, tool parameter and output JSON Schema, error types | `Schema`                                     | zod schemas plus separate MCP schemas |
| HTTP with retries and typed failures                                | `HttpClient` (`effect/http`)                 | fetch and a retry loop                |
| Credentials                                                         | `Config.String`, `Config.Redacted`           | reading `process.env`                 |
| MCP server, tool annotations, stdio transport                       | `McpServer`, `Tool`, `Toolkit` (`effect/ai`) | the MCP SDK                           |
| Tests on a controllable clock                                       | `@effect/vitest`, `TestClock`                | fake timers                           |

The cost: Effect 4 is new (stable since 4.0.0, [RC announcement][effect-rc]), and the
modules we depend on that Effect marks `@stability unstable` (`http`,
`http-api`, `ai`) may still change in a minor release. The
version is pinned exactly, the touchpoints are few, and
`.claude/skills/effect-v4` records the idioms and renames so agents don't
write v3 from memory. The MSW fake Tipee survived the rewrite: `FetchHttpClient`
goes through global `fetch`, which MSW intercepts.

## Why MCP first, and no CLI

Inside Claude Code the plugin system treats MCP servers as the first-class
integration: a server is a declared command that Claude Code launches with a
declared environment, so credentials collected at install time reach it
directly and never touch disk. Bash-tool commands, by contrast, are composed
freely by the model, and Claude Code deliberately does not export plugin
secrets into them ([Plugins reference][plugins-ref]). A CLI in the plugin
would have needed a hook bridging the key into a file. For the first users,
all on Claude Code, the CLI added setup and a weaker credential posture for
no benefit, so it was removed. A terminal CLI returns in phase 3, on
`effect/cli`, when the first user outside Claude Code appears.

## Shape

```
tipee-tools/
├── packages/
│   ├── core/                      # TipeeClient service, schemas, errors, test kit
│   │   ├── spec/                  # Tipee's OpenAPI document
│   │   └── scripts/generate.ts    # patches the document, generates the HttpApi
│   └── mcp/                       # toolkit, handlers, stdio server, entry point
├── plugins/
│   └── tipee/                     # the Claude Code plugin, also workspace package @tipee-tools/plugin
│       ├── .claude-plugin/plugin.json   # name, version, userConfig (instance, api_key)
│       ├── .mcp.json                    # node ${CLAUDE_PLUGIN_ROOT}/server/tipee-mcp.mjs
│       ├── src/main.ts + tsdown.config  # bundles @tipee-tools/mcp into server/
│       ├── scripts/pack-mcpb.ts         # Claude Desktop manifest and .mcpb
│       ├── server/tipee-mcp.mjs         # the bundled server (pnpm build), committed
│       ├── skills/tipee/SKILL.md        # user-facing: tools, guardrails, quirks
│       ├── skills/tipee/roles.md        # the rights each tool needs
│       └── README.md                    # install, integration setup
├── .claude-plugin/marketplace.json      # lists ./plugins/tipee: the repo is the marketplace
├── .claude/skills/tipee/SKILL.md        # contributor-facing: how to work on this repo
├── .claude/skills/effect-v4/SKILL.md    # Effect 4 idioms and v4 gotchas
├── .github/workflows/                   # verify.yml on every push, release.yml on a v* tag
├── turbo.json                           # task graph: transit nodes, root lint/format, bundle outputs
└── ARCHITECTURE.md                      # this file
```

**The plugin carries the server, vendored.** The plugin is itself a workspace
package whose only build bundles `@tipee-tools/mcp` with every dependency
(Effect included) into one file under `plugins/tipee/server`, using tsdown
([docs][tsdown]). The file is committed;
the pre-commit hook rebuilds and restages it, and `pnpm verify` fails when
it is stale. Installing the plugin therefore installs nothing: Claude Code
clones the marketplace and runs the file with `node`. This is the simplest
thing that works for a handful of users and needs no npm account, no
publishing pipeline and no lockfile dance. The generated file in git is the
price, paid knowingly.

**The same bundle is the Claude Desktop extension.** `pnpm pack` (a Turborepo
task after `build`) generates an MCPB manifest from the toolkit, so tool names
and descriptions cannot drift, copies the bundle next to it, validates and
packs `dist/tipee-<version>.mcpb`. Claude Desktop collects the two values
through its own dialog, stores the key in the system keychain, and runs the
server with its bundled Node ([MCPB][mcpb]). This is the channel for
non-technical users; on Team and Enterprise plans an owner can upload the
extension once and allowlist it for the organisation. Skills are not read by
Claude Desktop, so the guidance lives in the server's instructions, the tool
descriptions (every write asks Claude to confirm first) and the error
messages, each of which names its fix. Signing is deferred.

**Two skills, on purpose.** `.claude/skills/tipee` explains this repository
to whoever develops it. `plugins/tipee/skills/tipee` explains the _product_
to whoever uses it: the tools, confirming before every write, the token-rights
trap, and how to read redacted values and intervals. The user-facing skill
never mentions this repo's internals.

## Installation, by persona

| Persona                               | Gets                                              | How                                                                                                                 |
| :------------------------------------ | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------ |
| Claude Code user (v1)                 | MCP server, skill, credential prompt              | `/plugin marketplace add Floriferous/tipee-tools`, then `/plugin install tipee@tipee-tools`; Node 24 on the machine |
| Codex, Cursor, other agents (phase 3) | Skill, plus the server via `.mcp.json` or the CLI | `npx skills add <direct path to plugins/tipee/skills/tipee>`, plus `npm i -g @tipee-tools/cli`                      |
| Human at a terminal (phase 3)         | CLI                                               | `npm i -g @tipee-tools/cli`, later a Homebrew tap                                                                   |
| Claude Desktop user (v1)              | MCP server with a config dialog, no Node install  | `tipee.mcpb` from the latest GitHub Release                                                                         |

Updates: Claude Code users receive a new plugin when its `version` is bumped;
the marketplace refreshes in the background once per session. `check_setup`
also reports a newer GitHub Release, and the `update_plugin` tool acts on it: in Claude
Desktop it downloads the bundle, verifies it against the release's
`SHA256SUMS` and opens it, so Claude Desktop asks the user to confirm and
keeps the instance and key; in Claude Code it gives the commands to run.

## Credentials and multi-company configuration

In v1 the credentials come from the client's own settings: the plugin's
`userConfig` in Claude Code, the extension manifest's `user_config` in Claude
Desktop (described above). Claude Code prompts for the instance and the key when the plugin is enabled, keeps the
key in the macOS Keychain, and substitutes `${user_config.instance}` and
`${user_config.api_key}` into the server's environment through
`.mcp.json`. The server reads them with `Config.String("TIPEE_INSTANCE")`
and `Config.Redacted("TIPEE_API_KEY")`; the key is a `Redacted` value and
cannot be logged by accident. Nothing is written to disk by us. Re-enabling
the plugin re-prompts.

One instance per plugin installation. Someone working with several companies
is the phase 3 trigger for a profile store in the CLI and a per-call profile
parameter on the tools; both plug into the same `Config` seam.

## Development experience

- **Source runs directly.** `pnpm mcp` runs the server under Node 24 from
  source, vitest tests source, and the type-aware lint stays. tsdown runs
  only for the plugin bundle.
- **Plugin loop.** `pnpm build`, then `claude --plugin-dir ./plugins/tipee`
  loads the plugin without installing it; `/reload-plugins` picks up edits,
  and a local plugin shadows an installed one of the same name
  ([Create plugins][plugins]).
- **One task graph.** Turborepo ([docs][turbo]) runs `check`, `test` and
  `build` per package with caching; because packages consume each other's
  TypeScript source, transit nodes (`transit` depends on `^transit`) make a
  dependency's source change invalidate its dependents without serialising
  the graph. Lint and format are root tasks over the whole repo.
- **Validation.** `pnpm verify` (generate, lint, format, tsc, tests, bundle,
  pack, then freshness of the generated and bundled files) is the command run
  locally and by CI. The pre-commit hook first runs `pnpm fix` and restages
  what it rewrote, then runs `turbo run check test`. CI restores the
  `.turbo` cache between runs and can switch to Vercel's remote cache
  through two variables; `pnpm plugin:validate` runs
  `claude plugin validate --strict` on the plugin and the marketplace.
- **Fake Tipee everywhere.** The MSW test kit in `@tipee-tools/core/testing`
  is how every package is tested, the MCP tools included; a stdio test
  spawns the real entry point and completes the handshake. Nothing in CI
  talks to a real instance.
- **Effect's sources at hand.** `pnpm docs:effect` mirrors the Effect
  repository into `opensrc/` (git-ignored) for its agent docs and migration
  notes; the exact sources of the pinned version are in `node_modules/effect/src`.
- **Effect diagnostics everywhere.** TypeScript 7 is the native compiler;
  `@effect/tsgo` patches it and the type-aware lint at install time
  (`prepare`), so `tsc`, oxlint and the editor all report Effect-specific
  diagnostics, the way Effect's own repository is set up.
- **Dependencies stay current and safe.** Renovate proposes grouped weekly
  npm updates behind a one-week cooldown (Dependabot cannot run pnpm 12 in
  its sandbox, so it only covers GitHub Actions); pnpm's supply-chain policy
  refuses versions younger than a day, trust downgrades, and exotic
  transitive sources. Node is pinned in `.node-version`, read by CI and by
  mise.

## Release pipeline

Bump the version in `plugins/tipee/.claude-plugin/plugin.json`, the
`package.json` of `packages/core`, `packages/mcp` and `plugins/tipee`, and
`SERVER_VERSION` in `packages/mcp/src/Server.ts`; merge; push a
`v<version>` tag. Claude Code users pick the new plugin up from the
marketplace in the background. The tag runs `.github/workflows/release.yml`,
which fails unless the tag equals `SERVER_VERSION` and the `plugin.json`
version, then packs the extension and publishes a GitHub Release carrying
`tipee-<version>.mcpb`, a copy named `tipee.mcpb` for the README's latest
link, and their `SHA256SUMS`.

Phase 3 adds npm: changesets for versions, GitHub Actions with
`id-token: write` and npm trusted publishing (no `NPM_TOKEN`, provenance
attached automatically), and a GitHub Release carrying the plugin as a
`.zip` loadable with `--plugin-url`.

## Platforms

The bundle is plain JavaScript, so Linux works unchanged and Windows should
too, as long as `node` is on the PATH Claude Code sees. v1 targets macOS
only, and asks for Node 24 on the machine.

## Phases

1. **Done: MCP server, plugin, Desktop extension.** Effect 4 core, the
   plugin with `userConfig` and the bundled server, the repository as
   marketplace, the two skills, the `.mcpb` packed by CI, `pnpm verify`
   through Turborepo.
2. **Done: the whole API, generated.** `@effect/openapi-generator` turns
   Tipee's OpenAPI document into an `HttpApi`; `HttpApiClient` derives the
   client; `HttpApi.reflect` yields the operation catalogue; one
   `Tool.dynamic` per operation gives 69 tools plus `check_setup` and
   `update_plugin`, each strict and titled, with read-only and destructive
   annotations from the verb (every write but a create is destructive). No hand-written schemas,
   no deny list, no server-side gate: which tools a user has, and which need
   approval, is configured in the Claude client. The one exception is left
   out at generation: granting and revoking roles, which an admin does in
   Tipee. A weekly workflow refreshes the document and opens a PR.
3. **Beyond Claude Code.** Triggered by the first user on another agent or
   in a terminal: tsdown builds for npm, OIDC publishing, a CLI on
   `effect/cli` sharing the core, profile store, `npx skills add`
   instructions.
4. **Distribution polish.** GitHub Releases carrying the `.mcpb` (done), a
   signed extension, Bun binary and Homebrew tap for the CLI, Keychain
   storage in the CLI, and a hosted connector (remote MCP with OAuth, one
   Tipee key per organisation) if a company wants a zero-install rollout.
5. **Smarter planning.** Composite tools (a week's plan for a team in one
   call, conflict detection) on top of the generated ones, if the raw API
   proves too chatty for the model.

## Open decisions

- **Repository visibility.** A private marketplace works but requires each
  friend to have `gh auth setup-git` or SSH configured; the npm packages are
  public regardless. Recommendation: public, now that the history is clean.
- **npm scope.** Confirm `@tipee-tools` is free, and decide whether a name
  derived from an unaffiliated product is acceptable long term.
- **Node as a prerequisite.** Claude Code's native installer no longer needs
  Node, so a friend may lack it and the server would fail to start. v1
  documents `brew install node`; phase 3 removes the requirement.

## Sources

[node-ts]: https://nodejs.org/api/typescript.html
[plugins]: https://code.claude.com/docs/en/plugins
[plugins-ref]: https://code.claude.com/docs/en/plugins-reference
[marketplaces]: https://code.claude.com/docs/en/plugin-marketplaces
[hints]: https://code.claude.com/docs/en/plugin-hints
[skills-cli]: https://github.com/vercel-labs/skills
[skills-announce]: https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem
[stripe-skills]: https://docs.stripe.com/skills
[stripe-agentskills]: https://pkg.go.dev/github.com/stripe/stripe-cli/pkg/agentskills
[mcpb]: https://github.com/modelcontextprotocol/mcpb
[dxt]: https://www.anthropic.com/engineering/desktop-extensions
[bun-compile]: https://bun.com/docs/bundler/executables
[node-sea]: https://nodejs.org/api/single-executable-applications.html
[node-build-sea]: https://progosling.com/en/dev-digest/2026-01/nodejs-25-5-build-sea-single-executable
[npm-oidc]: https://docs.npmjs.com/trusted-publishers/
[oidc-playbook]: https://bex.co/blog/2026/09/10/npm-trusted-publishing-oidc-tokenless-pipeline
[tsdown]: https://tsdown.dev/guide/faq
[brew-node]: https://docs.brew.sh/Node-for-Formula-Authors.html
[turbo]: https://turborepo.dev/docs/crafting-your-repository/configuring-tasks
[effect-rc]: https://effect.website/blog/releases/effect/40-rc
[effect-migration]: https://github.com/Effect-TS/effect/blob/main/MIGRATION.md

- Node.js, [Modules: TypeScript][node-ts]: type stripping defaults and the
  `node_modules` refusal.
- Claude Code docs: [Create plugins][plugins], [Plugins reference][plugins-ref],
  [Plugin marketplaces][marketplaces], [Recommend your plugin from your CLI][hints].
- Agent Skills ecosystem: [vercel-labs/skills][skills-cli],
  [Vercel changelog][skills-announce], [Stripe skills for agents][stripe-skills],
  [Stripe CLI `agentskills` package][stripe-agentskills].
- MCP packaging: [MCP Bundles (.mcpb)][mcpb],
  [Claude Desktop Extensions][dxt].
- Binaries: [Bun single-file executables][bun-compile],
  [Node single executable applications][node-sea],
  [Node 25.5 `--build-sea`][node-build-sea].
- Effect 4: [release candidate announcement][effect-rc],
  [migration guide][effect-migration].
- Build: [Turborepo task configuration][turbo].
- Publishing: [npm trusted publishing][npm-oidc],
  [Tokenless publishing playbook][oidc-playbook], [tsdown FAQ][tsdown],
  [Homebrew: Node for formula authors][brew-node].
