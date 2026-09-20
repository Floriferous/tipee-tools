// Where this copy of the plugin runs and who runs it. Claude starts the
// Server many times over, and its two surfaces give an extension different
// Home directories, so neither a launch nor a file in the home directory
// Identifies an installation. A hash of the machine and the account does,
// Without either ever leaving the machine.

import { createHash } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import { argv } from 'node:process';

/** How the plugin was installed, which decides how it updates. */
export type Channel = 'desktop' | 'plugin' | 'dev';

const UUID_PARTS = [8, 4, 4, 4, 12] as const;

// Reads the channel off the path the server was started from. Claude Code
// Keeps plugins under its own directory; this repository also has a
// `plugins/` folder, so only Claude's own path counts as an install.
export const channelOf = (entry: string): Channel => {
  if (entry.includes('Claude Extensions')) {
    return 'desktop';
  }
  return entry.includes('.claude/plugins/') ? 'plugin' : 'dev';
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

// The same id for every copy of the plugin on one account, so Claude's
// Surfaces count as one installation. One way: the machine and account names
// Cannot be read back out, and are never sent.
export const installationId = (): string =>
  shaped(
    createHash('sha256').update(`tipee-tools:${hostname()}:${userInfo().username}`).digest('hex'),
  );
