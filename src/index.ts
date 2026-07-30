#!/usr/bin/env node
/**
 * stdout is the JSON-RPC channel. A single stray write from any dependency corrupts the
 * protocol stream and the server dies with an unhelpful parse error, so redirect the
 * console writers to stderr before anything else is imported or run.
 */
console.log = console.error;
console.info = console.error;
console.debug = console.error;

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { closeAllSessions } from './browser/session.js';
import { log } from './log.js';
import { gcRuns } from './store/run.js';
import { buildReport } from './tools/build-report.js';
import { captureBuild } from './tools/capture-build.js';
import { captureDesign } from './tools/capture-design.js';
import { checkTokens } from './tools/check-tokens.js';
import { dismissFinding } from './tools/dismiss-finding.js';
import { runDesignQa } from './tools/orchestrate.js';

const server = new McpServer({ name: 'figma-live-design-qa-mcp', version: '0.1.0' });

/**
 * With an outputSchema declared the client receives `structuredContent`, so the text block
 * carries only the one-line summary. Stringifying the whole object into `content` as well
 * would double the token cost of every single call.
 */
type Reply = { content: { type: 'text'; text: string }[]; structuredContent: Record<string, unknown> };

function reply<T extends { summary: string }>(result: T): Reply {
  return {
    content: [{ type: 'text', text: result.summary }],
    structuredContent: result as unknown as Record<string, unknown>,
  };
}

function failure(err: unknown): Reply & { isError: true } {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { error: message, summary: message },
    isError: true,
  };
}

async function guard<T extends { summary: string }>(fn: () => Promise<T>): Promise<Reply> {
  try {
    return reply(await fn());
  } catch (err) {
    return failure(err);
  }
}

const runIdSchema = z.string().describe('The runId returned by capture_design.');

server.registerTool(
  'run_design_qa',
  {
    title: 'Run design QA',
    description:
      'End-to-end design QA: measures a Figma frame and a live page, then writes an HTML report. ' +
      'Give it a Figma frame link and the URL of the built page. Runs capture_design, capture_build, ' +
      'check_tokens and build_report in sequence. On failure it returns the runId so the remaining ' +
      'steps can be run individually.',
    inputSchema: {
      figmaUrl: z.string().describe('Figma frame link, e.g. https://figma.com/design/<key>/...?node-id=1-23'),
      buildUrl: z.string().describe('URL of the built page to measure.'),
      viewportWidth: z.number().optional().describe('Defaults to the Figma frame width.'),
    },
  },
  async (args) => guard(() => runDesignQa(args)),
);

server.registerTool(
  'capture_design',
  {
    title: 'Capture Figma design',
    description:
      'Fetch a Figma frame and derive its design token set. Accepts a pasted Figma frame link or a ' +
      'bare file key plus nodeId. Writes the flattened node list to disk and returns a runId. ' +
      'Never returns the node tree.',
    inputSchema: {
      figma: z.string().describe('Figma frame link, or a bare file key.'),
      nodeId: z.string().optional().describe('Node id, if not already in the link. "1-23" or "1:23".'),
    },
  },
  async (args) => guard(() => captureDesign(args)),
);

server.registerTool(
  'capture_build',
  {
    title: 'Capture built page',
    description:
      'Measure the live page in the user\'s own browser session, piercing shadow DOM and same-origin ' +
      'iframes. Reuses a running Chrome over CDP, else a copy of the Chrome profile. Never asks for ' +
      'or stores credentials. Viewport width defaults to the Figma frame width from the same run.',
    inputSchema: {
      runId: runIdSchema,
      url: z.string().describe('URL of the built page.'),
      viewportWidth: z.number().optional(),
    },
  },
  async (args) => guard(() => captureBuild(args)),
);

server.registerTool(
  'check_tokens',
  {
    title: 'Check design tokens',
    description:
      'Compare every colour, font size, font weight and border radius in the build against the ' +
      'design token set. Returns findings grouped by value, capped at 50, with severities. ' +
      'Dimensions where no token set could be inferred are reported as "not verified" rather ' +
      'than guessed at.',
    inputSchema: { runId: runIdSchema },
  },
  async (args) => guard(() => checkTokens(args)),
);

server.registerTool(
  'build_report',
  {
    title: 'Build HTML report',
    description:
      'Write a self-contained HTML report with all images inlined, plus report.json. Opens offline ' +
      'and can be shared directly. Returns the absolute path.',
    inputSchema: { runId: runIdSchema },
  },
  async (args) => guard(() => buildReport(args)),
);

server.registerTool(
  'dismiss_finding',
  {
    title: 'Dismiss a finding',
    description:
      'Add a finding to the baseline for its Figma file so it is suppressed on all future runs.',
    inputSchema: {
      runId: runIdSchema,
      findingHash: z.string().describe('The hash from check_tokens or the report.'),
      reason: z.string().optional().describe('Why this is not a bug. Recorded in the baseline.'),
    },
  },
  async (args) => guard(() => dismissFinding(args)),
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`shutting down (${signal})`);
  // Closes pages always, but only closes browsers we launched ourselves — tearing down a
  // CDP-attached browser would quit the user's Chrome and every tab in it.
  await closeAllSessions();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

async function main(): Promise<void> {
  await gcRuns().catch((err) => log.warn('run gc failed', (err as Error).message));
  await server.connect(new StdioServerTransport());
  log.info('figma-live-design-qa-mcp server ready on stdio');
}

main().catch((err) => {
  log.error('fatal', err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
