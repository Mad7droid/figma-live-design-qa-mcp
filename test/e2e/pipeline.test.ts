import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Connection, Ladder } from '../../src/browser/connect.js';
import { installShadowPatch, preparePage } from '../../src/browser/prepare.js';
import { fixtureDesign } from '../fixtures/design.js';
import { startServer, type StaticServer } from '../server.js';

let browser: Browser;
let server: StaticServer;
let home: string;

beforeAll(async () => {
  // Set by test/setup-env.ts, which must run before any source module is imported —
  // config.ts resolves the artifact roots once, at load time.
  home = process.env.DESIGN_QA_HOME!;
  expect(home).toBeTruthy();

  server = await startServer();
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Stands in for the auth ladder so the capture path can be exercised without a logged-in
 * browser. Everything after the connection — page prep, the DOM walk, field mapping — is
 * the real production code.
 */
function stubLadder(page: string): Ladder {
  return async ({ url, viewportWidth }): Promise<Connection> => {
    const context = await browser.newContext();
    await installShadowPatch(context);
    const p = await context.newPage();
    await p.setViewportSize({ width: viewportWidth, height: 900 });
    const settle = await preparePage(p, url);
    return {
      browser,
      context,
      page: p,
      method: 'cdp',
      detail: `stub:${page}`,
      ownsBrowser: false,
      loginWall: false,
      loginWallReason: null,
      settle,
      finalUrl: p.url(),
    };
  };
}

async function seedDesign(runId: string): Promise<void> {
  const dir = join(home, 'runs', runId);
  await mkdir(dir, { recursive: true });
  const design = fixtureDesign(runId);
  await writeFile(join(dir, 'design.json'), JSON.stringify(design, null, 2));
  const now = new Date().toISOString();
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      runId, stage: 'design', fileKey: design.fileKey, nodeId: design.nodeId,
      frameWidth: design.frameWidth, frameName: design.frameName, createdAt: now, updatedAt: now,
    }),
  );
}

function runId(suffix: string): string {
  return `20260101-0000${suffix}-abcd`;
}

describe('the derived token set', () => {
  it('reaches the bound tier for every dimension in the fixture', async () => {
    const design = fixtureDesign(runId('00'));
    for (const set of design.allowed) {
      expect(set.tier, `${set.dimension} tier`).toBe('bound');
    }
  });
});

describe('precision acceptance bar', () => {
  it('reports ZERO findings on a page built only from the design tokens', async () => {
    const id = runId('01');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { checkTokens } = await import('../../src/tools/check-tokens.js');

    const build = await captureBuild(
      { runId: id, url: `${server.origin}/clean.html` },
      stubLadder('clean'),
    );
    expect(build.elements.harvested).toBeGreaterThan(5);

    const result = await checkTokens({ runId: id });

    // Every value on clean.html is in the token set; everything else on the page is noise
    // the filters are supposed to eat. Any finding here is a false positive.
    expect(result.findings, JSON.stringify(result.findings, null, 2)).toEqual([]);
    expect(result.counts.total).toBe(0);
  });
});

describe('real deviations', () => {
  it('catches a near-miss colour as an error, grouped once across all its elements', async () => {
    const id = runId('02');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { checkTokens } = await import('../../src/tools/check-tokens.js');

    await captureBuild({ runId: id, url: `${server.origin}/drift.html` }, stubLadder('drift'));
    const result = await checkTokens({ runId: id });

    const colorFinding = result.findings.find((f) => f.value === '#1A73E9FF');
    expect(colorFinding).toBeDefined();
    // One char from the token: hardcoded drift, the most confident class of finding.
    expect(colorFinding!.severity).toBe('error');
    expect(colorFinding!.nearest).toBe('#1A73E8FF');
    // Four elements use it; that must be one finding with occurrences: 4.
    expect(colorFinding!.occurrences).toBe(4);
    expect(result.findings.filter((f) => f.value === '#1A73E9FF')).toHaveLength(1);
  });

  it('catches an off-token font size, weight and radius', async () => {
    const id = runId('03');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { checkTokens } = await import('../../src/tools/check-tokens.js');

    await captureBuild({ runId: id, url: `${server.origin}/drift.html` }, stubLadder('drift'));
    const result = await checkTokens({ runId: id });

    expect(result.findings.find((f) => f.value === '15px')).toBeDefined();
    expect(result.findings.find((f) => f.value === '500')).toBeDefined();
    expect(result.findings.find((f) => f.value === '13px')).toBeDefined();
  });
});

describe('field mapping through the capture path', () => {
  it('carries computed radii into the checked border-radius dimension', async () => {
    const id = runId('04');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { readBuild } = await import('../../src/store/run.js');

    await captureBuild({ runId: id, url: `${server.origin}/drift.html` }, stubLadder('drift'));
    const build = await readBuild(id);
    const rounded = build!.elements.find((e) => e.borderRadius.includes('13px'));
    // extract.ts calls this `radii`; BuildElement calls it `borderRadius`. If that mapping
    // is ever dropped, every radius finding silently disappears.
    expect(rounded).toBeDefined();
    expect(rounded!.radiusVisible).toBe(true);
  });
});

describe('baseline suppression', () => {
  it('stops reporting a finding after it is dismissed, and says so', async () => {
    const id = runId('05');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { checkTokens } = await import('../../src/tools/check-tokens.js');
    const { dismissFinding } = await import('../../src/tools/dismiss-finding.js');

    await captureBuild({ runId: id, url: `${server.origin}/drift.html` }, stubLadder('drift'));
    const before = await checkTokens({ runId: id });
    const target = before.findings.find((f) => f.value === '#1A73E9FF')!;

    const dismissal = await dismissFinding({ runId: id, findingHash: target.hash, reason: 'test' });
    expect(dismissal.alreadyPresent).toBe(false);

    const after = await checkTokens({ runId: id });
    expect(after.findings.find((f) => f.value === '#1A73E9FF')).toBeUndefined();
    expect(after.counts.suppressed).toBeGreaterThanOrEqual(1);
  });
});

describe('report', () => {
  it('writes a self-contained HTML file with no external references', async () => {
    const id = runId('06');
    await seedDesign(id);

    const { captureBuild } = await import('../../src/tools/capture-build.js');
    const { checkTokens } = await import('../../src/tools/check-tokens.js');
    const { buildReport } = await import('../../src/tools/build-report.js');

    await captureBuild({ runId: id, url: `${server.origin}/drift.html` }, stubLadder('drift'));
    await checkTokens({ runId: id });
    const report = await buildReport({ runId: id });

    const html = await readFile(report.reportPath, 'utf8');

    // Must open offline and survive being forwarded around.
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/src="https?:\/\//i);
    // Element-clipped screenshots of the live page, inlined.
    expect(html).toContain('data:image/jpeg;base64,');
    expect(report.images.buildCrops).toBeGreaterThan(0);

    // The dismissal call is copy-pasteable straight into Claude, with real quotes.
    expect(html).toContain(`dismiss_finding(runId: "${id}"`);
  });

  it('escapes page-derived text so the report cannot be corrupted by content', async () => {
    const { esc } = await import('../../src/report/render.js');
    expect(esc('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });
});

describe('font family checking', () => {
  /** A page whose webfont never applied, so text falls back to a generic family. */
  async function seedGenericFontRun(id: string) {
    await seedDesign(id);
    const { readDesign } = await import('../../src/store/run.js');
    const { fixtureBuild } = await import('../fixtures/design.js');
    const design = (await readDesign(id))!;
    const build = fixtureBuild(id);
    for (const el of build.elements) el.fontFamily = 'sans-serif';
    await writeFile(join(home, 'runs', id, 'build.json'), JSON.stringify(build));
    expect(design.fontFamilies).toContain('inter');
  }

  it('flags a generic fallback family as its own dimension, not as fontSize', async () => {
    const id = runId('07');
    await seedGenericFontRun(id);
    const { checkTokens } = await import('../../src/tools/check-tokens.js');
    const result = await checkTokens({ runId: id });

    const font = result.findings.find((f) => f.value === 'sans-serif');
    expect(font).toBeDefined();
    // Previously mislabelled as `fontSize`, which made the report actively misleading.
    expect(font!.dimension).toBe('fontFamily');
    expect(font!.severity).toBe('warn');
  });

  it('actually suppresses a dismissed font-family finding on the next run', async () => {
    const id = runId('08');
    await seedGenericFontRun(id);
    const { checkTokens } = await import('../../src/tools/check-tokens.js');
    const { dismissFinding } = await import('../../src/tools/dismiss-finding.js');

    const before = await checkTokens({ runId: id });
    const font = before.findings.find((f) => f.value === 'sans-serif')!;

    await dismissFinding({ runId: id, findingHash: font.hash, reason: 'intentional' });

    // The font check used to bypass the baseline entirely, making dismissal a silent no-op.
    const after = await checkTokens({ runId: id });
    expect(after.findings.find((f) => f.value === 'sans-serif')).toBeUndefined();
    expect(after.counts.suppressed).toBeGreaterThanOrEqual(1);
  });

  it('ignores a different real font, which is an editorial choice not a token bug', async () => {
    const id = runId('09');
    await seedDesign(id);
    const { fixtureBuild } = await import('../fixtures/design.js');
    const build = fixtureBuild(id);
    for (const el of build.elements) el.fontFamily = '"Georgia", serif';
    await writeFile(join(home, 'runs', id, 'build.json'), JSON.stringify(build));

    const { checkTokens } = await import('../../src/tools/check-tokens.js');
    const result = await checkTokens({ runId: id });
    expect(result.findings.find((f) => f.dimension === 'fontFamily')).toBeUndefined();
  });
});

describe('run_design_qa failure handling', () => {
  it('reports the failed step instead of throwing when there is no Figma token', async () => {
    const saved = process.env.FIGMA_TOKEN;
    const savedAlt = process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
    delete process.env.FIGMA_TOKEN;
    delete process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
    try {
      const { runDesignQa } = await import('../../src/tools/orchestrate.js');
      const result = await runDesignQa({
        figmaUrl: 'https://www.figma.com/design/abc123XYZ890/File?node-id=1-2',
        buildUrl: `${server.origin}/clean.html`,
      });

      // The orchestrator must degrade to a report of what went wrong, not blow up the tool
      // call — otherwise the first-run experience is an opaque stack trace.
      expect(result.failedAt).toBe('capture_design');
      expect(result.completed).toEqual([]);
      expect(result.error).toMatch(/FIGMA_TOKEN/);
      // Actionable setup guidance, since this is the most common first-run failure.
      expect(result.error).toMatch(/Personal access tokens/);
    } finally {
      if (saved !== undefined) process.env.FIGMA_TOKEN = saved;
      if (savedAlt !== undefined) process.env.FIGMA_PERSONAL_ACCESS_TOKEN = savedAlt;
    }
  });

  it('rejects a non-Figma link before doing any work', async () => {
    const { runDesignQa } = await import('../../src/tools/orchestrate.js');
    const result = await runDesignQa({
      figmaUrl: 'https://example.com/not-figma',
      buildUrl: `${server.origin}/clean.html`,
    });
    expect(result.failedAt).toBe('capture_design');
    expect(result.runId).toBeNull();
  });
});
