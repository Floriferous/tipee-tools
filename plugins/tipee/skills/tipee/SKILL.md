---
name: tipee
description: Reading Tipee HR plannings (people, teams, shifts, absences, on-calls) through the tipee MCP tools. Use whenever a task mentions Tipee, shifts, plannings, absences, on-call duties, or employee activity rates.
---

# Tipee plannings via the `tipee` tools

Tipee is a Swiss HR tool. These MCP tools read one company's Tipee instance
through an integration key. Everything here is **read-only**: nothing you do
through these tools changes a planning.

## Start here

- **`tipee_check` first** when the tools are new to this machine or when any
  tool fails. It calls every endpoint and either reports all `ok`, explains a
  missing authorization in plain words, or lists which response shapes no
  longer match (meaning Tipee changed its API, not that the data is wrong).
- **Ids come from other tools.** Team ids from `tipee_teams`, person ids from
  `tipee_people`. Never guess an id.
- **Dates** are `YYYY-MM-DD`; ranges are inclusive on both ends.

## The tools

| Tool                   | Returns                                                                      |
| :--------------------- | :--------------------------------------------------------------------------- |
| `tipee_teams`          | Sites and sectors as a tree (`parent_id`), with short names and colours      |
| `tipee_people`         | Employees with activity rate, job, teams, apprentice/trainee/hourly flags    |
| `tipee_templates`      | Shift templates: name, hour ranges (`"23:00/PT1H"` = start + duration), type |
| `tipee_shifts`         | Planned shifts in a range: time ranges, template, team, person               |
| `tipee_absences`       | Absences in a range with their type (holidays, sick leave, …)                |
| `tipee_on_calls`       | On-call duties in a range                                                    |
| `tipee_activity_rates` | A person's employment rate history: average, weekday pattern, regime         |
| `tipee_check`          | Health report over every endpoint                                            |

## Reading the results

- Values the integration may not see arrive as `{"redacted": "forbidden"}`
  or `{"redacted": "confidential"}` instead of a string or number. Say that
  the value is not accessible; do not treat it as missing data.
- Date-time intervals carry no seconds: `2026-09-07T23:00/2026-09-08T00:00`.
  Date ranges can be open: `2026-08-01/-` means "from August onwards".
- Durations follow ISO 8601 and can be negative (`PT-15M` is a 15-minute
  reduction). Some templates have `PT0S`.
- Team names often end with a site code (`GE`, `FR`); the tree in
  `tipee_teams` is the authority on what belongs where.
- People results contain no private data by design: no birth dates, no
  contact details, no addresses. Do not try to infer them.

## Guardrails

- Never propose to modify or delete a shift template. Templates are history:
  old ones are referenced by past plannings. A new need means a new template.
- Treat absence types like sick leave as sensitive: report counts and dates
  when asked, do not volunteer them.
- The API key belongs to the person who installed the plugin. Never ask for
  it, print it, or suggest putting it in a file.

## When a tool fails

The error text already says what to do. The common cases:

- _"rejected the API key"_: the key is wrong or belongs to another instance.
- _"has no permissions yet"_: the integration lacks **Configurations
  générales → "Se connecter avec des applications externes"** in the Tipee
  admin panel. No Planning role fixes this; the authorization must be
  granted, then the tools work without reinstalling.
- _"lacks the permission for this data"_: grant the integration Planning →
  "Accéder au module Planning" + "Voir les plannings" and Cœur RH →
  "Accéder au module Cœur RH" + "Voir les collaborateurs".
- _"unexpected response"_: Tipee changed a shape. Run `tipee_check`, report
  which endpoints fail, and suggest updating the plugin.
