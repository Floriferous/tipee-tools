// Runs @effect/openapi-generator's `openapigen` on a document and a JSON
// Patch over it, returning the module it prints.

import { Effect, Path, Schema as Codec, Stream } from 'effect';
import type { PlatformError } from 'effect/PlatformError';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { SpecError, root } from './spec.ts';
import type { Patch } from './spec.ts';

const encodeJson = Codec.encodeEffect(Codec.fromJsonString(Codec.Unknown));
const text = (bytes: Stream.Stream<Uint8Array, PlatformError>) =>
  Stream.mkString(Stream.decodeText(bytes));

// Fails with the generator's stderr unless it exits with 0.
export const openapigen = Effect.fn('openapigen')(function* (
  file: string,
  patch: ReadonlyArray<Patch>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const directory = yield* root;
  const json = yield* encodeJson(patch);
  const handle = yield* spawner.spawn(
    ChildProcess.make(path.join(directory, 'node_modules', '.bin', 'openapigen'), [
      '--spec',
      file,
      '--format',
      'httpapi',
      '--name',
      'Tipee',
      '--patch',
      json,
    ]),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [text(handle.stdout), text(handle.stderr), handle.exitCode],
    { concurrency: 'unbounded' },
  );
  if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
    return yield* SpecError.make({ message: `openapigen failed:\n${stderr}` });
  }
  return stdout;
}, Effect.scoped);
