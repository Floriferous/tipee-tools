// The fixtures loaded once as the fake Tipee's tables, decoded only as far
// As the fake needs to filter, sort and paginate; rows are answered raw.

import { Schema } from 'effect';

import { readFixture } from './fixtures.ts';
import type { FixtureName } from './fixtures.ts';

// Fixtures are raw Tipee JSON and are answered untouched; these schemas only
// Pick what the fake needs to filter, sort and paginate.
const Row = Schema.Struct({ id: Schema.String });
const KindRow = Schema.Struct({ ...Row.fields, machine_name: Schema.String });
const TeamRow = Schema.Struct({ ...Row.fields, parent_id: Schema.NullOr(Schema.String) });
const TemplateRow = Schema.Struct({ ...Row.fields, team_id: Schema.String });
export const PersonRow = Schema.Struct({
  ...Row.fields,
  attributes: Schema.Struct({ last_name: Schema.String }),
  teams: Schema.optionalKey(Schema.Array(Schema.Struct({ id: Schema.String }))),
});
const ByResource = Schema.Struct({ ...Row.fields, resource_id: Schema.String });
const OnCallRow = Schema.Struct({ ...ByResource.fields, team_id: Schema.String });
const AnyRow = Schema.Struct({});

export interface Loaded<Row> {
  readonly raw: Schema.Json;
  readonly row: Row;
}

const load = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  name: FixtureName,
): ReadonlyArray<Loaded<S['Type']>> => {
  const raw = Schema.decodeUnknownSync(Schema.Array(Schema.Json))(readFixture(name));
  const rows = Schema.decodeSync(Schema.Array(schema))(raw);
  return rows.map((row, index) => ({ raw: raw[index] ?? null, row }));
};

export const kinds = load(KindRow, 'kinds');
export const teams = load(TeamRow, 'teams');
export const templates = load(TemplateRow, 'templates');
export const people = load(PersonRow, 'people');
export const integrations = load(PersonRow, 'integrations');
export const shifts = load(ByResource, 'shifts');
export const absences = load(ByResource, 'absences');
export const onCalls = load(OnCallRow, 'on-calls');
export const activityRates = load(AnyRow, 'activity-rates');

const employeeKind = kinds.find((kind) => kind.row.machine_name === 'employee');
if (employeeKind === undefined) {
  throw new Error('fixture kinds.json has no "employee" kind');
}
export const EMPLOYEE_KIND_ID = employeeKind.row.id;
const integrationKind = kinds.find((kind) => kind.row.machine_name === 'integration');
if (integrationKind === undefined) {
  throw new Error('fixture kinds.json has no "integration" kind');
}
export const INTEGRATION_KIND_ID = integrationKind.row.id;
/** The one integration of the fake instance: the key's own. */
export const INTEGRATION_ID = integrations[0]?.row.id ?? '';
