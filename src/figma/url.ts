export interface FigmaRef {
  fileKey: string;
  nodeId: string | null;
}

/** The API wants "1:23"; URLs carry "1-23". */
export function normalizeNodeId(raw: string): string {
  return raw.trim().replace(/-/g, ':');
}

/** For building URLs back the other way. */
export function nodeIdForUrl(raw: string): string {
  return raw.trim().replace(/:/g, '-');
}

const FILE_KEY_RE = /^[A-Za-z0-9]{10,}$/;

/**
 * Accepts a pasted figma.com URL or a bare file key. Designers paste links, not keys,
 * so both forms have to work for the zero-config promise to hold.
 */
export function parseFigmaRef(input: string, explicitNodeId?: string): FigmaRef {
  const trimmed = input.trim();
  let fileKey: string;
  let nodeId: string | null = null;

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error(`Could not parse "${input}" as a Figma URL.`);
    }
    if (!/(^|\.)figma\.com$/i.test(url.hostname)) {
      throw new Error(`"${url.hostname}" is not a figma.com URL.`);
    }
    // /file/<key>/..., /design/<key>/..., /proto/<key>/...
    const m = /\/(?:file|design|proto|board)\/([A-Za-z0-9]+)/.exec(url.pathname);
    if (!m?.[1]) throw new Error(`Could not find a file key in "${input}".`);
    fileKey = m[1];
    const nodeParam = url.searchParams.get('node-id') || url.searchParams.get('node_id');
    if (nodeParam) nodeId = normalizeNodeId(nodeParam);
  } else if (FILE_KEY_RE.test(trimmed)) {
    fileKey = trimmed;
  } else {
    throw new Error(
      `"${input}" is neither a Figma URL nor a file key. Paste the frame link from Figma (right-click the frame → Copy link to selection).`,
    );
  }

  if (explicitNodeId) nodeId = normalizeNodeId(explicitNodeId);
  return { fileKey, nodeId };
}

export function figmaNodeUrl(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}/?node-id=${nodeIdForUrl(nodeId)}`;
}
