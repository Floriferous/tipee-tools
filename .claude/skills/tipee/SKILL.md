---
name: tipee
description: Working on tipee-tools (Effect 4 core client, MCP server, Claude Code plugin, MSW test kit) — Tipee access rights, API quirks vs. its docs, guardrails. Use whenever a task touches Tipee, shifts, absences, or this repository's packages.
---

# Tipee API via tipee-tools

Tipee is a Swiss HR tool (employees, shifts, absences). This repo is a
**read-only** toolkit over its public API that works against any Tipee
instance: `@tipee-tools/core` (Effect service + schemas + errors),
`@tipee-tools/mcp` (MCP toolkit and stdio server), and the Claude Code plugin
in `plugins/tipee` that bundles the server. The user-facing skill lives in
`plugins/tipee/skills/tipee`; this one is for developing the repo.

## Guardrails

- **Never write to Tipee** unless the task explicitly asks for it and the key
  has the "Planifier" right. Only `*.list` / `*.show-*` endpoints exist here.
- **Shift templates are history.** Old templates are referenced by past
  plannings; never delete or modify them (that rewrites who worked when).
  A new need means a new template.
- **Personal data.** The directory returns birth dates, private contact
  details, sick leave… The schemas keep only planning fields; don't widen
  them without a reason, and never commit real responses — fixtures are
  anonymised (the fictional company "Acme").
- **The API key is a secret**: only in `packages/mcp/.env` or the plugin's
  keychain entry, never in chat, commits or CI. Rotate it in the Tipee admin
  if it leaks.

## Running the server

`pnpm mcp` runs it on stdio from source; configuration in `packages/mcp/.env`
(`TIPEE_INSTANCE`, `TIPEE_API_KEY`). Plugin users get the prompt from Claude
Code instead. `claude --plugin-dir ./plugins/tipee` loads the plugin for
development; `pnpm build` refreshes the bundle it runs.

## Getting API access (the trap)

The key belongs to an *integration* — a service account created like an
employee, given roles. Until it has the authorization
**Configurations générales → "Se connecter avec des applications externes"**,
every call answers `HTTP 401 {"message":"Tipee.api.token_rights_missing"}`
(not 403 as the docs say). No Planning role fixes that, and regenerating the
key doesn't help. A wrong key gives `"Le jeton fourni est invalide."`.

Reads also need: Planning → "Accéder au module Planning" + "Voir les
plannings"; Cœur RH → "Accéder au module Cœur RH" + "Voir les
collaborateurs". Writes will need Planning → "Planifier". Pay-related fields
come back as `{"redacted": "forbidden"}`.

## API facts that differ from the docs

Docs: https://api.tipee.ch/ (index https://api.tipee.ch/llms.txt, OpenAPI
https://api.tipee.ch/openapi/26.06.25.json). Every endpoint is
`POST https://<instance>.tipee.net/api/...` with a JSON body and headers
`Authorization: Bearer`, `Tipee-Version: 26.06.25`, `Accept: application/json`.

- Date-time intervals carry **no seconds**: `2026-09-07T23:00/2026-09-08T00:00`
  (the docs' examples show seconds). Template hours are `23:00/PT1H`.
- Date ranges can be **open**: `2026-08-01/-`, `-/2018-12-31`.
- Any value the integration may not see becomes
  `{"redacted": "forbidden" | "confidential"}` in place of a string, number
  or object.
- Durations can carry negative parts (`PT-15M`); some templates have `PT0S`.
- Pagination (`resources.list`): send `pagination: {limit, next_token}`
  explicitly (`next_token: null` first), explicit `orders`
  (`{key: "resource.attribute", attribute: "last_name", direction: "asc"}`),
  and identical filters/orders on every page or Tipee answers 422. The
  cursor can be non-null on the last full page (the next page is empty).
- Team filter: `{key: "resource.team", value: {teams: [id], recursive: true}}`.
- Rate limits are generous (500-token bucket, 4/s); the client retries
  transient failures with backoff (`HttpClient.retryTransient`).
- Versions are date-based and supported ≥ 6 months after the next release;
  subscribe to the changelog on https://api.tipee.ch/.

## Repository notes

- `ARCHITECTURE.md` is the target design (Effect 4 core, MCP server first,
  the plugin bundles the server, the repo is its own marketplace). Check it
  before adding a distribution channel or a configuration source.
- Effect 4 is at its release candidate, pinned exactly; the `effect-v4` skill
  in `.claude/skills` lists the idioms and RC gotchas. Read Effect's sources
  in `node_modules/effect/src` (exact version) and its docs in
  `opensrc/effect` (`pnpm docs:effect`) rather than memory.
- No build step: Node 24 runs TypeScript directly (imports need the `.ts`
  extension, no enums). The only build is `pnpm build`, which bundles the
  server into `plugins/tipee/server/` (the plugin is the workspace package
  `@tipee-tools/plugin`) — committed, and checked for freshness by
  `pnpm verify`.
- Tasks run through Turborepo (`turbo.json`): `check`, `test`, `build` per
  package, cached; `transit` nodes propagate source changes between
  workspace packages; `lint:check` and `format:check` are root tasks. Run a
  single package with `pnpm exec turbo run test --filter=@tipee-tools/mcp`.
- Tests: `@effect/vitest` + MSW. `packages/core/test/handlers.ts` is a fake
  Tipee that enforces the real rules (401 bad key, 422 bad pagination) —
  assert on output, not on requests. Other packages import it from
  `@tipee-tools/core/testing`. `it.effect` runs on the test clock: fork,
  `TestClock.adjust`, join to exercise retries.
- `pnpm fix` applies the oxlint/oxfmt fixers and rebuilds the bundle;
  `pnpm verify` only checks (CI and the pre-commit hook rely on that split);
  every disabled rule is commented in `oxlint.config.ts` (notably
  `unicorn/no-null`: Tipee's wire format needs literal `null`).
