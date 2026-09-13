---
name: tipee
description: Working with the Tipee HR API through tipee-tools (core client, CLI, MSW test kit) — access rights, API quirks vs. its docs, guardrails. Use whenever a task touches Tipee, shifts, absences, or this repository's packages.
---

# Tipee API via tipee-tools

Tipee is a Swiss HR tool (employees, shifts, absences). This repo is a
**read-only** TypeScript toolkit over its public API that works against any
Tipee instance: `@tipee-tools/core` (client + zod schemas + endpoints),
`@tipee-tools/cli`, and later an MCP server on the same core.

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
- **The API key is a secret**: only in `packages/cli/.env`, never in chat,
  commits or CI. Rotate it in the Tipee admin if it leaks.

## Running the CLI

`pnpm tipee help` from the repo root; configuration in `packages/cli/.env`
(`TIPEE_INSTANCE`, `TIPEE_API_KEY`). Start with `pnpm tipee check`.

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
- Rate limits are generous (500-token bucket, 4/s); the client retries 429
  honouring `Retry-After`.
- Versions are date-based and supported ≥ 6 months after the next release;
  subscribe to the changelog on https://api.tipee.ch/.

## Repository notes

- No build step: Node 24 runs TypeScript directly (imports need the `.ts`
  extension, no enums). `@tipee-tools/core` is consumed from source through
  the workspace link; publishing to npm will need a compiled build.
- Tests: vitest + MSW. `packages/core/test/handlers.ts` is a fake Tipee that
  enforces the real rules (401 bad key, 422 bad pagination) — assert on
  output, not on requests. Other packages import it from
  `@tipee-tools/core/testing`.
- `pnpm fix` applies the oxlint/oxfmt fixers, `pnpm verify` only checks (CI
  and the pre-commit hook rely on that split); every disabled rule is
  commented in `oxlint.config.ts` (notably `unicorn/no-null`: Tipee's wire
  format needs literal `null`).
