// Entry point: `node src/main.ts`. Configuration comes from TIPEE_INSTANCE and
// TIPEE_API_KEY in the environment. A crash outside the Effect runtime is
// Reported before the process dies, the way one inside it is.

import { NodeRuntime } from '@effect/platform-node';
import { Cause, Effect } from 'effect';

import { main, reportCrash } from './Server.ts';

const EXIT_CRASHED = 1;

const leave = Effect.sync(() => {
  // oxlint-disable-next-line unicorn/no-process-exit -- the process is crashing; leave once the report is out
  process.exit(EXIT_CRASHED);
});
const crashed = (error: unknown): void => {
  Effect.runFork(Effect.andThen(reportCrash(Cause.die(error)), leave));
};
process.on('uncaughtException', crashed);
process.on('unhandledRejection', crashed);

NodeRuntime.runMain(main);
