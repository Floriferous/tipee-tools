// Runs the committed bundle the way Claude runs it, on whichever Node runs
// this script (in CI the oldest one the extension declares), as an Effect
// program over the platform's child process, so it needs only what
// `pnpm install` provides and no loader. The MCP handshake must report
// plugin.json's version, list one tool per operation, the batch tools of a
// few (`<operation>_many`), check_setup and update_plugin, and offer
// the setup prompt, with nothing but JSON on stdout. Usage: node scripts/smoke.ts

import { runMain } from '@effect/platform-node/NodeRuntime';
import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import {
  Array as Arr,
  Console,
  Effect,
  Exit,
  FileSystem,
  Fiber,
  Path,
  Queue,
  Ref,
  Runtime,
  Schema,
  Stream,
  String as Str,
} from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';

import { toolName, toolRoutes, vendored } from '../../../packages/core/scripts/spec.ts';

const TIMEOUT_MS = 10_000;
const SETUP_PROMPT = 'check-tipee-setup';

// What the checks read of the server's answers; the rest is dropped.
const Named = Schema.Array(Schema.Struct({ name: Schema.String }));
const Response = Schema.Struct({
  id: Schema.optionalKey(Schema.Int),
  result: Schema.optionalKey(
    Schema.Struct({
      prompts: Schema.optionalKey(Named),
      serverInfo: Schema.optionalKey(Schema.Struct({ version: Schema.optionalKey(Schema.String) })),
      tools: Schema.optionalKey(Named),
    }),
  ),
});
type Response = typeof Response.Type;

// A request that cannot be answered: the server stopped, or was stopped.
class Unanswered extends Schema.TaggedError<Unanswered, { readonly brand: unique symbol }>()(
  'Unanswered',
  { message: Schema.String },
) {}

const parseJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const decodeResponse = Schema.decodeUnknownEffect(Response);
const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
);

const smoke = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = path.join(import.meta.dirname, '..');
  const manifest = yield* fs.readFileString(path.join(root, '.claude-plugin', 'plugin.json'));
  const { version } = yield* decodeManifest(manifest);
  const { document } = yield* vendored();
  const expected = new Set([
    ...Arr.map(toolRoutes(document), toolName),
    'check_setup',
    'update_plugin',
  ]);

  // Dummy settings and nothing else from this environment; telemetry and the
  // release lookup are refused at once.
  const input = yield* Queue.unbounded<string>();
  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [path.join(root, 'server', 'tipee-mcp.mjs')], {
      env: {
        TIPEE_API_KEY: 'smoke-test',
        TIPEE_INSTANCE: 'acme',
        TIPEE_POSTHOG_HOST: 'http://127.0.0.1:1',
        TIPEE_RELEASES_URL: 'http://127.0.0.1:1/releases',
      },
      stdin: { stream: Stream.encodeText(Stream.fromQueue(input)) },
    }),
  );
  const stderr = yield* Effect.forkScoped(Stream.mkString(Stream.decodeText(handle.stderr)));

  // Requests fail as soon as the server stops, rather than waiting for an
  // answer that cannot come.
  const answers = yield* Queue.unbounded<Response, Unanswered>();
  const notJson = yield* Ref.make<ReadonlyArray<string>>([]);
  const read = (line: string) =>
    parseJson(line).pipe(
      Effect.matchEffect({
        onFailure: () => Ref.update(notJson, Arr.append(line)),
        onSuccess: (message) =>
          decodeResponse(message).pipe(
            Effect.flatMap((response) =>
              response.id === undefined ? Effect.void : Queue.offer(answers, response),
            ),
            Effect.ignore,
          ),
      }),
    );
  const stdout = yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(read),
    Effect.andThen(Effect.exit(handle.exitCode)),
    Effect.flatMap((exit) => {
      const how = Exit.isSuccess(exit) ? `code ${exit.value}` : 'signal';
      return Queue.fail(answers, Unanswered.make({ message: `the server exited (${how})` }));
    }),
    Effect.forkScoped,
  );

  const send = (message: object) =>
    Effect.flatMap(encodeJson(message), (json) => Queue.offer(input, `${json}\n`));
  const answer = (id: number): Effect.Effect<Response, Unanswered> =>
    Effect.filterOrElse(
      Queue.take(answers),
      (message) => message.id === id,
      () => answer(id),
    );
  const request = (id: number, method: string, params: object) =>
    Effect.andThen(send({ id, jsonrpc: '2.0', method, params }), answer(id));

  const handshake = yield* Effect.gen(function* () {
    const initialized = yield* request(1, 'initialize', {
      capabilities: {},
      clientInfo: { name: 'tipee-tools smoke test', version: '0' },
      protocolVersion: '2025-06-18',
    });
    yield* send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = yield* request(2, 'tools/list', {});
    const prompts = yield* request(3, 'prompts/list', {});
    return { initialized, listed, prompts };
  }).pipe(
    Effect.timeoutOrElse({
      duration: TIMEOUT_MS,
      orElse: () =>
        Effect.fail(
          Unanswered.make({ message: `no answer within ${TIMEOUT_MS / 1000} s (SIGTERM)` }),
        ),
    }),
    Effect.result,
  );

  const failures: Array<string> = [];
  const check = (holds: boolean, failure: string): void => {
    if (!holds) {
      failures.push(failure);
    }
  };
  if (handshake._tag === 'Failure') {
    failures.push(handshake.failure.message);
  } else {
    const { initialized, listed, prompts } = handshake.success;
    const reported = initialized.result?.serverInfo?.version;
    check(reported === version, `serverInfo.version is ${reported}, plugin.json says ${version}`);
    const names = Arr.map(listed.result?.tools ?? [], ({ name }) => name);
    const missing = Arr.filter([...expected], (name) => !names.includes(name));
    check(missing.length === 0, `missing tools: ${Arr.join(missing, ', ')}`);
    // A batch tool is fine for any operation; which ones have one is the mcp
    // package's choice, tested there.
    const batches = Arr.filter(
      names,
      (name) => Str.endsWith('_many')(name) && expected.has(Str.slice(0, -5)(name)),
    );
    check(batches.length > 0, 'no batch tools listed');
    const unexpected = Arr.filter(names, (name) => !expected.has(name) && !batches.includes(name));
    check(unexpected.length === 0, `unexpected tools: ${Arr.join(unexpected, ', ')}`);
    const promptNames = Arr.map(prompts.result?.prompts ?? [], ({ name }) => name);
    check(promptNames.includes(SETUP_PROMPT), `no ${SETUP_PROMPT} prompt`);
  }
  yield* Effect.ignore(handle.kill());
  yield* Fiber.join(stdout);
  const output = yield* Fiber.join(stderr);

  const lines = yield* Ref.get(notJson);
  check(lines.length === 0, `stdout lines that are not JSON:\n${Arr.join(lines, '\n')}`);
  yield* Console.error(`Server stderr:\n${output === '' ? '(empty)' : Str.trimEnd(output)}`);
  if (failures.length > 0) {
    yield* Console.error(
      `Smoke test failed on Node ${process.version}:\n- ${Arr.join(failures, '\n- ')}`,
    );
    return false;
  }
  yield* Console.log(
    `Smoke test passed on Node ${process.version}: v${version}, ${expected.size} tools and batch tools.`,
  );
  return true;
});

// A failed check exits with 1 once its report is out, like any failure.
runMain(Effect.provide(Effect.scoped(smoke), nodeServices), {
  teardown: (exit, onExit) => {
    Runtime.defaultTeardown(exit, (code) => {
      onExit(Exit.isSuccess(exit) && exit.value === false ? 1 : code);
    });
  },
});
