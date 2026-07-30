import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Dim } from './types.js';

/** Root for all artifacts. Claude Desktop launches MCP servers with cwd `/`, so this must be absolute. */
export const HOME = process.env.DESIGN_QA_HOME || join(homedir(), '.figma-live-design-qa-mcp');
export const RUNS_DIR = join(HOME, 'runs');
export const BASELINES_DIR = join(HOME, 'baselines');

/** Where the shareable report lands, in addition to the run directory. */
export const REPORT_OUT_DIR = process.env.DESIGN_QA_REPORT_DIR || join(homedir(), 'Documents', 'Design QA');

export const CDP_URL = process.env.DESIGN_QA_CDP_URL || `http://127.0.0.1:${process.env.DESIGN_QA_CDP_PORT || '9222'}`;

export function figmaToken(): string | null {
  return process.env.FIGMA_TOKEN || process.env.FIGMA_PERSONAL_ACCESS_TOKEN || null;
}

/** Minimum number of distinct bound values before we trust the `bound` tier for a dimension. */
export const MIN_BOUND: Record<Dim, number> = {
  color: 3,
  fontSize: 2,
  fontWeight: 2,
  borderRadius: 1,
};

/** Above this many distinct values in a frame, a frequency-derived set has no authority. */
export const MAX_DISTINCT: Record<Dim, number> = {
  color: 24,
  fontSize: 12,
  fontWeight: 6,
  borderRadius: 8,
};

/** Fraction of usages that must be bound to variables/styles before the `bound` tier applies. */
export const BOUND_COVERAGE = 0.5;
/** Below this, bindings are treated as noise and we fall through to frequency. */
export const BOUND_PARTIAL_COVERAGE = 0.15;
/** A frequency-derived set must explain this share of in-frame usage to be trusted at all. */
export const FREQ_MIN_COVERAGE = 0.75;

/**
 * Distance bands. Confidence and distance run *opposite*: a value very close to a token is
 * almost certainly hardcoded drift (a real bug), while a value far from every token is more
 * likely legitimately outside the system (third-party widget, image-derived color, state color
 * absent from this frame). See `severityFor` in analyze/findings.ts.
 */
export const NEAR = { color: 3.0, fontSize: 2.5, fontWeight: 100, borderRadius: 3.0 } as const;
export const MID = { color: 12.0, fontSize: 6.0, fontWeight: 200, borderRadius: 8.0 } as const;

/** Two colors closer than this are the same source value seen through antialiasing. */
export const COLOR_MERGE_DELTA_E = 1.0;

/** Font sizes within this many px are the same value (rem on a non-16px root gives 13.9999px). */
export const FONT_SIZE_TOLERANCE = 0.5;

export const MAX_FINDINGS_RETURNED = 50;
export const MAX_SAMPLES_PER_FINDING = 5;

export const MAX_ELEMENTS = 15000;
export const MAX_DEPTH = 60;

export const CROPS_PER_FINDING = 3;
export const FIGMA_CROPS_PER_FINDING = 2;
export const MAX_CROPS_TOTAL = 40;
export const MAX_REPORT_BYTES = 25 * 1024 * 1024;

export const VIEWPORT_MIN = 320;
export const VIEWPORT_MAX = 2560;
export const VIEWPORT_DEFAULT_HEIGHT = 900;

/** Runs older than this are deleted on server start. */
export const RUN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const RUNS_MAX_BYTES = 2 * 1024 * 1024 * 1024;

/** How long a captured page stays open for build_report to reuse. */
export const SESSION_IDLE_MS = 15 * 60 * 1000;
