import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fixtureBuild, fixtureDesign } from '../fixtures/design.js';

let client: Client;
let transport: StdioClientTransport;
const RUN_ID = '20260101-000099-abcd';

beforeAll(async () => {
  const home = process.env.DESIGN_QA_HOME!;

  // Seed a complete run — check_tokens gates on both design and build — so the assertions
  // below inspect a real payload with real findings.
  const dir = join(home, 'runs', RUN_ID);
  await mkdir(dir, { recursive: true });
  const design = fixtureDesign(RUN_ID);
  await writeFile(join(dir, 'design.json'), JSON.stringify(design));
  await writeFile(join(dir, 'build.json'), JSON.stringify(fixtureBuild(RUN_ID)));
  const now = new Date().toISOString();
  await writeFile(
    join(dir, 'run.json'),
    JSON.stringify({
      runId: RUN_ID, stage: 'design', fileKey: design.fileKey, nodeId: design.nodeId,
      frameWidth: design.frameWidth, frameName: design.frameName, createdAt: now, updatedAt: now,
    }),
  );

  // Spawns the built artifact, exactly as Claude Desktop would.
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'dist', 'index.js')],
    env: { ...process.env, DESIGN_QA_HOME: home } as Record<string, string>,
  });
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(transport);
}, 120_000);

afterAll(async () => {
  await client?.close();
});

describe('tool registration', () => {
  it('exposes exactly the intended tool surface', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'build_report',
      'capture_build',
      'capture_design',
      'check_tokens',
      'dismiss_finding',
      'run_design_qa',
    ]);
  });

  it('advertises input schemas the client can validate against', async () => {
    const { tools } = await client.listTools();
    const orchestrator = tools.find((t) => t.name === 'run_design_qa')!;
    expect(orchestrator.inputSchema.required).toEqual(
      expect.arrayContaining(['figmaUrl', 'buildUrl']),
    );
    // viewportWidth is optional — it defaults to the Figma frame width.
    expect(orchestrator.inputSchema.required).not.toContain('viewportWidth');
  });
});

describe('what the model actually receives', () => {
  it('delivers the full structured payload, not just the summary line', async () => {
    const result = await client.callTool({ name: 'check_tokens', arguments: { runId: RUN_ID } });

    // The whole design depends on this: the numbers live in structuredContent and the text
    // block carries only one line. If a client dropped structuredContent, the model would
    // be left with prose and could not report anything concrete.
    expect(result.structuredContent).toBeDefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.runId).toBe(RUN_ID);
    expect(structured.counts).toBeDefined();
    expect(structured.tiers).toBeDefined();
    // Non-empty, so the payload assertions below are not vacuous.
    expect(structured.findings).toHaveLength(1);
    const finding = (structured.findings as Record<string, unknown>[])[0]!;
    expect(finding).toMatchObject({
      dimension: 'color',
      severity: 'error',
      value: '#1A73E9FF',
      nearest: '#1A73E8FF',
      occurrences: 2,
    });
  });

  it('keeps the text block to a single line to stay inside the token budget', async () => {
    const result = await client.callTool({ name: 'check_tokens', arguments: { runId: RUN_ID } });
    const content = result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe('text');
    expect(content[0]!.text.split('\n')).toHaveLength(1);
    // Must not be the object stringified a second time.
    expect(content[0]!.text).not.toContain('{');
  });

  it('never leaks machine selector paths to the model', async () => {
    const result = await client.callTool({ name: 'check_tokens', arguments: { runId: RUN_ID } });
    // Paths like HTML[0]>BODY[1]>... cost ~40 tokens each and the model cannot use them.
    expect(JSON.stringify(result)).not.toMatch(/HTML\[0\]/);
  });
});

describe('error handling over the wire', () => {
  it('returns a readable tool error rather than crashing the transport', async () => {
    const result = await client.callTool({
      name: 'check_tokens',
      arguments: { runId: '20990101-000000-ffff' },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { text: string }[];
    expect(content[0]!.text).toMatch(/capture_design first/);
  });

  it('stays alive and usable after an error', async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(6);
  });

  it('rejects a malformed runId with a validation error', async () => {
    const result = await client.callTool({ name: 'check_tokens', arguments: { runId: 'nonsense' } });
    expect(result.isError).toBe(true);
  });
});
