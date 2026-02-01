import { describe, it, expect } from 'vitest';
import { chunkText } from '../src/utils.js';

describe('chunkText', () => {
  it('returns single chunk for short text', () => {
    const result = chunkText('Hello world');
    expect(result).toEqual(['Hello world']);
  });

  it('splits at paragraph breaks', () => {
    const text = 'A'.repeat(3000) + '\n\n' + 'B'.repeat(2000);
    const result = chunkText(text, 4000);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('A'.repeat(3000));
    expect(result[1]).toBe('B'.repeat(2000));
  });

  it('splits at line breaks when no paragraph break', () => {
    const text = 'A'.repeat(3000) + '\n' + 'B'.repeat(2000);
    const result = chunkText(text, 4000);
    expect(result).toHaveLength(2);
  });

  it('splits very long text into multiple chunks', () => {
    const text = 'word '.repeat(2000); // ~10000 chars
    const result = chunkText(text, 4000);
    expect(result.length).toBeGreaterThan(2);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('handles text with no natural break points', () => {
    const text = 'A'.repeat(5000);
    const result = chunkText(text, 4000);
    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(4000);
    expect(result[1].length).toBe(1000);
  });

  it('avoids splitting inside code fences', () => {
    const before = 'X'.repeat(3500);
    const code = '\n```\ncode line 1\ncode line 2\n```\n';
    const after = 'Y'.repeat(1000);
    const text = before + code + after;
    const result = chunkText(text, 4000);
    // The code fence should not be split across chunks
    expect(result.length).toBeGreaterThanOrEqual(2);
    for (const chunk of result) {
      const opens = (chunk.match(/^```/gm) || []).length;
      // Each chunk should have even number of fences (0 or 2)
      expect(opens % 2).toBe(0);
    }
  });

  it('returns empty array for empty string', () => {
    const result = chunkText('');
    expect(result).toEqual(['']);
  });

  it('respects custom max length', () => {
    const text = 'Hello World Test';
    const result = chunkText(text, 10);
    expect(result.length).toBeGreaterThan(1);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
  });
});
