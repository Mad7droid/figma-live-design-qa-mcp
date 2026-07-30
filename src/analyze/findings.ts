import {
  COLOR_MERGE_DELTA_E,
  MAX_SAMPLES_PER_FINDING,
  MID,
  NEAR,
} from '../config.js';
import type { DimSet, Dim, Finding, Occurrence, Severity, Tier } from '../types.js';
import { colorDistance, sameRgb } from './color.js';
import type { Observation } from './filters.js';
import { findingHash } from './hash.js';
import { distanceToAllowed, isAllowed } from './normalize.js';

/**
 * Severity from tier and distance — and note that the two run *opposite*.
 *
 * A value very close to a real token (#1A73E8 against #1A73E9, 15.5px against 16px) is
 * almost certainly hardcoded drift: someone typed a hex instead of using the token. That
 * is a true bug. A value far from every token is much more likely to be legitimate — a
 * third-party widget, a color sampled from an image, a state color that simply is not in
 * this frame. So the closer the value, the more confident the finding.
 *
 * This inversion is the core precision bet of the whole tool.
 */
export function severityFor(dim: Dim, tier: Tier, distance: number): Severity | null {
  const near = distance <= NEAR[dim];
  const mid = distance <= MID[dim];

  switch (tier) {
    case 'variables-api':
    case 'bound':
      return near ? 'error' : mid ? 'warn' : 'info';
    case 'bound-partial':
      // An inferred set has no authority to call a distant value wrong.
      return mid ? 'warn' : null;
    case 'frequency':
      return near ? 'warn' : mid ? 'info' : null;
    case 'not_verified':
      return null;
  }
}

/** Values a frequency-derived set has no standing to reject. */
const FREQUENCY_EXEMPT = new Set(['#000000FF', '#FFFFFFFF']);

interface Group {
  dimension: Dim;
  value: string;
  occurrences: Occurrence[];
  notes: Set<string>;
  rgbOnly: boolean;
}

function groupKey(dim: Dim, value: string): string {
  return `${dim}|${value}`;
}

/**
 * Longest common prefix of the machine paths, which is the deepest node containing every
 * occurrence — a direct answer to "where do I look".
 */
function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return '';
  const split = paths.map((p) => p.split('>'));
  const first = split[0]!;
  let i = 0;
  outer: for (; i < first.length; i++) {
    for (const parts of split) {
      if (parts[i] !== first[i]) break outer;
    }
  }
  return first.slice(0, i).join('>') || first[0] || '';
}

/**
 * Pick samples that are spread across the page.
 *
 * Five occurrences from the same list row tell you nothing. Repeatedly choosing the
 * occurrence least similar to what is already picked shows the actual blast radius.
 */
function diverseSamples(occurrences: Occurrence[], limit: number): Occurrence[] {
  if (occurrences.length <= limit) return occurrences.slice();

  const sorted = occurrences.slice().sort((a, b) => b.path.length - a.path.length);
  const chosen: Occurrence[] = [sorted[0]!];

  const prefixLen = (a: string, b: string): number => {
    const x = a.split('>');
    const y = b.split('>');
    let n = 0;
    while (n < x.length && n < y.length && x[n] === y[n]) n++;
    return n;
  };

  while (chosen.length < limit) {
    let best: Occurrence | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const cand of sorted) {
      if (chosen.includes(cand)) continue;
      const score = Math.max(...chosen.map((c) => prefixLen(c.path, cand.path)));
      if (score < bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

export interface BuildFindingsInput {
  observations: Observation[];
  allowed: DimSet[];
  suppressedHashes: Set<string>;
}

export interface BuildFindingsResult {
  findings: Finding[];
  suppressed: number;
}

export function buildFindings(input: BuildFindingsInput): BuildFindingsResult {
  const byDim = new Map<Dim, DimSet>();
  for (const set of input.allowed) byDim.set(set.dimension, set);

  const groups = new Map<string, Group>();

  for (const obs of input.observations) {
    const set = byDim.get(obs.dimension);
    // A dimension we could not derive a token set for emits nothing at all. That is the
    // "not verified" contract: a miss is cheap, a false positive is not.
    if (!set || set.tier === 'not_verified') continue;

    const allowedSet = new Set(set.values);

    if (isAllowed(obs.dimension, obs.value, allowedSet)) continue;

    // A composited background can never match a flat token exactly, so an RGB match is
    // as close to "correct" as it can get.
    if (obs.rgbOnly && set.values.some((v) => sameRgb(obs.value, v))) continue;

    if (set.tier === 'frequency' && FREQUENCY_EXEMPT.has(obs.value)) continue;

    const key = groupKey(obs.dimension, obs.value);
    let group = groups.get(key);
    if (!group) {
      group = { dimension: obs.dimension, value: obs.value, occurrences: [], notes: new Set(), rgbOnly: obs.rgbOnly };
      groups.set(key, group);
    }
    group.occurrences.push({ path: obs.path, label: obs.label });
    for (const n of obs.notes) group.notes.add(n);
  }

  mergeNearIdenticalColors(groups);

  const findings: Finding[] = [];
  let suppressed = 0;

  for (const group of groups.values()) {
    const set = byDim.get(group.dimension)!;

    // For a translucent fill, compare the colour itself rather than its composite over
    // white. Otherwise the alpha dominates the perceptual distance and a token-coloured
    // 50% overlay reads as "far from every token", which is the opposite of the truth.
    const measuredValue =
      group.rgbOnly && group.dimension === 'color' ? group.value.slice(0, 7) + 'FF' : group.value;
    const { nearest, distance, unit } = distanceToAllowed(group.dimension, measuredValue, set.values);

    let severity = severityFor(group.dimension, set.tier, distance);
    if (!severity) continue;
    // The rendered color of a translucent fill is a composite, so we are less sure it is wrong.
    if (group.rgbOnly) severity = downgrade(severity);

    const hash = findingHash(group.dimension, group.value);
    if (input.suppressedHashes.has(hash)) {
      suppressed++;
      continue;
    }

    const samples = diverseSamples(group.occurrences, MAX_SAMPLES_PER_FINDING);
    const ancestor = commonAncestor(group.occurrences.map((o) => o.path));

    findings.push({
      hash,
      dimension: group.dimension,
      severity,
      value: group.value,
      nearest,
      distance: Number.isFinite(distance) ? Math.round(distance * 100) / 100 : -1,
      distanceUnit: unit,
      occurrences: group.occurrences.length,
      commonAncestor: ancestor,
      label: samples[0]?.label ?? '',
      samples: samples.map((s) => s.path),
      sampleLabels: samples.map((s) => s.label),
      tier: set.tier,
      notes: [...group.notes],
    });
  }

  const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      b.occurrences - a.occurrences ||
      a.distance - b.distance,
  );

  return { findings, suppressed };
}

function downgrade(s: Severity): Severity {
  return s === 'error' ? 'warn' : s === 'warn' ? 'info' : 'info';
}

/**
 * Antialiasing and compositing round the same source color into several neighbours
 * (#1A73E8 and #1A73E7). Reporting those separately triples the noise for one bug.
 */
function mergeNearIdenticalColors(groups: Map<string, Group>): void {
  const colors = [...groups.entries()]
    .filter(([, g]) => g.dimension === 'color')
    .sort((a, b) => b[1].occurrences.length - a[1].occurrences.length);

  const absorbed = new Set<string>();
  for (let i = 0; i < colors.length; i++) {
    const entryA = colors[i]!;
    if (absorbed.has(entryA[0])) continue;
    for (let j = i + 1; j < colors.length; j++) {
      const entryB = colors[j]!;
      if (absorbed.has(entryB[0])) continue;
      if (colorDistance(entryA[1].value, entryB[1].value) < COLOR_MERGE_DELTA_E) {
        entryA[1].occurrences.push(...entryB[1].occurrences);
        for (const n of entryB[1].notes) entryA[1].notes.add(n);
        absorbed.add(entryB[0]);
        groups.delete(entryB[0]);
      }
    }
  }
}
