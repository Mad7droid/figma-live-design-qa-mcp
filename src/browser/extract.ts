/**
 * The in-page DOM walk.
 *
 * `domExtract` is serialized to source and evaluated inside the page, so it cannot close
 * over anything from this module. Every constant and helper it needs is declared inside it.
 */

export interface RawElement {
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
  /** Raw computed longhands; canonicalised in Node where element dimensions are known. */
  radii: string[];
  boxShadow: string;
  textFillSkipped: boolean;
  radiusVisible: boolean;
}

export interface ExtractResult {
  elements: RawElement[];
  stats: {
    harvested: number;
    skippedByFilter: number;
    truncated: boolean;
    shadowRoots: number;
    closedShadowRoots: number;
    sameOriginIframes: number;
    crossOriginIframesSkipped: number;
  };
  doc: { scrollWidth: number; scrollHeight: number };
  bodyBackground: string | null;
}

export function domExtract(opts: { maxElements: number; maxDepth: number }): ExtractResult {
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // No box, or no painted surface of their own.
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META', 'HEAD', 'TITLE',
    'BR', 'WBR', 'SOURCE', 'TRACK', 'PARAM', 'COL', 'COLGROUP',
  ]);

  const elements: RawElement[] = [];
  const stats = {
    harvested: 0,
    skippedByFilter: 0,
    truncated: false,
    shadowRoots: 0,
    closedShadowRoots: 0,
    sameOriginIframes: 0,
    crossOriginIframesSkipped: 0,
  };

  // Populated by the attachShadow patch installed in prepare.ts, so closed roots are
  // reachable. Absent if the patch could not run (e.g. a page we did not navigate).
  const closedRoots: WeakMap<Element, ShadowRoot> | undefined = (window as any).__dq_shadowRoots;

  const docScrollWidth = document.documentElement.scrollWidth;

  function seg(el: Element, i: number): string {
    return el.tagName + '[' + i + ']';
  }

  /** Framework-generated classes (`css-1x2y3z`, `sc-fzXfMB`) churn every build; ignore them. */
  function stableClass(el: Element): string | null {
    const cls = el.getAttribute('class');
    if (!cls) return null;
    for (const c of cls.trim().split(/\s+/)) {
      if (!c || c.length > 30) continue;
      const digits = (c.match(/\d/g) || []).length;
      if (digits > 2) continue;
      if (/^[a-z]+-[a-z0-9]{5,}$/i.test(c)) continue;
      return c;
    }
    return null;
  }

  function labelSeg(el: Element): string {
    const cls = stableClass(el);
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '');
  }

  function shortLabel(parts: string[]): string {
    return parts.slice(-4).join(' > ');
  }

  function directText(el: Element): { has: boolean; text: string | null } {
    let buf = '';
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) buf += n.textContent ?? '';
    }
    const trimmed = buf.replace(/\s+/g, ' ').trim();
    return { has: trimmed.length > 0, text: trimmed ? trimmed.slice(0, 120) : null };
  }

  function alphaOf(css: string): number {
    const m = /^rgba?\(([^)]+)\)$/.exec(css.trim());
    if (!m?.[1]) return css.trim() === 'transparent' ? 0 : 1;
    const parts = m[1].split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 4) return 1;
    const a = Number(parts[3]);
    return Number.isFinite(a) ? a : 1;
  }

  /**
   * The `.sr-only` recipe: visually hidden, but with fully real computed styles. Without
   * this gate every accessible-name span contributes phantom color and font findings.
   */
  function isScreenReaderOnly(cs: CSSStyleDeclaration, r: DOMRect): boolean {
    if (r.width <= 1 || r.height <= 1) return true;
    if (cs.clip && cs.clip !== 'auto') return true;
    if (cs.clipPath && cs.clipPath.indexOf('inset(50%') === 0) return true;
    return false;
  }

  function record(
    el: Element,
    cs: CSSStyleDeclaration,
    r: DOMRect,
    path: string,
    labelParts: string[],
    absX: number,
    absY: number,
  ): RawElement | null {
    if (isScreenReaderOnly(cs, r)) return null;

    // Off-canvas: `left:-9999px` menus and the like paint nothing the user can see.
    if (r.right < 0 || r.bottom < 0 || absX > docScrollWidth) return null;

    // Chromium UA styles (`-internal-light-dark(...)` on form controls). Never author-set,
    // so never a design decision worth reporting.
    if (cs.color.indexOf('-internal-') >= 0 || cs.backgroundColor.indexOf('-internal-') >= 0) return null;

    const dt = directText(el);

    // Gradient text: the painted color lives in the background, not in `color`.
    const bgClip = (cs as any).backgroundClip || (cs as any).webkitBackgroundClip || '';
    const textFill = (cs as any).webkitTextFillColor || '';
    let textFillSkipped = false;
    let effectiveColor = cs.color;
    if (String(bgClip).indexOf('text') >= 0) {
      textFillSkipped = true;
    } else if (textFill && textFill !== cs.color) {
      if (alphaOf(textFill) < 0.05) textFillSkipped = true;
      else effectiveColor = textFill;
    }

    // Only sides that actually paint. Chromium reports `border-color: currentColor` even
    // on zero-width borders, so without this every element yields a phantom border finding.
    const borderColors: string[] = [];
    const sides = ['Top', 'Right', 'Bottom', 'Left'] as const;
    for (const side of sides) {
      const w = parseFloat((cs as any)['border' + side + 'Width'] || '0');
      const style = (cs as any)['border' + side + 'Style'] || 'none';
      if (w > 0 && style !== 'none' && style !== 'hidden') {
        const c = (cs as any)['border' + side + 'Color'];
        if (c && borderColors.indexOf(c) < 0) borderColors.push(c);
      }
    }

    const radii = [
      cs.borderTopLeftRadius, cs.borderTopRightRadius,
      cs.borderBottomRightRadius, cs.borderBottomLeftRadius,
    ];

    // A radius only exists visually if something is painted inside the rounded box.
    const hasBg = alphaOf(cs.backgroundColor) > 0;
    const hasBorder = borderColors.length > 0;
    const hasShadow = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    const clips = ['hidden', 'clip', 'auto', 'scroll'].indexOf(cs.overflow) >= 0 && el.children.length > 0;
    const isMedia = ['IMG', 'VIDEO', 'CANVAS'].indexOf(el.tagName) >= 0;
    const hasBgImage = cs.backgroundImage !== 'none' && cs.backgroundImage !== '';
    const radiusVisible = hasBg || hasBorder || hasShadow || clips || isMedia || hasBgImage;

    return {
      path,
      label: shortLabel(labelParts),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role'),
      bounds: { x: absX, y: absY, width: r.width, height: r.height },
      text: dt.text,
      hasDirectText: dt.has,
      color: effectiveColor,
      backgroundColor: cs.backgroundColor,
      borderColors,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      padding: `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`,
      margin: `${cs.marginTop} ${cs.marginRight} ${cs.marginBottom} ${cs.marginLeft}`,
      gap: (cs as any).gap || 'normal',
      radii,
      boxShadow: cs.boxShadow,
      textFillSkipped,
      radiusVisible,
    };
  }

  /**
   * `offX`/`offY` are the absolute page coordinates of this document's viewport origin,
   * excluding the document's own scroll. So an element's absolute position is
   * `rect.left + offX + view.scrollX`, and descending into an iframe adds that iframe's
   * absolute content-box origin.
   */
  function visit(el: Element, path: string, labelParts: string[], offX: number, offY: number, depth: number): void {
    if (elements.length >= opts.maxElements) {
      stats.truncated = true;
      return;
    }
    if (depth > opts.maxDepth) return;
    if (SKIP_TAGS.has(el.tagName)) return;

    // Realm-safe. `instanceof SVGElement` fails for elements from an iframe's realm.
    const isSvgInner = el.namespaceURI === SVG_NS && el.localName !== 'svg';

    const view = el.ownerDocument.defaultView;
    if (!view) return;

    const r = el.getBoundingClientRect();
    const visible = typeof (el as any).checkVisibility === 'function'
      ? (el as any).checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
          contentVisibilityAuto: true,
        })
      : true;

    if (!isSvgInner && visible && r.width >= 1 && r.height >= 1) {
      // Must use the element's own window: a cross-realm element passed to the top
      // window's getComputedStyle returns garbage.
      const cs = view.getComputedStyle(el);
      const rec = record(el, cs, r, path, labelParts, r.left + offX + view.scrollX, r.top + offY + view.scrollY);
      if (rec) {
        elements.push(rec);
        stats.harvested++;
      } else {
        stats.skippedByFilter++;
      }
    } else {
      stats.skippedByFilter++;
    }

    // 1. Shadow tree, open or recovered-closed.
    const sr = el.shadowRoot ?? closedRoots?.get(el);
    if (sr) {
      stats.shadowRoots++;
      if (!el.shadowRoot) stats.closedShadowRoots++;
      const kids = sr.children;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i];
        if (!k) continue;
        visit(k, path + '::shadow>' + seg(k, i), labelParts.concat(labelSeg(k)), offX, offY, depth + 1);
      }
    }

    // 2. Same-origin iframe document. Cross-origin access throws SecurityError, and one
    //    uncaught throw would abort the entire evaluate.
    if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') {
      let doc: Document | null = null;
      try {
        doc = (el as HTMLIFrameElement).contentDocument;
      } catch {
        doc = null;
      }
      if (doc?.documentElement) {
        stats.sameOriginIframes++;
        const ics = view.getComputedStyle(el);
        const padL = parseFloat(ics.borderLeftWidth || '0') + parseFloat(ics.paddingLeft || '0');
        const padT = parseFloat(ics.borderTopWidth || '0') + parseFloat(ics.paddingTop || '0');
        const root = doc.documentElement;
        visit(
          root,
          path + '::iframe>' + root.tagName + '[0]',
          labelParts.concat('iframe', root.tagName.toLowerCase()),
          offX + r.left + view.scrollX + padL,
          offY + r.top + view.scrollY + padT,
          depth + 1,
        );
      } else {
        stats.crossOriginIframesSkipped++;
      }
    }

    // 3. Light children. Slotted nodes are visited here and only here — `slot.children` is
    //    empty because assigned nodes stay in the light tree, so no double counting.
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k) continue;
      visit(k, path + '>' + seg(k, i), labelParts.concat(labelSeg(k)), offX, offY, depth + 1);
    }
  }

  const rootEl = document.documentElement;
  visit(rootEl, rootEl.tagName + '[0]', [rootEl.tagName.toLowerCase()], 0, 0, 0);

  const body = document.body;
  return {
    elements,
    stats,
    doc: { scrollWidth: rootEl.scrollWidth, scrollHeight: rootEl.scrollHeight },
    bodyBackground: body ? getComputedStyle(body).backgroundColor : null,
  };
}
