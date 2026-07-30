import { describe, expect, it } from 'vitest';

import {
  colorDistance,
  compositeOver,
  figmaColorToRgba,
  hex8ToRgba,
  parseColor,
  relativeLuminance,
  sameRgb,
  toHex8,
} from '../../src/analyze/color.js';

describe('parseColor', () => {
  it('handles modern color spaces Chromium can emit', () => {
    const oklch = parseColor('oklch(0.7 0.15 250)');
    expect(oklch).not.toBeNull();
    expect(oklch!.a).toBe(1);
  });

  it('clamps alpha into range', () => {
    expect(parseColor('rgba(0,0,0,2)')!.a).toBe(1);
  });
});

describe('figmaColorToRgba', () => {
  it('multiplies the paint opacity into the alpha channel', () => {
    const c = figmaColorToRgba({ r: 1, g: 0, b: 0, a: 1 }, 0.5);
    expect(toHex8(c)).toBe('#FF000080');
  });

  it('defaults both alpha and opacity to opaque', () => {
    expect(toHex8(figmaColorToRgba({ r: 0, g: 0, b: 0 }))).toBe('#000000FF');
  });
});

describe('compositeOver', () => {
  it('resolves a translucent color against its backdrop', () => {
    const result = compositeOver({ r: 0, g: 0, b: 0, a: 0.5 });
    expect(Math.round(result.r)).toBe(128);
    expect(result.a).toBe(1);
  });
});

describe('colorDistance', () => {
  it('reports near-identical colors as near-identical', () => {
    expect(colorDistance('#1A73E8FF', '#1A73E9FF')).toBeLessThan(1.5);
  });

  it('separates genuinely different colors', () => {
    expect(colorDistance('#1A73E8FF', '#FF0000FF')).toBeGreaterThan(20);
  });

  it('clamps distances where every channel is within 8/255', () => {
    // CIEDE2000 is poorly behaved at the extremes, so imperceptible channel rounding must
    // not be allowed to score as a visible difference.
    expect(colorDistance('#000000FF', '#060606FF')).toBeLessThanOrEqual(1.5);
    expect(colorDistance('#FFFFFFFF', '#F8F8F8FF')).toBeLessThanOrEqual(1.5);
  });

  it('keeps near-black neighbours inside the near-miss band', () => {
    // Just outside the clamp. Still near enough to read as hardcoded drift from a token
    // rather than a deliberately different colour.
    const d = colorDistance('#000000FF', '#0A0A0AFF');
    expect(d).toBeGreaterThan(1.5);
    expect(d).toBeLessThan(3.0); // NEAR.color
  });

  it('still separates colors just outside the channel clamp', () => {
    expect(colorDistance('#000000FF', '#303030FF')).toBeGreaterThan(1.5);
  });
});

describe('relativeLuminance', () => {
  it('places black and white at the extremes', () => {
    expect(relativeLuminance(hex8ToRgba('#000000FF'))).toBeCloseTo(0, 5);
    expect(relativeLuminance(hex8ToRgba('#FFFFFFFF'))).toBeCloseTo(1, 5);
  });

  it('separates light and dark page backgrounds around the 0.5 midpoint', () => {
    expect(relativeLuminance(hex8ToRgba('#FBFBFAFF'))).toBeGreaterThan(0.5);
    expect(relativeLuminance(hex8ToRgba('#1A1A19FF'))).toBeLessThan(0.5);
  });
});

describe('sameRgb', () => {
  it('ignores alpha, for composited backgrounds that can never match exactly', () => {
    expect(sameRgb('#1A73E880', '#1A73E8FF')).toBe(true);
    expect(sameRgb('#1A73E880', '#FF0000FF')).toBe(false);
  });
});
