import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { RUNS_DIR, RUN_TTL_MS, RUNS_MAX_BYTES } from '../config.js';
import { log } from '../log.js';
import type { BuildDoc, DesignDoc, FindingsDoc, RunState, Stage } from '../types.js';

export function newRunId(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString('hex')}`;
}

export function runDir(runId: string): string {
  if (!/^[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/.test(runId)) {
    throw new Error(`Invalid runId "${runId}". Expected the id returned by capture_design.`);
  }
  return join(RUNS_DIR, runId);
}

export async function ensureRunDir(runId: string): Promise<string> {
  const dir = runDir(runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readJson<T>(runId: string, file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(join(runDir(runId), file), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJson(runId: string, file: string, data: unknown): Promise<string> {
  const dir = await ensureRunDir(runId);
  const path = join(dir, file);
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  return path;
}

export const readRunState = (runId: string) => readJson<RunState>(runId, 'run.json');
export const readDesign = (runId: string) => readJson<DesignDoc>(runId, 'design.json');
export const readBuild = (runId: string) => readJson<BuildDoc>(runId, 'build.json');
export const readFindings = (runId: string) => readJson<FindingsDoc>(runId, 'findings.json');

export const writeDesign = (runId: string, d: DesignDoc) => writeJson(runId, 'design.json', d);
export const writeBuild = (runId: string, d: BuildDoc) => writeJson(runId, 'build.json', d);
export const writeFindings = (runId: string, d: FindingsDoc) => writeJson(runId, 'findings.json', d);

export async function writeRunState(state: RunState): Promise<void> {
  await writeJson(state.runId, 'run.json', { ...state, updatedAt: new Date().toISOString() });
}

export async function advanceStage(runId: string, stage: Stage, patch: Partial<RunState> = {}): Promise<void> {
  const prev = await readRunState(runId);
  if (!prev) throw new Error(`Run ${runId} has no run.json.`);
  await writeRunState({ ...prev, ...patch, stage });
}

/** Stage gates. The error text tells the caller exactly which tool to run first. */
export async function requireDesign(runId: string): Promise<DesignDoc> {
  const d = await readDesign(runId);
  if (!d) throw new Error(`Run ${runId} has no captured design. Run capture_design first.`);
  return d;
}

export async function requireBuild(runId: string): Promise<BuildDoc> {
  const b = await readBuild(runId);
  if (!b) throw new Error(`Run ${runId} has no captured build. Run capture_build first.`);
  return b;
}

export async function requireFindings(runId: string): Promise<FindingsDoc> {
  const f = await readFindings(runId);
  if (!f) throw new Error(`Run ${runId} has no findings. Run check_tokens first.`);
  return f;
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p);
    else total += (await stat(p)).size;
  }
  return total;
}

/**
 * Drop runs older than the TTL, then evict oldest-first until the total is under the cap.
 * Reports hold multi-MB base64 payloads, so this matters within weeks of daily use.
 */
export async function gcRuns(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch {
    return;
  }

  const cutoff = Date.now() - RUN_TTL_MS;
  const kept: { dir: string; mtime: number; size: number }[] = [];

  for (const name of entries) {
    const dir = join(RUNS_DIR, name);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      if (s.mtimeMs < cutoff) {
        await rm(dir, { recursive: true, force: true });
        continue;
      }
      kept.push({ dir, mtime: s.mtimeMs, size: await dirSize(dir) });
    } catch {
      /* a run being written concurrently; skip it */
    }
  }

  let total = kept.reduce((n, k) => n + k.size, 0);
  kept.sort((a, b) => a.mtime - b.mtime);
  for (const k of kept) {
    if (total <= RUNS_MAX_BYTES) break;
    await rm(k.dir, { recursive: true, force: true }).catch(() => {});
    total -= k.size;
    log.info(`gc: evicted ${k.dir}`);
  }
}
