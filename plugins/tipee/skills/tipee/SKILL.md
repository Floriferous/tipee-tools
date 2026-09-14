---
name: tipee
description: Tipee HR plannings and timesheets through the Tipee MCP tools — reading them, changing them, and repairing a failing setup. Use when a task mentions Tipee, shifts, absences, on-calls, timesheets or activities.
---

# Tipee through the MCP tools

Every operation of Tipee's API is a tool named `<resource>_<verb>`:
`schedules_list`, `absences_create`, `resources_show_activity_rates`. The
tool's schema is the truth about what Tipee accepts and returns; this file
carries only what the schema cannot say.

## Working a request

1. **Earn the ids.** Every id in a call comes from an earlier result: team
   ids from `teams_list`, template ids from `schedule_templates_list`, person
   ids from `resources_list` filtered on the `employee` kind found with
   `kinds_list`. Done when each id in the planned call traces to a result.
2. **Read before you write.** `schedules_list` for the day, `absences_list`
   for the person, so the change is described against what is there now.
3. **Confirm the change, once.** State exactly what will change and for whom,
   in one sentence, and wait for a yes. Skip the wait only when the user
   already asked for that precise change. Then make one precise call.
4. **Report Tipee's answer**: the created id and what changed. A schedule
   create answers only `done`: read the day back to get the id. Done when
   the user can see the outcome without opening Tipee.

A failing tool ends the sequence: read [errors.md](errors.md), which maps
each error message to the fix.

## What the schema cannot say

- **Setup**: `check` first when the tools are new to this machine. `ok`
  means the setup is complete; a `skipped` endpoint is a module this
  instance does not have. The report names the integration the key belongs
  to and links its Roles tab. When it reports an `update`, tell the user the
  version and the link once. Which rights an integration needs for which
  tools, and every right Tipee offers, is in [roles.md](roles.md).
- **Withheld values**: `{"redacted": "forbidden"}` or `"confidential"` in
  place of a value means Tipee withheld it from this integration. Report it
  as withheld.
- **Reality versus the document**: date-time intervals carry no seconds
  (`2026-09-07T23:00/2026-09-08T00:00`); date ranges can be open on either
  side (`2026-08-01/-`); durations can carry negative parts (`PT-15M`).
- **Pages of people**: `resources_list` takes explicit `pagination`
  (`next_token: null` on the first page) and explicit `orders`, identical
  filters and orders on every page, and can hand out a cursor on the last
  full page whose next page is empty.
- **Templates are history.** Past plannings reference old templates; a new
  need means a new template.
