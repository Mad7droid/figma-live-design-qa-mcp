import { SESSION_IDLE_MS } from '../config.js';
import { log } from '../log.js';
import type { Connection } from './connect.js';

interface Entry {
  connection: Connection;
  timer: NodeJS.Timeout;
}

const sessions = new Map<string, Entry>();

/**
 * Keep the captured page alive so build_report can take element-clipped screenshots.
 * Re-finding an element on the live page is trivial; reconstructing it after the page is
 * gone is not, and a re-navigated page may render different dynamic content.
 */
export function keepSession(runId: string, connection: Connection): void {
  closeSession(runId);
  const timer = setTimeout(() => {
    log.debug('session idle-expired', runId);
    void closeSession(runId);
  }, SESSION_IDLE_MS);
  timer.unref?.();
  sessions.set(runId, { connection, timer });
}

export function getSession(runId: string): Connection | null {
  const entry = sessions.get(runId);
  if (!entry) return null;
  if (entry.connection.page.isClosed()) {
    void closeSession(runId);
    return null;
  }
  // Touch the idle timer so an active run does not expire mid-report.
  entry.timer.refresh?.();
  return entry.connection;
}

export async function closeSession(runId: string): Promise<void> {
  const entry = sessions.get(runId);
  if (!entry) return;
  sessions.delete(runId);
  clearTimeout(entry.timer);
  await teardown(entry.connection);
}

async function teardown(connection: Connection): Promise<void> {
  await connection.page.close().catch(() => {});
  // Only close a browser we launched. Closing a CDP-attached browser would quit the
  // user's own Chrome along with every tab they had open.
  if (connection.ownsBrowser) {
    await connection.context.close().catch(() => {});
    await connection.browser?.close().catch(() => {});
  }
}

export async function closeAllSessions(): Promise<void> {
  await Promise.all([...sessions.keys()].map((runId) => closeSession(runId)));
}
