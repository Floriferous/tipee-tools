// Where this copy of the plugin runs and who runs it. Claude starts the
// server many times over, and its two surfaces give an extension different
// home directories, so neither a launch nor a file in the home directory
// identifies an installation. A hash of the machine and the account does,
// without either ever leaving the machine.

import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { argv, env } from 'node:process';

/** How the plugin was installed, which decides how it updates. */
export type Channel = 'desktop' | 'plugin' | 'dev';

const UUID_PARTS = [8, 4, 4, 4, 12] as const;

// Reads the channel off the path the server was started from. Claude Code
// keeps plugins under its own directory; this repository also has a
// `plugins/` folder, so only Claude's own path counts as an install.
export const channelOf = (entry: string): Channel => {
  // Windows paths use backslashes.
  const unixy = entry.replaceAll('\\', '/');
  if (unixy.includes('Claude Extensions')) {
    return 'desktop';
  }
  return unixy.includes('.claude/plugins/') ? 'plugin' : 'dev';
};

export const channel: Channel = channelOf(argv[1] ?? '');

// Shaped like a UUID so PostHog treats it as an opaque id.
const shaped = (hex: string): string => {
  let at = 0;
  return UUID_PARTS.map((length) => {
    const part = hex.slice(at, at + length);
    at += length;
    return part;
  }).join('-');
};

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
// surfaces count as one installation. One way: the machine and account names
// cannot be read back out, and are never sent.
export const installationId = (): string =>
  shaped(createHash('sha256').update(`tipee-tools:${hostname()}:${username()}`).digest('hex'));
