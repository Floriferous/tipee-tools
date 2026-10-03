// End to end over stdio: the server's entry point, which the plugin's bundle
// shares (both call `start`), must complete the MCP handshake, carry the
// instructions, and list its tools, and a start that cannot succeed must say
// why on stderr.

import { spawn, spawnSync } from 'node:child_process';
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

describe('stdio transport', () => {
  it(
    'initializes with instructions and lists the tools, each with a title',
    async () => {
      const child = spawn(process.execPath, [ENTRY], {
        env: {
          ...process.env,
          ...OFFLINE,
          TIPEE_API_KEY: 'unused-in-this-test',
          TIPEE_INSTANCE: 'acme',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stderr: Array<string> = [];
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk.toString());
      });
      const lines = createInterface({ input: child.stdout });
      const responses = new Map<number, (response: JsonRpcResponse) => void>();
      lines.on('line', (line) => {
        const message = JSON.parse(line) as JsonRpcResponse;
        if (message.id !== undefined) {
          responses.get(message.id)?.(message);
        }
      });
      const send = (message: object): void => {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      };
      const request = async (
        id: number,
        method: string,
        params: object,
      ): Promise<JsonRpcResponse> =>
        new Promise((resolve) => {
          responses.set(id, resolve);
          send({ id, jsonrpc: '2.0', method, params });
        });

      try {
        const initialized = await request(1, 'initialize', {
          capabilities: {},
          clientInfo: { name: 'tipee-tools tests', version: '0' },
          protocolVersion: '2025-06-18',
        });
        send({ jsonrpc: '2.0', method: 'notifications/initialized' });
        const listed = await request(2, 'tools/list', {});
        const prompts = await request(3, 'prompts/list', {});

        expect(initialized.error, stderr.join('')).toBeUndefined();
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
        child.kill();
      }
    },
    TIMEOUT_MS,
  );

  it(
    'explains on stderr, not on the MCP channel, that Tipee is not set up',
    () => {
      const { TIPEE_API_KEY: _key, TIPEE_INSTANCE: _instance, ...env } = process.env;
      const run = spawnSync(process.execPath, [ENTRY], {
        encoding: 'utf8',
        env: { ...env, ...OFFLINE },
        input: '',
        timeout: TIMEOUT_MS,
      });

      expect(run.status).toBe(1);
      expect(run.signal).toBeNull();
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/not set up/u);
    },
    TIMEOUT_MS,
  );
});
