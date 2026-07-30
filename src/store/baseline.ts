import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { BASELINES_DIR } from '../config.js';

export interface BaselineEntry {
  hash: string;
  dimension: string;
  value: string;
  reason?: string;
  dismissedAt: string;
}

export interface Baseline {
  fileKey: string;
  entries: BaselineEntry[];
}

/** File keys come from Figma URLs; keep the path safe regardless of what was pasted. */
function baselinePath(fileKey: string): string {
  const safe = fileKey.replace(/[^A-Za-z0-9._-]/g, '_');
  return join(BASELINES_DIR, `${safe}.json`);
}

export async function readBaseline(fileKey: string): Promise<Baseline> {
  try {
    const raw = await readFile(baselinePath(fileKey), 'utf8');
    const parsed = JSON.parse(raw) as Baseline;
    return { fileKey, entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
  } catch {
    return { fileKey, entries: [] };
  }
}

export async function readBaselineHashes(fileKey: string): Promise<Set<string>> {
  return new Set((await readBaseline(fileKey)).entries.map((e) => e.hash));
}

export async function addToBaseline(
  fileKey: string,
  entry: Omit<BaselineEntry, 'dismissedAt'>,
): Promise<{ path: string; total: number; alreadyPresent: boolean }> {
  const baseline = await readBaseline(fileKey);
  const alreadyPresent = baseline.entries.some((e) => e.hash === entry.hash);
  if (!alreadyPresent) {
    baseline.entries.push({ ...entry, dismissedAt: new Date().toISOString() });
  }
  await mkdir(BASELINES_DIR, { recursive: true });
  const path = baselinePath(fileKey);
  await writeFile(path, JSON.stringify(baseline, null, 2), 'utf8');
  return { path, total: baseline.entries.length, alreadyPresent };
}
