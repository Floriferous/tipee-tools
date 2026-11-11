// Packs the Claude Desktop extension: the same bundled server as the Claude
// Code plugin, plus a manifest generated from the toolkit so tool names and
// descriptions cannot drift. Output: dist/tipee-<version>.mcpb.

import { runMain } from '@effect/platform-node/NodeRuntime';
import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import { SERVER_VERSION, SETUP_PROMPT, TipeeToolkit } from '@tipee-tools/mcp';
import { Array as Arr, Effect, FileSystem, Path, Record as Rec, Schema } from 'effect';
import { Tool } from 'effect/ai';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

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
    'tipee for Claude: people, teams, shifts, absences, on-calls, activities and time clock, reading and changing.',
  display_name: 'tipee for Claude',
  documentation: `${REPOSITORY}#readme`,
  homepage: REPOSITORY,
  // Tipee's app icon, icon-512x512.png from the web manifest on tipee.ch.
  icon: 'icon.png',
  keywords: ['tipee', 'hr', 'planning', 'shifts'],
  license: 'MIT',
  long_description:
    'Give Claude access to your tipee: people, teams, shifts, absences, on-calls, ' +
    'activities and time clock, reading and changing. Every tool that changes tipee ' +
    'instructs Claude to say exactly what will change and wait for your yes, unless you ' +
    'asked for that exact change, and Claude Desktop asks your permission per tool: choose ' +
    '"Allow once" to approve every change yourself.\n\n' +
    'The API key belongs to an integration created in the tipee admin panel. It needs the ' +
    'authorization "Se connecter avec des applications externes" plus the module rights ' +
    'Claude should have. After saving, use the "check-tipee-setup" prompt or ask Claude to ' +
    'run check_setup: it names the integration, links where its rights are set, and explains ' +
    'anything missing in plain words.\n\n' +
    'The extension sends usage data to PostHog to help improve it: which tools ran, whether ' +
    'an update was offered, how they ' +
    "failed (by reason, HTTP status, tipee's error code, and the names of the fields " +
    'concerned and of the parameters sent, never their values), crash messages and ' +
    'stack traces, your instance name, your setup (system, Node and Claude versions), the ' +
    'approximate location PostHog derives from your IP address before discarding it, and a ' +
    'pseudonymous installation ID computed from your computer and account names (the names ' +
    'are never sent); never your key, anything tipee answered, or anything about your ' +
    'people. See the privacy policy.\n\n' +
    'An independent project, not made or endorsed by tipee.',
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
  tools: Arr.map(Rec.values(TipeeToolkit.tools), (tool) => ({
    description: Tool.getDescription(tool),
    name: tool.name,
  })),
  tools_generated: false,
  // Built from entries so the order is explicit: Claude Desktop shows the
  // fields in insertion order, and the easy, non-secret value comes first.
  // Descriptions double as placeholders, so they stay short. Claude Desktop
  // keeps saved values by key: renaming one loses every user's instance or
  // key.
  user_config: Rec.fromEntries([
    [
      'instance',
      {
        description: 'Your tipee subdomain: acme for acme.tipee.net',
        required: true,
        title: 'tipee instance',
        type: 'string',
      },
    ],
    [
      'api_key',
      {
        description: 'Integration key from the tipee admin panel',
        required: true,
        sensitive: true,
        title: 'tipee API key',
        type: 'string',
      },
    ],
  ]),
  version: SERVER_VERSION,
};

class PackFailed extends Schema.TaggedError<PackFailed, { readonly brand: unique symbol }>()(
  'PackFailed',
  { message: Schema.String },
) {}

const encodeManifest = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown, { space: 2 }));

const pack = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = path.join(import.meta.dirname, '..');
  const staging = path.join(root, 'dist', 'mcpb');
  const output = path.join(root, 'dist', `tipee-${SERVER_VERSION}.mcpb`);
  const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb');

  yield* fs.remove(path.join(root, 'dist'), { force: true, recursive: true });
  yield* fs.makeDirectory(path.join(staging, 'server'), { recursive: true });
  const json = yield* encodeManifest(manifest);
  yield* fs.writeFileString(path.join(staging, 'manifest.json'), `${json}\n`);
  yield* fs.copyFile(
    path.join(root, 'server', 'tipee-mcp.mjs'),
    path.join(staging, 'server', 'tipee-mcp.mjs'),
  );
  for (const file of ['icon.png', 'LICENSE']) {
    yield* fs.copyFile(path.join(root, file), path.join(staging, file));
  }

  // Pack validates the manifest first.
  const args = ['pack', staging, output];
  yield* spawner
    .exitCode(
      ChildProcess.make(mcpb, args, { stderr: 'inherit', stdin: 'inherit', stdout: 'inherit' }),
    )
    .pipe(
      Effect.filterOrFail(
        (exitCode) => exitCode === ChildProcessSpawner.ExitCode(0),
        () => PackFailed.make({ message: `mcpb ${Arr.join(args, ' ')} failed` }),
      ),
    );
});

runMain(Effect.provide(pack, nodeServices));
