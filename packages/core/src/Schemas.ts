// Schemas for the Tipee responses the shift planning uses. They describe
// What Tipee actually sends — checked against real responses, which differ
// From the docs' examples (intervals carry no seconds, ranges can be open on
// Either side, values the integration may not see arrive as `{redacted}`).
// Each object keeps only the fields planning needs: decoding strips the rest,
// So parsing doubles as the data-minimisation step for personal data.

import { Schema } from 'effect';

const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const TIME = String.raw`\d{2}:\d{2}(?::\d{2})?`;
// ISO 8601 duration; Tipee also emits negative components such as "PT-15M".
const DURATION = String.raw`-?P(?:\d+D)?(?:T(?:-?\d+H)?(?:-?\d+M)?(?:-?\d+S)?)?`;

const exact = (source: string): RegExp => new RegExp(`^${source}$`, 'u');

export const Snowflake = Schema.String.check(Schema.isPattern(/^\d+$/u)).annotate({
  description: 'A Tipee id: digits only',
});
export const LocalDate = Schema.String.check(Schema.isPattern(exact(DATE))).annotate({
  description: 'A calendar date, YYYY-MM-DD',
});
/** "2026-09-07/2026-09-13"; either side may be "-" for an open end. */
export const LocalDateInterval = Schema.String.check(
  Schema.isPattern(exact(`(?:${DATE}|-)/(?:${DATE}|-)`)),
);
/** "2026-09-07T23:00/2026-09-08T00:00". */
export const LocalDateTimeInterval = Schema.String.check(
  Schema.isPattern(exact(`${DATE}T${TIME}/${DATE}T${TIME}`)),
);
/** "23:00/PT1H": a start time and a duration. */
export const LocalTimeInterval = Schema.String.check(
  Schema.isPattern(exact(`${TIME}/${DURATION}`)),
);
export const Duration = Schema.String.check(Schema.isPattern(exact(DURATION)));
export const Percentage = Schema.Finite;
/** Tipee replaces values the integration may not see with this marker. */
export const RedactedValue = Schema.Struct({
  redacted: Schema.Literals(['confidential', 'forbidden']),
});
/** Instances usually fill in only their working language. */
const TranslatedString = Schema.Struct({
  de: Schema.optionalKey(Schema.String),
  en: Schema.optionalKey(Schema.String),
  fr: Schema.optionalKey(Schema.String),
});

export class Kind extends Schema.Class<Kind>('tipee/Kind')({
  id: Snowflake,
  machine_name: Schema.String,
}) {}

export class Team extends Schema.Class<Team>('tipee/Team')({
  color: Schema.NullOr(Schema.String),
  id: Snowflake,
  name: Schema.String,
  parent_id: Schema.NullOr(Snowflake),
  short_name: Schema.NullOr(Schema.String),
}) {}

const TemplateSummary = Schema.Struct({
  color: Schema.String,
  description: Schema.NullOr(Schema.String),
  id: Snowflake,
  name: Schema.String,
});

const Adjustment = Schema.Struct({ time: Schema.NullOr(Schema.String), value: Duration });

export class Shift extends Schema.Class<Shift>('tipee/Shift')({
  adjustment: Schema.NullOr(Adjustment),
  break_time: Schema.NullOr(
    Schema.Struct({ min_duration: Duration, time_range: LocalDateTimeInterval }),
  ),
  id: Snowflake,
  modified: Schema.Boolean,
  remark: Schema.String,
  resource_id: Snowflake,
  schedule_template: Schema.NullOr(TemplateSummary),
  team_id: Snowflake,
  time_ranges: Schema.Array(Schema.Struct({ time_range: LocalDateTimeInterval })),
}) {}

export class Template extends Schema.Class<Template>('tipee/Template')({
  color: Schema.String,
  description: Schema.NullOr(TranslatedString),
  hour_ranges: Schema.Array(Schema.Struct({ hour_range: LocalTimeInterval })),
  id: Snowflake,
  name: TranslatedString,
  team_id: Snowflake,
  type: Schema.Struct({ id: Snowflake, is_on_call: Schema.Boolean, machine_name: Schema.String }),
  validity_date_range: Schema.NullOr(LocalDateInterval),
}) {}

export class Absence extends Schema.Class<Absence>('tipee/Absence')({
  absence_type: Schema.Struct({
    color: Schema.String,
    id: Snowflake,
    machine_name: Schema.String,
    name: Schema.String,
    short_name: Schema.String,
  }),
  date: LocalDate,
  id: Snowflake,
  percentage: Schema.Union([Percentage, RedactedValue]),
  remark: Schema.NullOr(Schema.Union([Schema.String, RedactedValue])),
  repetition_id: Schema.NullOr(Schema.Finite),
  resource_id: Snowflake,
  time_range: Schema.NullOr(LocalDateTimeInterval),
}) {}

export class OnCall extends Schema.Class<OnCall>('tipee/OnCall')({
  id: Snowflake,
  remark: Schema.NullOr(Schema.String),
  resource_id: Snowflake,
  schedule_template: Schema.NullOr(TemplateSummary),
  team_id: Snowflake,
  time_range: LocalDateTimeInterval,
}) {}

const WeekdayRates = Schema.Struct({
  friday: Schema.NullOr(Percentage),
  monday: Schema.NullOr(Percentage),
  saturday: Schema.NullOr(Percentage),
  sunday: Schema.NullOr(Percentage),
  thursday: Schema.NullOr(Percentage),
  tuesday: Schema.NullOr(Percentage),
  wednesday: Schema.NullOr(Percentage),
});

const WorkRegime = Schema.Struct({
  id: Snowflake,
  label: TranslatedString,
  weekly_worked_days: Schema.Finite,
  weekly_worked_hours: Duration,
});

export class ActivityRate extends Schema.Class<ActivityRate>('tipee/ActivityRate')({
  activity_rate_patterns: Schema.Array(WeekdayRates),
  apprentice: Schema.Boolean,
  average_rate: Percentage,
  date_range: LocalDateInterval,
  paid_hourly: Schema.Boolean,
  trainee: Schema.Boolean,
  work_regime: Schema.NullOr(WorkRegime),
}) {}

// The directory returns dozens of attributes per person (birth date, private
// Contact details, …). Planning needs none of them, so only these survive.
const PersonAttributes = Schema.Struct({
  activity_rate: Percentage,
  is_apprentice: Schema.Boolean,
  is_paid_hourly: Schema.Boolean,
  is_trainee: Schema.Boolean,
  job: Schema.NullOr(Schema.String),
  schedule_period: Schema.String,
});

const PersonTeam = Schema.Struct({ head: Schema.Boolean, id: Snowflake, name: Schema.String });

/** A directory entry as Tipee sends it (minus the attributes we drop). */
export class PersonRecord extends Schema.Class<PersonRecord>('tipee/PersonRecord')({
  attributes: PersonAttributes,
  id: Snowflake,
  label: Schema.String,
  short_label: Schema.String,
  /** Present because the directory is always queried with `with_teams`. */
  teams: Schema.Array(PersonTeam),
}) {}

export const PersonPage = Schema.Struct({
  data: Schema.Array(PersonRecord),
  next_token: Schema.NullOr(Schema.String),
});

/** A person as the tools present them: identity, teams and planning attributes, flattened. */
export class Person extends Schema.Class<Person>('tipee/Person')({
  ...PersonAttributes.fields,
  id: Snowflake,
  label: Schema.String,
  short_label: Schema.String,
  teams: Schema.Array(PersonTeam),
}) {
  public static fromRecord(record: PersonRecord): Person {
    return new Person({
      ...record.attributes,
      id: record.id,
      label: record.label,
      short_label: record.short_label,
      teams: record.teams,
    });
  }
}

/** A closed date range, encoded for Tipee as "from/to". */
export const DateRange = Schema.Struct({ from: LocalDate, to: LocalDate });
export type DateRange = typeof DateRange.Type;

export const encodeDateRange = ({ from, to }: DateRange): string => `${from}/${to}`;
