// The process around the server: the one entry point of both the source
// (`src/main.ts`) and the plugin's bundle. It trusts the system's
// Certificates, reports crashes outside the Effect runtime the way one inside
// It is, and keeps every log, a failed start's included, on stderr: stdout is
// The MCP channel.

import tls from 'node:tls';

import { NodeRuntime } from '@effect/platform-node';
import { Cause, Effect, Logger } from 'effect';

import { main, reportCrash } from './Server.ts';

const EXIT_CRASHED = 1;

// Node's fetch trusts only the roots it ships with, so on a network that
// Inspects HTTPS (Zscaler, Netskope…) every call would fail while Claude
// Itself works: trust the system's store too. Node 22.19 and 24.5 can; older
// Ones skip it, and `--use-system-ca` would crash them.
const trustSystemCertificates = (): void => {
  (tls as Partial<typeof tls>).setDefaultCACertificates?.([
    ...tls.getCACertificates('default'),
    ...tls.getCACertificates('system'),
  ]);
};

/** Runs the server until the client disconnects. */
export const start = (): void => {
  const leave = Effect.sync(() => {
    // oxlint-disable-next-line unicorn/no-process-exit -- the process is crashing; leave once the report is out
    process.exit(EXIT_CRASHED);
  });
  const crashed = (error: unknown): void => {
    Effect.runFork(Effect.andThen(reportCrash(Cause.die(error)), leave));
  };
  process.on('uncaughtException', crashed);
  process.on('unhandledRejection', crashed);
  trustSystemCertificates();
  // Why a start failed reaches stderr, which Claude keeps in its logs, in the
  // Error's own words; a shutdown is not worth a line.
  NodeRuntime.runMain(
    main.pipe(
      Effect.tapCause((cause) =>
        Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.logError(cause),
      ),
      Effect.provideService(Logger.LogToStderr, true),
    ),
    { disableErrorReporting: true },
  );
};
