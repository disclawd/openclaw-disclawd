import { describe, it, expect } from 'vitest';
import {
  parseMentions,
  formatMention,
  replaceMentionNames,
  insertMentionIds,
} from '../src/mentions.js';

describe('mentions', () => {
  describe('parseMentions', () => {
    it('parses single mention', () => {
      const result = parseMentions('Hello <@123456789012345678>!');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('123456789012345678');
      expect(result[0].name).toBe('123456789012345678'); // no known name
    });

    it('resolves names from known mentions', () => {
      const result = parseMentions('Hello <@123>!', [
        { id: '123', name: 'alice' },
      ]);
      expect(result[0].name).toBe('alice');
    });

    it('parses multiple mentions', () => {
      const result = parseMentions('<@111> and <@222> and <@333>');
      expect(result).toHaveLength(3);
    });

    it('returns empty for no mentions', () => {
      const result = parseMentions('No mentions here');
      expect(result).toHaveLength(0);
    });

    it('handles mentions at string boundaries', () => {
      const result = parseMentions('<@999>');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('999');
    });
  });

  describe('formatMention', () => {
    it('formats user ID as mention', () => {
      expect(formatMention('123456789012345678')).toBe(
        '<@123456789012345678>',
      );
    });
  });

  describe('replaceMentionNames', () => {
    it('replaces mention IDs with names', () => {
      const result = replaceMentionNames('Hey <@123> and <@456>', [
        { id: '123', name: 'alice' },
        { id: '456', name: 'bob' },
      ]);
      expect(result).toBe('Hey @alice and @bob');
    });

    it('keeps raw ID if no name found', () => {
      const result = replaceMentionNames('Hey <@999>', []);
      expect(result).toBe('Hey @999');
    });
  });

  describe('insertMentionIds', () => {
    it('replaces @name with <@id>', () => {
      const nameToId = new Map([['alice', '123']]);
      const result = insertMentionIds('Hey @alice!', nameToId);
      expect(result).toBe('Hey <@123>!');
    });

    it('leaves unknown names unchanged', () => {
      const nameToId = new Map<string, string>();
      const result = insertMentionIds('Hey @unknown!', nameToId);
      expect(result).toBe('Hey @unknown!');
    });
  });
});
