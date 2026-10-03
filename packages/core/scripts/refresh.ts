// `pnpm spec:refresh`: brings the vendored OpenAPI document up to Tipee's
// newest stable version, regenerates the client and the plugin bundle, and
// prints what changed. It only rewrites files of this checkout, so it is safe
// to run locally; review the diff, or throw it away. With --bump it also moves
// the plugin version (minor when operations were added, patch otherwise), and
// --report <file> writes the summary as JSON for the spec-refresh workflow.

import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { root, specDirectory, toolName, toolRoutes, vendored } from './spec.ts';
import type { Document } from './spec.ts';

const DOCS = 'https://api.tipee.ch';
const repository = path.join(root, '..', '..');
const { values: options } = parseArgs({
  options: { bump: { default: false, type: 'boolean' }, report: { type: 'string' } },
});

// Curl keeps the script synchronous; it fails on any HTTP error.
const download = (url: string): string => {
  const result = spawnSync('curl', ['--fail', '--silent', '--show-error', '--location', url], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`could not download ${url}: ${result.stderr}`);
  }
  return result.stdout;
};

// Replaces a passage that must be there.
const rewrite = (file: string, from: string, to: string): void => {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) {
    throw new Error(`"${from}" is not in ${path.relative(repository, file)}`);
  }
  writeFileSync(file, text.replace(from, to));
};

const run = (command: string, args: ReadonlyArray<string>): void => {
  // The tools' own output goes to stderr; stdout carries the summary.
  const result = spawnSync(command, args, { cwd: repository, stdio: ['ignore', 2, 2] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
};

// The docs index links every page of each version as versions/<YY.MM.DD>/…
// (`preview` is not a stable version); the dates sort as text.
const index = download(`${DOCS}/llms.txt`);
const latest = [...index.matchAll(/\/versions\/(?<version>\d{2}\.\d{2}\.\d{2})\//gu)]
  .map((match) => match.groups?.version ?? '')
  .toSorted()
  .at(-1);
const { document: before, file: vendoredFile } = vendored();
const pinned = before.info.version;
if (latest === undefined || latest < pinned) {
  throw new Error(`no stable version at or after ${pinned} in ${DOCS}/llms.txt`);
}
// Written as downloaded: parsing would move numeric keys (response codes) first.
const downloaded = download(`${DOCS}/openapi/${latest}.json`);
const after = JSON.parse(downloaded) as Document;
if (after.info.version !== latest) {
  throw new Error(`${DOCS}/openapi/${latest}.json declares version ${after.info.version}`);
}
const moved = latest !== pinned;
const changed = moved || JSON.stringify(after) !== JSON.stringify(before);

const tools = (document: Document): Set<string> =>
  new Set(toolRoutes(document).map((route) => toolName(route)));
const added = [...tools(after)].filter((name) => !tools(before).has(name));
const removed = [...tools(before)].filter((name) => !tools(after).has(name));
const schemas = {
  added: [] as Array<string>,
  changed: [] as Array<string>,
  removed: [] as Array<string>,
};
for (const [name, schema] of Object.entries(after.components.schemas)) {
  const previous = before.components.schemas[name];
  if (previous === undefined) {
    schemas.added.push(name);
  } else if (JSON.stringify(previous) !== JSON.stringify(schema)) {
    schemas.changed.push(name);
  }
}
schemas.removed = Object.keys(before.components.schemas).filter(
  (name) => after.components.schemas[name] === undefined,
);

// The plugin version a reviewer merges: tool names are the public surface, so
// a removed or renamed operation needs a major version, which a person decides.
const bump = (): string => {
  const manifest = path.join(repository, 'plugins', 'tipee', '.claude-plugin', 'plugin.json');
  const current = (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
  const [major = 0, minor = 0, patch = 0] = current.split('.').map(Number);
  const next = added.length > 0 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  rewrite(manifest, `"version": "${current}"`, `"version": "${next}"`);
  rewrite(
    path.join(repository, 'packages', 'mcp', 'src', 'Server.ts'),
    `SERVER_VERSION = '${current}'`,
    `SERVER_VERSION = '${next}'`,
  );
  // The packages carry the version too, until they no longer do.
  for (const workspace of ['packages/core', 'packages/mcp', 'plugins/tipee']) {
    const manifestOf = path.join(repository, workspace, 'package.json');
    if (readFileSync(manifestOf, 'utf8').includes(`"version": "${current}"`)) {
      rewrite(manifestOf, `"version": "${current}"`, `"version": "${next}"`);
    }
  }
  return `${current} → ${next}`;
};

// Writes the new document, moves the version when asked, then regenerates
// the client and rebuilds the bundle; returns the version change, if any.
const update = (): string | undefined => {
  writeFileSync(path.join(specDirectory, `tipee-${latest}.json`), downloaded);
  if (moved) {
    rmSync(vendoredFile);
    rewrite(
      path.join(root, 'src', 'TipeeClient.ts'),
      `TIPEE_API_VERSION = '${pinned}'`,
      `TIPEE_API_VERSION = '${latest}'`,
    );
  }
  const bumped = options.bump ? bump() : undefined;
  run('pnpm', ['exec', 'oxfmt', specDirectory]);
  run('pnpm', ['generate']);
  run('pnpm', ['build']);
  return bumped;
};
const version = changed ? update() : undefined;

const list = (names: ReadonlyArray<string>): string =>
  names.length === 0 ? 'none' : names.map((name) => `\`${name}\``).join(', ');
const title = moved ? `Move to Tipee API ${latest}` : `Refresh the Tipee API ${latest} document`;
const body = [
  moved
    ? `Tipee released API ${latest}; this moves the tools from ${pinned}. Tipee supports ` +
      `${pinned} for at least 6 months after ${latest}'s release: merge within that window.`
    : `Tipee changed its ${latest} document in place.`,
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
  ...(version === undefined ? [] : [`### Version\n\n${version}`]),
  'Read the diff of `packages/core/src/generated/TipeeApi.ts`: a patch in ' +
    '`packages/core/scripts/generate.ts` may need to follow, or to go once Tipee fixed what it worked around.',
].join('\n\n');

process.stdout.write(changed ? `# ${title}\n\n${body}\n` : `Tipee API ${pinned} is current.\n`);
if (options.report !== undefined) {
  writeFileSync(
    options.report,
    JSON.stringify({
      body,
      branch: moved ? `spec-move-${latest}` : 'spec-refresh',
      changed,
      needs_major: removed.length > 0,
      title,
    }),
  );
}
