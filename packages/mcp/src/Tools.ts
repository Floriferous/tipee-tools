// The MCP tools: one read-only tool per Tipee endpoint a planner needs, plus
// `tipee_check`. Parameter and result schemas come from the core, so the
// Model sees the same shapes the client validates, and results carry only
// Planning fields.

import {
  Absence,
  ActivityRate,
  LocalDate,
  OnCall,
  Person,
  Shift,
  Snowflake,
  Team,
  Template,
  TipeeError,
} from '@tipee-tools/core';
import { Schema } from 'effect';
import { Tool, Toolkit } from 'effect/unstable/ai';

// Every tool only reads Tipee; say so in the MCP annotations so clients can
// Run them without confirmation.
const readOnlyTool: typeof Tool.make = (name, options) =>
  Tool.make(name, options)
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true);

const TeamId = Snowflake.annotate({
  description: 'Restrict to this team and its sub-teams (an id from tipee_teams)',
});
const ResourceIds = Schema.Array(Snowflake).annotate({
  description: 'Restrict to these people (ids from tipee_people)',
});
const From = LocalDate.annotate({ description: 'First day of the range, YYYY-MM-DD' });
const To = LocalDate.annotate({ description: 'Last day of the range, YYYY-MM-DD (inclusive)' });

export const TipeeTeams = readOnlyTool('tipee_teams', {
  description:
    'List the teams of the Tipee instance (sites and sectors, as a tree via parent_id). ' +
    'Use it to find the team id other tools filter on.',
  failure: TipeeError,
  success: Schema.Struct({ teams: Schema.Array(Team) }),
});

export const TipeePeople = readOnlyTool('tipee_people', {
  description:
    'List employees with their planning attributes (activity rate, job, teams). ' +
    'Returns no personal data beyond name and id.',
  failure: TipeeError,
  parameters: Schema.Struct({ team_id: Schema.optionalKey(TeamId) }),
  success: Schema.Struct({ people: Schema.Array(Person) }),
});

export const TipeeTemplates = readOnlyTool('tipee_templates', {
  description:
    'List shift templates (name, hour ranges, type). Templates are history: old ones are ' +
    'referenced by past plannings and must never be modified.',
  failure: TipeeError,
  parameters: Schema.Struct({ team_id: Schema.optionalKey(TeamId) }),
  success: Schema.Struct({ templates: Schema.Array(Template) }),
});

export const TipeeShifts = readOnlyTool('tipee_shifts', {
  description: 'List the planned shifts in a date range, optionally for given people.',
  failure: TipeeError,
  parameters: Schema.Struct({ from: From, resource_ids: Schema.optionalKey(ResourceIds), to: To }),
  success: Schema.Struct({ shifts: Schema.Array(Shift) }),
});

export const TipeeAbsences = readOnlyTool('tipee_absences', {
  description:
    'List absences (holidays, sick leave, …) in a date range, optionally for given people. ' +
    'Values the integration may not see arrive as {"redacted": …}.',
  failure: TipeeError,
  parameters: Schema.Struct({ from: From, resource_ids: Schema.optionalKey(ResourceIds), to: To }),
  success: Schema.Struct({ absences: Schema.Array(Absence) }),
});

export const TipeeOnCalls = readOnlyTool('tipee_on_calls', {
  description: 'List on-call duties in a date range, optionally for a team or given people.',
  failure: TipeeError,
  parameters: Schema.Struct({
    from: From,
    resource_ids: Schema.optionalKey(ResourceIds),
    team_id: Schema.optionalKey(TeamId),
    to: To,
  }),
  success: Schema.Struct({ on_calls: Schema.Array(OnCall) }),
});

export const TipeeActivityRates = readOnlyTool('tipee_activity_rates', {
  description:
    "Show a person's employment rates over time (average rate, weekday pattern, regime). " +
    'Without a range, the whole history is returned.',
  failure: TipeeError,
  parameters: Schema.Struct({
    from: Schema.optionalKey(From),
    resource_id: Snowflake.annotate({ description: 'The person id (from tipee_people)' }),
    to: Schema.optionalKey(To),
  }),
  success: Schema.Struct({ activity_rates: Schema.Array(ActivityRate) }),
});

export const EndpointReport = Schema.Struct({
  count: Schema.optionalKey(Schema.Int),
  error: Schema.optionalKey(Schema.String),
  name: Schema.String,
  status: Schema.Literals(['ok', 'failed']),
});

export const TipeeCheck = readOnlyTool('tipee_check', {
  description:
    'Call every Tipee endpoint and validate the response shapes. Run it first after ' +
    'installing, or when another tool fails: it explains missing authorizations and ' +
    'detects the day Tipee changes a response shape. Stores nothing.',
  failure: TipeeError,
  parameters: Schema.Struct({
    from: Schema.optionalKey(From),
    to: Schema.optionalKey(To),
  }),
  success: Schema.Struct({
    date_range: Schema.String,
    endpoints: Schema.Array(EndpointReport),
    ok: Schema.Boolean,
  }),
});

export const TipeeToolkit = Toolkit.make(
  TipeeTeams,
  TipeePeople,
  TipeeTemplates,
  TipeeShifts,
  TipeeAbsences,
  TipeeOnCalls,
  TipeeActivityRates,
  TipeeCheck,
);
