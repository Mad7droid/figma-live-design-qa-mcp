import { describe, expect, it } from 'vitest';

import { decideDimension } from '../../src/analyze/tokens.js';
import type { DesignUsage } from '../../src/types.js';

function usages(spec: [value: string, count: number, bound: boolean][]): DesignUsage[] {
  const out: DesignUsage[] = [];
  for (const [value, count, bound] of spec) {
    for (let i = 0; i < count; i++) {
      out.push({ value, bound, nodeId: `${value}:${i}`, area: 100 });
    }
  }
  return out;
}

describe('decideDimension — variables API', () => {
  it('trusts the API outright when it is available', () => {
    const set = decideDimension('color', usages([['#111111FF', 40, false]]), new Set(['#1A73E8FF']));
    expect(set.tier).toBe('variables-api');
    expect(set.values).toContain('#1A73E8FF');
    // The frame's own values are irrelevant once real variables are known.
    expect(set.values).not.toContain('#111111FF');
  });
});

describe('decideDimension — bound tier', () => {
  it('derives tokens from bindings alone, which is the common non-Enterprise path', () => {
    const set = decideDimension(
      'color',
      usages([
        ['#1A73E8FF', 10, true],
        ['#FFFFFFFF', 8, true],
        ['#111111FF', 6, true],
        ['#ABCDEFFF', 2, false],
      ]),
      null,
    );
    expect(set.tier).toBe('bound');
    expect(set.values).toEqual(expect.arrayContaining(['#1A73E8FF', '#FFFFFFFF', '#111111FF']));
    expect(set.values).not.toContain('#ABCDEFFF');
  });

  it('needs enough distinct bound values before it trusts them', () => {
    // Two bound colors is below MIN_BOUND.color of 3.
    const set = decideDimension(
      'color',
      usages([['#1A73E8FF', 10, true], ['#FFFFFFFF', 10, true]]),
      null,
    );
    expect(set.tier).not.toBe('bound');
  });

  it('needs bindings to cover at least half of usage', () => {
    const justUnder = decideDimension(
      'color',
      usages([
        ['#1A73E8FF', 16, true], ['#FFFFFFFF', 16, true], ['#111111FF', 17, true],
        ['#AAAAAAFF', 51, false],
      ]),
      null,
    );
    expect(justUnder.tier).toBe('bound-partial');

    const justOver = decideDimension(
      'color',
      usages([
        ['#1A73E8FF', 17, true], ['#FFFFFFFF', 17, true], ['#111111FF', 17, true],
        ['#AAAAAAFF', 49, false],
      ]),
      null,
    );
    expect(justOver.tier).toBe('bound');
  });

  it('accepts a single bound radius, since radius vocabularies are tiny', () => {
    const set = decideDimension('borderRadius', usages([['8px', 10, true]]), null);
    expect(set.tier).toBe('bound');
  });
});

describe('decideDimension — bound-partial tier', () => {
  it('widens with frequent unbound values so legitimate design values are not flagged', () => {
    const set = decideDimension(
      'color',
      usages([
        ['#1A73E8FF', 10, true],
        ['#FFFFFFFF', 30, false],
        ['#111111FF', 20, false],
      ]),
      null,
    );
    expect(set.tier).toBe('bound-partial');
    expect(set.values).toEqual(expect.arrayContaining(['#1A73E8FF', '#FFFFFFFF', '#111111FF']));
  });
});

describe('decideDimension — frequency tier', () => {
  it('falls back to values the frame actually uses when nothing is bound', () => {
    const set = decideDimension(
      'color',
      usages([['#1A73E8FF', 20, false], ['#FFFFFFFF', 20, false], ['#111111FF', 20, false]]),
      null,
    );
    expect(set.tier).toBe('frequency');
    expect(set.values).toEqual(expect.arrayContaining(['#1A73E8FF', '#FFFFFFFF', '#111111FF']));
  });

  it('ignores values used exactly once — as likely a design mistake as a token', () => {
    const set = decideDimension(
      'fontSize',
      usages([['16px', 30, false], ['14px', 30, false], ['13px', 1, false]]),
      null,
    );
    expect(set.tier).toBe('frequency');
    expect(set.values).not.toContain('13px');
  });
});

describe('decideDimension — not_verified', () => {
  it('refuses to infer a set from a frame with no discipline', () => {
    const spec: [string, number, boolean][] = [];
    for (let i = 0; i < 60; i++) {
      spec.push([`#${i.toString(16).padStart(6, '0').toUpperCase()}FF`, 2, false]);
    }
    const set = decideDimension('color', usages(spec), null);
    expect(set.tier).toBe('not_verified');
    expect(set.reason).toMatch(/distinct color values/);
  });

  it('refuses when the common values explain too little of the frame', () => {
    const spec: [string, number, boolean][] = [['#1A73E8FF', 6, false]];
    for (let i = 0; i < 14; i++) spec.push([`#AA00${i.toString(16).padStart(2, '0')}FF`, 1, false]);
    const set = decideDimension('color', usages(spec), null);
    expect(set.tier).toBe('not_verified');
  });

  it('refuses when the frame uses the dimension not at all', () => {
    const set = decideDimension('borderRadius', [], null);
    expect(set.tier).toBe('not_verified');
    expect(set.reason).toMatch(/no borderRadius values/);
  });
});

describe('decideDimension — unconditional values', () => {
  it('always allows zero radius and pills', () => {
    const set = decideDimension('borderRadius', usages([['8px', 10, true]]), null);
    expect(set.values).toContain('0px');
    expect(set.values).toContain('pill');
  });

  it('always allows fully transparent color', () => {
    const set = decideDimension(
      'color',
      usages([['#1A73E8FF', 10, true], ['#FFFFFFFF', 8, true], ['#111111FF', 6, true]]),
      null,
    );
    expect(set.values).toContain('#00000000');
  });
});
