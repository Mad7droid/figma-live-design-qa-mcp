import { createHash } from 'node:crypto';

import type { FindingDim } from '../types.js';

export const HASH_VERSION = 1;

/**
 * A finding's identity, stable across re-runs.
 *
 * Deliberately excludes everything volatile: selector paths, element text, coordinates,
 * occurrence counts, the URL, and the timestamp. Live pages carry real dynamic data, so
 * any of those would change between runs and silently resurrect a dismissed finding.
 *
 * It also excludes `nearest`. The nearest allowed value changes the moment a designer adds
 * a token; folding it in would invalidate every dismissal in the baseline for reasons the
 * user never sees.
 *
 * `fileKey` is excluded too: `baselines/<fileKey>.json` already namespaces dismissals, and
 * a portable hash lets a team diff and merge baselines across branches. The tradeoff is
 * that dismissing a value dismisses it file-wide — the right granularity for a token check,
 * where a value is either in the system or it is not.
 */
export function findingHash(dimension: FindingDim, canonicalValue: string): string {
  const input = `v${HASH_VERSION}|${dimension}|${canonicalValue}`;
  return 'dq-' + createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 12);
}
