import { converter, differenceCiede2000, parse } from 'culori';

export interface Rgba {
  r: number; // 0..255
  g: number;
  b: number;
  a: number; // 0..1
}

const toRgb = converter('rgb');
const ciede = differenceCiede2000();

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Parses any CSS color Chromium can produce (hex, rgb(), hsl(), oklch(), color(), named).
 * Returns null for keywords with no color value — `currentColor`, `transparent` handled
 * by callers, and Chromium's `-internal-light-dark(...)` UA form which is never author-set.
 */
export function parseColor(css: string): Rgba | null {
  if (!css) return null;
  const s = css.trim();
  if (!s || s === 'none' || s === 'currentcolor' || s.includes('-internal-')) return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  const parsed = parse(s);
  if (!parsed) return null;
  const rgb = toRgb(parsed);
  if (!rgb) return null;
  return {
    r: clamp255(rgb.r * 255),
    g: clamp255(rgb.g * 255),
    b: clamp255(rgb.b * 255),
    a: rgb.alpha === undefined ? 1 : Math.max(0, Math.min(1, rgb.alpha)),
  };
}

/** Figma paints carry 0..1 channels plus a separate paint opacity. */
export function figmaColorToRgba(
  color: { r: number; g: number; b: number; a?: number },
  opacity?: number,
): Rgba {
  const alpha = (color.a === undefined ? 1 : color.a) * (opacity === undefined ? 1 : opacity);
  return {
    r: clamp255(color.r * 255),
    g: clamp255(color.g * 255),
    b: clamp255(color.b * 255),
    a: Math.max(0, Math.min(1, alpha)),
  };
}

const hex2 = (n: number) => clamp255(n).toString(16).padStart(2, '0').toUpperCase();

/** Canonical color form. Alpha is quantised to a byte so 0.5 and 0.499 agree. */
export function toHex8(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${hex2(Math.round(c.a * 255))}`;
}

export function hex8ToRgba(hex: string): Rgba {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
    a: h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
  };
}

/** What the eye actually sees for a translucent color on a page. */
export function compositeOver(fg: Rgba, bg: Rgba = { r: 255, g: 255, b: 255, a: 1 }): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/** WCAG relative luminance, used for the light/dark mode-mismatch guard. */
export function relativeLuminance(c: Rgba): number {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
}

function maxChannelDelta(a: Rgba, b: Rgba): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

/**
 * Perceptual distance between two canonical hex8 colors, both composited over white.
 *
 * CIEDE2000 is poorly behaved near the extremes: #000000 vs #0A0A0A scores ~3.9 despite
 * being indistinguishable. Left alone that promotes invisible rounding into "error"
 * findings. So when every channel is within 8/255 we clamp the distance into the
 * near-miss band rather than trusting the formula.
 */
export function colorDistance(aHex: string, bHex: string): number {
  const a = compositeOver(hex8ToRgba(aHex));
  const b = compositeOver(hex8ToRgba(bHex));
  const toCulori = (c: Rgba) => ({ mode: 'rgb' as const, r: c.r / 255, g: c.g / 255, b: c.b / 255 });

  const raw = ciede(toCulori(a), toCulori(b));
  const d = Number.isFinite(raw) ? raw : Number.POSITIVE_INFINITY;

  const channel = maxChannelDelta(a, b);
  if (channel <= 8) return Math.min(d, 1.5);
  return d;
}

export function nearestColor(value: string, allowed: string[]): { nearest: string | null; distance: number } {
  let nearest: string | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const candidate of allowed) {
    const d = colorDistance(value, candidate);
    if (d < best) {
      best = d;
      nearest = candidate;
    }
  }
  return { nearest, distance: nearest === null ? Number.POSITIVE_INFINITY : best };
}

/** Ignores alpha. Used for semi-transparent backgrounds, whose painted color is a composite. */
export function sameRgb(aHex: string, bHex: string): boolean {
  return aHex.slice(0, 7).toUpperCase() === bHex.slice(0, 7).toUpperCase();
}

export function alphaOf(hex: string): number {
  return hex8ToRgba(hex).a;
}
