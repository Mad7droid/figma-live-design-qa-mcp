import { decideAll } from '../../src/analyze/tokens.js';
import type { BuildDoc, BuildElement, DesignDoc, DesignNode, DesignUsage, Dim } from '../../src/types.js';

/** The token vocabulary the fixture pages are built from. */
export const TOKENS = {
  colors: ['#1A73E8FF', '#FFFFFFFF', '#111111FF'],
  fontSizes: ['16px', '14px', '24px'],
  fontWeights: ['400', '600'],
  radii: ['8px'],
};

function usage(value: string, nodeId: string, bound = true): DesignUsage {
  return { value, bound, nodeId, area: 10_000 };
}

/**
 * A synthetic frame whose values are all variable-bound, so every dimension lands on the
 * `bound` tier. No real file key, no product names — the zero-config rule applies to
 * fixtures too.
 */
export function fixtureDesign(runId: string): DesignDoc {
  const usages: Record<Dim, DesignUsage[]> = {
    color: [],
    fontSize: [],
    fontWeight: [],
    borderRadius: [],
  };

  // Repeat each value so the frequency gates (count >= 2) are satisfied whichever
  // tier the tiering logic ends up choosing.
  TOKENS.colors.forEach((c, i) => {
    for (let n = 0; n < 6; n++) usages.color.push(usage(c, `10:${i}${n}`));
  });
  TOKENS.fontSizes.forEach((s, i) => {
    for (let n = 0; n < 4; n++) usages.fontSize.push(usage(s, `20:${i}${n}`));
  });
  TOKENS.fontWeights.forEach((w, i) => {
    for (let n = 0; n < 4; n++) usages.fontWeight.push(usage(w, `30:${i}${n}`));
  });
  TOKENS.radii.forEach((r, i) => {
    for (let n = 0; n < 4; n++) usages.borderRadius.push(usage(r, `40:${i}${n}`));
  });

  const nodes: DesignNode[] = [
    {
      id: '10:00',
      name: 'Frame',
      type: 'FRAME',
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      fills: ['#FFFFFFFF'],
      strokes: [],
      fontFamily: 'Inter',
      fontSize: null,
      fontWeight: null,
      lineHeightPx: null,
      paddingTop: null,
      paddingRight: null,
      paddingBottom: null,
      paddingLeft: null,
      itemSpacing: null,
      cornerRadius: null,
      text: null,
      boundProps: ['fills'],
    },
  ];

  return {
    runId,
    fileKey: 'fixtureFileKey123',
    nodeId: '10:00',
    frameName: 'Fixture Frame',
    frameWidth: 1200,
    frameHeight: 800,
    // White frame background, so the mode-mismatch guard sees a light design.
    frameLuminance: 1,
    variablesSource: 'bound-values',
    variableCollections: 0,
    nodes,
    usages,
    allowed: decideAll(usages, null),
    fontFamilies: ['inter'],
  };
}

function element(path: string, overrides: Partial<BuildElement> = {}): BuildElement {
  return {
    path,
    label: 'body > p',
    tag: 'p',
    role: null,
    bounds: { x: 0, y: 0, width: 200, height: 24 },
    text: 'text',
    hasDirectText: true,
    color: 'rgb(17, 17, 17)',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderColors: [],
    fontFamily: 'Inter, sans-serif',
    fontSize: '16px',
    fontWeight: '400',
    lineHeight: 'normal',
    padding: '0px 0px 0px 0px',
    margin: '0px 0px 0px 0px',
    gap: 'normal',
    borderRadius: ['0px', '0px', '0px', '0px'],
    boxShadow: 'none',
    textFillSkipped: false,
    radiusVisible: false,
    ...overrides,
  };
}

/**
 * A measured page with one deliberate deviation, so protocol-level assertions have real
 * findings to inspect rather than an empty list.
 */
export function fixtureBuild(runId: string): BuildDoc {
  return {
    runId,
    url: 'http://127.0.0.1/fixture',
    finalUrl: 'http://127.0.0.1/fixture',
    viewport: { width: 1200, height: 900 },
    auth: { method: 'cdp', detail: 'fixture', loginWall: false },
    stats: {
      harvested: 3,
      skippedByFilter: 0,
      truncated: false,
      shadowRoots: 0,
      closedShadowRoots: 0,
      sameOriginIframes: 0,
      crossOriginIframesSkipped: 0,
    },
    waits: { networkIdle: true, fontsReady: true, settleMs: 100 },
    // Light page, matching the white fixture frame, so the mode guard stays quiet.
    bodyLuminance: 1,
    elements: [
      element('HTML[0]>BODY[1]>P[0]'),
      // One character off the #1A73E8 token: a near-miss, which must surface as an error.
      element('HTML[0]>BODY[1]>P[1]', { color: 'rgb(26, 115, 233)' }),
      element('HTML[0]>BODY[1]>P[2]', { color: 'rgb(26, 115, 233)' }),
    ],
  };
}
