import type { MentionRef } from './types.js';

const MENTION_REGEX = /<@(\d+)>/g;

export function parseMentions(
  content: string,
  knownMentions?: MentionRef[],
): MentionRef[] {
  const found: MentionRef[] = [];
  const knownMap = new Map(knownMentions?.map((m) => [m.id, m.name]));
  let match;

  MENTION_REGEX.lastIndex = 0;
  while ((match = MENTION_REGEX.exec(content)) !== null) {
    const id = match[1];
    found.push({
      id,
      name: knownMap.get(id) ?? id,
    });
  }

  return found;
}

export function formatMention(userId: string): string {
  return `<@${userId}>`;
}

export function replaceMentionNames(
  content: string,
  mentions: MentionRef[],
): string {
  const mentionMap = new Map(mentions.map((m) => [m.id, m.name]));
  MENTION_REGEX.lastIndex = 0;
  return content.replace(MENTION_REGEX, (_, id: string) => {
    const name = mentionMap.get(id);
    return name ? `@${name}` : `@${id}`;
  });
}

export function insertMentionIds(
  content: string,
  nameToId: Map<string, string>,
): string {
  return content.replace(/@(\w[\w-]*)/g, (original, name: string) => {
    const id = nameToId.get(name.toLowerCase());
    return id ? `<@${id}>` : original;
  });
}
