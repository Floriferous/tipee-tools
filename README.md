# tipee-tools

Tools for the [Tipee](https://tipee.ch) HR API, written in TypeScript. They
work against **any Tipee instance**: point them at your company's subdomain
and an API key, nothing else is company-specific.

- **`@tipee-tools/core`** — HTTP client, read-only endpoint wrappers, and
  [zod](https://zod.dev) schemas describing what Tipee _really_ sends. Also
  ships a test kit (`@tipee-tools/core/testing`): a fake Tipee built with
  [MSW](https://mswjs.io) over anonymised responses for a fictional company.
- **`@tipee-tools/cli`** — the `tipee` command line on top of the core.
- `@tipee-tools/mcp` — planned: an MCP server sharing the same core.

Everything is **read-only** today: only `*.list` / `*.show-*` endpoints are
called. Nothing here is affiliated with Tipee.

## Getting started

Requirements: Node 24 and pnpm 12 (`corepack enable` picks the pinned pnpm).

```bash
pnpm install
cp packages/cli/.env.example packages/cli/.env   # then fill in the two values
pnpm tipee check                                  # validates every endpoint
pnpm tipee help
```

`TIPEE_INSTANCE` is the subdomain you sign in at (`acme` for
`acme.tipee.net`). `TIPEE_API_KEY` is the key of an _integration_ created in
your Tipee admin panel. Each person, and each company, uses their own `.env`;
the file is git-ignored and the key never leaves your machine.

### Creating the integration

In Tipee, an integration is a service account: create it like an employee,
then give it roles. Until it has the authorization **Configurations
générales → "Se connecter avec des applications externes"**, every call
answers `401 token_rights_missing`, whatever else you grant. Reads also need
**Planning → "Accéder au module Planning" + "Voir les plannings"** and
**Cœur RH → "Accéder au module Cœur RH" + "Voir les collaborateurs"**.
`pnpm tipee check` tells you when the setup is complete.

[`.claude/skills/tipee/SKILL.md`](.claude/skills/tipee/SKILL.md) collects
these steps and the API's quirks versus its documentation, for humans and
coding agents alike.

## Commands

```
kinds                                 List resource kinds
people [--team id]                    List employees (planning fields only)
teams                                 List teams (sites and sectors)
templates [--team id]                 List shift templates
shifts <from> <to> [--people a,b]     List planned shifts in a date range
absences <from> <to> [--people a,b]   List absences in a date range
on-calls <from> <to> [--team id]      List on-call duties in a date range
activity-rates <person> [from to]     Show a person's employment rates
check [from to]                       Call every endpoint and validate the
                                      response shapes (stores nothing)
```

Dates are `YYYY-MM-DD`; output is JSON.

## Design notes

- The schemas keep only the fields a planner needs, so parsing doubles as
  data minimisation: no birth dates or private contact details reach the
  output. Values the integration may not see arrive as `{"redacted": …}`.
- Responses are validated on every call; `pnpm tipee check` is the early
  warning for the day Tipee changes a shape.
- No build step: Node 24 runs the TypeScript directly. Zero runtime
  dependencies besides `zod`.
- Test fixtures are real response shapes with every value replaced: the
  company is "Acme", the people are placeholders, ids are sequential. Never
  commit a real response.

## Development

```bash
pnpm fix      # oxlint (type-aware) and oxfmt, applying their fixers
pnpm verify   # lint, format, tsc and tests, check-only — what CI runs
```

The pre-commit hook runs `pnpm fix`, restages what the fixers rewrote, then
`tsc` and the tests (vitest + MSW).

Tests assert on CLI output, never on requests: the fake Tipee enforces the
real API's rules (401 for a bad key, 422 when pagination filters change
between pages) so a wrong request fails the way it would in production.

## Roadmap

- MCP server over the same core, so agents can read plannings directly.
- A compiled build, so the packages can be published to npm.
- Write endpoints (creating shifts), behind an explicit opt-in and the
  integration's "Planifier" right.
