import { FONT_SIZE_TOLERANCE } from '../config.js';
import type { Dim } from '../types.js';
import { colorDistance, parseColor, toHex8 } from './color.js';

/** Sentinel for fully-rounded corners. See `canonicalRadius`. */
export const PILL = 'pill';

/** 0.5px buckets. rem-based sizes on a non-16px root compute to 13.9999px. */
const half = (n: number) => Math.round(n * 2) / 2;

export function canonicalColor(css: string): string | null {
  const rgba = parseColor(css);
  return rgba ? toHex8(rgba) : null;
}

export function canonicalFontSize(px: number): string {
  return `${half(px)}px`;
}

export function canonicalFontWeight(weight: number): string {
  return String(Math.round(weight));
}

/**
 * A corner radius at or above half the shorter side renders as a full semicircle: the
 * "pill" a designer specified once as 9999px. Its *computed* px value equals half the
 * element height, so it differs on every element — left unnormalised, one design decision
 * becomes hundreds of distinct findings.
 */
export function canonicalRadius(px: number, elWidth?: number, elHeight?: number, isPercent = false): string {
  if (isPercent) return PILL;
  if (elWidth !== undefined && elHeight !== undefined) {
    const shorter = Math.min(elWidth, elHeight);
    if (shorter > 0 && px >= shorter / 2 - 0.51) return PILL;
  }
  return `${half(px)}px`;
}

export function parsePx(value: string): number | null {
  const m = /^(-?[\d.]+)px$/.exec(value.trim());
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** Chromium reports numeric weights, but `bold`/`normal` show up in serialized values. */
export function parseWeight(value: string): number | null {
  const s = value.trim().toLowerCase();
  if (s === 'normal') return 400;
  if (s === 'bold') return 700;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Only the first family in a stack is the one the designer chose; the rest are fallbacks.
 * Compare against Figma's `style.fontFamily`, never `fontPostScriptName` — the latter
 * encodes weight ("Inter-SemiBold") and would never match a CSS family.
 */
export function canonicalFontFamily(value: string): string | null {
  const first = value.split(',')[0];
  if (!first) return null;
  const cleaned = first.trim().replace(/^['"]|['"]$/g, '').trim().toLowerCase();
  return cleaned || null;
}

const GENERIC_FAMILIES = new Set([
  'system-ui', '-apple-system', 'blinkmacsystemfont', 'sans-serif', 'serif',
  'monospace', 'cursive', 'fantasy', 'ui-sans-serif', 'ui-serif', 'ui-monospace',
  'ui-rounded', 'math', 'emoji', 'fangsong',
]);

export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family);
}

export interface DistanceResult {
  nearest: string | null;
  distance: number;
  unit: 'deltaE2000' | 'px' | 'weight';
}

/** Distance from an offending value to the closest member of the allowed set. */
export function distanceToAllowed(dim: Dim, value: string, allowed: string[]): DistanceResult {
  if (dim === 'color') {
    let nearest: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const c of allowed) {
      const d = colorDistance(value, c);
      if (d < best) { best = d; nearest = c; }
    }
    return { nearest, distance: nearest ? best : Number.POSITIVE_INFINITY, unit: 'deltaE2000' };
  }

  const unit: 'px' | 'weight' = dim === 'fontWeight' ? 'weight' : 'px';

  // `pill` is categorical: it either matches or there is no meaningful numeric distance.
  if (value === PILL) {
    return { nearest: allowed.includes(PILL) ? PILL : null, distance: Number.POSITIVE_INFINITY, unit };
  }

  const numeric = dim === 'fontWeight' ? Number(value) : parsePx(value);
  if (numeric === null || !Number.isFinite(numeric)) {
    return { nearest: null, distance: Number.POSITIVE_INFINITY, unit };
  }

  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const c of allowed) {
    if (c === PILL) continue;
    const cn = dim === 'fontWeight' ? Number(c) : parsePx(c);
    if (cn === null || !Number.isFinite(cn)) continue;
    const d = Math.abs(numeric - cn);
    if (d < best) { best = d; nearest = c; }
  }
  return { nearest, distance: nearest ? best : Number.POSITIVE_INFINITY, unit };
}

/**
 * Membership test. Font sizes get a tolerance because the same authored value can compute
 * to 13.9999px or 14.0001px depending on the root font size.
 */
export function isAllowed(dim: Dim, value: string, allowed: Set<string>): boolean {
  if (allowed.has(value)) return true;
  if (dim !== 'fontSize') return false;
  const n = parsePx(value);
  if (n === null) return false;
  for (const c of allowed) {
    const cn = parsePx(c);
    if (cn !== null && Math.abs(cn - n) <= FONT_SIZE_TOLERANCE) return true;
  }
  return false;
}
