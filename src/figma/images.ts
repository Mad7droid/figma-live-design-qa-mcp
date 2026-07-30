import { log } from '../log.js';
import { fetchBinary, figmaGet } from './client.js';

interface ImagesResponse {
  err?: string | null;
  images: Record<string, string | null>;
}

/**
 * Render Figma nodes as PNGs. The endpoint returns short-lived S3 URLs which then have to
 * be fetched separately.
 */
export async function renderNodes(
  fileKey: string,
  nodeIds: string[],
  scale = 1,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (nodeIds.length === 0) return out;

  const ids = [...new Set(nodeIds)];
  let res: ImagesResponse;
  try {
    res = await figmaGet<ImagesResponse>(
      `/v1/images/${encodeURIComponent(fileKey)}?ids=${ids.map(encodeURIComponent).join(',')}` +
        `&format=png&scale=${scale}`,
    );
  } catch (err) {
    log.warn('Figma image render failed', (err as Error).message);
    return out;
  }

  if (res.err) {
    log.warn('Figma image render returned an error', res.err);
    return out;
  }

  for (const [id, url] of Object.entries(res.images ?? {})) {
    if (!url) continue;
    try {
      const buffer = await fetchBinary(url);
      out.set(id, buffer.toString('base64'));
    } catch (err) {
      log.warn(`could not fetch rendered image for ${id}`, (err as Error).message);
    }
  }
  return out;
}
