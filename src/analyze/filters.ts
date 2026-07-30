import type { BuildElement, Dim } from '../types.js';
import { alphaOf, parseColor, toHex8 } from './color.js';
import { canonicalColor, canonicalFontSize, canonicalRadius, canonicalFontWeight, parsePx, parseWeight } from './normalize.js';

/** One canonical value observed on one element, ready to be checked against the token set. */
export interface Observation {
  dimension: Dim;
  value: string;
  path: string;
  label: string;
  notes: string[];
  /** Semi-transparent backgrounds paint a composite, so only RGB can be compared. */
  rgbOnly: boolean;
}

/** Below this, a color contributes nothing visible. */
const MIN_ALPHA = 0.05;
/** A painted background smaller than this is a sub-pixel artifact, not a design decision. */
const MIN_PAINT_AREA = 16;

function push(out: Observation[], o: Observation): void {
  out.push(o);
}

/**
 * Harvest every checkable value from one element.
 *
 * The gates here are what separates a usable report from several hundred junk findings.
 * Each one corresponds to a real source of noise on real pages; see the notes inline.
 */
export function observe(el: BuildElement): Observation[] {
  const out: Observation[] = [];
  const area = el.bounds.width * el.bounds.height;

  /* ---- text color ---------------------------------------------------------------- */
  // Only elements with their own text node. A `color` declared on <body> is inherited by
  // every descendant, so without this gate one declaration is reported on 1800 elements.
  // This single filter removes the large majority of color noise.
  if (el.hasDirectText && !el.textFillSkipped) {
    const hex = canonicalColor(el.color);
    if (hex && alphaOf(hex) >= MIN_ALPHA) {
      push(out, { dimension: 'color', value: hex, path: el.path, label: el.label, notes: [], rgbOnly: false });
    }
  }

  /* ---- background color ---------------------------------------------------------- */
  const bg = parseColor(el.backgroundColor);
  if (bg && bg.a >= MIN_ALPHA && area >= MIN_PAINT_AREA) {
    const hex = toHex8(bg);
    const semi = bg.a < 1;
    push(out, {
      dimension: 'color',
      value: hex,
      path: el.path,
      label: el.label,
      // A translucent fill renders as a composite over whatever is behind it, so it can
      // never equal a flat token exactly. Compare the RGB and say so in the report.
      notes: semi ? ['semi-transparent background, RGB compared only'] : [],
      rgbOnly: semi,
    });
  }

  /* ---- border color -------------------------------------------------------------- */
  // extract.ts already dropped sides with zero width or `none` style, which is what stops
  // Chromium's `border-color: currentColor` default from firing on every element.
  for (const raw of el.borderColors) {
    const hex = canonicalColor(raw);
    if (hex && alphaOf(hex) >= MIN_ALPHA) {
      push(out, { dimension: 'color', value: hex, path: el.path, label: el.label, notes: [], rgbOnly: false });
    }
  }

  /* ---- typography ---------------------------------------------------------------- */
  // Font metrics only mean something where text is actually rendered.
  if (el.hasDirectText) {
    const size = parsePx(el.fontSize);
    if (size !== null && size > 0) {
      push(out, {
        dimension: 'fontSize', value: canonicalFontSize(size),
        path: el.path, label: el.label, notes: [], rgbOnly: false,
      });
    }
    const weight = parseWeight(el.fontWeight);
    if (weight !== null) {
      push(out, {
        dimension: 'fontWeight', value: canonicalFontWeight(weight),
        path: el.path, label: el.label, notes: [], rgbOnly: false,
      });
    }
  }

  /* ---- border radius ------------------------------------------------------------- */
  // A radius on a fully transparent element rounds nothing the eye can see.
  if (el.radiusVisible) {
    const seen = new Set<string>();
    for (const raw of el.borderRadius) {
      if (!raw || raw === '0px') continue;
      const isPercent = raw.includes('%');
      // Elliptical radii serialize as two values; the first is the horizontal one.
      const firstPart = raw.trim().split(/\s+/)[0] ?? raw;
      const px = parsePx(firstPart);
      if (!isPercent && (px === null || px <= 0)) continue;
      const value = canonicalRadius(px ?? 0, el.bounds.width, el.bounds.height, isPercent);
      if (value === '0px' || seen.has(value)) continue;
      seen.add(value);
      push(out, { dimension: 'borderRadius', value, path: el.path, label: el.label, notes: [], rgbOnly: false });
    }
  }

  return out;
}

export function observeAll(elements: BuildElement[]): Observation[] {
  const out: Observation[] = [];
  for (const el of elements) out.push(...observe(el));
  return out;
}
