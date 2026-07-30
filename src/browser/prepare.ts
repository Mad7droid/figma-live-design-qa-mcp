import type { BrowserContext, Page } from 'playwright';

import { log } from '../log.js';

/**
 * Patch `attachShadow` before any page script runs so closed shadow roots stay reachable.
 *
 * The requested mode is preserved deliberately — forcing `'open'` would make
 * `element.shadowRoot` non-null for components that assert it is null, changing the
 * behaviour of the page we are supposed to be measuring.
 */
export async function installShadowPatch(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const roots = new WeakMap<Element, ShadowRoot>();
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
      const root = original.call(this, init);
      roots.set(this, root);
      return root;
    };
    (window as any).__dq_shadowRoots = roots;
  });
}

export interface SettleResult {
  networkIdle: boolean;
  fontsReady: boolean;
  settleMs: number;
}

/**
 * Wait until the DOM stops changing.
 *
 * `networkidle` never fires on pages with polling, analytics beacons, or open websockets,
 * so it is best-effort and backed up by a mutation counter.
 */
async function settleDom(page: Page, quietMs: number, windows: number, maxMs: number): Promise<number> {
  const started = Date.now();
  await page.evaluate(() => {
    (window as any).__dq_mutations = 0;
    const observer = new MutationObserver((records) => {
      (window as any).__dq_mutations += records.length;
    });
    observer.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true, characterData: true,
    });
    (window as any).__dq_observer = observer;
  });

  let quietWindows = 0;
  while (Date.now() - started < maxMs && quietWindows < windows) {
    const before = await page.evaluate(() => (window as any).__dq_mutations as number);
    await page.waitForTimeout(quietMs);
    const after = await page.evaluate(() => (window as any).__dq_mutations as number);
    quietWindows = after === before ? quietWindows + 1 : 0;
  }

  await page.evaluate(() => {
    (window as any).__dq_observer?.disconnect();
  }).catch(() => {});

  return Date.now() - started;
}

export async function preparePage(page: Page, url: string): Promise<SettleResult> {
  // The Figma frame was captured in one mode; forcing light keeps the comparison honest.
  // check_tokens still guards against a build that renders dark regardless.
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });

  let networkIdle = true;
  try {
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  } catch {
    networkIdle = false;
    log.debug('networkidle did not settle; relying on the mutation counter');
  }

  // Measuring before webfonts load yields fallback metrics, which turns every text element
  // into a bogus font-family and font-size finding.
  let fontsReady = true;
  try {
    await page.evaluate(() => document.fonts.ready);
  } catch {
    fontsReady = false;
  }

  const settleMs = await settleDom(page, 500, 2, 8000);

  // Freeze anything still moving so screenshots match the measurements.
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-play-state:paused!important;transition:none!important}
              html{scroll-behavior:auto!important}*{caret-color:transparent!important}`,
  }).catch(() => {});

  return { networkIdle, fontsReady, settleMs };
}

export interface LoginWallResult {
  loginWall: boolean;
  reason: string | null;
}

/**
 * Detect that we landed on a sign-in page instead of the target.
 *
 * Without this the tool cheerfully measures a login form and reports 200 confident findings
 * about the wrong page. Patterns are generic by necessity — naming any product or identity
 * provider would break the zero-config rule.
 */
export async function detectLoginWall(page: Page, requestedUrl: string): Promise<LoginWallResult> {
  const probe = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type=password]'));
    const visiblePassword = inputs.some((i) => {
      const el = i as HTMLElement;
      return typeof (el as any).checkVisibility === 'function' ? (el as any).checkVisibility() : true;
    });
    return { visiblePassword, href: location.href };
  });

  if (probe.visiblePassword) {
    return { loginWall: true, reason: 'the page shows a password field' };
  }

  let current: URL;
  let requested: URL;
  try {
    current = new URL(probe.href);
    requested = new URL(requestedUrl);
  } catch {
    return { loginWall: false, reason: null };
  }

  const path = current.pathname.toLowerCase();
  const looksAuth =
    /(^|\/)(login|log-in|signin|sign-in|auth|sso|oauth|authorize|session)(\/|$)/.test(path) ||
    /\b(accounts|login|auth|sso|id)\./.test(current.hostname);

  if (looksAuth && current.origin !== requested.origin) {
    return { loginWall: true, reason: `redirected to ${current.origin}${current.pathname}` };
  }

  return { loginWall: false, reason: null };
}
