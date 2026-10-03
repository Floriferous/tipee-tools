---
name: tipee
description: Tipee HR plannings and timesheets through the Tipee for Claude tools — reading them, changing them, and repairing a failing setup. Use when a task, in any language, mentions Tipee, plannings, shifts, absences, on-calls, time checks (timbrages) or activities.
---

# Tipee through the MCP tools

Every operation of Tipee's API but granting and revoking roles is a tool
named `<resource>_<verb>`: `schedules_list`, `absences_create`,
`resources_show_activity_rates`. The tool's schema is the truth about what
Tipee accepts and returns; this file carries only what the schema cannot
say.

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
4. **Report Tipee's answer**: the created id and what changed. Done when the
   user can see the outcome without opening Tipee.

A failing tool ends the sequence. Its message names the cause and the fix:
follow it and give the user any link as is.

## What the schema cannot say

- **Setup**: `check_setup` first when the tools are new to this machine. A
  `skipped` endpoint was refused: either the module is not enabled on this
  instance, or the integration lacks the right, and then its error names the
  right and links the Roles tab. `ok` stays true with skipped endpoints and
  is false only when an endpoint failed (Tipee answered in a shape this
  version of Tipee for Claude cannot read). The report names the integration
  the key belongs to and links its Roles tab. When it reports an `update`,
  tell the user the version once and ask whether to install it; on a yes,
  call `update_plugin` and relay its message (Claude Desktop asks the user to
  confirm in its own dialog). Which rights an integration needs for which
  tools is in [roles.md](roles.md).
- **Withheld values**: `{"redacted": "forbidden"}` or `"confidential"` in
  place of a value means Tipee withheld it from this integration. Report it
  as withheld.
- **Reality versus the document**: date-time intervals carry no seconds
  (`2026-09-07T23:00/2026-09-08T00:00`); date ranges can be open on either
  side (`2026-08-01/-`); durations can carry negative parts (`PT-15M`).
- **Templates are history.** Past plannings reference old templates; a new
  need means a new template.
