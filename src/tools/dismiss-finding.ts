import { addToBaseline } from '../store/baseline.js';
import { requireDesign, requireFindings } from '../store/run.js';

export interface DismissFindingInput {
  runId: string;
  findingHash: string;
  reason?: string;
}

export interface DismissFindingOutput {
  runId: string;
  hash: string;
  suppresses: string;
  baselineFile: string;
  totalDismissed: number;
  alreadyPresent: boolean;
  summary: string;
}

export async function dismissFinding(input: DismissFindingInput): Promise<DismissFindingOutput> {
  const design = await requireDesign(input.runId);
  const findings = await requireFindings(input.runId);

  // Validate against the run so a typo silently suppresses nothing, and so the confirmation
  // can echo what was actually dismissed.
  const finding = findings.findings.find((f) => f.hash === input.findingHash);
  if (!finding) {
    throw new Error(
      `No finding "${input.findingHash}" in run ${input.runId}. ` +
        `Copy the hash from check_tokens output or the report.`,
    );
  }

  const result = await addToBaseline(design.fileKey, {
    hash: finding.hash,
    dimension: finding.dimension,
    value: finding.value,
    ...(input.reason ? { reason: input.reason } : {}),
  });

  const suppresses = `${finding.dimension} ${finding.value}`;
  return {
    runId: input.runId,
    hash: finding.hash,
    suppresses,
    baselineFile: result.path,
    totalDismissed: result.total,
    alreadyPresent: result.alreadyPresent,
    summary: result.alreadyPresent
      ? `${suppresses} was already dismissed for this Figma file.`
      : `Dismissed ${suppresses}. It will be suppressed on future runs against this Figma file.`,
  };
}
