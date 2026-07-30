import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { CDP_URL, VIEWPORT_DEFAULT_HEIGHT } from '../config.js';
import { log } from '../log.js';
import type { AuthMethod } from '../types.js';
import { detectLoginWall, installShadowPatch, preparePage, type SettleResult } from './prepare.js';
import { copyProfile, findProfileSource } from './profile.js';

export interface Connection {
  browser: Browser | null;
  context: BrowserContext;
  page: Page;
  method: AuthMethod;
  detail: string;
  /** False when we attached to the user's own Chrome — closing it would quit their browser. */
  ownsBrowser: boolean;
  loginWall: boolean;
  loginWallReason: string | null;
  settle: SettleResult;
  finalUrl: string;
}

export interface ConnectOptions {
  url: string;
  viewportWidth: number;
}

function ladderError(url: string, attempts: string[]): Error {
  let origin = url;
  try {
    origin = new URL(url).origin;
  } catch {
    /* use the raw string */
  }

  return new Error(
    `Could not reach a logged-in browser.\n\n` +
      `Start Chrome with remote debugging, then re-run capture_build:\n\n` +
      `  macOS    /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222\n` +
      `  Windows  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222\n` +
      `  Linux    google-chrome --remote-debugging-port=9222\n\n` +
      `Quit Chrome completely first (on macOS that is Cmd+Q, not just closing the windows),\n` +
      `run the command above, then sign in to ${origin} in that window.\n\n` +
      `Tried:\n${attempts.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n\n` +
      `Set DESIGN_QA_CDP_PORT or DESIGN_QA_CDP_URL to use a different port.\n` +
      `No password is ever requested or stored by this server.`,
  );
}

/** Tier 1: attach to the user's already-running Chrome. */
async function tryCdp(opts: ConnectOptions): Promise<Connection | { failure: string }> {
  try {
    // Probe first so an absent Chrome fails in 1.5s rather than after Playwright's timeout.
    const res = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { failure: `CDP at ${CDP_URL} -> HTTP ${res.status}` };
  } catch (err) {
    return { failure: `CDP at ${CDP_URL} -> ${(err as Error).message}` };
  }

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(CDP_URL, { timeout: 5000 });
  } catch (err) {
    return { failure: `CDP at ${CDP_URL} -> ${(err as Error).message}` };
  }

  // The user's real persistent context, the one holding their cookies. `browser.newContext()`
  // over CDP would create a fresh, logged-OUT context and we would silently measure the
  // login page instead of the target.
  const context = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    return { failure: `CDP at ${CDP_URL} -> connected but Chrome exposed no browser context` };
  }

  await installShadowPatch(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: opts.viewportWidth, height: VIEWPORT_DEFAULT_HEIGHT });

  const settle = await preparePage(page, opts.url);
  const wall = await detectLoginWall(page, opts.url);

  return {
    browser,
    context,
    page,
    method: 'cdp',
    detail: CDP_URL,
    ownsBrowser: false,
    loginWall: wall.loginWall,
    loginWallReason: wall.reason,
    settle,
    finalUrl: page.url(),
  };
}

/** Tier 2: launch Chrome against a copy of the user's profile. */
async function tryProfileCopy(opts: ConnectOptions): Promise<Connection | { failure: string }> {
  const source = await findProfileSource();
  if (!source) {
    return { failure: `Chrome profile copy -> no Chrome user-data directory found` };
  }

  let context: BrowserContext;
  try {
    const dir = await copyProfile(source.userDataDir);
    context = await chromium.launchPersistentContext(dir, {
      // The real signed Chrome binary. On macOS the cookie encryption key in the login
      // Keychain is ACL'd to Chrome's code signature, so bundled Chromium decrypts cookies
      // to garbage and the session silently appears logged out.
      ...(source.channel ? { channel: source.channel } : { executablePath: source.executablePath }),
      headless: false,
      viewport: null,
      args: ['--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble'],
    });
  } catch (err) {
    return { failure: `Chrome profile copy -> ${(err as Error).message}` };
  }

  await installShadowPatch(context);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize({ width: opts.viewportWidth, height: VIEWPORT_DEFAULT_HEIGHT });

  const settle = await preparePage(page, opts.url);
  const wall = await detectLoginWall(page, opts.url);

  if (wall.loginWall) {
    // A copied profile that lands on a sign-in page cannot be fixed by the user in place,
    // so this is a failure of the tier, not a warning. Fall through to the CDP instructions.
    await context.close().catch(() => {});
    return { failure: `Chrome profile copy -> launched, but ${wall.reason}` };
  }

  return {
    browser: context.browser(),
    context,
    page,
    method: 'profile-copy',
    detail: source.userDataDir,
    ownsBrowser: true,
    loginWall: false,
    loginWallReason: null,
    settle,
    finalUrl: page.url(),
  };
}

export type Ladder = (opts: ConnectOptions) => Promise<Connection>;

export const defaultLadder: Ladder = async (opts) => {
  const attempts: string[] = [];

  const cdp = await tryCdp(opts);
  if (!('failure' in cdp)) return cdp;
  attempts.push(cdp.failure);
  log.info('CDP attach failed', cdp.failure);

  const profile = await tryProfileCopy(opts);
  if (!('failure' in profile)) return profile;
  attempts.push(profile.failure);
  log.info('profile copy failed', profile.failure);

  throw ladderError(opts.url, attempts);
};

/**
 * The ladder is injected rather than switched on an env var, so tests can substitute a
 * plain `chromium.launch()` without shipping a bypass in the production path.
 */
export function connectBrowser(opts: ConnectOptions, ladder: Ladder = defaultLadder): Promise<Connection> {
  return ladder(opts);
}
