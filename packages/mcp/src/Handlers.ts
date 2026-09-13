// Tool handlers: thin wrappers over the TipeeClient, plus `tipee_check`,
// Which probes every endpoint and reports shape mismatches without aborting.

import { TipeeClient } from '@tipee-tools/core';
import type { DateRange, TipeeError } from '@tipee-tools/core';
import { DateTime, Effect } from 'effect';

import { TipeeToolkit } from './Tools.ts';
import type { EndpointReport } from './Tools.ts';

const DAYS_PER_WEEK = 7;

// Today through six days from now — enough to exercise every endpoint.
const defaultRange: Effect.Effect<DateRange> = Effect.map(DateTime.now, (now) => ({
  from: DateTime.formatIsoDate(now),
  to: DateTime.formatIsoDate(DateTime.add(now, { days: DAYS_PER_WEEK - 1 })),
}));

const rangeOf = (from: string | undefined, to: string | undefined): DateRange | undefined =>
  from === undefined || to === undefined ? undefined : { from, to };

interface Probe<A> {
  readonly items: ReadonlyArray<A>;
  readonly report: typeof EndpointReport.Type;
}

// One report line per endpoint. Only shape mismatches are reported as
// Failures; auth and network errors abort the whole check so the user sees
// Their explanation once.
const probe = Effect.fn('tipee_check.probe')(function* probe<A>(
  name: string,
  items: Effect.Effect<ReadonlyArray<A>, TipeeError>,
) {
  return yield* items.pipe(
    Effect.map((found): Probe<A> => ({
      items: found,
      report: { count: found.length, name, status: 'ok' },
    })),
    Effect.catchReason('TipeeError', 'UnexpectedShape', (reason) =>
      Effect.succeed<Probe<A>>({
        items: [],
        report: { error: reason.message, name, status: 'failed' },
      }),
    ),
  );
});

export const TipeeToolkitLayer = TipeeToolkit.toLayer(
  Effect.gen(function* TipeeToolkitLayer() {
    const client = yield* TipeeClient;

    const check = Effect.fn('tipee_check')(function* check({
      from,
      to,
    }: {
      from?: string;
      to?: string;
    }) {
      const range = rangeOf(from, to) ?? (yield* defaultRange);
      const people = yield* probe('people', client.people());
      const [somebody] = people.items;
      const probes: ReadonlyArray<
        readonly [string, Effect.Effect<ReadonlyArray<unknown>, TipeeError>]
      > = [
        ['teams', client.teams],
        ['templates', client.templates()],
        ['shifts', client.shifts(range)],
        ['absences', client.absences(range)],
        ['on_calls', client.onCalls(range)],
        [
          'activity_rates',
          somebody === undefined ? Effect.succeed([]) : client.activityRates(somebody.id),
        ],
      ];
      const endpoints = [people.report];
      for (const [name, items] of probes) {
        endpoints.push((yield* probe(name, items)).report);
      }
      return {
        date_range: `${range.from}/${range.to}`,
        endpoints,
        ok: endpoints.every((report) => report.status === 'ok'),
      };
    });

    return TipeeToolkit.of({
      tipee_absences: Effect.fn('tipee_absences')(function* tipee_absences({
        from,
        resource_ids,
        to,
      }) {
        return { absences: yield* client.absences({ from, to }, { resourceIds: resource_ids }) };
      }),
      tipee_activity_rates: Effect.fn('tipee_activity_rates')(function* tipee_activity_rates({
        from,
        resource_id,
        to,
      }) {
        return { activity_rates: yield* client.activityRates(resource_id, rangeOf(from, to)) };
      }),
      tipee_check: check,
      tipee_on_calls: Effect.fn('tipee_on_calls')(function* tipee_on_calls({
        from,
        resource_ids,
        team_id,
        to,
      }) {
        return {
          on_calls: yield* client.onCalls(
            { from, to },
            { resourceIds: resource_ids, teamId: team_id },
          ),
        };
      }),
      tipee_people: Effect.fn('tipee_people')(function* tipee_people({ team_id }) {
        return { people: yield* client.people({ teamId: team_id }) };
      }),
      tipee_shifts: Effect.fn('tipee_shifts')(function* tipee_shifts({ from, resource_ids, to }) {
        return { shifts: yield* client.shifts({ from, to }, { resourceIds: resource_ids }) };
      }),
      tipee_teams: Effect.fn('tipee_teams')(function* tipee_teams() {
        return { teams: yield* client.teams };
      }),
      tipee_templates: Effect.fn('tipee_templates')(function* tipee_templates({ team_id }) {
        return { templates: yield* client.templates({ teamId: team_id }) };
      }),
    });
  }),
);
