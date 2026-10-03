// The installation id in a container run under a uid with no passwd entry,
// where `os.userInfo` throws: the server must still start.

import { afterEach, expect, it } from '@effect/vitest';
// Vitest hoists `vi.mock` only when `vi` comes from vitest itself.
import { vi } from 'vitest';

import { installationId } from '../src/Install.ts';

vi.mock(import('node:os'), async (importOriginal) => ({
  ...(await importOriginal()),
  userInfo: () => {
    throw new Error('ENOENT: no such file or directory, uv_os_get_passwd');
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it('falls back on the account name in the environment', () => {
  vi.stubEnv('USER', 'someone');
  const id = installationId();
  vi.stubEnv('USER', 'someone-else');

  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
  expect(installationId()).not.toBe(id);
});
