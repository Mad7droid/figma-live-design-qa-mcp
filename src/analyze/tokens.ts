import {
  BOUND_COVERAGE,
  BOUND_PARTIAL_COVERAGE,
  FREQ_MIN_COVERAGE,
  MAX_DISTINCT,
  MIN_BOUND,
} from '../config.js';
import { DIMENSIONS, type DesignUsage, type Dim, type DimSet } from '../types.js';
import { PILL } from './normalize.js';

/** Values that are always legitimate regardless of what the design happens to contain. */
const ALWAYS_ALLOWED: Partial<Record<Dim, string[]>> = {
  borderRadius: ['0px', PILL],
  color: ['#00000000'],
};

function tally(usages: DesignUsage[], onlyBound: boolean): Map<string, number> {
  const counts = new Map<string, number>();
  for (const u of usages) {
    if (onlyBound && !u.bound) continue;
    counts.set(u.value, (counts.get(u.value) ?? 0) + 1);
  }
  return counts;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);

interface FreqOpts {
  minCount: number;
  minShare: number;
  maxDistinct: number;
}

/**
 * Values common enough in the frame to plausibly be tokens.
 *
 * Both gates matter. A value used *once* in a frame is as likely to be a mistake in the
 * design as a token — admitting it would let a real build bug hide behind a design bug.
 * The share gate then drops the long tail of one-off decorative values.
 */
function topByFrequency(counts: Map<string, number>, opts: FreqOpts): Set<string> {
  const total = sum(counts);
  if (total === 0) return new Set();
  return new Set(
    [...counts.entries()]
      .filter(([, c]) => c >= opts.minCount && c / total >= opts.minShare)
      .sort((a, b) => b[1] - a[1])
      .slice(0, opts.maxDistinct)
      .map(([v]) => v),
  );
}

function shareOfUsages(chosen: Set<string>, counts: Map<string, number>): number {
  const total = sum(counts);
  if (total === 0) return 0;
  let covered = 0;
  for (const [v, c] of counts) if (chosen.has(v)) covered += c;
  return covered / total;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Decide the allowed value set for one dimension, and how much to trust it.
 *
 * Tiering is per dimension, never per file: a file commonly has thorough color variables
 * and zero radius variables. A single file-wide confidence would either poison the colors
 * or throw away the radii.
 */
export function decideDimension(
  dim: Dim,
  usages: DesignUsage[],
  apiValues: Set<string> | null,
): DimSet {
  const always = ALWAYS_ALLOWED[dim] ?? [];
  const finish = (set: Set<string>): string[] => {
    for (const v of always) set.add(v);
    return [...set].sort();
  };

  if (apiValues && apiValues.size > 0) {
    return {
      dimension: dim,
      tier: 'variables-api',
      values: finish(new Set(apiValues)),
      coverage: 1,
      distinct: apiValues.size,
    };
  }

  const all = tally(usages, false);
  const bound = tally(usages, true);

  if (all.size === 0) {
    return {
      dimension: dim,
      tier: 'not_verified',
      values: finish(new Set()),
      coverage: 0,
      distinct: 0,
      reason: `the frame uses no ${dim} values, so there is nothing to compare the build against`,
    };
  }

  const totalUse = sum(all);
  const coverage = totalUse === 0 ? 0 : sum(bound) / totalUse;

  if (bound.size >= MIN_BOUND[dim] && coverage >= BOUND_COVERAGE) {
    return {
      dimension: dim,
      tier: 'bound',
      values: finish(new Set(bound.keys())),
      coverage,
      distinct: bound.size,
    };
  }

  if (bound.size > 0 && coverage >= BOUND_PARTIAL_COVERAGE) {
    // Some values are bound, most are not. Widening with frequent unbound values stops us
    // flagging legitimate-but-unbound design values. Costs recall; buys precision.
    const extra = topByFrequency(all, { minCount: 2, minShare: 0.02, maxDistinct: MAX_DISTINCT[dim] });
    const merged = new Set([...bound.keys(), ...extra]);
    return {
      dimension: dim,
      tier: 'bound-partial',
      values: finish(merged),
      coverage,
      distinct: merged.size,
    };
  }

  const freq = topByFrequency(all, { minCount: 2, minShare: 0.01, maxDistinct: MAX_DISTINCT[dim] });
  const covered = shareOfUsages(freq, all);

  if (all.size > MAX_DISTINCT[dim] * 2 || covered < FREQ_MIN_COVERAGE || freq.size === 0) {
    return {
      dimension: dim,
      tier: 'not_verified',
      values: finish(new Set()),
      coverage: covered,
      distinct: all.size,
      reason:
        `${all.size} distinct ${dim} values in the frame and the most common ones cover only ` +
        `${pct(covered)} of uses — no token set can be inferred with confidence`,
    };
  }

  return { dimension: dim, tier: 'frequency', values: finish(freq), coverage: covered, distinct: freq.size };
}

export function decideAll(
  usages: Record<Dim, DesignUsage[]>,
  apiValues: Partial<Record<Dim, Set<string>>> | null,
): DimSet[] {
  return DIMENSIONS.map((dim) => decideDimension(dim, usages[dim] ?? [], apiValues?.[dim] ?? null));
}
