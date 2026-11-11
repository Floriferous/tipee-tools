// The fixtures as the fake tipee's tables: each row typed only as far as the
// fake needs to filter, sort and paginate, and answered raw.

import { Array as Arr, Option } from 'effect';
import type { JsonBodyType } from 'msw';

import { fixtures } from './fixtures.ts';

interface Identified {
  readonly id: string;
}
interface KindRow extends Identified {
  readonly machine_name: string;
}
interface TeamRow extends Identified {
  readonly parent_id: string | null;
}
interface TemplateRow extends Identified {
  readonly team_id: string;
}
export interface PersonRow extends Identified {
  readonly attributes: { readonly last_name: string };
  readonly teams?: ReadonlyArray<{ readonly id: string }>;
}
interface ForResource {
  readonly resource_id: string;
}
interface ByResource extends Identified, ForResource {}
interface OnCallRow extends ByResource {
  readonly team_id: string;
}

export interface Loaded<Row> {
  readonly raw: JsonBodyType;
  readonly row: Row;
}

// The compiler checks each fixture against `Row`; the row is its own raw JSON.
const load = <Row>(rows: ReadonlyArray<Row & JsonBodyType>): ReadonlyArray<Loaded<Row>> =>
  Arr.map(rows, (row) => ({ raw: row, row }));

export const kinds = load<KindRow>(fixtures.kinds);
export const teams = load<TeamRow>(fixtures.teams);
export const templates = load<TemplateRow>(fixtures.templates);
export const people = load<PersonRow>(fixtures.people);
export const integrations = load<PersonRow>(fixtures.integrations);
export const shifts = load<ByResource>(fixtures.shifts);
export const absences = load<ByResource>(fixtures.absences);
export const onCalls = load<OnCallRow>(fixtures['on-calls']);
export const activityRates = load<object>(fixtures['activity-rates']);
export const dayTasks = load<ForResource>(fixtures['day-tasks']);

const kindId = (machineName: string): string =>
  Arr.findFirst(kinds, (kind) => kind.row.machine_name === machineName).pipe(
    Option.map((kind) => kind.row.id),
    Option.getOrThrowWith(() => new Error(`fixture kinds.json has no "${machineName}" kind`)),
  );

export const EMPLOYEE_KIND_ID = kindId('employee');
export const INTEGRATION_KIND_ID = kindId('integration');
/** The one integration of the fake instance: the key's own. */
export const INTEGRATION_ID = integrations[0]?.row.id ?? '';
