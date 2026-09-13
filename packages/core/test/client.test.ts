// The HTTP client: headers Tipee insists on, retries, and error explanations.

import { API_KEY, BASE } from './handlers.ts';
import { HttpResponse, http } from 'msw';
import { TipeeError, tipeePost } from '../src/client.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from './server.ts';

const CONFIG = { apiKey: API_KEY, instance: 'acme' };
const KINDS = '/api/directory/kinds.list';
const KINDS_URL = `${BASE}${KINDS}`;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;
const RETRY_AFTER_SECONDS = 2;
const MILLISECONDS_PER_SECOND = 1000;

const status = (code: number, headers?: Record<string, string>) =>
  http.post(KINDS_URL, () => new HttpResponse(undefined, { headers, status: code }), {
    once: true,
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('authentication', () => {
  it('is accepted by a Tipee that checks the bearer key and headers', async () => {
    await expect(tipeePost(CONFIG, KINDS, {})).resolves.toBeInstanceOf(Array);
  });

  it('rejects a wrong key with an explanation', async () => {
    const wrongKey = { apiKey: 'wrong', instance: CONFIG.instance };

    await expect(tipeePost(wrongKey, KINDS, {})).rejects.toThrow(/rejected the API key/u);
  });

  it('explains a valid key whose integration has no permissions yet', async () => {
    server.use(
      http.post(
        KINDS_URL,
        () =>
          HttpResponse.json(
            { message: 'Tipee.api.token_rights_missing' },
            { status: HTTP_UNAUTHORIZED },
          ),
        { once: true },
      ),
    );

    await expect(tipeePost(CONFIG, KINDS, {})).rejects.toThrow(/no permissions yet/u);
  });
});

describe('retries', () => {
  it('waits for Retry-After and retries after a 429', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(status(HTTP_TOO_MANY_REQUESTS, { 'Retry-After': String(RETRY_AFTER_SECONDS) }));

    const pending = tipeePost(CONFIG, KINDS, {});
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_SECONDS * MILLISECONDS_PER_SECOND);

    await expect(pending).resolves.toBeInstanceOf(Array);
  });

  it('gives up after three server errors', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    server.use(status(HTTP_SERVER_ERROR), status(HTTP_SERVER_ERROR), status(HTTP_SERVER_ERROR));

    const failure = expect(tipeePost(CONFIG, KINDS, {})).rejects.toThrow(TipeeError);
    await vi.runAllTimersAsync();

    await failure;
  });

  it('does not retry client errors', async () => {
    server.use(status(HTTP_NOT_FOUND));

    await expect(tipeePost(CONFIG, KINDS, {})).rejects.toThrow(/could not find/u);
  });
});
