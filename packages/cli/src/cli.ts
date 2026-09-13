// Command-line interface over the read-only Tipee endpoints. `run` is pure
// (arguments and environment in, text out) so tests can call it directly.

import {
  TipeeShapeError,
  listAbsences,
  listKinds,
  listOnCalls,
  listPeople,
  listShifts,
  listTeams,
  listTemplates,
  showActivityRates,
} from '@tipee-tools/core';
import type { TipeeConfig } from '@tipee-tools/core';
import { parseArgs } from 'node:util';

export const USAGE = `Usage: pnpm tipee <command> [arguments]

Commands (all read-only):
  kinds                                 List resource kinds
  people [--team id]                    List employees (planning fields only)
  teams                                 List teams (sites and sectors)
  templates [--team id]                 List shift templates
  shifts <from> <to> [--people a,b]     List planned shifts in a date range
  absences <from> <to> [--people a,b]   List absences in a date range
  on-calls <from> <to> [--team id]      List on-call duties in a date range
  activity-rates <person> [from to]     Show a person's employment rates
  check [from to]                       Call every endpoint and validate the
                                        response shapes (stores nothing)

Dates use the YYYY-MM-DD format. Configuration comes from
packages/cli/.env (see .env.example): TIPEE_INSTANCE and TIPEE_API_KEY.`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const JSON_INDENT = 2;
const DAYS_PER_WEEK = 7;

const readConfig = (env: Record<string, string | undefined>): TipeeConfig => {
  const instance = env.TIPEE_INSTANCE;
  const apiKey = env.TIPEE_API_KEY;
  if (instance === undefined || instance === '' || apiKey === undefined || apiKey === '') {
    throw new Error(
      'Missing Tipee configuration. Copy packages/cli/.env.example to ' +
        'packages/cli/.env and fill in TIPEE_INSTANCE and TIPEE_API_KEY.',
    );
  }
  return { apiKey, instance };
};

const dateRange = (from: string | undefined, to: string | undefined): string => {
  if (
    from === undefined ||
    to === undefined ||
    !DATE_PATTERN.test(from) ||
    !DATE_PATTERN.test(to)
  ) {
    throw new Error(`This command needs two dates in YYYY-MM-DD format.\n\n${USAGE}`);
  }
  return `${from}/${to}`;
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 'YYYY-MM-DD'.length);

// Today through six days from now — enough to exercise every endpoint.
const defaultRange = (now: Date): string => {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + DAYS_PER_WEEK - 1);
  return `${isoDate(now)}/${isoDate(end)}`;
};

const splitIds = (people: string | undefined): string[] | undefined => {
  if (people === undefined || people === '') {
    return undefined;
  }
  return people.split(',').map((id) => id.trim());
};

interface CommandArguments {
  first: string | undefined;
  second: string | undefined;
  third: string | undefined;
  people: string | undefined;
  team: string | undefined;
  /** Injected so tests can pin "today". */
  now: Date;
}

type Command = (config: TipeeConfig, commandArguments: CommandArguments) => Promise<unknown>;

const COMMANDS: Record<string, Command> = {
  absences: async (config, { first, second, people }) =>
    listAbsences(config, dateRange(first, second), { resourceIds: splitIds(people) }),
  'activity-rates': async (config, { first, second, third }) => {
    if (first === undefined) {
      throw new Error(`This command needs a person id.\n\n${USAGE}`);
    }
    const range = second === undefined ? undefined : dateRange(second, third);
    return showActivityRates(config, first, range);
  },
  kinds: async (config) => listKinds(config),
  'on-calls': async (config, { first, second, team }) =>
    listOnCalls(config, dateRange(first, second), { teamId: team }),
  people: async (config, { team }) => listPeople(config, { teamId: team }),
  shifts: async (config, { first, second, people }) =>
    listShifts(config, dateRange(first, second), { resourceIds: splitIds(people) }),
  teams: async (config) => listTeams(config),
  templates: async (config, { team }) => listTemplates(config, { teamId: team }),
};

type Probe<Item> = () => Promise<Item[]>;

interface ProbeResult<Item> {
  failed: boolean;
  items: Item[];
  line: string;
}

// One "ok"/"FAIL" report line per endpoint; only shape errors are caught, so
// Auth or network failures still abort the whole check.
const probe = async <Item>(name: string, run: Probe<Item>): Promise<ProbeResult<Item>> => {
  try {
    const items = await run();
    return { failed: false, items, line: `ok    ${name} (${items.length})` };
  } catch (error) {
    if (!(error instanceof TipeeShapeError)) {
      throw error;
    }
    return { failed: true, items: [], line: `FAIL  ${name}\n${error.message}` };
  }
};

// Runs every read endpoint and reports which responses still match the
// Schemas. Nothing is stored: this is the early warning for API changes.
const check = async (config: TipeeConfig, range: string): Promise<string> => {
  const people = await probe('people', async () => listPeople(config));
  const [somebody] = people.items;
  const probes: Record<string, Probe<unknown>> = {
    absences: async () => listAbsences(config, range),
    'activity-rates': async () =>
      somebody === undefined ? [] : showActivityRates(config, somebody.id),
    kinds: async () => listKinds(config),
    'on-calls': async () => listOnCalls(config, range),
    shifts: async () => listShifts(config, range),
    teams: async () => listTeams(config),
    templates: async () => listTemplates(config),
  };
  const results: ProbeResult<unknown>[] = [people];
  for (const [name, run] of Object.entries(probes)) {
    results.push(await probe(name, run));
  }
  const report = `${results.map((result) => result.line).join('\n')}\nDate range: ${range}`;
  if (results.some((result) => result.failed)) {
    throw new Error(report);
  }
  return report;
};

const execute = async (
  command: string,
  config: TipeeConfig,
  commandArguments: CommandArguments,
): Promise<string> => {
  const { first, second, now } = commandArguments;
  if (command === 'check') {
    return check(config, first === undefined ? defaultRange(now) : dateRange(first, second));
  }
  const handler = COMMANDS[command];
  if (handler === undefined) {
    throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
  }
  const result = await handler(config, commandArguments);
  return JSON.stringify(result, undefined, JSON_INDENT);
};

export const run = async (
  argv: string[],
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): Promise<string> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      people: { type: 'string' },
      team: { type: 'string' },
    },
  });
  const [command, first, second, third] = positionals;
  if (command === undefined || command === 'help') {
    return USAGE;
  }
  const commandArguments = { first, now, people: values.people, second, team: values.team, third };
  return execute(command, readConfig(env), commandArguments);
};
