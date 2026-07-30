import { describe, expect, it } from 'vitest';

import { normalizeNodeId, parseFigmaRef } from '../../src/figma/url.js';

describe('parseFigmaRef', () => {
  it('accepts the link a designer copies out of Figma', () => {
    const ref = parseFigmaRef('https://www.figma.com/design/abc123XYZ890/Some-File?node-id=12-34&t=x');
    expect(ref.fileKey).toBe('abc123XYZ890');
    // URLs carry "12-34"; the REST API wants "12:34".
    expect(ref.nodeId).toBe('12:34');
  });

  it('accepts the older /file/ and /proto/ URL shapes', () => {
    expect(parseFigmaRef('https://figma.com/file/abc123XYZ890/X?node-id=1%3A2').nodeId).toBe('1:2');
    expect(parseFigmaRef('https://figma.com/proto/abc123XYZ890/X').fileKey).toBe('abc123XYZ890');
  });

  it('accepts a bare file key', () => {
    const ref = parseFigmaRef('abc123XYZ890');
    expect(ref.fileKey).toBe('abc123XYZ890');
    expect(ref.nodeId).toBeNull();
  });

  it('lets an explicit nodeId win over the one in the link', () => {
    const ref = parseFigmaRef('https://figma.com/design/abc123XYZ890/X?node-id=1-2', '9-9');
    expect(ref.nodeId).toBe('9:9');
  });

  it('rejects non-Figma URLs rather than guessing', () => {
    expect(() => parseFigmaRef('https://example.com/design/abc123XYZ890')).toThrow(/not a figma\.com URL/);
  });

  it('gives an actionable error for unparseable input', () => {
    expect(() => parseFigmaRef('nope')).toThrow(/Copy link to selection/);
  });
});

describe('normalizeNodeId', () => {
  it('converts URL node ids to API node ids', () => {
    expect(normalizeNodeId('12-34')).toBe('12:34');
    expect(normalizeNodeId('12:34')).toBe('12:34');
  });
});
