// End to end over stdio: the server's entry point, which the plugin's bundle
// shares (both call `start`), must complete the MCP handshake, carry the
// instructions, and list its tools, and with a setting it cannot use still
// start and say what to fix through its tools.

import { layer as nodeServices } from '@effect/platform-node/NodeServices';
import { expect, layer } from '@effect/vitest';
import { Array as Arr, Effect, Fiber, Option, Path, Queue, Ref, Schema, Stream } from 'effect';
import { ChildProcess } from 'effect/process';

import { fromJson, toJson } from './wire.ts';

const TIMEOUT_MS = 15_000;
// Some clients cut the server's instructions past this length.
const INSTRUCTIONS_LIMIT = 2048;
// Nowhere to send telemetry or ask for releases: the connection is refused and ignored.
const OFFLINE = {
  TIPEE_POSTHOG_HOST: 'http://127.0.0.1:1',
  TIPEE_RELEASES_URL: 'http://127.0.0.1:1/releases',
};

const JsonRpcResponse = Schema.Struct({
  error: Schema.optionalKey(Schema.Struct({ message: Schema.String })),
  id: Schema.optionalKey(Schema.Int),
  result: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
type JsonRpcResponse = typeof JsonRpcResponse.Type;

// The server stopped before it answered, with what it wrote on stderr.
class ServerStopped extends Schema.TaggedError<ServerStopped, { readonly brand: unique symbol }>()(
  'ServerStopped',
  {
    message: Schema.String,
  },
) {}

// Starts the server with these settings and nothing else from Claude; it is
// killed when the test's scope closes.
const serve = Effect.fn('serve')(function* (settings: Record<string, string>) {
  const path = yield* Path.Path;
  const entry = yield* path.fromFileUrl(new URL('../src/main.ts', import.meta.url));
  const { TIPEE_API_KEY: _key, TIPEE_INSTANCE: _instance, ...env } = process.env;
  const input = yield* Queue.unbounded<string>();
  const handle = yield* ChildProcess.make(process.execPath, [entry], {
    env: { ...env, ...OFFLINE, ...settings },
    stdin: Stream.fromQueue(input).pipe(Stream.encodeText),
  });

  const stderr = yield* Ref.make('');
  const stderrRead = yield* handle.stderr.pipe(
    Stream.decodeText,
    Stream.runForEach((chunk) => Ref.update(stderr, (text) => text + chunk)),
    Effect.forkScoped,
  );

  // Every message the server writes, one per line; a server that stops fails
  // what it left unanswered at once, saying why.
  const messages = yield* Queue.unbounded<JsonRpcResponse, ServerStopped>();
  yield* handle.stdout.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.mapEffect(fromJson(JsonRpcResponse)),
    Stream.runForEach((message) => Queue.offer(messages, message)),
    Effect.andThen(
      Effect.gen(function* () {
        // By the end of stderr, the server has said all it will.
        yield* Fiber.join(stderrRead);
        const code = yield* handle.exitCode;
        const said = yield* Ref.get(stderr);
        return yield* Queue.fail(
          messages,
          ServerStopped.make({ message: `the server exited (code ${code}); stderr:\n${said}` }),
        );
      }),
    ),
    // Output that cannot be read stops the test as surely as an exit.
    Effect.catch((error) =>
      Queue.fail(
        messages,
        ServerStopped.make({ message: `the server's output could not be read: ${error.message}` }),
      ),
    ),
    Effect.forkScoped,
  );

  const next = yield* Ref.make(1);
  const request = Effect.fn('request')(function* (method: string, params: object) {
    const id = yield* Ref.getAndUpdate(next, (current) => current + 1);
    const line = yield* toJson({ id, jsonrpc: '2.0', method, params });
    yield* Queue.offer(input, `${line}\n`);
    // Notifications and other answers are skipped.
    let message = yield* Queue.take(messages);
    while (message.id !== id) {
      message = yield* Queue.take(messages);
    }
    return message;
  });
  return { request, stderr: Ref.get(stderr) };
});

type Server = Effect.Success<ReturnType<typeof serve>>;

const initialize = ({ request }: Server) =>
  request('initialize', {
    capabilities: {},
    clientInfo: { name: 'tipee-tools tests', version: '0' },
    // The newest version the server speaks, the first to carry its icon.
    protocolVersion: '2025-11-25',
  });

interface ServerInfo {
  readonly name: string;
  readonly websiteUrl?: string;
  readonly icons?: ReadonlyArray<{ readonly src: string; readonly mimeType?: string }>;
}

// Who the server says it is, with tipee's mark inline and a link to its docs.
const expectServerInfo = (serverInfo: unknown): void => {
  const { icons = [], name, websiteUrl } = serverInfo as ServerInfo;
  expect(name).toBe('tipee');
  expect(websiteUrl).toBe('https://github.com/Floriferous/tipee-tools#readme');
  expect(icons).toHaveLength(1);
  const [icon] = icons;
  expect(icon?.mimeType).toBe('image/png');
  expect(icon?.src).toMatch(/^data:image\/png;base64,iVBORw0KGgo/u);
};

interface Listed {
  readonly name: string;
  readonly annotations: { readOnlyHint: boolean; destructiveHint: boolean; title?: string };
}

// A real process, on the real clock.
layer(nodeServices, { excludeTestServices: true })('stdio transport', (it) => {
  it.effect(
    'initializes with instructions and lists the tools, each with a title',
    () =>
      Effect.gen(function* () {
        const server = yield* serve({
          TIPEE_API_KEY: 'unused-in-this-test',
          TIPEE_INSTANCE: 'acme',
        });
        const initialized = yield* initialize(server);
        const listed = yield* server.request('tools/list', {});
        const prompts = yield* server.request('prompts/list', {});

        const stderr = yield* server.stderr;
        expect(initialized.error, stderr).toBeUndefined();
        expectServerInfo(initialized.result?.serverInfo);
        const instructions = initialized.result?.instructions as string | undefined;
        expect(instructions).toMatch(/check_setup/u);
        expect(instructions?.length).toBeLessThan(INSTRUCTIONS_LIMIT);
        const tools = listed.result?.tools as ReadonlyArray<Listed>;
        const names = Arr.map(tools, (tool) => tool.name);
        expect(names).toContain('check_setup');
        expect(names).toContain('schedules_create');
        expect(names).toContain('schedules_update_many');
        expect(Arr.filter(tools, (tool) => tool.annotations.title === undefined)).toEqual([]);
        const titled = (name: string) =>
          Arr.findFirst(tools, (tool) => tool.name === name).pipe(
            Option.map((tool) => tool.annotations),
            Option.getOrUndefined,
          );
        expect(titled('absences_list')?.title).toBe('Absences: list');
        expect(titled('day_tasks_submit_for_contributor')?.title).toBe(
          'Day tasks: submit for contributor',
        );
        expect(titled('check_setup')?.title).toBe('Check tipee setup');
        expect(titled('check_setup')?.readOnlyHint).toBe(true);
        expect(titled('schedules_delete')?.destructiveHint).toBe(true);
        const promptList = prompts.result?.prompts as ReadonlyArray<{ name: string }> | undefined;
        expect(Arr.map(promptList ?? [], (prompt) => prompt.name)).toContain('check-tipee-setup');
      }),
    TIMEOUT_MS,
  );

  // Claude keeps stderr in a log nobody opens: the tools must say it.
  it.effect(
    'starts with an instance it cannot use, and check_setup says what to fix',
    () =>
      Effect.gen(function* () {
        const server = yield* serve({
          TIPEE_API_KEY: 'unused-in-this-test',
          TIPEE_INSTANCE: 'acme corp',
        });
        yield* initialize(server);
        const checked = yield* server.request('tools/call', { arguments: {}, name: 'check_setup' });
        const result = checked.result as
          | { isError?: boolean; content: ReadonlyArray<{ text: string }> }
          | undefined;

        expect(result?.isError).toBe(true);
        expect(result?.content[0]?.text).toContain(
          '"acme corp" is not a tipee instance: enter the part before .tipee.net',
        );
        const stderr = yield* server.stderr;
        expect(stderr).toMatch(/not set up/u);
      }),
    TIMEOUT_MS,
  );
});
