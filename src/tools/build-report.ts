import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getSession } from '../browser/session.js';
import { MAX_REPORT_BYTES, REPORT_OUT_DIR } from '../config.js';
import { log } from '../log.js';
import { captureBuildCrops, captureFigmaCrops } from '../report/crops.js';
import { renderReport } from '../report/render.js';
import { advanceStage, ensureRunDir, requireBuild, requireDesign, requireFindings } from '../store/run.js';
import type { Finding } from '../types.js';

export interface BuildReportInput {
  runId: string;
}

export interface BuildReportOutput {
  runId: string;
  reportPath: string;
  runCopy: string;
  jsonPath: string;
  bytes: number;
  images: { buildCrops: number; figmaCrops: number; unresolved: number };
  summary: string;
}

/** Filesystem-safe, human-recognisable filename. */
function reportFileName(frameName: string): string {
  const slug = frameName
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'figma-live-design-qa';
  const date = new Date().toISOString().slice(0, 10);
  return `${slug}-${date}.html`;
}

export async function buildReport(input: BuildReportInput): Promise<BuildReportOutput> {
  const design = await requireDesign(input.runId);
  const build = await requireBuild(input.runId);
  const findings = await requireFindings(input.runId);

  const session = getSession(input.runId);
  if (!session) {
    log.warn('capture session expired; the report will have no build screenshots', input.runId);
  }

  const { images: buildCrops, unresolved } = await captureBuildCrops(
    session?.page ?? null,
    findings.findings,
  );
  const figmaCrops = await captureFigmaCrops(design, findings.findings).catch((err) => {
    log.warn('could not render Figma reference crops', (err as Error).message);
    return new Map<string, { base64: string; nodeName: string }[]>();
  });

  let html = renderReport({
    design,
    build,
    findings,
    buildCrops,
    figmaCrops,
    generatedAt: new Date().toLocaleString(),
  });

  // Drop the least important imagery first if the file would be unshareable.
  if (Buffer.byteLength(html) > MAX_REPORT_BYTES) {
    html = renderReport({
      design,
      build,
      findings,
      buildCrops: dropInfoCrops(buildCrops, findings.findings),
      figmaCrops: dropInfoCrops(figmaCrops, findings.findings),
      generatedAt: new Date().toLocaleString(),
    });
  }

  const dir = await ensureRunDir(input.runId);
  const runCopy = join(dir, 'report.html');
  await writeFile(runCopy, html, 'utf8');

  const jsonPath = join(dir, 'report.json');
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        runId: input.runId,
        frameName: design.frameName,
        fileKey: design.fileKey,
        nodeId: design.nodeId,
        url: build.finalUrl,
        viewport: build.viewport,
        auth: build.auth,
        tiers: findings.tiers,
        notVerified: findings.notVerified,
        counts: findings.counts,
        findings: findings.findings,
      },
      null,
      2,
    ),
    'utf8',
  );

  // Also land it somewhere the user can actually find and share from.
  await mkdir(REPORT_OUT_DIR, { recursive: true });
  const reportPath = join(REPORT_OUT_DIR, reportFileName(design.frameName));
  await writeFile(reportPath, html, 'utf8');

  await advanceStage(input.runId, 'report');

  const figmaCount = [...figmaCrops.values()].reduce((n, v) => n + v.length, 0);
  const buildCount = [...buildCrops.values()].reduce((n, v) => n + v.length, 0);
  const c = findings.counts;

  return {
    runId: input.runId,
    reportPath,
    runCopy,
    jsonPath,
    bytes: Buffer.byteLength(html),
    images: { buildCrops: buildCount, figmaCrops: figmaCount, unresolved },
    summary:
      `${c.total} token deviations (${c.error} error, ${c.warn} warn, ${c.info} info) ` +
      `across ${c.elementsScanned} elements — ${reportPath}`,
  };
}

function dropInfoCrops<T>(crops: Map<string, T>, findings: Finding[]): Map<string, T> {
  const infoHashes = new Set(findings.filter((f) => f.severity === 'info').map((f) => f.hash));
  const out = new Map<string, T>();
  for (const [hash, value] of crops) {
    if (!infoHashes.has(hash)) out.set(hash, value);
  }
  return out;
}
