const MAX_MESSAGE_LENGTH = 4000;

export function chunkText(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    const breakpoint = findBreakpoint(remaining, maxLen);
    chunks.push(remaining.slice(0, breakpoint).trimEnd());
    remaining = remaining.slice(breakpoint).trimStart();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findBreakpoint(text: string, maxLen: number): number {
  const slice = text.slice(0, maxLen);

  // Check if we're inside a code fence — avoid splitting mid-fence
  const fenceCount = (slice.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) {
    // Odd number of fences means we're inside a code block.
    // Find the opening fence and break before it.
    const lastFenceStart = slice.lastIndexOf('\n```');
    if (lastFenceStart > 0) {
      return lastFenceStart;
    }
  }

  // Prefer paragraph break
  const paraBreak = slice.lastIndexOf('\n\n');
  if (paraBreak > maxLen * 0.3) return paraBreak + 2;

  // Prefer line break
  const lineBreak = slice.lastIndexOf('\n');
  if (lineBreak > maxLen * 0.3) return lineBreak + 1;

  // Prefer sentence end
  const sentenceEnd = findLastSentenceEnd(slice);
  if (sentenceEnd > maxLen * 0.3) return sentenceEnd;

  // Prefer word boundary
  const wordBreak = slice.lastIndexOf(' ');
  if (wordBreak > maxLen * 0.3) return wordBreak + 1;

  // Hard break at max length
  return maxLen;
}

function findLastSentenceEnd(text: string): number {
  const match = text.match(/[.!?]\s+\S/g);
  if (!match) return -1;

  // Find the position of the last sentence-ending punctuation followed by space
  let pos = -1;
  let searchFrom = 0;
  for (const m of match) {
    const idx = text.indexOf(m, searchFrom);
    if (idx >= 0) {
      pos = idx + 2; // after punctuation and space
      searchFrom = idx + 1;
    }
  }
  return pos;
}

export function encodeEmoji(emoji: string): string {
  return encodeURIComponent(emoji);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
