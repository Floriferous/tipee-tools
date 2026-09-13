// Zod schemas for the Tipee responses the shift planning uses. They describe
// What Tipee actually sends — checked against real responses, which differ
// From the docs' examples (intervals carry no seconds, ranges can be open on
// Either side, values the integration may not see arrive as `{redacted}`).
// Each object keeps only the fields planning needs: z.object strips the rest,
// So parsing doubles as the data-minimisation step for personal data.

import { z } from 'zod';

const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const TIME = String.raw`\d{2}:\d{2}(?::\d{2})?`;
// ISO 8601 duration; Tipee also emits negative components such as "PT-15M".
const DURATION = String.raw`-?P(?:\d+D)?(?:T(?:-?\d+H)?(?:-?\d+M)?(?:-?\d+S)?)?`;

const exact = (source: string): RegExp => new RegExp(`^${source}$`, 'u');

export const Snowflake = z.string().regex(/^\d+$/u, 'expected a Tipee id (digits only)');
export const LocalDate = z.iso.date();
/** "2026-09-07/2026-09-13"; either side may be "-" for an open end. */
export const LocalDateInterval = z.string().regex(exact(`(?:${DATE}|-)/(?:${DATE}|-)`));
/** "2026-09-07T23:00/2026-09-08T00:00". */
export const LocalDateTimeInterval = z.string().regex(exact(`${DATE}T${TIME}/${DATE}T${TIME}`));
/** "23:00/PT1H": a start time and a duration. */
export const LocalTimeInterval = z.string().regex(exact(`${TIME}/${DURATION}`));
export const Duration = z.string().regex(exact(DURATION));
export const Percentage = z.number();
/** Tipee replaces values the integration may not see with this marker. */
export const Redacted = z.object({ redacted: z.enum(['confidential', 'forbidden']) });
/** Instances usually fill in only their working language. */
const TranslatedString = z.object({
  de: z.string().optional(),
  en: z.string().optional(),
  fr: z.string().optional(),
});

export const Kind = z.object({ id: Snowflake, machine_name: z.string() });
export const KindList = z.array(Kind);

export const Team = z.object({
  color: z.string().nullable(),
  id: Snowflake,
  name: z.string(),
  parent_id: Snowflake.nullable(),
  short_name: z.string().nullable(),
});
export const TeamList = z.array(Team);

const TemplateSummary = z.object({
  color: z.string(),
  description: z.string().nullable(),
  id: Snowflake,
  name: z.string(),
});

const Adjustment = z.object({ time: z.string().nullable(), value: Duration });

export const Shift = z.object({
  adjustment: Adjustment.nullable(),
  break_time: z.object({ min_duration: Duration, time_range: LocalDateTimeInterval }).nullable(),
  id: Snowflake,
  modified: z.boolean(),
  remark: z.string(),
  resource_id: Snowflake,
  schedule_template: TemplateSummary.nullable(),
  team_id: Snowflake,
  time_ranges: z.array(z.object({ time_range: LocalDateTimeInterval })),
});
export const ShiftList = z.array(Shift);

export const Template = z.object({
  color: z.string(),
  description: TranslatedString.nullable(),
  hour_ranges: z.array(z.object({ hour_range: LocalTimeInterval })),
  id: Snowflake,
  name: TranslatedString,
  team_id: Snowflake,
  type: z.object({ id: Snowflake, is_on_call: z.boolean(), machine_name: z.string() }),
  validity_date_range: LocalDateInterval.nullable(),
});
export const TemplateList = z.array(Template);

export const Absence = z.object({
  absence_type: z.object({
    color: z.string(),
    id: Snowflake,
    machine_name: z.string(),
    name: z.string(),
    short_name: z.string(),
  }),
  date: LocalDate,
  id: Snowflake,
  percentage: z.union([Percentage, Redacted]),
  remark: z.union([z.string(), Redacted]).nullable(),
  repetition_id: z.number().nullable(),
  resource_id: Snowflake,
  time_range: LocalDateTimeInterval.nullable(),
});
export const AbsenceList = z.array(Absence);

export const OnCall = z.object({
  id: Snowflake,
  remark: z.string().nullable(),
  resource_id: Snowflake,
  schedule_template: TemplateSummary.nullable(),
  team_id: Snowflake,
  time_range: LocalDateTimeInterval,
});
export const OnCallList = z.array(OnCall);

const WeekdayRates = z.object({
  friday: Percentage.nullable(),
  monday: Percentage.nullable(),
  saturday: Percentage.nullable(),
  sunday: Percentage.nullable(),
  thursday: Percentage.nullable(),
  tuesday: Percentage.nullable(),
  wednesday: Percentage.nullable(),
});

const WorkRegime = z.object({
  id: Snowflake,
  label: TranslatedString,
  weekly_worked_days: z.number(),
  weekly_worked_hours: Duration,
});

export const ActivityRate = z.object({
  activity_rate_patterns: z.array(WeekdayRates),
  apprentice: z.boolean(),
  average_rate: Percentage,
  date_range: LocalDateInterval,
  paid_hourly: z.boolean(),
  trainee: z.boolean(),
  work_regime: WorkRegime.nullable(),
});
export const ActivityRateList = z.array(ActivityRate);

// The directory returns dozens of attributes per person (birth date, private
// Contact details, …). Planning needs none of them, so only these survive,
// Flattened next to the person's identity.
const PersonAttributes = z.object({
  activity_rate: Percentage,
  is_apprentice: z.boolean(),
  is_paid_hourly: z.boolean(),
  is_trainee: z.boolean(),
  job: z.string().nullable(),
  schedule_period: z.string(),
});

const PersonTeam = z.object({ head: z.boolean(), id: Snowflake, name: z.string() });

export const Person = z.object({
  attributes: PersonAttributes,
  id: Snowflake,
  label: z.string(),
  short_label: z.string(),
  /** Present because the directory is always queried with `with_teams`. */
  teams: z.array(PersonTeam),
});

export const PersonPage = z.object({
  data: z.array(Person),
  next_token: z.string().nullable(),
});

export type KindView = z.output<typeof Kind>;
export type TeamView = z.output<typeof Team>;
export type ShiftView = z.output<typeof Shift>;
export type TemplateView = z.output<typeof Template>;
export type AbsenceView = z.output<typeof Absence>;
export type OnCallView = z.output<typeof OnCall>;
export type ActivityRateView = z.output<typeof ActivityRate>;
export type PersonRecord = z.output<typeof Person>;
// Spelled out rather than inferred: the type-aware linter (typescript-go)
// Resolves the inferred page type to `any` and then rejects every access.
export interface PersonPageView {
  data: PersonRecord[];
  next_token: string | null;
}
export type PersonView = Omit<PersonRecord, 'attributes'> & PersonRecord['attributes'];

// The CLI's view of a person: identity, teams and the planning attributes.
export const toPersonView = (person: PersonRecord): PersonView => ({
  activity_rate: person.attributes.activity_rate,
  id: person.id,
  is_apprentice: person.attributes.is_apprentice,
  is_paid_hourly: person.attributes.is_paid_hourly,
  is_trainee: person.attributes.is_trainee,
  job: person.attributes.job,
  label: person.label,
  schedule_period: person.attributes.schedule_period,
  short_label: person.short_label,
  teams: person.teams,
});
