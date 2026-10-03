// End to end over stdio: the server's entry point, which the plugin's bundle
// shares (both call `start`), must complete the MCP handshake, carry the
// instructions, and list its tools, and with a setting it cannot use still
// start and say what to fix through its tools.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const TIMEOUT_MS = 15_000;
// Some clients cut the server's instructions past this length.
const INSTRUCTIONS_LIMIT = 2048;
// Nowhere to send telemetry or ask for releases: the connection is refused and ignored.
const OFFLINE = {
  TIPEE_POSTHOG_HOST: 'http://127.0.0.1:1',
  TIPEE_RELEASES_URL: 'http://127.0.0.1:1/releases',
};

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

interface Server {
  readonly request: (method: string, params: object) => Promise<JsonRpcResponse>;
  readonly stderr: Array<string>;
  readonly stop: () => void;
}

// Starts the server with these settings and nothing else from Claude.
const serve = (settings: Record<string, string>): Server => {
  const { TIPEE_API_KEY: _key, TIPEE_INSTANCE: _instance, ...env } = process.env;
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...env, ...OFFLINE, ...settings },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stderr: Array<string> = [];
  child.stderr.on('data', (chunk: Buffer) => {
    stderr.push(chunk.toString());
  });
  const lines = createInterface({ input: child.stdout });
  const responses = new Map<
    number,
    { resolve: (response: JsonRpcResponse) => void; reject: (error: Error) => void }
  >();
  lines.on('line', (line) => {
    const message = JSON.parse(line) as JsonRpcResponse;
    if (message.id !== undefined) {
      responses.get(message.id)?.resolve(message);
      responses.delete(message.id);
    }
  });
  // A server that stops fails what it left unanswered at once, saying why.
  const state: { ended?: Error; next: number } = { next: 1 };
  const end = (cause: string): void => {
    state.ended ??= new Error(`${cause}; stderr:\n${stderr.join('')}`);
    for (const { reject } of responses.values()) {
      reject(state.ended);
    }
    responses.clear();
  };
  child.once('error', (error) => {
    end(`the server could not start: ${error.message}`);
  });
  // 'close' rather than 'exit': by then stderr has been read to the end.
  child.once('close', (code, signal) => {
    end(`the server exited (${signal ?? `code ${code}`})`);
  });
  const send = (message: object): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = async (method: string, params: object): Promise<JsonRpcResponse> =>
    new Promise((resolve, reject) => {
      if (state.ended !== undefined) {
        reject(state.ended);
        return;
      }
      const id = state.next;
      state.next += 1;
      responses.set(id, { reject, resolve });
      send({ id, jsonrpc: '2.0', method, params });
    });
  const stop = (): void => {
    child.kill();
  };
  return { request, stderr, stop };
};

const initialize = async ({ request }: Server): Promise<JsonRpcResponse> =>
  request('initialize', {
    capabilities: {},
    clientInfo: { name: 'tipee-tools tests', version: '0' },
    protocolVersion: '2025-06-18',
  });

describe('stdio transport', () => {
  it(
    'initializes with instructions and lists the tools, each with a title',
    async () => {
      const server = serve({ TIPEE_API_KEY: 'unused-in-this-test', TIPEE_INSTANCE: 'acme' });
      try {
        const initialized = await initialize(server);
        const listed = await server.request('tools/list', {});
        const prompts = await server.request('prompts/list', {});

        expect(initialized.error, server.stderr.join('')).toBeUndefined();
        const serverInfo = initialized.result?.serverInfo as { name: string } | undefined;
        expect(serverInfo?.name).toBe('tipee');
        const instructions = initialized.result?.instructions as string | undefined;
        expect(instructions).toMatch(/check_setup/u);
        expect(instructions?.length).toBeLessThan(INSTRUCTIONS_LIMIT);
        const tools = listed.result?.tools as Array<{
          name: string;
          annotations: { readOnlyHint: boolean; destructiveHint: boolean; title?: string };
        }>;
        expect(tools.map((tool) => tool.name)).toContain('check_setup');
        expect(tools.map((tool) => tool.name)).toContain('schedules_create');
        expect(tools.filter((tool) => tool.annotations.title === undefined)).toEqual([]);
        const titled = (name: string) => tools.find((tool) => tool.name === name)?.annotations;
        expect(titled('absences_list')?.title).toBe('Absences: list');
        expect(titled('day_tasks_submit_for_contributor')?.title).toBe(
          'Day tasks: submit for contributor',
        );
        expect(titled('check_setup')?.title).toBe('Check Tipee setup');
        expect(titled('check_setup')?.readOnlyHint).toBe(true);
        expect(
          tools.find((tool) => tool.name === 'schedules_delete')?.annotations.destructiveHint,
        ).toBe(true);
        const promptList = prompts.result?.prompts as Array<{ name: string }> | undefined;
        expect(promptList?.map((prompt) => prompt.name)).toContain('check-tipee-setup');
      } finally {
        server.stop();
      }
    },
    TIMEOUT_MS,
  );

  // Claude keeps stderr in a log nobody opens: the tools must say it.
  it(
    'starts with an instance it cannot use, and check_setup says what to fix',
    async () => {
      const server = serve({ TIPEE_API_KEY: 'unused-in-this-test', TIPEE_INSTANCE: 'acme corp' });
      try {
        await initialize(server);
        const checked = await server.request('tools/call', { arguments: {}, name: 'check_setup' });
        const result = checked.result as
          | { isError?: boolean; content: Array<{ text: string }> }
          | undefined;

        expect(result?.isError).toBe(true);
        expect(result?.content[0]?.text).toContain(
          '"acme corp" is not a Tipee instance: enter the part before .tipee.net',
        );
        expect(server.stderr.join('')).toMatch(/not set up/u);
      } finally {
        server.stop();
      }
    },
    TIMEOUT_MS,
  );
});
