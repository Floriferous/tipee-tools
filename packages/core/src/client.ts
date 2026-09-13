// Minimal read-only client for the Tipee HR API (https://api.tipee.ch/).
// Every Tipee endpoint is a POST with a JSON body, authenticated by a bearer
// API key created in the Tipee admin panel, pinned to a dated API version.

export const TIPEE_API_VERSION = '26.06.25';

const MAX_ATTEMPTS = 3;
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR = 500;

export interface TipeeConfig {
  /** The Tipee subdomain, e.g. "acme" for acme.tipee.net. */
  instance: string;
  /** The API key generated in the Tipee admin panel. */
  apiKey: string;
}

const STATUS_HINTS: Record<number, string> = {
  401: 'Tipee rejected the API key. Check that TIPEE_API_KEY is the key of an integration on this instance.',
  403: 'The API key is valid but its Tipee integration lacks the permission for this data.',
  404: 'Tipee could not find this resource.',
  429: 'Tipee rate limit reached even after retrying. Wait a moment and try again.',
};

// Tipee answers 401 (not 403) for a valid key whose integration was never
// Granted any rights, so the body is the only way to tell the cases apart.
const RIGHTS_MISSING_MARKER = 'token_rights_missing';
const RIGHTS_MISSING_HINT =
  'The API key works, but its Tipee integration has no permissions yet. ' +
  'In the Tipee admin panel, grant it "Configurations générales → Se connecter avec des applications externes", ' +
  'then read access to the Planning and Cœur RH modules.';

const describeStatus = (status: number, body: string): string => {
  const hint = body.includes(RIGHTS_MISSING_MARKER)
    ? RIGHTS_MISSING_HINT
    : (STATUS_HINTS[status] ?? 'Tipee returned an unexpected error.');
  return `${hint} (HTTP ${status}) ${body}`.trim();
};

export class TipeeError extends Error {
  public readonly status: number;
  public readonly body: string;

  public constructor(status: number, body: string) {
    super(describeStatus(status, body));
    this.name = 'TipeeError';
    this.status = status;
    this.body = body;
  }
}

const wait = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const retryDelaySeconds = (response: Response, attempt: number): number => {
  const retryAfter = Number(response.headers.get('retry-after'));
  return Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : attempt;
};

const requestOnce = async (config: TipeeConfig, path: string, body: unknown): Promise<Response> =>
  fetch(`https://${config.instance}.tipee.net${path}`, {
    body: JSON.stringify(body),
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
      'tipee-version': TIPEE_API_VERSION,
    },
    method: 'POST',
  });

export const tipeePost = async (
  config: TipeeConfig,
  path: string,
  body: unknown,
): Promise<unknown> => {
  for (let attempt = 1; ; attempt += 1) {
    const response = await requestOnce(config, path, body);
    const text = await response.text();
    if (response.ok) {
      return text.length > 0 ? JSON.parse(text) : undefined;
    }
    const retryable =
      response.status === HTTP_TOO_MANY_REQUESTS || response.status >= HTTP_SERVER_ERROR;
    if (!retryable || attempt >= MAX_ATTEMPTS) {
      throw new TipeeError(response.status, text);
    }
    await wait(retryDelaySeconds(response, attempt) * MILLISECONDS_PER_SECOND);
  }
};
