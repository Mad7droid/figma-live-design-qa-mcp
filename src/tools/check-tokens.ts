import { observeAll } from '../analyze/filters.js';
import { buildFindings } from '../analyze/findings.js';
import { findingHash } from '../analyze/hash.js';
import { canonicalFontFamily, isGenericFamily } from '../analyze/normalize.js';
import { MAX_FINDINGS_RETURNED, MAX_SAMPLES_PER_FINDING } from '../config.js';
import { readBaselineHashes } from '../store/baseline.js';
import { advanceStage, requireBuild, requireDesign, writeFindings } from '../store/run.js';
import type { DimSet, Finding, FindingsDoc, NotVerified, Tier } from '../types.js';

export interface CheckTokensInput {
  runId: string;
}

/** The trimmed finding the model sees. Machine paths stay on disk. */
interface SlimFinding {
  hash: string;
  dimension: string;
  severity: string;
  value: string;
  nearest: string | null;
  distance: number;
  unit: string;
  occurrences: number;
  where: string;
  tier: Tier;
  notes?: string[];
}

export interface CheckTokensOutput {
  runId: string;
  tiers: Record<string, Tier>;
  notVerified: NotVerified[];
  counts: FindingsDoc['counts'];
  returned: number;
  cappedAt: number;
  findings: SlimFinding[];
  /** True when the page exceeded the element budget, so absence of a finding proves nothing. */
  truncated: boolean;
  artifact: string;
  summary: string;
}

/**
 * A frame captured in light mode compared against a build rendering dark produces almost
 * nothing but false positives. Rather than report hundreds of wrong findings, drop the
 * colour dimension entirely and say why.
 */
function modeMismatch(frameLuminance: number | null, bodyLuminance: number | null): boolean {
  if (frameLuminance === null || bodyLuminance === null) return false;
  return (frameLuminance > 0.5) !== (bodyLuminance > 0.5);
}

export async function checkTokens(input: CheckTokensInput): Promise<CheckTokensOutput> {
  const design = await requireDesign(input.runId);
  const build = await requireBuild(input.runId);

  const notVerified: NotVerified[] = [];
  let allowed: DimSet[] = design.allowed;

  if (modeMismatch(design.frameLuminance, build.bodyLuminance)) {
    const frameDark = (design.frameLuminance ?? 1) <= 0.5;
    allowed = allowed.map((s) =>
      s.dimension === 'color'
        ? { ...s, tier: 'not_verified' as Tier, reason: 'mode mismatch' }
        : s,
    );
    notVerified.push({
      dimension: 'color',
      reason:
        `the Figma frame is ${frameDark ? 'dark' : 'light'} but the build rendered ` +
        `${frameDark ? 'light' : 'dark'} — colour comparison would be meaningless`,
    });
  }

  for (const set of allowed) {
    if (set.tier === 'not_verified' && set.reason && set.reason !== 'mode mismatch') {
      notVerified.push({ dimension: set.dimension, reason: set.reason });
    }
  }

  const observations = observeAll(build.elements);
  const suppressedHashes = await readBaselineHashes(design.fileKey);
  const { findings, suppressed } = buildFindings({ observations, allowed, suppressedHashes });

  const fonts = checkFontFamilies(design.fontFamilies, build, notVerified, suppressedHashes);

  // Re-sort after merging. Font findings are appended, and without this a warning about a
  // webfont that never loaded would sort behind every info-level finding and could be cut
  // off by the 50-item cap.
  const all: Finding[] = [...findings, ...fonts.findings];
  const rank: Record<string, number> = { error: 0, warn: 1, info: 2 };
  all.sort(
    (a, b) => rank[a.severity]! - rank[b.severity]! || b.occurrences - a.occurrences || a.distance - b.distance,
  );

  const counts = {
    error: all.filter((f) => f.severity === 'error').length,
    warn: all.filter((f) => f.severity === 'warn').length,
    info: all.filter((f) => f.severity === 'info').length,
    total: all.length,
    suppressed: suppressed + fonts.suppressed,
    elementsScanned: build.elements.length,
  };

  const tiers: Record<string, Tier> = {};
  for (const set of allowed) tiers[set.dimension] = set.tier;

  const doc: FindingsDoc = { runId: input.runId, tiers, notVerified, counts, findings: all };
  const artifact = await writeFindings(input.runId, doc);
  await advanceStage(input.runId, 'findings');

  // Machine paths are stripped here: they cost ~40 tokens each and the model has no use
  // for `HTML[0]>BODY[1]>...`. They remain in findings.json for the report.
  const slim: SlimFinding[] = all.slice(0, MAX_FINDINGS_RETURNED).map((f) => ({
    hash: f.hash,
    dimension: f.dimension,
    severity: f.severity,
    value: f.value,
    nearest: f.nearest,
    distance: f.distance,
    unit: f.distanceUnit,
    occurrences: f.occurrences,
    where: f.label || f.commonAncestor,
    tier: f.tier,
    ...(f.notes.length ? { notes: f.notes } : {}),
  }));

  return {
    runId: input.runId,
    tiers,
    notVerified,
    counts,
    returned: slim.length,
    cappedAt: MAX_FINDINGS_RETURNED,
    findings: slim,
    truncated: build.stats.truncated,
    artifact,
    summary:
      `${counts.total} token deviations (${counts.error} error, ${counts.warn} warn, ` +
      `${counts.info} info) across ${counts.elementsScanned} elements` +
      (counts.suppressed ? `, ${counts.suppressed} suppressed by baseline` : '') +
      (build.stats.truncated ? ' — page was truncated, so this may under-report' : '') + '.',
  };
}

/**
 * A generic first font family means the webfont never applied — a real and very visible
 * bug. Only checkable when the design actually names families.
 */
function checkFontFamilies(
  designFamilies: string[],
  build: { elements: { fontFamily: string; hasDirectText: boolean; path: string; label: string }[] },
  notVerified: NotVerified[],
  suppressedHashes: Set<string>,
): { findings: Finding[]; suppressed: number } {
  if (designFamilies.length === 0) {
    notVerified.push({
      dimension: 'fontFamily',
      reason: "the frame declares no font families, so the build's fonts cannot be checked",
    });
    return { findings: [], suppressed: 0 };
  }

  const allowed = new Set(designFamilies);
  const offenders = new Map<string, { path: string; label: string }[]>();

  for (const el of build.elements) {
    if (!el.hasDirectText) continue;
    const family = canonicalFontFamily(el.fontFamily);
    if (!family || allowed.has(family)) continue;
    // A different real font is an editorial choice, not a token violation. Only a generic
    // fallback proves the intended webfont failed to apply.
    if (!isGenericFamily(family)) continue;
    const list = offenders.get(family) ?? [];
    list.push({ path: el.path, label: el.label });
    offenders.set(family, list);
  }

  const findings: Finding[] = [];
  let suppressed = 0;

  for (const [family, occ] of offenders) {
    // Same hashing scheme as every other dimension, so dismiss_finding actually suppresses
    // these on the next run.
    const hash = findingHash('fontFamily', family);
    if (suppressedHashes.has(hash)) {
      suppressed++;
      continue;
    }
    findings.push({
      hash,
      dimension: 'fontFamily',
      severity: 'warn',
      value: family,
      nearest: designFamilies[0] ?? null,
      // Font families have no ordering, so there is no meaningful distance.
      distance: -1,
      distanceUnit: 'px',
      occurrences: occ.length,
      commonAncestor: occ[0]?.path ?? '',
      label: occ[0]?.label ?? '',
      samples: occ.slice(0, MAX_SAMPLES_PER_FINDING).map((o) => o.path),
      sampleLabels: occ.slice(0, MAX_SAMPLES_PER_FINDING).map((o) => o.label),
      tier: 'bound' as Tier,
      notes: [`text is rendering in the generic "${family}" family — the design font did not load`],
    });
  }

  return { findings, suppressed };
}
