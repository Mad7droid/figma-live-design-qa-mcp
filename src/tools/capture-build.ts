import { parseColor, relativeLuminance } from '../analyze/color.js';
import { connectBrowser, type Ladder } from '../browser/connect.js';
import { domExtract } from '../browser/extract.js';
import { keepSession } from '../browser/session.js';
import { MAX_DEPTH, MAX_ELEMENTS, VIEWPORT_DEFAULT_HEIGHT, VIEWPORT_MAX, VIEWPORT_MIN } from '../config.js';
import { advanceStage, requireDesign, writeBuild } from '../store/run.js';
import type { BuildDoc, BuildElement, BuildStats } from '../types.js';

export interface CaptureBuildInput {
  runId: string;
  url: string;
  viewportWidth?: number;
}

export interface CaptureBuildOutput {
  runId: string;
  url: string;
  finalUrl: string;
  viewport: { width: number; height: number };
  auth: { method: string; detail: string; loginWall: boolean; note?: string };
  elements: { harvested: number; skippedByFilter: number; truncated: boolean };
  dom: {
    shadowRoots: number;
    closedShadowRoots: number;
    sameOriginIframes: number;
    crossOriginIframesSkipped: number;
  };
  waits: { networkIdle: boolean; fontsReady: boolean; settleMs: number };
  artifact: string;
  summary: string;
}

const clampWidth = (n: number) => Math.max(VIEWPORT_MIN, Math.min(VIEWPORT_MAX, Math.round(n)));

export async function captureBuild(input: CaptureBuildInput, ladder?: Ladder): Promise<CaptureBuildOutput> {
  const design = await requireDesign(input.runId);

  // Default to the Figma frame width so the build renders the layout the frame describes.
  const width = clampWidth(input.viewportWidth ?? design.frameWidth ?? 1440);

  const connection = await connectBrowser({ url: input.url, viewportWidth: width }, ladder);

  const raw = await connection.page.evaluate(domExtract, {
    maxElements: MAX_ELEMENTS,
    maxDepth: MAX_DEPTH,
  });

  const elements: BuildElement[] = raw.elements.map((e) => ({
    path: e.path,
    label: e.label,
    tag: e.tag,
    role: e.role,
    bounds: e.bounds,
    text: e.text,
    hasDirectText: e.hasDirectText,
    color: e.color,
    backgroundColor: e.backgroundColor,
    borderColors: e.borderColors,
    fontFamily: e.fontFamily,
    fontSize: e.fontSize,
    fontWeight: e.fontWeight,
    lineHeight: e.lineHeight,
    padding: e.padding,
    margin: e.margin,
    gap: e.gap,
    borderRadius: e.radii,
    boxShadow: e.boxShadow,
    textFillSkipped: e.textFillSkipped,
    radiusVisible: e.radiusVisible,
  }));

  const bodyRgba = raw.bodyBackground ? parseColor(raw.bodyBackground) : null;

  const stats: BuildStats = raw.stats;
  const doc: BuildDoc = {
    runId: input.runId,
    url: input.url,
    finalUrl: connection.finalUrl,
    viewport: { width, height: VIEWPORT_DEFAULT_HEIGHT },
    auth: {
      method: connection.method,
      detail: connection.detail,
      loginWall: connection.loginWall,
      ...(connection.loginWall
        ? {
            note:
              `Attached to your Chrome, but ${connection.loginWallReason}. ` +
              `Sign in to the site in that window, then run capture_build again.`,
          }
        : {}),
    },
    stats,
    waits: connection.settle,
    bodyLuminance: bodyRgba && bodyRgba.a > 0 ? relativeLuminance(bodyRgba) : null,
    elements,
  };

  const artifact = await writeBuild(input.runId, doc);
  await advanceStage(input.runId, 'build', { url: input.url });

  // Held open so build_report can take element-clipped screenshots of this exact render.
  keepSession(input.runId, connection);

  return {
    runId: input.runId,
    url: input.url,
    finalUrl: connection.finalUrl,
    viewport: doc.viewport,
    auth: doc.auth,
    elements: {
      harvested: stats.harvested,
      skippedByFilter: stats.skippedByFilter,
      truncated: stats.truncated,
    },
    dom: {
      shadowRoots: stats.shadowRoots,
      closedShadowRoots: stats.closedShadowRoots,
      sameOriginIframes: stats.sameOriginIframes,
      crossOriginIframesSkipped: stats.crossOriginIframesSkipped,
    },
    waits: connection.settle,
    artifact,
    summary:
      `Measured ${stats.harvested} elements at ${width}px via ${connection.method}` +
      (connection.loginWall ? ' — WARNING: this looks like a sign-in page, not the target.' : '.'),
  };
}
