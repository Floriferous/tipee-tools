// `pnpm spec:refresh`: brings the vendored OpenAPI document up to tipee's
// newest stable version, regenerates the client and the plugin bundle, and
// prints what changed. It only rewrites files of this checkout, so it is safe
// to run locally; review the diff, or throw it away. The summary says which
// release it calls for (major when an operation disappeared, minor when one
// was added, patch otherwise); with --bump it also moves the version to it,
// and --report <file> writes the summary as JSON for the spec-refresh workflow.

import { runMain } from '@effect/platform-node/NodeRuntime';
import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import {
  Array as Arr,
  Console,
  Effect,
  FileSystem,
  Option,
  Order,
  Path,
  Record as Rec,
  Schema as Codec,
  Stdio,
  Stream,
  String as Str,
} from 'effect';
import { Command, Flag } from 'effect/cli';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import {
  SpecError,
  decodeDocument,
  specDirectory,
  toolName,
  toolRoutes,
  vendored,
} from './spec.ts';
import type { Document } from './spec.ts';

const DOCS = 'https://api.tipee.ch';
const repository = Path.Path.useSync((path) => path.join(import.meta.dirname, '..', '..', '..'));
const json = Codec.encodeEffect(Codec.fromJsonString(Codec.Unknown));

// Fails on any HTTP error.
const download = Effect.fn('download')(
  function* (url: string) {
    const client = yield* HttpClient.HttpClient;
    const response = yield* HttpClient.filterStatusOk(client).get(url);
    return yield* response.text;
  },
  (effect, url) =>
    Effect.mapError(effect, (cause) =>
      SpecError.make({ message: `could not download ${url}: ${cause.message}` }),
    ),
);

// Replaces a passage that must be there.
const rewrite = Effect.fn('rewrite')(function* (file: string, from: string, to: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(file);
  if (Str.includes(from)(text)) {
    return yield* fs.writeFileString(file, Str.replace(from, to)(text));
  }
  const directory = yield* repository;
  return yield* SpecError.make({
    message: `"${from}" is not in ${path.relative(directory, file)}`,
  });
});

// The tools' own output goes to stderr; stdout carries the summary.
const run = Effect.fn('run')(function* (command: string, args: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdio = yield* Stdio.Stdio;
  const cwd = yield* repository;
  const handle = yield* spawner.spawn(
    ChildProcess.make(command, args, { cwd, stderr: 'inherit', stdin: 'ignore' }),
  );
  yield* Effect.all([Stream.run(handle.stdout, stdio.stderr()), handle.exitCode], {
    concurrency: 'unbounded',
  }).pipe(
    Effect.filterOrFail(
      ([, exitCode]) => exitCode === ChildProcessSpawner.ExitCode(0),
      () => SpecError.make({ message: `${command} ${Arr.join(args, ' ')} failed` }),
    ),
  );
}, Effect.scoped);

// The docs index links every page of each version as versions/<YY.MM.DD>/…
// (`preview` is not a stable version); the dates sort as text.
const latestVersion = Effect.fn('latestVersion')(function* (pinned: string) {
  const index = yield* download(`${DOCS}/llms.txt`);
  const latest = Arr.last(
    Arr.sort(
      Arr.map(
        Arr.fromIterable(Str.matchAll(/\/versions\/(?<version>\d{2}\.\d{2}\.\d{2})\//gu)(index)),
        (match) => match.groups?.version ?? '',
      ),
      Order.String,
    ),
  );
  if (Option.isNone(latest) || latest.value < pinned) {
    return yield* SpecError.make({
      message: `no stable version at or after ${pinned} in ${DOCS}/llms.txt`,
    });
  }
  return latest.value;
});

// What changed between two documents: operations by tool name, schemas by name.
const compare = Effect.fn('compare')(function* (before: Document, after: Document) {
  const tools = (document: Document): Set<string> =>
    new Set(Arr.map(toolRoutes(document), toolName));
  const added = Arr.filter([...tools(after)], (name) => !tools(before).has(name));
  const removed = Arr.filter([...tools(before)], (name) => !tools(after).has(name));
  const schemas = {
    added: [] as Array<string>,
    changed: [] as Array<string>,
    removed: Arr.filter(
      Rec.keys(before.components.schemas),
      (name) => after.components.schemas[name] === undefined,
    ),
  };
  for (const [name, schema] of Rec.toEntries(after.components.schemas)) {
    const previous = before.components.schemas[name];
    if (previous === undefined) {
      schemas.added.push(name);
    } else if ((yield* json(previous)) !== (yield* json(schema))) {
      schemas.changed.push(name);
    }
  }
  return { added, removed, schemas };
});

// The plugin version a reviewer merges: tool names are the public surface, so
// a removed or renamed operation needs a major version, which a person decides.
// The version lives in plugin.json, SERVER_VERSION and the marketplace ref (see version.test.ts).
const manifest = Path.Path.useSync((path) =>
  path.join(import.meta.dirname, '../../../plugins/tipee/.claude-plugin/plugin.json'),
);
const pluginVersion = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = yield* manifest;
  const text = yield* fs.readFileString(file);
  const { version } = yield* Codec.decodeEffect(
    Codec.fromJsonString(Codec.Struct({ version: Codec.String })),
  )(text);
  return version;
});
const bump = Effect.fn('bump')(function* (minor: boolean) {
  const path = yield* Path.Path;
  const directory = yield* repository;
  const current = yield* pluginVersion;
  const file = yield* manifest;
  const [major, minorVersion = 0, patch = 0] = Arr.map(Str.split('.')(current), Number);
  const next = minor ? `${major}.${minorVersion + 1}.0` : `${major}.${minorVersion}.${patch + 1}`;
  yield* rewrite(file, `"version": "${current}"`, `"version": "${next}"`);
  yield* rewrite(
    path.join(directory, 'packages', 'mcp', 'src', 'Server.ts'),
    `SERVER_VERSION = '${current}'`,
    `SERVER_VERSION = '${next}'`,
  );
  yield* rewrite(
    path.join(directory, '.claude-plugin', 'marketplace.json'),
    `"ref": "v${current}"`,
    `"ref": "v${next}"`,
  );
  return `${current} → ${next}`;
});

const list = (names: ReadonlyArray<string>): string =>
  names.length === 0
    ? 'none'
    : Arr.join(
        Arr.map(names, (name) => `\`${name}\``),
        ', ',
      );

const refresh = Effect.fn('refresh')(function* (options: {
  readonly bump: boolean;
  readonly report: Option.Option<string>;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const checkout = yield* repository;
  const specs = yield* specDirectory;
  const { document: before, file: vendoredFile } = yield* vendored();
  const pinned = before.info.version;
  const latest = yield* latestVersion(pinned);
  // Written as downloaded: parsing would move numeric keys (response codes) first.
  const source = `${DOCS}/openapi/${latest}.json`;
  const downloaded = yield* download(source);
  const after = yield* decodeDocument(downloaded, source).pipe(
    Effect.filterOrFail(
      (document) => document.info.version === latest,
      (document) =>
        SpecError.make({ message: `${source} declares version ${document.info.version}` }),
    ),
  );
  const moved = latest !== pinned;
  const changed = moved || (yield* json(after)) !== (yield* json(before));
  const { added, removed, schemas } = yield* compare(before, after);

  // Writes the new document, moves the version when asked, then regenerates
  // the client and rebuilds the bundle; returns the version change, if any.
  const update = Effect.gen(function* () {
    yield* fs.writeFileString(path.join(specs, `tipee-${latest}.json`), downloaded);
    if (moved) {
      yield* fs.remove(vendoredFile);
      yield* rewrite(
        path.join(checkout, 'packages', 'core', 'src', 'TipeeClient.ts'),
        `TIPEE_API_VERSION = '${pinned}'`,
        `TIPEE_API_VERSION = '${latest}'`,
      );
      // The README's compatibility section names the version too.
      yield* rewrite(
        path.join(checkout, 'README.md'),
        `tipee API ${pinned}`,
        `tipee API ${latest}`,
      );
    }
    const bumped = options.bump ? yield* bump(added.length > 0) : undefined;
    yield* run('pnpm', ['exec', 'oxfmt', specs]);
    yield* run('pnpm', ['generate']);
    yield* run('pnpm', ['build']);
    return bumped;
  });
  const version = changed ? yield* update : undefined;

  // The release a change calls for: tool names are the public surface.
  let level = 'patch';
  if (removed.length > 0) {
    level = 'major';
  } else if (added.length > 0) {
    level = 'minor';
  }

  const title = moved ? `Move to tipee API ${latest}` : `Refresh the tipee API ${latest} document`;
  const body = Arr.join(
    [
      moved
        ? `tipee released API ${latest}; this moves the tools from ${pinned}. tipee supports ` +
          `${pinned} for at least 6 months after ${latest}'s release: merge within that window.`
        : `tipee changed its ${latest} document in place.`,
      `Changelog: ${DOCS}/changelog/${latest}/changelog.md`,
      ...(removed.length > 0
        ? [
            '> [!WARNING]\n> Operations disappeared or were renamed. Tool names are the public ' +
              'surface: this needs a major version, chosen by a person before merging.',
          ]
        : []),
      `### Operations\n\n- Added: ${list(added)}\n- Removed: ${list(removed)}`,
      `### Schemas\n\n- Added: ${list(schemas.added)}\n- Removed: ${list(schemas.removed)}\n` +
        `- Changed: ${list(schemas.changed)}`,
      version === undefined
        ? `### Release\n\nMerging this ships nothing: it goes out with the next release, ` +
          `which it makes at least a ${level} version.`
        : `### Version\n\n${version}`,
      'Read the diff of `packages/core/src/generated/TipeeApi.ts`: a patch in ' +
        '`packages/core/scripts/generate.ts` may need to follow, or to go once tipee fixed what it worked around.',
    ],
    '\n\n',
  );

  yield* Console.log(changed ? `# ${title}\n\n${body}` : `tipee API ${pinned} is current.`);
  if (Option.isSome(options.report)) {
    const report = yield* json({
      body,
      branch: moved ? `spec-move-${latest}` : 'spec-refresh',
      changed,
      needs_major: removed.length > 0,
      title,
    });
    yield* fs.writeFileString(options.report.value, report);
  }
});

const command = Command.make(
  'spec:refresh',
  {
    bump: Flag.Boolean('bump').pipe(
      Flag.withDescription('Also move the plugin version to the release the change calls for'),
      Flag.withDefault(false),
    ),
    report: Flag.String('report').pipe(
      Flag.withDescription('Write the summary as JSON to this file, for the spec-refresh workflow'),
      Flag.optional,
    ),
  },
  refresh,
);

const main = Effect.gen(function* () {
  const version = yield* pluginVersion;
  yield* command.pipe(Command.run({ version }));
});

runMain(Effect.provide(main, [nodeServices, FetchHttpClient.layer]));
