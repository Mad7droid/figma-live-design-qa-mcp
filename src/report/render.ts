import type { BuildDoc, DesignDoc, Finding, FindingsDoc, Severity } from '../types.js';

/**
 * Page text and node names end up in this file. Unescaped they corrupt the markup and
 * are an injection vector in a document people open locally and forward around.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface RenderInput {
  design: DesignDoc;
  build: BuildDoc;
  findings: FindingsDoc;
  buildCrops: Map<string, string[]>;
  figmaCrops: Map<string, { base64: string; nodeName: string }[]>;
  /** Full-frame render from Figma's image API, including image fills and placed assets. */
  figmaPreview: string | null;
  generatedAt: string;
}

const SEVERITY_LABEL: Record<Severity, string> = { error: 'Error', warn: 'Warning', info: 'Info' };

/** A hex8 canonical value shown as an actual swatch. CSS, not an image — far smaller. */
function swatch(value: string | null): string {
  if (!value || !/^#[0-9A-F]{8}$/i.test(value)) return '';
  const css = `#${value.slice(1, 7)}`;
  const alpha = parseInt(value.slice(7, 9), 16) / 255;
  return `<span class="sw" style="background:${css};opacity:${alpha.toFixed(2)}"></span>`;
}

function tierBadge(dimension: string, tier: string): string {
  return `<span class="badge t-${esc(tier)}">${esc(dimension)}: ${esc(tier)}</span>`;
}

function findingBlock(f: Finding, input: RenderInput): string {
  const crops = input.buildCrops.get(f.hash) ?? [];
  const figma = input.figmaCrops.get(f.hash) ?? [];
  const distance =
    f.distance < 0 ? '—' : `${f.distance} ${f.distanceUnit === 'deltaE2000' ? 'ΔE' : f.distanceUnit}`;

  const images = crops.length || figma.length
    ? `<details class="imgs"><summary>Show ${crops.length} build crop${crops.length === 1 ? '' : 's'}${
        figma.length ? ` and ${figma.length} design reference${figma.length === 1 ? '' : 's'}` : ''
      }</summary>
        <div class="strip">
          ${crops.map((b64, i) => `<figure><img src="data:image/jpeg;base64,${b64}" alt="Build element ${i + 1}"><figcaption>In the build — ${esc(f.sampleLabels[i] ?? '')}</figcaption></figure>`).join('')}
          ${figma.map((img) => `<figure><img src="data:image/png;base64,${img.base64}" alt="Design node ${esc(img.nodeName)}"><figcaption>${esc(f.nearest)} is used here in the design — ${esc(img.nodeName)}</figcaption></figure>`).join('')}
        </div>
      </details>`
    : '';

  return `<article class="finding sev-${esc(f.severity)}">
    <header>
      <span class="sev">${esc(SEVERITY_LABEL[f.severity])}</span>
      <span class="dim">${esc(f.dimension)}</span>
      <span class="count">${f.occurrences} occurrence${f.occurrences === 1 ? '' : 's'}</span>
      ${tierBadge('from', f.tier)}
    </header>
    <div class="values">
      <div class="v"><label>In the build</label><div>${swatch(f.value)}<code>${esc(f.value)}</code></div></div>
      <div class="arrow">→</div>
      <div class="v"><label>Nearest design token</label><div>${swatch(f.nearest)}<code>${esc(f.nearest ?? 'none')}</code></div></div>
      <div class="v"><label>Distance</label><div><code>${esc(distance)}</code></div></div>
    </div>
    <p class="where">Where: <code>${esc(f.label || f.commonAncestor)}</code></p>
    ${f.notes.length ? `<ul class="notes">${f.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    ${images}
    <p class="dismiss">Not a bug? Paste into Claude:
      <code>dismiss_finding(runId: "${esc(input.findings.runId)}", findingHash: "${esc(f.hash)}")</code></p>
  </article>`;
}

export function renderReport(input: RenderInput): string {
  const { design, build, findings } = input;
  const groups: Severity[] = ['error', 'warn', 'info'];

  const notVerified = findings.notVerified.length
    ? `<section class="nv"><h2>Not verified</h2><ul>${findings.notVerified
        .map((n) => `<li><strong>${esc(n.dimension)}</strong> — ${esc(n.reason)}</li>`)
        .join('')}</ul>
       <p class="muted">These dimensions produced no findings on purpose. A missed issue is
       cheaper than a wrong one.</p></section>`
    : '';

  const body = groups
    .map((sev) => {
      const list = findings.findings.filter((f) => f.severity === sev);
      if (!list.length) return '';
      return `<section class="group"><h2>${esc(SEVERITY_LABEL[sev])} (${list.length})</h2>
        ${list.map((f) => findingBlock(f, input)).join('')}</section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Design QA — ${esc(design.frameName)}</title>
<style>
:root{--bg:#fbfbfa;--fg:#1a1a19;--muted:#6b6b68;--line:#e4e4e1;--card:#fff;
--error:#b3261e;--warn:#8a5a00;--info:#3a5c8a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
font:15px/1.55 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.wrap{max-width:940px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:16px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);
margin:36px 0 12px}
.meta{color:var(--muted);font-size:13px;margin:0 0 20px}
.meta a{color:inherit}
.summary{display:flex;gap:20px;flex-wrap:wrap;padding:14px 16px;background:var(--card);
border:1px solid var(--line);border-radius:10px;margin-bottom:8px}
.summary div{font-size:13px}.summary strong{display:block;font-size:20px}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0 0}
.badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--line);
background:var(--card);color:var(--muted)}
.t-bound,.t-variables-api{border-color:#bcd8bc;color:#2f6b2f}
.t-frequency,.t-bound-partial{border-color:#e0d3ac;color:#7a5c12}
.t-not_verified{border-color:#d8d8d8;color:#8a8a8a}
.nv{background:#fffaf0;border:1px solid #eadfc2;border-radius:10px;padding:4px 18px 14px;margin-top:28px}
.nv h2{margin-top:16px}
.finding{background:var(--card);border:1px solid var(--line);border-left-width:4px;
border-radius:10px;padding:14px 16px;margin-bottom:12px}
.sev-error{border-left-color:var(--error)}.sev-warn{border-left-color:var(--warn)}
.sev-info{border-left-color:var(--info)}
.finding header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
.sev{font-weight:650;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.sev-error .sev{color:var(--error)}.sev-warn .sev{color:var(--warn)}.sev-info .sev{color:var(--info)}
.dim{font-size:12px;color:var(--muted);border:1px solid var(--line);padding:1px 7px;border-radius:20px}
.count{font-size:12px;color:var(--muted)}
.values{display:flex;gap:18px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px}
.values label{display:block;font-size:11px;color:var(--muted);margin-bottom:3px}
.values .v>div{display:flex;align-items:center;gap:7px}
.arrow{color:var(--muted);padding-bottom:2px}
.sw{width:17px;height:17px;border-radius:4px;border:1px solid rgba(0,0,0,.18);display:inline-block}
code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f3f3f1;
padding:1px 5px;border-radius:4px}
.where{margin:6px 0;font-size:13px;color:var(--muted)}
.notes{margin:6px 0;padding-left:18px;font-size:13px;color:var(--muted)}
.dismiss{margin:10px 0 0;font-size:12px;color:var(--muted)}
.imgs{margin-top:10px}
.imgs summary{cursor:pointer;font-size:13px;color:var(--muted)}
.strip{display:flex;gap:12px;overflow-x:auto;padding:12px 2px 2px}
.strip figure{margin:0;flex:0 0 auto;max-width:320px}
.strip img{max-width:320px;max-height:240px;border:1px solid var(--line);border-radius:6px;display:block}
.strip figcaption{font-size:11px;color:var(--muted);margin-top:5px;max-width:320px}
.reference{margin:28px 0}.reference h2{margin:0 0 12px}.reference figure{margin:0}
.reference img{max-width:100%;max-height:720px;object-fit:contain;object-position:top left;
border:1px solid var(--line);border-radius:8px;display:block;background:#fff}
.reference figcaption{font-size:11px;color:var(--muted);margin-top:6px}
.muted{color:var(--muted);font-size:13px}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);
color:var(--muted);font-size:12px}
</style></head><body><div class="wrap">
<h1>${esc(design.frameName)}</h1>
<p class="meta">
  ${esc(build.finalUrl)} &middot; ${build.viewport.width}px viewport &middot;
  measured via ${esc(build.auth.method)} &middot; ${esc(input.generatedAt)}
</p>
${build.auth.loginWall ? `<p class="nv">⚠ This page looked like a sign-in page. The findings below may describe the wrong page.</p>` : ''}
${build.stats.truncated ? `<p class="nv">⚠ The page exceeded the element budget and was measured only in part, so this report may under-report. Findings shown are still accurate.</p>` : ''}
<div class="summary">
  <div><strong>${findings.counts.error}</strong>errors</div>
  <div><strong>${findings.counts.warn}</strong>warnings</div>
  <div><strong>${findings.counts.info}</strong>info</div>
  <div><strong>${findings.counts.elementsScanned}</strong>elements measured</div>
  <div><strong>${design.nodes.length}</strong>design nodes</div>
  <div><strong>${findings.counts.suppressed}</strong>suppressed</div>
</div>
${input.figmaPreview
    ? `<section class="reference"><h2>Figma reference</h2>
<figure><img src="data:image/png;base64,${input.figmaPreview}" alt="Figma reference frame"><figcaption>The selected Figma frame, rendered directly by the Figma API.</figcaption></figure></section>`
    : ''}
<div class="badges">${Object.entries(findings.tiers).map(([d, t]) => tierBadge(d, t)).join('')}</div>
${notVerified}
${body || '<section class="group"><h2>No deviations found</h2><p class="muted">Every measured value matched the design token set.</p></section>'}
<footer>
  Values are measured, never eyeballed: colours are compared with CIEDE2000, everything
  else numerically. Token set derived from ${esc(design.variablesSource)}.
  Run ${esc(findings.runId)}.
</footer>
</div></body></html>`;
}
