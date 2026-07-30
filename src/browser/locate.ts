import type { Page } from 'playwright';

/**
 * Resolve a machine path produced by `domExtract` back to a live element's page rect.
 *
 * Runs on the same page from the same run, so resolution is essentially total for static
 * content and degrades gracefully when a region has re-rendered. On failure it returns
 * null and the caller skips the crop — screenshotting the wrong element is far worse than
 * showing no image at all.
 */
function resolveRect(path: string): { x: number; y: number; width: number; height: number } | null {
  const SEG = /^([A-Za-z0-9-]+)\[(\d+)\](::shadow|::iframe)?$/;
  const segs = path.split('>');
  if (segs.length === 0) return null;

  let current: Element | null = document.documentElement;
  let offX = 0;
  let offY = 0;
  let view: Window = window;

  const first = segs[0];
  if (!first) return null;
  const firstMatch = SEG.exec(first);
  if (!firstMatch || firstMatch[1] !== document.documentElement.tagName) return null;

  let pendingBoundary = firstMatch[3];

  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i];
    if (!seg || !current) return null;
    const m = SEG.exec(seg);
    if (!m?.[1] || !m[2]) return null;
    const tag = m[1];
    const index = Number(m[2]);

    let container: HTMLCollection;
    if (pendingBoundary === '::shadow') {
      const root = current.shadowRoot ?? (window as any).__dq_shadowRoots?.get(current);
      if (!root) return null;
      container = root.children;
    } else if (pendingBoundary === '::iframe') {
      let doc: Document | null = null;
      try {
        doc = (current as HTMLIFrameElement).contentDocument;
      } catch {
        return null;
      }
      if (!doc?.documentElement) return null;
      // Accumulate the iframe's content-box origin before descending.
      const r = current.getBoundingClientRect();
      const cs = view.getComputedStyle(current);
      offX += r.left + view.scrollX + parseFloat(cs.borderLeftWidth || '0') + parseFloat(cs.paddingLeft || '0');
      offY += r.top + view.scrollY + parseFloat(cs.borderTopWidth || '0') + parseFloat(cs.paddingTop || '0');
      view = doc.defaultView ?? view;
      current = doc.documentElement;
      pendingBoundary = m[3];
      if (current.tagName !== tag) return null;
      continue;
    } else {
      container = current.children;
    }

    const next = container[index];
    if (!next || next.tagName !== tag) return null;
    current = next;
    pendingBoundary = m[3];
  }

  if (!current) return null;
  const rect = current.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  return {
    x: rect.left + offX + view.scrollX,
    y: rect.top + offY + view.scrollY,
    width: rect.width,
    height: rect.height,
  };
}

export interface Crop {
  path: string;
  base64: string;
}

const PADDING = 16;

/** Element-clipped screenshot with a little breathing room around the element. */
export async function cropElement(page: Page, path: string): Promise<Crop | null> {
  const rect = await page.evaluate(resolveRect, path).catch(() => null);
  if (!rect) return null;

  const doc = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));

  const x = Math.max(0, rect.x - PADDING);
  const y = Math.max(0, rect.y - PADDING);
  const width = Math.min(doc.width - x, rect.width + PADDING * 2);
  const height = Math.min(doc.height - y, rect.height + PADDING * 2);
  if (width < 1 || height < 1) return null;

  try {
    const buffer = await page.screenshot({
      clip: { x, y, width, height },
      // Force 1x. On a retina display the default is 2x, making every crop 4x the bytes
      // in a report that has to stay under the size cap.
      scale: 'css',
      type: 'jpeg',
      quality: 80,
    });
    return { path, base64: buffer.toString('base64') };
  } catch {
    return null;
  }
}
