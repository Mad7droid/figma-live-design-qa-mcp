import { describe, expect, it } from 'vitest';

import { findingHash } from '../../src/analyze/hash.js';

describe('findingHash', () => {
  it('is pinned — changing it silently invalidates every existing baseline', () => {
    expect(findingHash('color', '#1A73E8FF')).toBe('dq-9a6640315ccc');
    expect(findingHash('borderRadius', 'pill')).toBe('dq-a20e0410f60d');
    expect(findingHash('fontSize', '15.5px')).toBe('dq-456625f99bc2');
  });

  it('depends only on dimension and value', () => {
    // Everything volatile is excluded on purpose: paths, text, coordinates, occurrence
    // counts, the URL, the timestamp, and the nearest allowed value. A live page carries
    // real dynamic data, so any of those would resurrect dismissed findings between runs.
    expect(findingHash('color', '#1A73E8FF')).toBe(findingHash('color', '#1A73E8FF'));
  });

  it('separates the same value seen in different dimensions', () => {
    expect(findingHash('fontSize', '16px')).not.toBe(findingHash('borderRadius', '16px'));
  });

  it('changes when the offending value changes', () => {
    expect(findingHash('color', '#1A73E8FF')).not.toBe(findingHash('color', '#1A73E9FF'));
  });
});
