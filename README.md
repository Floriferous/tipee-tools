# tipee-tools

A [Claude Code](https://claude.com/claude-code) plugin that lets Claude read
your company's [Tipee](https://tipee.ch) plannings: people, teams, shift
templates, shifts, absences and on-call duties.

It is built for agents, not for humans at a terminal. The plugin bundles a
read-only [MCP](https://modelcontextprotocol.io) server and a skill that tells
Claude when and how to use it. There is no command-line tool.

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

## What Claude can do with it

Ask about a week's shifts, who is on call, who is absent, a person's
employment rate, or the shape of a team. Behind the questions are eight
read-only tools: `tipee_teams`, `tipee_people`, `tipee_templates`,
`tipee_shifts`, `tipee_absences`, `tipee_on_calls`, `tipee_activity_rates`
and `tipee_check`.

Nothing writes to Tipee, and nothing private leaves it: the server keeps
only planning fields, so birth dates, addresses and contact details never
reach the conversation.

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

TypeScript on [Effect](https://effect.website) 4, with Node running the
sources directly. [ARCHITECTURE.md](ARCHITECTURE.md) explains the design and
where it is going; the skills in `.claude/skills` brief agents working here.

```bash
pnpm install
pnpm verify          # lint, format, types, tests, bundle — what CI runs
pnpm fix             # apply fixers and rebuild the plugin bundle
pnpm mcp             # run the server from source (needs packages/mcp/.env)
```

Iterate on the plugin with `claude --plugin-dir ./plugins/tipee`.
