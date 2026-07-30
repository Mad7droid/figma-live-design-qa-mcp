import { figmaToken } from '../config.js';
import { log } from '../log.js';

export class FigmaAuthError extends Error {}
export class FigmaForbiddenError extends Error {}
export class FigmaNotFoundError extends Error {}

const SETUP_MESSAGE = `No Figma access token found.

Add one to your Claude Desktop config (Settings → Developer → Edit Config), under this
server's "env" block:

  "env": { "FIGMA_TOKEN": "figd_..." }

Create the token at figma.com → Settings → Security → Personal access tokens, with at
least "File content: read" scope. Restart Claude Desktop afterwards.

The token is read from the environment only — this server never writes it to disk.`;

/** Figma returns 429 under load; one request per second with backoff keeps us clear of it. */
let chain: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
const MIN_INTERVAL_MS = 1000;

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  chain = run.catch(() => {});
  return run as Promise<T>;
}

function authHeaders(): Record<string, string> {
  const token = figmaToken();
  if (!token) throw new FigmaAuthError(SETUP_MESSAGE);
  // OAuth access tokens are bearer credentials; personal access tokens use the custom header.
  return token.startsWith('figd_') || token.startsWith('figu_')
    ? { 'X-Figma-Token': token }
    : { Authorization: `Bearer ${token}` };
}

async function request(path: string, attempt = 0): Promise<unknown> {
  const url = `https://api.figma.com${path}`;
  const res = await fetch(url, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 3) throw new Error(`Figma API ${res.status} after ${attempt + 1} attempts: ${path}`);
    const retryAfter = Number(res.headers.get('Retry-After'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * 2 ** attempt + Math.random() * 400;
    log.warn(`Figma ${res.status}, retrying in ${Math.round(backoff)}ms`, path);
    await new Promise((r) => setTimeout(r, backoff));
    return request(path, attempt + 1);
  }

  if (res.status === 401) throw new FigmaAuthError(`Figma rejected the token (401). ${SETUP_MESSAGE}`);
  if (res.status === 403) throw new FigmaForbiddenError(`Figma denied access (403) to ${path}`);
  if (res.status === 404) throw new FigmaNotFoundError(`Figma returned 404 for ${path}`);
  if (!res.ok) throw new Error(`Figma API ${res.status} for ${path}: ${(await res.text()).slice(0, 300)}`);

  return res.json();
}

export function figmaGet<T>(path: string): Promise<T> {
  return serialize(() => request(path)) as Promise<T>;
}

/** Figma image URLs are short-lived S3 links and must be fetched separately. */
export function fetchBinary(url: string): Promise<Buffer> {
  return serialize(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Image fetch failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  });
}

export { SETUP_MESSAGE };
