import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { domExtract, type ExtractResult } from '../../src/browser/extract.js';
import { installShadowPatch } from '../../src/browser/prepare.js';
import { startServer, type StaticServer } from '../server.js';

let browser: Browser;
let context: BrowserContext;
let mainServer: StaticServer;
let crossServer: StaticServer;

beforeAll(async () => {
  crossServer = await startServer();
  mainServer = await startServer({ CROSS_ORIGIN_SRC: `${crossServer.origin}/inner.html` });
  browser = await chromium.launch();
  context = await browser.newContext();
  await installShadowPatch(context);
}, 120_000);

afterAll(async () => {
  await context?.close();
  await browser?.close();
  await mainServer?.close();
  await crossServer?.close();
});

async function extract(path: string): Promise<{ result: ExtractResult; page: Page }> {
  const page = await context.newPage();
  await page.goto(`${mainServer.origin}/${path}`, { waitUntil: 'networkidle' });
  const result = await page.evaluate(domExtract, { maxElements: 15000, maxDepth: 60 });
  return { result, page };
}

const find = (r: ExtractResult, predicate: (path: string) => boolean) =>
  r.elements.filter((e) => predicate(e.path));

describe('shadow DOM', () => {
  it('descends open shadow roots', async () => {
    const { result, page } = await extract('shadow.html');
    const inner = result.elements.find((e) => e.text === 'Open shadow text');
    expect(inner).toBeDefined();
    expect(inner!.path).toContain('::shadow>');
    expect(result.stats.shadowRoots).toBeGreaterThanOrEqual(4);
    await page.close();
  });

  it('recovers closed shadow roots through the attachShadow patch', async () => {
    const { result, page } = await extract('shadow.html');
    const closed = result.elements.find((e) => e.text === 'Closed shadow text');
    // Without the patch element.shadowRoot is null and this subtree is invisible to us.
    expect(closed).toBeDefined();
    expect(result.stats.closedShadowRoots).toBe(1);
    await page.close();
  });

  it('descends nested shadow roots', async () => {
    const { result, page } = await extract('shadow.html');
    const deep = result.elements.find((e) => e.text === 'Nested twice');
    expect(deep).toBeDefined();
    expect(deep!.path.match(/::shadow>/g)?.length).toBe(2);
    await page.close();
  });

  it('counts a slotted node exactly once', async () => {
    const { result, page } = await extract('shadow.html');
    // Assigned nodes live in the light tree, so descending both trees must not double up.
    const slotted = result.elements.filter((e) => e.text === 'Slotted light child');
    expect(slotted).toHaveLength(1);
    expect(slotted[0]!.path).not.toContain('::shadow>');
    await page.close();
  });
});

describe('iframes', () => {
  it('descends same-origin iframes and skips cross-origin ones without throwing', async () => {
    const { result, page } = await extract('iframes.html');
    expect(result.stats.sameOriginIframes).toBe(1);
    expect(result.stats.crossOriginIframesSkipped).toBe(1);
    await page.close();
  });

  it('translates in-frame coordinates into absolute page coordinates', async () => {
    const { result, page } = await extract('iframes.html');
    const marker = result.elements.find((e) => e.text === 'Inside iframe');
    expect(marker).toBeDefined();
    // iframe left 50 + border 5 + padding 10 = content origin 65; marker sits at 30 inside.
    expect(marker!.bounds.x).toBeCloseTo(95, 0);
    // iframe top 100 + border 5 + padding 10 = 115; marker sits at 20 inside.
    expect(marker!.bounds.y).toBeCloseTo(135, 0);
    await page.close();
  });

  it('marks the iframe boundary in the path', async () => {
    const { result, page } = await extract('iframes.html');
    const marker = result.elements.find((e) => e.text === 'Inside iframe');
    expect(marker!.path).toContain('::iframe>');
    await page.close();
  });
});

describe('false-positive filters', () => {
  it('drops screen-reader-only text', async () => {
    const { result, page } = await extract('noise.html');
    expect(result.elements.find((e) => e.text === 'Skip to content')).toBeUndefined();
    await page.close();
  });

  it('drops zero-size, hidden, and off-canvas elements', async () => {
    const { result, page } = await extract('noise.html');
    const paths = result.elements.map((e) => e.path).join('|');
    // All four are styled #ff00ff; none of them paint anything the user can see.
    const magenta = result.elements.filter((e) => e.backgroundColor === 'rgb(255, 0, 255)');
    expect(magenta).toHaveLength(0);
    expect(paths.length).toBeGreaterThan(0);
    await page.close();
  });

  it('keeps SVG roots but not their individual paths', async () => {
    const { result, page } = await extract('noise.html');
    // One icon of 12 paths would otherwise contribute 12 identical findings.
    const svgPaths = result.elements.filter((e) => e.tag === 'path');
    expect(svgPaths).toHaveLength(0);
    expect(result.elements.some((e) => e.tag === 'svg')).toBe(true);
    await page.close();
  });

  it('reports no border colour where the border has zero width', async () => {
    const { result, page } = await extract('noise.html');
    const withBorders = result.elements.filter((e) => e.borderColors.length > 0);

    // Chromium resolves `border-color` to currentColor even where border-width is 0, so
    // without the width gate every element on the page yields a phantom border finding.
    // Exactly two elements here actually paint one: the card, and the unstyled <button>
    // carrying Chrome's UA border — which is a real, visible border and belongs in the
    // results.
    expect(withBorders.map((e) => e.tag).sort()).toEqual(['button', 'div']);
    expect(withBorders.find((e) => e.tag === 'div')!.borderColors).toEqual(['rgb(17, 17, 17)']);
    await page.close();
  });

  it('flags gradient text so its unpainted colour is never reported', async () => {
    const { result, page } = await extract('noise.html');
    const gradient = result.elements.find((e) => e.text === 'Gradient headline');
    expect(gradient!.textFillSkipped).toBe(true);
    await page.close();
  });

  it('marks a radius on a transparent box as not visible', async () => {
    const { result, page } = await extract('noise.html');
    const noBg = result.elements.find((e) => e.radii.includes('13px'));
    expect(noBg).toBeDefined();
    expect(noBg!.radiusVisible).toBe(false);
    await page.close();
  });

  it('only records direct text, so inherited colour is not reported everywhere', async () => {
    const { result, page } = await extract('noise.html');
    const leaf = result.elements.find((e) => e.text === 'Real text');
    expect(leaf!.hasDirectText).toBe(true);
    // The wrapper divs inherit the same colour but paint no text of their own.
    const wrappers = find(result, (p) => p.includes('DIV')).filter(
      (e) => e.color === 'rgb(26, 115, 232)' && !e.hasDirectText,
    );
    expect(wrappers.length).toBeGreaterThan(0);
    await page.close();
  });
});

describe('path format', () => {
  it('produces stable, index-based paths rooted at HTML[0]', async () => {
    const { result, page } = await extract('noise.html');
    for (const el of result.elements) {
      expect(el.path.startsWith('HTML[0]')).toBe(true);
      for (const seg of el.path.split('>')) {
        expect(seg).toMatch(/^[A-Za-z0-9-]+\[\d+\](::shadow|::iframe)?$/);
      }
    }
    await page.close();
  });
});
