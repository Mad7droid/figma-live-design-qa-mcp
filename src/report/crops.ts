import type { Page } from 'playwright';

import { cropElement } from '../browser/locate.js';
import { CROPS_PER_FINDING, FIGMA_CROPS_PER_FINDING, MAX_CROPS_TOTAL } from '../config.js';
import { renderNodes } from '../figma/images.js';
import { log } from '../log.js';
import type { DesignDoc, Finding, Severity } from '../types.js';

export interface FindingImages {
  build: string[];
  figma: { base64: string; nodeName: string }[];
}

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

/** Errors get their images first; if the budget runs out, info-level findings lose theirs. */
function byBudget(findings: Finding[]): Finding[] {
  return findings.slice().sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.occurrences - a.occurrences,
  );
}

export async function captureBuildCrops(
  page: Page | null,
  findings: Finding[],
): Promise<{ images: Map<string, string[]>; captured: number; unresolved: number }> {
  const images = new Map<string, string[]>();
  let captured = 0;
  let unresolved = 0;
  if (!page) return { images, captured, unresolved };

  for (const finding of byBudget(findings)) {
    if (captured >= MAX_CROPS_TOTAL) break;
    const shots: string[] = [];
    for (const path of finding.samples.slice(0, CROPS_PER_FINDING)) {
      if (captured >= MAX_CROPS_TOTAL) break;
      const crop = await cropElement(page, path);
      if (crop) {
        shots.push(crop.base64);
        captured++;
      } else {
        // Better no image than the wrong element next to a finding.
        unresolved++;
      }
    }
    if (shots.length) images.set(finding.hash, shots);
  }

  return { images, captured, unresolved };
}

/**
 * Figma crops, resolved by *value* rather than by position.
 *
 * There is no principled way to say which Figma node corresponds to a finding that groups
 * 37 DOM elements, and guessing would put the wrong image next to a finding — which
 * destroys trust faster than showing no image. Instead: look up the design nodes that use
 * the nearest allowed token and show those, captioned honestly as "this token is used
 * here in the design".
 */
export async function captureFigmaCrops(
  design: DesignDoc,
  findings: Finding[],
): Promise<Map<string, { base64: string; nodeName: string }[]>> {
  const nodeNames = new Map(design.nodes.map((n) => [n.id, n.name]));
  const wanted = new Map<string, string[]>(); // findingHash -> nodeIds
  const allNodeIds = new Set<string>();

  for (const finding of byBudget(findings)) {
    if (!finding.nearest) continue;
    // Font family is not a measurable dimension, so there is no usage list keyed by value
    // and nothing honest to crop.
    if (finding.dimension === 'fontFamily') continue;
    const usages = design.usages[finding.dimension];
    if (!usages) continue;

    // Largest nodes first — a 4px icon crop is unreadable in the report.
    const matching = usages
      .filter((u) => u.value === finding.nearest)
      .sort((a, b) => b.area - a.area);

    const chosen: string[] = [];
    const seen = new Set<string>();
    for (const usage of matching) {
      if (chosen.length >= FIGMA_CROPS_PER_FINDING) break;
      if (seen.has(usage.nodeId) || usage.area <= 0) continue;
      seen.add(usage.nodeId);
      chosen.push(usage.nodeId);
    }
    if (chosen.length) {
      wanted.set(finding.hash, chosen);
      for (const id of chosen) allNodeIds.add(id);
    }
  }

  if (allNodeIds.size === 0) return new Map();

  const rendered = await renderNodes(design.fileKey, [...allNodeIds].slice(0, MAX_CROPS_TOTAL));
  log.debug(`rendered ${rendered.size} Figma node images`);

  const out = new Map<string, { base64: string; nodeName: string }[]>();
  for (const [hash, ids] of wanted) {
    const items = ids
      .map((id) => {
        const base64 = rendered.get(id);
        return base64 ? { base64, nodeName: nodeNames.get(id) ?? id } : null;
      })
      .filter((v): v is { base64: string; nodeName: string } => v !== null);
    if (items.length) out.set(hash, items);
  }
  return out;
}
