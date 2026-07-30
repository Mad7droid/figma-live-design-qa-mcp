/**
 * stdout is the JSON-RPC channel. Everything diagnostic goes to stderr, always.
 * `src/index.ts` additionally redirects console.log/info/debug to stderr so that a stray
 * write from a transitive dependency cannot corrupt the protocol stream.
 */
function emit(level: string, msg: string, extra?: unknown): void {
  const line = `[figma-live-design-qa-mcp] ${level} ${msg}`;
  if (extra === undefined) process.stderr.write(line + '\n');
  else process.stderr.write(`${line} ${safe(extra)}\n`);
}

function safe(v: unknown): string {
  try {
    return typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const log = {
  info: (msg: string, extra?: unknown) => emit('info', msg, extra),
  warn: (msg: string, extra?: unknown) => emit('warn', msg, extra),
  error: (msg: string, extra?: unknown) => emit('error', msg, extra),
  debug: (msg: string, extra?: unknown) => {
    if (process.env.DESIGN_QA_DEBUG) emit('debug', msg, extra);
  },
};
