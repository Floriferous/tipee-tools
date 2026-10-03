// Runs the committed bundle the way Claude runs it, on whichever Node runs
// this script (in CI the oldest one the extension declares), so it uses
// node: builtins only. The MCP handshake must report plugin.json's version,
// list one tool per operation plus check_setup and update_plugin, and offer
// the setup prompt, with nothing but JSON on stdout. Usage: node scripts/smoke.ts

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { toolName, toolRoutes, vendored } from '../../../packages/core/scripts/spec.ts';

const root = path.join(import.meta.dirname, '..');
const TIMEOUT_MS = 10_000;
const SETUP_PROMPT = 'check-tipee-setup';
// Never tools: granting or revoking roles is left to an admin in Tipee.
const ROLE_TOOLS = new Set(['resources_grant_roles', 'resources_revoke_roles']);

interface Response {
  readonly id?: number;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly message: string };
}

const manifest = path.join(root, '.claude-plugin', 'plugin.json');
const { version } = JSON.parse(readFileSync(manifest, 'utf8')) as { version: string };
const expected = new Set([
  ...toolRoutes(vendored().document).map((route) => toolName(route)),
  'check_setup',
  'update_plugin',
]);

// Dummy settings and nothing else from this environment; telemetry and the
// release lookup are refused at once.
const child = spawn(process.execPath, [path.join(root, 'server', 'tipee-mcp.mjs')], {
  env: {
    TIPEE_API_KEY: 'smoke-test',
    TIPEE_INSTANCE: 'acme',
    TIPEE_POSTHOG_HOST: 'http://127.0.0.1:1',
    TIPEE_RELEASES_URL: 'http://127.0.0.1:1/releases',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

const stderr: Array<string> = [];
child.stderr.on('data', (chunk: Buffer) => {
  stderr.push(chunk.toString());
});
const closed = new Promise<void>((resolve) => {
  child.once('close', () => {
    resolve();
  });
});

// Requests fail as soon as the server stops, or is stopped at the timeout,
// rather than waiting for an answer that cannot come.
const waiting = new Map<
  number,
  { resolve: (response: Response) => void; reject: (error: Error) => void }
>();
const state: { ended?: Error; stopped: string } = { stopped: 'the server exited' };
const end = (error: Error): void => {
  state.ended ??= error;
  for (const { reject } of waiting.values()) {
    reject(state.ended);
  }
  waiting.clear();
};
child.once('error', end);
child.stdin.on('error', end);
child.once('exit', (code, signal) => {
  end(new Error(`${state.stopped} (${signal ?? `code ${code}`})`));
});
const timer = setTimeout(() => {
  state.stopped = `no answer within ${TIMEOUT_MS / 1000} s`;
  child.kill();
}, TIMEOUT_MS);

const notJson: Array<string> = [];
const parse = (line: string): Response | undefined => {
  try {
    return JSON.parse(line) as Response;
  } catch {
    notJson.push(line);
    return undefined;
  }
};
createInterface({ input: child.stdout }).on('line', (line) => {
  const message = parse(line);
  if (message?.id !== undefined) {
    waiting.get(message.id)?.resolve(message);
    waiting.delete(message.id);
  }
});

const send = (message: object): void => {
  child.stdin.write(`${JSON.stringify(message)}\n`);
};
const request = async (id: number, method: string, params: object): Promise<Response> =>
  new Promise((resolve, reject) => {
    if (state.ended !== undefined) {
      reject(state.ended);
      return;
    }
    waiting.set(id, { reject, resolve });
    send({ id, jsonrpc: '2.0', method, params });
  });

const failures: Array<string> = [];
const check = (holds: boolean, failure: string): void => {
  if (!holds) {
    failures.push(failure);
  }
};

try {
  const initialized = await request(1, 'initialize', {
    capabilities: {},
    clientInfo: { name: 'tipee-tools smoke test', version: '0' },
    protocolVersion: '2025-06-18',
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const listed = await request(2, 'tools/list', {});
  const prompts = await request(3, 'prompts/list', {});

  const serverInfo = initialized.result?.serverInfo as { version?: string } | undefined;
  check(
    serverInfo?.version === version,
    `serverInfo.version is ${serverInfo?.version}, plugin.json says ${version}`,
  );
  const names = ((listed.result?.tools ?? []) as Array<{ name: string }>).map(({ name }) => name);
  check(names.length === expected.size, `${names.length} tools listed, ${expected.size} expected`);
  const missing = [...expected].filter((name) => !names.includes(name));
  check(missing.length === 0, `missing tools: ${missing.join(', ')}`);
  const unexpected = names.filter((name) => !expected.has(name));
  check(unexpected.length === 0, `unexpected tools: ${unexpected.join(', ')}`);
  const roles = names.filter((name) => ROLE_TOOLS.has(name));
  check(roles.length === 0, `role tools listed: ${roles.join(', ')}`);
  const promptNames = ((prompts.result?.prompts ?? []) as Array<{ name: string }>).map(
    ({ name }) => name,
  );
  check(promptNames.includes(SETUP_PROMPT), `no ${SETUP_PROMPT} prompt`);
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(timer);
  child.kill();
}
await closed;

check(notJson.length === 0, `stdout lines that are not JSON:\n${notJson.join('\n')}`);
process.stderr.write(`Server stderr:\n${stderr.join('') || '(empty)\n'}`);
if (failures.length > 0) {
  process.stderr.write(
    `Smoke test failed on Node ${process.version}:\n- ${failures.join('\n- ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Smoke test passed on Node ${process.version}: v${version}, ${expected.size} tools.\n`,
  );
}
