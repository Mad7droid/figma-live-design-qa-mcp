import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'pages');

export interface StaticServer {
  origin: string;
  close: () => Promise<void>;
}

/** Serves the fixture pages. Two instances give us a genuine cross-origin iframe. */
export async function startServer(replacements: Record<string, string> = {}): Promise<StaticServer> {
  const server: Server = createServer(async (req, res) => {
    const name = (req.url || '/').split('?')[0]!.replace(/^\//, '') || 'index.html';
    try {
      let body = await readFile(join(PAGES, name), 'utf8');
      for (const [token, value] of Object.entries(replacements)) {
        body = body.split(token).join(value);
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server did not bind a port');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
