import { describe, expect, it } from 'vitest';

import type { Observation } from '../../src/analyze/filters.js';
import { buildFindings, severityFor } from '../../src/analyze/findings.js';
import type { DimSet } from '../../src/types.js';

function colorSet(values: string[], tier: DimSet['tier'] = 'bound'): DimSet {
  return { dimension: 'color', tier, values, coverage: 1, distinct: values.length };
}

function obs(value: string, path: string, label = 'div'): Observation {
  return { dimension: 'color', value, path, label, notes: [], rgbOnly: false };
}

describe('severityFor — confidence and distance run opposite', () => {
  it('treats a near-miss as the most serious case', () => {
    // Very close to a token means someone hardcoded a hex instead of using the token.
    expect(severityFor('color', 'bound', 0.5)).toBe('error');
    // Far from every token is more likely a legitimate outsider: a third-party widget,
    // an image-derived color, a state color absent from this frame.
    expect(severityFor('color', 'bound', 40)).toBe('info');
  });

  it('never lets an inferred set produce an error', () => {
    expect(severityFor('color', 'frequency', 0.5)).toBe('warn');
    expect(severityFor('color', 'bound-partial', 0.5)).toBe('warn');
  });

  it('drops distant values entirely below the bound tier', () => {
    expect(severityFor('color', 'frequency', 40)).toBeNull();
    expect(severityFor('color', 'bound-partial', 40)).toBeNull();
  });

  it('emits nothing at all for an unverified dimension', () => {
    expect(severityFor('color', 'not_verified', 0.1)).toBeNull();
  });
});

describe('buildFindings — grouping', () => {
  it('produces one finding per distinct value, not per element', () => {
    const observations = Array.from({ length: 37 }, (_, i) => obs('#FF0000FF', `HTML[0]>BODY[1]>DIV[${i}]`));
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.occurrences).toBe(37);
  });

  it('merges colors that differ only by antialiasing rounding', () => {
    const observations = [
      ...Array.from({ length: 10 }, (_, i) => obs('#1A73E0FF', `HTML[0]>BODY[1]>DIV[${i}]`)),
      ...Array.from({ length: 3 }, (_, i) => obs('#1A73E1FF', `HTML[0]>BODY[1]>SPAN[${i}]`)),
    ];
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#FF0000FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]!.occurrences).toBe(13);
  });

  it('emits nothing for a dimension that could not be verified', () => {
    const { findings } = buildFindings({
      observations: [obs('#FF0000FF', 'HTML[0]>BODY[1]')],
      allowed: [colorSet([], 'not_verified')],
      suppressedHashes: new Set(),
    });
    expect(findings).toEqual([]);
  });

  it('accepts values already in the token set', () => {
    const { findings } = buildFindings({
      observations: [obs('#1A73E8FF', 'HTML[0]>BODY[1]')],
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings).toEqual([]);
  });
});

describe('buildFindings — semi-transparent backgrounds', () => {
  it('accepts an RGB match, since a composite can never equal a flat token exactly', () => {
    const observations: Observation[] = [
      { dimension: 'color', value: '#1A73E880', path: 'HTML[0]>BODY[1]', label: 'div', notes: [], rgbOnly: true },
    ];
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings).toEqual([]);
  });

  it('downgrades severity when only RGB could be compared', () => {
    const observations: Observation[] = [
      { dimension: 'color', value: '#1A73E980', path: 'HTML[0]>BODY[1]', label: 'div',
        notes: ['semi-transparent background, RGB compared only'], rgbOnly: true },
    ];
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    // Would be `error` at this distance if the color were opaque.
    expect(findings[0]!.severity).toBe('warn');
  });
});

describe('buildFindings — baseline suppression', () => {
  it('drops suppressed findings and counts them separately', () => {
    const first = buildFindings({
      observations: [obs('#FF0000FF', 'HTML[0]>BODY[1]')],
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    const hash = first.findings[0]!.hash;

    const second = buildFindings({
      observations: [obs('#FF0000FF', 'HTML[0]>BODY[1]')],
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set([hash]),
    });
    expect(second.findings).toEqual([]);
    expect(second.suppressed).toBe(1);
  });
});

describe('buildFindings — samples and ordering', () => {
  it('picks samples spread across the page rather than five from one row', () => {
    const observations = [
      ...Array.from({ length: 20 }, (_, i) => obs('#FF0000FF', `HTML[0]>BODY[1]>UL[0]>LI[${i}]>SPAN[0]`)),
      obs('#FF0000FF', 'HTML[0]>BODY[1]>FOOTER[9]>P[0]'),
      obs('#FF0000FF', 'HTML[0]>BODY[1]>HEADER[0]>NAV[0]>A[0]'),
    ];
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    const samples = findings[0]!.samples;
    expect(samples.some((s) => s.includes('FOOTER'))).toBe(true);
    expect(samples.some((s) => s.includes('HEADER'))).toBe(true);
  });

  it('reports the deepest shared ancestor as where to look', () => {
    const { findings } = buildFindings({
      observations: [
        obs('#FF0000FF', 'HTML[0]>BODY[1]>MAIN[0]>SECTION[2]>H2[0]'),
        obs('#FF0000FF', 'HTML[0]>BODY[1]>MAIN[0]>SECTION[2]>P[1]'),
      ],
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings[0]!.commonAncestor).toBe('HTML[0]>BODY[1]>MAIN[0]>SECTION[2]');
  });

  it('orders errors before warnings, then by blast radius', () => {
    const observations = [
      // Near-miss on a bound set => error.
      ...Array.from({ length: 2 }, (_, i) => obs('#1A73E9FF', `HTML[0]>BODY[1]>A[${i}]`)),
      // Mid distance => warn, despite being far more common.
      ...Array.from({ length: 50 }, (_, i) => obs('#2E86F0FF', `HTML[0]>BODY[1]>B[${i}]`)),
    ];
    const { findings } = buildFindings({
      observations,
      allowed: [colorSet(['#1A73E8FF'])],
      suppressedHashes: new Set(),
    });
    expect(findings[0]!.severity).toBe('error');
    expect(findings[0]!.value).toBe('#1A73E9FF');
  });
});
