# tipee-tools

A [Claude Code](https://claude.com/claude-code) plugin that gives Claude the
whole [Tipee](https://tipee.ch) HR API: people, teams, shift templates,
shifts, absences, on-call duties, activities and time clock, reading and
writing.

It is built for agents, not for humans at a terminal. The plugin bundles an
[MCP](https://modelcontextprotocol.io) server with one tool per operation of
Tipee's API document, and a skill that tells Claude when and how to use
them. The same server ships as a Claude Desktop extension for people who do
not use Claude Code. There is no command-line tool.

Works with any Tipee instance. Not affiliated with Tipee.

## Install

Requires [Node.js](https://nodejs.org) 24 or newer (`brew install node`).
In Claude Code:

```
/plugin marketplace add Floriferous/tipee-tools
/plugin install tipee@tipee-tools
```

Claude Code asks for your Tipee instance (the subdomain you sign in at) and
an API key, keeps the key in your keychain, and starts the server. Then ask
Claude to run `tipee_check`: when every endpoint reports `ok`, you are set.

The key belongs to an _integration_ created in your Tipee admin panel, and
it needs one authorization that is easy to miss. The
[plugin README](plugins/tipee/README.md) walks through it.

## Claude Desktop, without a terminal

Download `tipee-<version>.mcpb` from the latest
[Verify run](https://github.com/Floriferous/tipee-tools/actions/workflows/verify.yml)
(artifact "tipee-mcpb"), then in Claude Desktop open Settings → Extensions →
Advanced settings → Install Extension… and pick the file. Claude Desktop
asks for the same two values, keeps the key in the system keychain, and runs
the server with its own bundled Node, so nothing else is installed. Claude
Desktop warns that the extension is not verified by Anthropic, which is
expected outside its directory. Afterwards, pick the **check-tipee-setup**
prompt from the "+" menu to confirm everything works.

## What Claude can do with it

Ask about a week's shifts, who is on call, who is absent, a person's
employment rate, the shape of a team, a project's hours; or ask it to plan a
shift, record an absence, submit a day's tasks. Every operation of Tipee's
API is a tool named `<resource>_<verb>`, such as `schedules_list` or
`absences_create`, plus `check`, which validates the setup. Tools that
only read are marked read-only and tools that delete are marked destructive,
so your Claude client can auto-approve the first and ask before the second;
which tools are available at all is decided in the client, per user.

The tools, their parameters and their results are generated from Tipee's
OpenAPI document, so the plugin cannot drift from the API. Personal data the
integration is not entitled to arrives redacted from Tipee itself.

## Other agents

The server is a plain MCP server over stdio. Any MCP client can run it with
two environment variables:

```bash
TIPEE_INSTANCE=acme TIPEE_API_KEY=… node plugins/tipee/server/tipee-mcp.mjs
```

The skill in `plugins/tipee/skills/tipee` follows the
[Agent Skills](https://agentskills.io) format and installs into other
agents with `npx skills add`.

## Contributing

TypeScript 7 on [Effect](https://effect.website) 4, with Node 24 running the
sources directly. [ARCHITECTURE.md](ARCHITECTURE.md) explains the design and
where it is going; the skills in `.claude/skills` brief agents working here.
Dependencies are kept current by Renovate (npm) and Dependabot (GitHub
Actions) behind a one-week cooldown, and pnpm refuses versions younger than a
day.

```bash
pnpm install
pnpm verify          # lint, format, types, tests, bundle — what CI runs
pnpm fix             # apply fixers and rebuild the plugin bundle
pnpm mcp             # run the server from source (needs packages/mcp/.env)
```

Iterate on the plugin with `claude --plugin-dir ./plugins/tipee`.
