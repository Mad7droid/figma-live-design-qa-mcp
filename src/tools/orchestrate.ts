import { log } from '../log.js';
import type { Tier } from '../types.js';
import { buildReport } from './build-report.js';
import { captureBuild } from './capture-build.js';
import { captureDesign } from './capture-design.js';
import { checkTokens } from './check-tokens.js';

export interface RunDesignQaInput {
  figmaUrl: string;
  buildUrl: string;
  viewportWidth?: number;
}

export interface RunDesignQaOutput {
  runId: string | null;
  completed: string[];
  failedAt?: string;
  error?: string;
  frameName?: string;
  viewport?: { width: number; height: number };
  auth?: { method: string; detail: string; loginWall: boolean; note?: string };
  tiers?: Record<string, Tier>;
  notVerified?: { dimension: string; reason: string }[];
  counts?: Record<string, number>;
  findings?: unknown[];
  returned?: number;
  reportPath?: string;
  summary: string;
}

/**
 * The path a designer actually wants: paste two links, get a report.
 *
 * On failure it returns the partial state plus the runId rather than throwing, so the work
 * already done is not lost — the granular tools can resume from wherever it stopped.
 */
export async function runDesignQa(input: RunDesignQaInput): Promise<RunDesignQaOutput> {
  const completed: string[] = [];
  let runId: string | null = null;

  const fail = (step: string, err: unknown): RunDesignQaOutput => {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`run_design_qa failed at ${step}`, message);
    return {
      runId,
      completed,
      failedAt: step,
      error: message,
      summary: runId
        ? `Stopped at ${step}. Run id ${runId} is saved — fix the issue and re-run ${step} on its own.`
        : `Stopped at ${step}.`,
    };
  };

  let design;
  try {
    design = await captureDesign({ figma: input.figmaUrl });
    runId = design.runId;
    completed.push('capture_design');
  } catch (err) {
    return fail('capture_design', err);
  }

  let build;
  try {
    build = await captureBuild({
      runId,
      url: input.buildUrl,
      ...(input.viewportWidth === undefined ? {} : { viewportWidth: input.viewportWidth }),
    });
    completed.push('capture_build');
  } catch (err) {
    return fail('capture_build', err);
  }

  let checks;
  try {
    checks = await checkTokens({ runId });
    completed.push('check_tokens');
  } catch (err) {
    return fail('check_tokens', err);
  }

  let report;
  try {
    report = await buildReport({ runId });
    completed.push('build_report');
  } catch (err) {
    return fail('build_report', err);
  }

  return {
    runId,
    completed,
    frameName: design.frameName,
    viewport: build.viewport,
    auth: build.auth,
    tiers: checks.tiers,
    notVerified: checks.notVerified,
    counts: checks.counts,
    findings: checks.findings,
    returned: checks.returned,
    reportPath: report.reportPath,
    summary: `${design.summary} ${build.summary} ${checks.summary} Report: ${report.reportPath}`,
  };
}
