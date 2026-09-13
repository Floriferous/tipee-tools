// Packs the Claude Desktop extension: the same bundled server as the Claude
// Code plugin, plus a manifest generated from the toolkit so tool names and
// Descriptions cannot drift. Output: dist/tipee-<version>.mcpb.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SERVER_VERSION, SETUP_PROMPT, TipeeToolkit } from '@tipee-tools/mcp';
import { Tool } from 'effect/unstable/ai';

const root = path.join(import.meta.dirname, '..');
const staging = path.join(root, 'dist', 'mcpb');
const output = path.join(root, 'dist', `tipee-${SERVER_VERSION}.mcpb`);
const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb');

const manifest = {
  author: { name: 'Florian Bienefelt', url: 'https://github.com/Floriferous' },
  compatibility: {
    claude_desktop: '>=0.10.0',
    platforms: ['darwin', 'win32', 'linux'],
    runtimes: { node: '>=20.0.0' },
  },
  description:
    'Read your Tipee plannings from Claude: people, teams, shift templates, shifts, absences, on-calls.',
  display_name: 'Tipee',
  documentation: 'https://github.com/Floriferous/tipee-tools#readme',
  homepage: 'https://github.com/Floriferous/tipee-tools',
  // Tipee's square mark, from the favicon on tipee.ch.
  icon: 'icon.png',
  keywords: ['tipee', 'hr', 'planning', 'shifts'],
  license: 'MIT',
  long_description:
    'Read-only access to one Tipee instance. The server keeps only planning fields: no ' +
    'birth dates, addresses or contact details ever reach the conversation. Nothing writes ' +
    'to Tipee.\n\n' +
    'The API key belongs to an integration created in the Tipee admin panel. It needs the ' +
    'authorization "Se connecter avec des applications externes" plus read access to the ' +
    'Planning and Cœur RH modules. After saving, use the "check-tipee-setup" prompt or ask ' +
    'Claude to run tipee_check: it explains any missing authorization in plain words.\n\n' +
    'Not affiliated with Tipee.',
  manifest_version: '0.3',
  name: 'tipee',
  prompts: [
    { description: SETUP_PROMPT.description, name: SETUP_PROMPT.name, text: SETUP_PROMPT.text },
  ],
  prompts_generated: false,
  repository: { type: 'git', url: 'https://github.com/Floriferous/tipee-tools' },
  server: {
    entry_point: 'server/tipee-mcp.mjs',
    mcp_config: {
      args: ['${__dirname}/server/tipee-mcp.mjs'],
      command: 'node',
      env: {
        TIPEE_API_KEY: '${user_config.api_key}',
        TIPEE_INSTANCE: '${user_config.instance}',
      },
    },
    type: 'node',
  },
  tools: Object.values(TipeeToolkit.tools).map((tool) => ({
    description: Tool.getDescription(tool),
    name: tool.name,
  })),
  tools_generated: false,
  // An array, not an object: Claude Desktop shows the fields in this order,
  // And the easy, non-secret value comes first. Descriptions double as
  // Placeholders, so they stay short.
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
copyFileSync(path.join(root, 'icon.png'), path.join(staging, 'icon.png'));

const run = (...args: ReadonlyArray<string>): void => {
  const result = spawnSync(mcpb, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`mcpb ${args.join(' ')} failed`);
  }
};

run('validate', path.join(staging, 'manifest.json'));
run('pack', staging, output);
