// Packs the Claude Desktop extension: the same bundled server as the Claude
// Code plugin, plus a manifest generated from the toolkit so tool names and
// descriptions cannot drift. Output: dist/tipee-<version>.mcpb.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SERVER_VERSION, SETUP_PROMPT, TipeeToolkit } from '@tipee-tools/mcp';
import { Tool } from 'effect/ai';

const root = path.join(import.meta.dirname, '..');
const staging = path.join(root, 'dist', 'mcpb');
const output = path.join(root, 'dist', `tipee-${SERVER_VERSION}.mcpb`);
const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb');

const REPOSITORY = 'https://github.com/Floriferous/tipee-tools';

const manifest = {
  // Claude Desktop recognizes an installed extension by its author's name and
  // its name: renaming either installs a second copy beside the first.
  author: { name: 'Florian Bienefelt', url: 'https://github.com/Floriferous' },
  compatibility: {
    claude_desktop: '>=0.10.0',
    platforms: ['darwin', 'win32', 'linux'],
    // The first Node 22 with `tls.setDefaultCACertificates` (see Start.ts), and
    // the oldest one the bundle is built for.
    runtimes: { node: '>=22.19.0' },
  },
  description:
    'Tipee for Claude: people, teams, shifts, absences, on-calls, activities and time clock, reading and changing.',
  display_name: 'Tipee for Claude',
  documentation: `${REPOSITORY}#readme`,
  homepage: REPOSITORY,
  // Tipee's square mark, from the favicon on tipee.ch.
  icon: 'icon.png',
  keywords: ['tipee', 'hr', 'planning', 'shifts'],
  license: 'MIT',
  long_description:
    'Give Claude access to your Tipee: people, teams, shifts, absences, on-calls, ' +
    'activities and time clock, reading and changing. Every tool that changes Tipee ' +
    'instructs Claude to say exactly what will change and wait for your yes, unless you ' +
    'asked for that exact change, and Claude Desktop asks your permission per tool: choose ' +
    '"Allow once" to approve every change yourself.\n\n' +
    'The API key belongs to an integration created in the Tipee admin panel. It needs the ' +
    'authorization "Se connecter avec des applications externes" plus the module rights ' +
    'Claude should have. After saving, use the "check-tipee-setup" prompt or ask Claude to ' +
    'run check_setup: it names the integration, links where its rights are set, and explains ' +
    'anything missing in plain words.\n\n' +
    'The extension sends usage data to PostHog to help improve it: which tools ran, how they ' +
    "failed (by reason, HTTP status, Tipee's error code and field paths), crash messages and " +
    'stack traces, your instance name, your setup (system, Node and Claude versions), and a ' +
    'pseudonymous installation ID computed from your computer and account names (the names ' +
    'are never sent); never your key, anything Tipee answered, or anything about your ' +
    'people. See the privacy policy.\n\n' +
    'An independent project, not made or endorsed by Tipee.',
  manifest_version: '0.3',
  // See `author`.
  name: 'tipee',
  // MCPB asks extensions that talk to outside services for a privacy policy.
  privacy_policies: [`${REPOSITORY}#privacy-and-telemetry`],
  prompts: [
    { description: SETUP_PROMPT.description, name: SETUP_PROMPT.name, text: SETUP_PROMPT.text },
  ],
  prompts_generated: false,
  repository: { type: 'git', url: REPOSITORY },
  server: {
    entry_point: 'server/tipee-mcp.mjs',
    mcp_config: {
      args: ['${__dirname}/server/tipee-mcp.mjs'],
      command: 'node',
      env: {
        // Use the HTTPS_PROXY a company network sets, as the plugin's
        // .mcp.json does; Node versions without proxy support ignore it.
        NODE_USE_ENV_PROXY: '1',
        TIPEE_API_KEY: '${user_config.api_key}',
        TIPEE_INSTANCE: '${user_config.instance}',
      },
    },
    type: 'node',
  },
  support: `${REPOSITORY}/issues`,
  tools: Object.values(TipeeToolkit.tools).map((tool) => ({
    description: Tool.getDescription(tool),
    name: tool.name,
  })),
  tools_generated: false,
  // Built from entries so the order is explicit: Claude Desktop shows the
  // fields in insertion order, and the easy, non-secret value comes first.
  // Descriptions double as placeholders, so they stay short. Claude Desktop
  // keeps saved values by key: renaming one loses every user's instance or
  // key.
  user_config: Object.fromEntries([
    [
      'instance',
      {
        description: 'Your Tipee subdomain: acme for acme.tipee.net',
        required: true,
        title: 'Tipee instance',
        type: 'string',
      },
    ],
    [
      'api_key',
      {
        description: 'Integration key from the Tipee admin panel',
        required: true,
        sensitive: true,
        title: 'Tipee API key',
        type: 'string',
      },
    ],
  ]),
  version: SERVER_VERSION,
};

rmSync(path.join(root, 'dist'), { force: true, recursive: true });
mkdirSync(path.join(staging, 'server'), { recursive: true });
writeFileSync(path.join(staging, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`);
copyFileSync(
  path.join(root, 'server', 'tipee-mcp.mjs'),
  path.join(staging, 'server', 'tipee-mcp.mjs'),
);
for (const file of ['icon.png', 'LICENSE']) {
  copyFileSync(path.join(root, file), path.join(staging, file));
}

const run = (...args: ReadonlyArray<string>): void => {
  const result = spawnSync(mcpb, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`mcpb ${args.join(' ')} failed`);
  }
};

// Pack validates the manifest first.
run('pack', staging, output);
