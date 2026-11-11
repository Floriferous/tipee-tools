// Where this copy of the plugin runs and who runs it. Claude starts the
// server many times over, and its two surfaces give an extension different
// home directories, so neither a launch nor a file in the home directory
// identifies an installation. A hash of the machine and the account does,
// without either ever leaving the machine.

import { hostname, userInfo } from 'node:os';
import { argv, env } from 'node:process';

import { layerDigest } from '@effect/platform-node/NodeCrypto';
import { Array as Arr, Effect, ManagedRuntime, String as Str, pipe } from 'effect';
import { Digest } from 'effect/crypto';

/** How the plugin was installed, which decides how it updates. */
export type Channel = 'desktop' | 'plugin' | 'dev';

const UUID_PARTS = [8, 4, 4, 4, 12] as const;

// Reads the channel off the path the server was started from. Claude Code
// keeps plugins under its own directory; this repository also has a
// `plugins/` folder, so only Claude's own path counts as an install.
export const channelOf = (entry: string): Channel => {
  // Windows paths use backslashes.
  const unixy = Str.replaceAll('\\', '/')(entry);
  if (Str.includes('Claude Extensions')(unixy)) {
    return 'desktop';
  }
  return Str.includes('.claude/plugins/')(unixy) ? 'plugin' : 'dev';
};

export const channel: Channel = channelOf(argv[1] ?? '');

// Shaped like a UUID so PostHog treats it as an opaque id.
const shaped = (hex: string): string =>
  pipe(
    UUID_PARTS,
    Arr.mapAccum(0, (at, length) => [at + length, Str.slice(at, at + length)(hex)] as const),
    ([, parts]) => Arr.join(parts, '-'),
  );

// The account name. `userInfo` throws in a container run under a uid that
// has no passwd entry, and telemetry must never stop the server.
const username = (): string => {
  try {
    return userInfo().username;
  } catch {
    return env.USER ?? env.USERNAME ?? '';
  }
};

// The same id for every copy of the plugin on one account, so Claude's
// surfaces count as one installation. Pseudonymous, not anonymous: the names
// are never sent, but whoever knows them can compute the id and match it.
export const installation: Effect.Effect<string, never, Digest.Digest> = Effect.gen(function* () {
  const digest = yield* Digest.Digest;
  const names = new TextEncoder().encode(`tipee-tools:${hostname()}:${username()}`);
  const hex = yield* digest.digestHex(Digest.sha256, names);
  return shaped(hex);
});

// Node computes digests synchronously, so code outside Effect gets the id at
// once from a runtime that holds only that.
const digests = ManagedRuntime.make(layerDigest);

// The installation id, for code outside Effect.
export const installationId = (): string => digests.runSync(installation);
