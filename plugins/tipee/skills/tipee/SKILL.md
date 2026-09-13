---
name: tipee
description: Using the Tipee HR API through the Tipee MCP tools — people, teams, shifts, absences, on-calls, activities, timeclock, and their writes. Use whenever a task mentions Tipee, plannings, shifts, absences, on-call duties, timesheets, projects, or employee activity rates.
---

# Tipee via the MCP tools

Tipee is a Swiss HR tool. The tools mirror its API one to one: every
operation of Tipee's API document is a tool named `<resource>_<verb>`
(`schedules_list`, `absences_create`, `resources_show_activity_rates`).
Tool descriptions, parameters and results come from that document, so the
schema you see is the truth about what Tipee accepts and returns.

## Start here

- **`check` first** when the tools are new to this machine or when any tool
  fails. It calls the main read endpoints and either reports all `ok`,
  explains a missing authorization in plain words, or lists which response
  shapes no longer match (Tipee changed its API, not the data).
- **Ids come from other tools.** Team ids from `teams_list`, person ids from
  `resources_list` (with `kind_id` of the `employee` kind from `kinds_list`),
  template ids from `schedule_templates_list`. Never guess an id.
- **Dates** are `YYYY-MM-DD`; a `date_range` is `from/to`, inclusive.

## Reading

- Reads are the `*_list` and `*_show*` tools; they are marked read-only.
- `resources_list` is paginated: always send `pagination` (`limit`, and
  `next_token: null` on the first page), explicit `orders`, and the same
  filters and orders on every page, or Tipee answers 422. A non-null
  `next_token` can come back on the last full page; the next page is then
  empty.
- Values the integration may not see arrive as `{"redacted": "forbidden"}`
  or `{"redacted": "confidential"}`. Say the value is not accessible; do not
  treat it as missing data.
- Date-time intervals carry no seconds (`2026-09-07T23:00/2026-09-08T00:00`);
  date ranges can be open (`2026-08-01/-`); durations follow ISO 8601 and can
  be negative (`PT-15M`).

## Writing

- The `*_create`, `*_update`, `*_delete` and workflow tools (`*_submit`,
  `*_validate`, `*_reject`, …) change data in Tipee. Before calling one,
  state exactly what will change and for whom, and let the user confirm,
  unless they have already asked for that precise change.
- Prefer one precise write over several exploratory ones. Read first
  (`schedules_list` for the day, `resources_list` for the person) so ids,
  team and dates are known before writing.
- Shift templates are history: old templates are referenced by past
  plannings. A new need means a new template, never an edit of an old one.
- Writes need the integration to have the corresponding right (Planning →
  "Planifier" for shifts); a "lacks the permission" message means that right
  is missing, not that the request was wrong.

## When a tool fails

The error text says what to do. The common cases:

- _"rejected the API key"_: the key is wrong or belongs to another instance.
- _"has no permissions yet"_: the integration lacks **Configurations
  générales → "Se connecter avec des applications externes"**. No other role
  fixes this; once granted, the tools work without reinstalling.
- _"lacks the permission"_: grant the integration the module right the
  operation needs (Planning, Cœur RH, Activités, Timbrages…).
- _"Tipee rejected the request"_: Tipee's own validation refused it; the
  message quotes the reason.
- _"does not match its API description"_: Tipee changed a shape. Run `check`,
  report which endpoints fail, and suggest updating the plugin.
