import { figmaColorToRgba, hex8ToRgba, relativeLuminance, toHex8 } from '../analyze/color.js';
import { canonicalFontSize, canonicalFontWeight, canonicalRadius } from '../analyze/normalize.js';
import type { DesignNode, DesignUsage, Dim } from '../types.js';
import { figmaGet } from './client.js';

/* Figma REST shapes, narrowed to what we read. */
interface FigmaPaint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: { r: number; g: number; b: number; a?: number };
  boundVariables?: Record<string, unknown>;
}

interface FigmaNode {
  id: string;
  name?: string;
  type: string;
  visible?: boolean;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  characters?: string;
  style?: {
    fontFamily?: string;
    fontPostScriptName?: string;
    fontSize?: number;
    fontWeight?: number;
    lineHeightPx?: number;
  };
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  boundVariables?: Record<string, unknown>;
  styles?: Record<string, string>;
  children?: FigmaNode[];
}

interface NodesResponse {
  name?: string;
  nodes: Record<string, { document: FigmaNode } | undefined>;
}

/**
 * Which node properties are backed by a variable or a published style.
 *
 * This is the heart of the zero-config token derivation. The Variables REST API is
 * Enterprise-only, so for most files we cannot resolve a variable id to a value — but we
 * do not need to. A binding proves the node's *resolved* value IS the token's value in the
 * current mode, and a published style proves the same thing. Collecting the resolved values
 * of bound properties yields a real token set on any plan.
 *
 * Bindings appear in three shapes in the wild, all handled here:
 *   node.boundVariables.cornerRadius = { type: 'VARIABLE_ALIAS', id }
 *   node.boundVariables.fills        = [{ type: 'VARIABLE_ALIAS', id }, ...]
 *   node.fills[i].boundVariables.color = { type: 'VARIABLE_ALIAS', id }
 */
function boundProperties(node: FigmaNode): Set<string> {
  const bound = new Set<string>();
  const bv = node.boundVariables;

  if (bv && typeof bv === 'object') {
    for (const [key, val] of Object.entries(bv)) {
      if (val === null || val === undefined) continue;
      if (Array.isArray(val) ? val.length > 0 : true) bound.add(key);
    }
  }

  // Per-paint bindings live on the paint itself.
  if (node.fills?.some((p) => p.boundVariables && Object.keys(p.boundVariables).length > 0)) {
    bound.add('fills');
  }
  if (node.strokes?.some((p) => p.boundVariables && Object.keys(p.boundVariables).length > 0)) {
    bound.add('strokes');
  }

  // A published style is as much a token as a variable, and roughly doubles recall on
  // files without the Enterprise variables API.
  const styles = node.styles;
  if (styles) {
    if (styles.fill || styles.fills) bound.add('fills');
    if (styles.stroke || styles.strokes) bound.add('strokes');
    if (styles.text) {
      bound.add('fontSize');
      bound.add('fontWeight');
      bound.add('fontFamily');
    }
  }

  return bound;
}

const RADIUS_KEYS = [
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
];

function solidHexes(paints: FigmaPaint[] | undefined): string[] {
  if (!paints) return [];
  const out: string[] = [];
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type !== 'SOLID' || !p.color) continue;
    out.push(toHex8(figmaColorToRgba(p.color, p.opacity)));
  }
  return out;
}

function flattenNode(node: FigmaNode, out: DesignNode[]): void {
  if (node.visible === false) return;

  const bound = boundProperties(node);
  const box = node.absoluteBoundingBox ?? null;

  const radii = node.rectangleCornerRadii
    ? node.rectangleCornerRadii.slice()
    : node.cornerRadius !== undefined
      ? [node.cornerRadius]
      : null;

  out.push({
    id: node.id,
    name: node.name ?? '',
    type: node.type,
    bounds: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
    fills: solidHexes(node.fills),
    strokes: solidHexes(node.strokes),
    fontFamily: node.style?.fontFamily ?? null,
    fontSize: node.style?.fontSize ?? null,
    fontWeight: node.style?.fontWeight ?? null,
    lineHeightPx: node.style?.lineHeightPx ?? null,
    paddingTop: node.paddingTop ?? null,
    paddingRight: node.paddingRight ?? null,
    paddingBottom: node.paddingBottom ?? null,
    paddingLeft: node.paddingLeft ?? null,
    itemSpacing: node.itemSpacing ?? null,
    cornerRadius: radii,
    text: node.characters ?? null,
    boundProps: [...bound],
  });

  for (const child of node.children ?? []) flattenNode(child, out);
}

export interface FetchedFrame {
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  frameLuminance: number | null;
  nodes: DesignNode[];
}

export async function fetchFrame(fileKey: string, nodeId: string): Promise<FetchedFrame> {
  const res = await figmaGet<NodesResponse>(
    `/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}`,
  );

  const entry = res.nodes?.[nodeId];
  if (!entry?.document) {
    const available = Object.keys(res.nodes ?? {});
    throw new Error(
      `Figma returned no node "${nodeId}" in file ${fileKey}.` +
        (available.length ? ` Available: ${available.join(', ')}` : ' Check the node-id in the link.'),
    );
  }

  const root = entry.document;
  const nodes: DesignNode[] = [];
  flattenNode(root, nodes);

  const box = root.absoluteBoundingBox;
  const rootFill = solidHexes(root.fills)[0] ?? null;

  return {
    frameName: root.name ?? nodeId,
    frameWidth: Math.round(box?.width ?? 0),
    frameHeight: Math.round(box?.height ?? 0),
    frameLuminance: rootFill ? relativeLuminance(hex8ToRgba(rootFill)) : null,
    nodes,
  };
}

const area = (n: DesignNode) => (n.bounds ? Math.max(0, n.bounds.width) * Math.max(0, n.bounds.height) : 0);

/**
 * Every value the frame uses, tagged with whether it came from a binding. `nodeId` and
 * `area` are retained so the report can crop the design nodes that use a given token.
 */
export function collectUsages(nodes: DesignNode[]): Record<Dim, DesignUsage[]> {
  const usages: Record<Dim, DesignUsage[]> = {
    color: [], fontSize: [], fontWeight: [], borderRadius: [],
  };

  for (const n of nodes) {
    const bp = new Set(n.boundProps);
    const a = area(n);

    for (const hex of n.fills) {
      usages.color.push({ value: hex, bound: bp.has('fills'), nodeId: n.id, area: a });
    }
    for (const hex of n.strokes) {
      usages.color.push({ value: hex, bound: bp.has('strokes'), nodeId: n.id, area: a });
    }

    if (n.fontSize !== null) {
      usages.fontSize.push({
        value: canonicalFontSize(n.fontSize), bound: bp.has('fontSize'), nodeId: n.id, area: a,
      });
    }
    if (n.fontWeight !== null) {
      usages.fontWeight.push({
        value: canonicalFontWeight(n.fontWeight), bound: bp.has('fontWeight'), nodeId: n.id, area: a,
      });
    }

    if (n.cornerRadius) {
      const radiusBound = RADIUS_KEYS.some((k) => bp.has(k));
      const seen = new Set<string>();
      for (const r of n.cornerRadius) {
        if (typeof r !== 'number' || !Number.isFinite(r)) continue;
        const v = canonicalRadius(r, n.bounds?.width, n.bounds?.height);
        if (seen.has(v)) continue;
        seen.add(v);
        usages.borderRadius.push({ value: v, bound: radiusBound, nodeId: n.id, area: a });
      }
    }
  }

  return usages;
}

export function collectFontFamilies(nodes: DesignNode[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) {
    if (n.fontFamily) set.add(n.fontFamily.trim().toLowerCase());
  }
  return [...set];
}
