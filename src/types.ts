/** Dimensions with a token set and a numeric/perceptual distance. */
export type Dim = 'color' | 'fontSize' | 'fontWeight' | 'borderRadius';

export const DIMENSIONS: Dim[] = ['color', 'fontSize', 'fontWeight', 'borderRadius'];

/**
 * What a finding can be about. Font family is checked separately — it has no ordering, so
 * no distance — but it must still be a first-class dimension so that dismissing one works
 * and the report does not mislabel it.
 */
export type FindingDim = Dim | 'fontFamily';

export type Tier = 'variables-api' | 'bound' | 'bound-partial' | 'frequency' | 'not_verified';

export type Severity = 'error' | 'warn' | 'info';

/** One value observed in the Figma frame, with how it got there. */
export interface DesignUsage {
  value: string;
  /** True when the property is bound to a variable or driven by a published style. */
  bound: boolean;
  /** Node id it came from, for value-based Figma crops in the report. */
  nodeId: string;
  /** Area of the node's absolute bounds; used to pick the most legible crop. */
  area: number;
}

export interface DesignNode {
  id: string;
  name: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
  fills: string[];
  strokes: string[];
  fontFamily: string | null;
  fontSize: number | null;
  fontWeight: number | null;
  lineHeightPx: number | null;
  paddingTop: number | null;
  paddingRight: number | null;
  paddingBottom: number | null;
  paddingLeft: number | null;
  itemSpacing: number | null;
  cornerRadius: number[] | null;
  text: string | null;
  /** Canonical property names that are bound to a variable or a published style. */
  boundProps: string[];
}

export interface DimSet {
  dimension: Dim;
  tier: Tier;
  values: string[];
  coverage: number;
  distinct: number;
  reason?: string;
}

export interface DesignDoc {
  runId: string;
  fileKey: string;
  nodeId: string;
  frameName: string;
  frameWidth: number;
  frameHeight: number;
  /** Background luminance of the frame, for the light/dark mode-mismatch guard. */
  frameLuminance: number | null;
  variablesSource: 'variables-api' | 'bound-values' | 'frequency' | 'none';
  variableCollections: number;
  nodes: DesignNode[];
  usages: Record<Dim, DesignUsage[]>;
  allowed: DimSet[];
  fontFamilies: string[];
}

/** One measured DOM element. `path` is machine-resolvable; `label` is for humans. */
export interface BuildElement {
  path: string;
  label: string;
  tag: string;
  role: string | null;
  bounds: { x: number; y: number; width: number; height: number };
  text: string | null;
  hasDirectText: boolean;
  color: string;
  backgroundColor: string;
  borderColors: string[];
  fontFamily: string;
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  padding: string;
  margin: string;
  gap: string;
  borderRadius: string[];
  boxShadow: string;
  /** Set when the painted text color comes from -webkit-text-fill-color or a gradient. */
  textFillSkipped: boolean;
  radiusVisible: boolean;
}

export interface BuildDoc {
  runId: string;
  url: string;
  finalUrl: string;
  viewport: { width: number; height: number };
  auth: { method: AuthMethod; detail: string; loginWall: boolean; note?: string };
  stats: BuildStats;
  waits: { networkIdle: boolean; fontsReady: boolean; settleMs: number };
  bodyLuminance: number | null;
  elements: BuildElement[];
}

export type AuthMethod = 'cdp' | 'profile-copy';

export interface BuildStats {
  harvested: number;
  skippedByFilter: number;
  truncated: boolean;
  shadowRoots: number;
  closedShadowRoots: number;
  sameOriginIframes: number;
  crossOriginIframesSkipped: number;
}

export interface Occurrence {
  path: string;
  label: string;
}

export interface Finding {
  hash: string;
  dimension: FindingDim;
  severity: Severity;
  /** Canonical offending value: "#1A73E8FF" | "15.5px" | "500" | "pill". */
  value: string;
  nearest: string | null;
  distance: number;
  distanceUnit: 'deltaE2000' | 'px' | 'weight';
  occurrences: number;
  commonAncestor: string;
  label: string;
  /** Machine paths. Written to disk, stripped from the model payload. */
  samples: string[];
  sampleLabels: string[];
  tier: Tier;
  notes: string[];
}

export interface NotVerified {
  dimension: Dim | 'fontFamily';
  reason: string;
}

export interface FindingsDoc {
  runId: string;
  tiers: Record<string, Tier>;
  notVerified: NotVerified[];
  counts: {
    error: number;
    warn: number;
    info: number;
    total: number;
    suppressed: number;
    elementsScanned: number;
  };
  findings: Finding[];
}

export type Stage = 'design' | 'build' | 'findings' | 'report';

export interface RunState {
  runId: string;
  stage: Stage;
  fileKey: string;
  nodeId: string;
  frameWidth: number;
  frameName: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}
