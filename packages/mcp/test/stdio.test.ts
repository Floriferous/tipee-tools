// End to end over stdio: the bundled entry point (or the source when the
// Bundle is absent) must complete the MCP handshake and list its tools.

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const TIMEOUT_MS = 15_000;

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

describe('stdio transport', () => {
  it(
    'initializes and lists the tools',
    async () => {
      const child = spawn(process.execPath, [ENTRY], {
        env: {
          ...process.env,
          TIPEE_API_KEY: 'unused-in-this-test',
          TIPEE_INSTANCE: 'acme',
          // Nowhere to send telemetry: the connection is refused and ignored.
          TIPEE_POSTHOG_HOST: 'http://127.0.0.1:1',
          TIPEE_RELEASES_URL: 'http://127.0.0.1:1/releases',
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
        const tools = listed.result?.tools as Array<{
          name: string;
          annotations: { readOnlyHint: boolean; destructiveHint: boolean };
        }>;
        expect(tools.map((tool) => tool.name)).toContain('check');
        expect(tools.map((tool) => tool.name)).toContain('schedules_create');
        expect(tools.find((tool) => tool.name === 'check')?.annotations.readOnlyHint).toBe(true);
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
});
