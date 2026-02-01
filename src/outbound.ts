import { ApiClient } from './api-client.js';
import { chunkText, sleep } from './utils.js';
import type { Message } from './types.js';

const TYPING_INTERVAL_MS = 7_000;
const CHUNK_DELAY_MS = 200;

export class OutboundService {
  private typingTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(
    private readonly api: ApiClient,
    private readonly sendTypingIndicators: boolean,
  ) {}

  async sendText(
    channelId: string,
    text: string,
    options?: { threadId?: string },
  ): Promise<Message[]> {
    const target = options?.threadId ?? channelId;
    const isThread = !!options?.threadId;
    const messages: Message[] = [];

    if (this.sendTypingIndicators) {
      await this.startTyping(target, isThread);
    }

    try {
      const chunks = chunkText(text);
      for (let i = 0; i < chunks.length; i++) {
        const msg = isThread
          ? await this.api.sendThreadMessage(target, chunks[i])
          : await this.api.sendMessage(target, chunks[i]);
        messages.push(msg);

        if (i < chunks.length - 1) {
          await sleep(CHUNK_DELAY_MS);
        }
      }
    } finally {
      this.stopTyping(target);
    }

    return messages;
  }

  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<Message> {
    return this.api.editMessage(channelId, messageId, content);
  }

  async deleteMessage(
    channelId: string,
    messageId: string,
  ): Promise<Message> {
    return this.api.deleteMessage(channelId, messageId);
  }

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.api.addReaction(channelId, messageId, emoji);
  }

  async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.api.removeReaction(channelId, messageId, emoji);
  }

  async createThread(
    channelId: string,
    messageId: string,
    name?: string,
  ) {
    return this.api.createThread(channelId, messageId, name);
  }

  private async startTyping(target: string, isThread: boolean): Promise<void> {
    const send = () =>
      isThread
        ? this.api.sendThreadTyping(target).catch(() => {})
        : this.api.sendTyping(target).catch(() => {});

    await send();

    // Re-send typing every 7s to keep the indicator alive
    const timer = setInterval(send, TYPING_INTERVAL_MS);
    this.typingTimers.set(target, timer);
  }

  private stopTyping(target: string): void {
    const timer = this.typingTimers.get(target);
    if (timer) {
      clearInterval(timer);
      this.typingTimers.delete(target);
    }
  }

  stopAll(): void {
    for (const timer of this.typingTimers.values()) {
      clearInterval(timer);
    }
    this.typingTimers.clear();
  }
}
