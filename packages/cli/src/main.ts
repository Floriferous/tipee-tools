// Entry point: `pnpm tipee <command>`. Kept separate from cli.ts so tests
// Can import `run` without triggering process side effects.

import { run } from './cli.ts';

try {
  const output = await run(process.argv.slice(2), process.env);
  process.stdout.write(`${output}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
