import { describe, expect, it } from 'vitest';

import {
  PILL,
  canonicalColor,
  canonicalFontFamily,
  canonicalFontSize,
  canonicalRadius,
  distanceToAllowed,
  isAllowed,
  isGenericFamily,
  parsePx,
  parseWeight,
} from '../../src/analyze/normalize.js';

describe('canonicalColor', () => {
  it('normalises every CSS form Chromium emits to hex8', () => {
    expect(canonicalColor('rgb(26, 115, 232)')).toBe('#1A73E8FF');
    expect(canonicalColor('rgba(26, 115, 232, 0.5)')).toBe('#1A73E880');
    expect(canonicalColor('#1a73e8')).toBe('#1A73E8FF');
    expect(canonicalColor('hsl(0, 100%, 50%)')).toBe('#FF0000FF');
  });

  it('treats transparent as a zero-alpha value rather than dropping it', () => {
    expect(canonicalColor('rgba(0, 0, 0, 0)')).toBe('#00000000');
    expect(canonicalColor('transparent')).toBe('#00000000');
  });

  it('rejects values that carry no color', () => {
    expect(canonicalColor('currentColor')).toBeNull();
    expect(canonicalColor('-internal-light-dark(black, white)')).toBeNull();
    expect(canonicalColor('')).toBeNull();
  });
});

describe('canonicalFontSize', () => {
  it('buckets to 0.5px so rem rounding does not create phantom values', () => {
    expect(canonicalFontSize(13.9999)).toBe('14px');
    expect(canonicalFontSize(14.0001)).toBe('14px');
    expect(canonicalFontSize(15.5)).toBe('15.5px');
    expect(canonicalFontSize(15.4)).toBe('15.5px');
  });
});

describe('canonicalRadius', () => {
  it('collapses fully-rounded corners to a single pill sentinel', () => {
    // One design decision ("9999px") would otherwise compute to a different px value on
    // every element and produce hundreds of distinct findings.
    expect(canonicalRadius(9999, 200, 40)).toBe(PILL);
    expect(canonicalRadius(20, 200, 40)).toBe(PILL);
    expect(canonicalRadius(50, 0, 0, true)).toBe(PILL);
  });

  it('keeps ordinary radii numeric', () => {
    expect(canonicalRadius(8, 200, 40)).toBe('8px');
    expect(canonicalRadius(6.4, 200, 40)).toBe('6.5px');
  });

  it('does not need element dimensions', () => {
    expect(canonicalRadius(12)).toBe('12px');
  });
});

describe('parsePx / parseWeight', () => {
  it('parses px values and rejects anything else', () => {
    expect(parsePx('16px')).toBe(16);
    expect(parsePx('-2px')).toBe(-2);
    expect(parsePx('50%')).toBeNull();
    expect(parsePx('normal')).toBeNull();
  });

  it('maps keyword weights to numbers', () => {
    expect(parseWeight('normal')).toBe(400);
    expect(parseWeight('bold')).toBe(700);
    expect(parseWeight('500')).toBe(500);
  });
});

describe('canonicalFontFamily', () => {
  it('takes only the first family, unquoted and lowercased', () => {
    expect(canonicalFontFamily('"Inter", system-ui, sans-serif')).toBe('inter');
    expect(canonicalFontFamily("'Helvetica Neue', Arial")).toBe('helvetica neue');
  });

  it('recognises generic families, which signal a webfont that never loaded', () => {
    expect(isGenericFamily('sans-serif')).toBe(true);
    expect(isGenericFamily('system-ui')).toBe(true);
    expect(isGenericFamily('inter')).toBe(false);
  });
});

describe('isAllowed', () => {
  it('matches exactly for discrete dimensions', () => {
    expect(isAllowed('fontWeight', '500', new Set(['400', '500']))).toBe(true);
    expect(isAllowed('fontWeight', '450', new Set(['400', '500']))).toBe(false);
  });

  it('gives font sizes a tolerance, because the same value computes differently', () => {
    expect(isAllowed('fontSize', '14px', new Set(['14px']))).toBe(true);
    expect(isAllowed('fontSize', '14.5px', new Set(['14px']))).toBe(true);
    expect(isAllowed('fontSize', '15px', new Set(['14px']))).toBe(false);
  });
});

describe('distanceToAllowed', () => {
  it('measures numeric dimensions in their own units', () => {
    const r = distanceToAllowed('fontSize', '15.5px', ['12px', '16px', '20px']);
    expect(r.nearest).toBe('16px');
    expect(r.distance).toBeCloseTo(0.5);
    expect(r.unit).toBe('px');
  });

  it('measures colors perceptually', () => {
    const r = distanceToAllowed('color', '#1A73E8FF', ['#1A73E9FF', '#FF0000FF']);
    expect(r.nearest).toBe('#1A73E9FF');
    expect(r.unit).toBe('deltaE2000');
    expect(r.distance).toBeLessThan(1.5);
  });

  it('treats pill as categorical rather than inventing a numeric distance', () => {
    const r = distanceToAllowed('borderRadius', PILL, ['4px', '8px']);
    expect(r.nearest).toBeNull();
    expect(r.distance).toBe(Number.POSITIVE_INFINITY);
  });
});
