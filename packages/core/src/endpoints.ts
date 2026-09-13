// Read-only wrappers around the Tipee endpoints the shift planning needs.
// Every response is validated against the schemas in schemas.ts, so callers
// Get typed, minimal data — and a clear error the day Tipee changes a shape.

import {
  AbsenceList,
  ActivityRateList,
  KindList,
  OnCallList,
  PersonPage,
  ShiftList,
  TeamList,
  TemplateList,
  toPersonView,
} from './schemas.ts';
import type {
  AbsenceView,
  ActivityRateView,
  KindView,
  OnCallView,
  PersonPageView,
  PersonView,
  ShiftView,
  TeamView,
  TemplateView,
} from './schemas.ts';
import type { TipeeConfig } from './client.ts';
import { tipeePost } from './client.ts';
import { z } from 'zod';

/** Tipee requires an explicit page size; 100 keeps the directory to one page. */
export const PAGE_SIZE = 100;

// Tipee derives the pagination cursor from the sort keys, so the order must
// Be explicit and identical on every page (otherwise it answers 422).
const RESOURCE_ORDER = [{ attribute: 'last_name', direction: 'asc', key: 'resource.attribute' }];

export class TipeeShapeError extends Error {
  public readonly endpoint: string;

  public constructor(endpoint: string, details: string) {
    super(`Tipee sent an unexpected response for ${endpoint}:\n${details}`);
    this.name = 'TipeeShapeError';
    this.endpoint = endpoint;
  }
}

interface Call<Output> {
  body: unknown;
  schema: z.ZodType<Output>;
}

// Posts to an endpoint and validates the response against its schema.
const call = async <Output>(
  config: TipeeConfig,
  endpoint: string,
  { body, schema }: Call<Output>,
): Promise<Output> => {
  const payload = await tipeePost(config, endpoint, body);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new TipeeShapeError(endpoint, z.prettifyError(result.error));
  }
  return result.data;
};

export interface TeamFilter {
  /** Restrict to this team and its sub-teams. */
  teamId?: string | undefined;
}

export interface PeopleFilter {
  /** Restrict to these person ids. */
  resourceIds?: string[] | undefined;
}

const idList = (id: string | undefined): string[] | undefined =>
  id === undefined ? undefined : [id];

export const listKinds = async (config: TipeeConfig): Promise<KindView[]> =>
  call(config, '/api/directory/kinds.list', { body: {}, schema: KindList });

export const listTeams = async (config: TipeeConfig): Promise<TeamView[]> =>
  call(config, '/api/directory/teams.list', { body: {}, schema: TeamList });

export const listTemplates = async (
  config: TipeeConfig,
  { teamId }: TeamFilter = {},
): Promise<TemplateView[]> =>
  call(config, '/api/schedule/schedule-templates.list', {
    body: { team_ids: idList(teamId) },
    schema: TemplateList,
  });

const employeeKindId = async (config: TipeeConfig): Promise<string> => {
  const kinds = await listKinds(config);
  const employeeKind = kinds.find((kind) => kind.machine_name === 'employee');
  if (employeeKind === undefined) {
    throw new Error('Tipee did not report an "employee" resource kind.');
  }
  return employeeKind.id;
};

const teamFilters = (teamId: string | undefined): unknown[] =>
  teamId === undefined
    ? []
    : [{ key: 'resource.team', value: { recursive: true, teams: [teamId] } }];

// Lists employees (all of them, or one team's), following pagination until
// The directory is exhausted. Tipee may return a non-null cursor on the last
// Full page, so an empty page also ends the loop.
export const listPeople = async (
  config: TipeeConfig,
  { teamId }: TeamFilter = {},
): Promise<PersonView[]> => {
  const kindId = await employeeKindId(config);
  const filters = teamFilters(teamId);
  const people: PersonView[] = [];
  let nextToken: string | null = null;
  do {
    // Annotated to break the inference cycle between `page` and `nextToken`.
    const page: PersonPageView = await call(config, '/api/directory/resources.list', {
      body: {
        filters,
        kind_id: kindId,
        orders: RESOURCE_ORDER,
        pagination: { limit: PAGE_SIZE, next_token: nextToken },
        with_teams: true,
      },
      schema: PersonPage,
    });
    people.push(...page.data.map(toPersonView));
    nextToken = page.data.length === 0 ? null : page.next_token;
  } while (nextToken !== null);
  return people;
};

export const listShifts = async (
  config: TipeeConfig,
  dateRange: string,
  { resourceIds }: PeopleFilter = {},
): Promise<ShiftView[]> =>
  call(config, '/api/schedule/schedules.list', {
    body: { date_range: dateRange, resource_ids: resourceIds },
    schema: ShiftList,
  });

export const listAbsences = async (
  config: TipeeConfig,
  dateRange: string,
  { resourceIds }: PeopleFilter = {},
): Promise<AbsenceView[]> =>
  call(config, '/api/schedule/absences.list', {
    body: { date_range: dateRange, resource_ids: resourceIds },
    schema: AbsenceList,
  });

export const listOnCalls = async (
  config: TipeeConfig,
  dateRange: string,
  { resourceIds, teamId }: PeopleFilter & TeamFilter = {},
): Promise<OnCallView[]> =>
  call(config, '/api/schedule/on-calls.list', {
    body: { date_range: dateRange, resource_ids: resourceIds, team_ids: idList(teamId) },
    schema: OnCallList,
  });

export const showActivityRates = async (
  config: TipeeConfig,
  resourceId: string,
  dateRange?: string,
): Promise<ActivityRateView[]> =>
  call(config, '/api/directory/resources.show-activity-rates', {
    body: { date_range: dateRange, resource_id: resourceId },
    schema: ActivityRateList,
  });
