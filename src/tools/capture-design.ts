import { decideAll } from '../analyze/tokens.js';
import { fetchLocalVariables } from '../figma/variables.js';
import { collectFontFamilies, collectUsages, fetchFrame } from '../figma/nodes.js';
import { parseFigmaRef } from '../figma/url.js';
import { newRunId, writeDesign, writeRunState } from '../store/run.js';
import { DIMENSIONS, type DesignDoc, type Dim, type Tier } from '../types.js';

export interface CaptureDesignInput {
  figma: string;
  nodeId?: string;
}

export interface CaptureDesignOutput {
  runId: string;
  fileKey: string;
  nodeId: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  nodeCount: number;
  variablesSource: DesignDoc['variablesSource'];
  variableCollections: number;
  tokens: Record<string, number>;
  tiers: Record<string, Tier>;
  artifact: string;
  summary: string;
}

export async function captureDesign(input: CaptureDesignInput): Promise<CaptureDesignOutput> {
  const ref = parseFigmaRef(input.figma, input.nodeId);
  if (!ref.nodeId) {
    throw new Error(
      'No frame selected. Paste the link to a specific frame (in Figma: right-click the frame → ' +
        'Copy link to selection), or pass nodeId explicitly.',
    );
  }

  const frame = await fetchFrame(ref.fileKey, ref.nodeId);

  // Enterprise-only endpoint; a null result is the normal case, not a failure.
  const variables = await fetchLocalVariables(ref.fileKey);

  const usages = collectUsages(frame.nodes);
  const allowed = decideAll(usages, variables?.values ?? null);

  const tiers: Record<string, Tier> = {};
  const tokens: Record<string, number> = {};
  for (const set of allowed) {
    tiers[set.dimension] = set.tier;
    tokens[set.dimension] = set.tier === 'not_verified' ? 0 : set.values.length;
  }

  const variablesSource: DesignDoc['variablesSource'] = variables
    ? 'variables-api'
    : allowed.some((s) => s.tier === 'bound' || s.tier === 'bound-partial')
      ? 'bound-values'
      : allowed.some((s) => s.tier === 'frequency')
        ? 'frequency'
        : 'none';

  const runId = newRunId();
  const doc: DesignDoc = {
    runId,
    fileKey: ref.fileKey,
    nodeId: ref.nodeId,
    frameName: frame.frameName,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    frameLuminance: frame.frameLuminance,
    variablesSource,
    variableCollections: variables?.collections ?? 0,
    nodes: frame.nodes,
    usages,
    allowed,
    fontFamilies: collectFontFamilies(frame.nodes),
  };

  const artifact = await writeDesign(runId, doc);
  const now = new Date().toISOString();
  await writeRunState({
    runId,
    stage: 'design',
    fileKey: ref.fileKey,
    nodeId: ref.nodeId,
    frameWidth: frame.frameWidth,
    frameName: frame.frameName,
    createdAt: now,
    updatedAt: now,
  });

  const total = DIMENSIONS.reduce((n, d: Dim) => n + (tokens[d] ?? 0), 0);
  const sourceLabel =
    variablesSource === 'variables-api' ? 'the variables API'
      : variablesSource === 'bound-values' ? 'variable and style bindings'
        : variablesSource === 'frequency' ? 'values used across the frame'
          : 'nothing — no token set could be derived';

  return {
    runId,
    fileKey: ref.fileKey,
    nodeId: ref.nodeId,
    frameName: frame.frameName,
    frameWidth: frame.frameWidth,
    frameHeight: frame.frameHeight,
    nodeCount: frame.nodes.length,
    variablesSource,
    variableCollections: variables?.collections ?? 0,
    tokens,
    tiers,
    artifact,
    summary:
      `Captured "${frame.frameName}" — ${frame.nodes.length} nodes, ${frame.frameWidth}px wide, ` +
      `${total} token values from ${sourceLabel}.`,
  };
}
