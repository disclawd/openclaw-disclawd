import { ApiClient } from './api-client.js';
import { CentrifugoGateway, type EventCallback, type StatusCallback } from './centrifugo.js';
import { OutboundService } from './outbound.js';
import { parseMentions, replaceMentionNames, formatMention } from './mentions.js';
import type { DisclawdConfig, NormalizedInbound } from './types.js';

export interface DisclawdChannel {
  id: string;
  meta: {
    id: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases: string[];
  };
  capabilities: {
    chatTypes: string[];
  };
  config: {
    listAccountIds: (cfg: any) => string[];
    resolveAccount: (cfg: any, accountId?: string) => Promise<any>;
  };
  gateway: {
    start: (cfg: DisclawdConfig, callbacks: GatewayCallbacks) => Promise<void>;
    stop: () => Promise<void>;
    login: (credentials: { token?: string; name?: string; description?: string }) => Promise<{ token: string }>;
  };
  outbound: {
    deliveryMode: string;
    sendText: (params: { channelId: string; text: string; threadId?: string }) => Promise<{ ok: boolean; messageIds: string[] }>;
  };
  threading: {
    createThread: (channelId: string, messageId: string, name?: string) => Promise<{ threadId: string }>;
    replyInThread: (threadId: string, text: string) => Promise<{ ok: boolean; messageIds: string[] }>;
  };
  actions: {
    react: (channelId: string, messageId: string, emoji: string) => Promise<void>;
    unreact: (channelId: string, messageId: string, emoji: string) => Promise<void>;
    edit: (channelId: string, messageId: string, content: string) => Promise<void>;
    delete: (channelId: string, messageId: string) => Promise<void>;
  };
  mentions: {
    parse: (content: string, known?: Array<{ id: string; name: string }>) => Array<{ id: string; name: string }>;
    format: (userId: string) => string;
    replaceWithNames: (content: string, mentions: Array<{ id: string; name: string }>) => string;
  };
}

interface GatewayCallbacks {
  onEvent: EventCallback;
  onStatus: StatusCallback;
}

let api: ApiClient | null = null;
let gateway: CentrifugoGateway | null = null;
let outbound: OutboundService | null = null;
let cachedAccountIds: string[] = [];

export const disclawdChannel: DisclawdChannel = {
  id: 'disclawd',

  meta: {
    id: 'disclawd',
    label: 'Disclawd',
    selectionLabel: 'Disclawd (WebSocket)',
    docsPath: '/channels/disclawd',
    blurb: 'Connect to Disclawd — a Discord-like platform for AI agents',
    aliases: ['dscl'],
  },

  capabilities: {
    chatTypes: ['direct', 'group'],
  },

  config: {
    listAccountIds: () => cachedAccountIds,
    resolveAccount: async (cfg: DisclawdConfig, _accountId?: string) => {
      const client = new ApiClient({ token: cfg.token, baseUrl: cfg.baseUrl });
      const me = await client.getMe();
      cachedAccountIds = [me.id];
      return {
        id: me.id,
        name: me.name,
        isBot: me.is_agent,
        avatarUrl: me.avatar_url,
      };
    },
  },

  gateway: {
    async start(cfg: DisclawdConfig, callbacks: GatewayCallbacks) {
      api = new ApiClient({ token: cfg.token, baseUrl: cfg.baseUrl });
      gateway = new CentrifugoGateway(api, cfg);
      outbound = new OutboundService(api, cfg.typingIndicators ?? true);

      gateway.setEventCallback(callbacks.onEvent);
      gateway.setStatusCallback(callbacks.onStatus);
      await gateway.start();
    },

    async stop() {
      outbound?.stopAll();
      await gateway?.stop();
      api = null;
      gateway = null;
      outbound = null;
    },

    async login(credentials) {
      if (credentials.token) {
        return { token: credentials.token };
      }
      // Self-register new agent
      const res = await fetch('https://disclawd.com/api/v1/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: credentials.name,
          description: credentials.description,
        }),
      });
      const data = await res.json();
      return { token: data.token };
    },
  },

  outbound: {
    deliveryMode: 'direct',

    async sendText({ channelId, text, threadId }) {
      if (!outbound) throw new Error('Gateway not started');
      const messages = await outbound.sendText(channelId, text, { threadId });
      return {
        ok: true,
        messageIds: messages.map((m) => m.id),
      };
    },
  },

  threading: {
    async createThread(channelId, messageId, name?) {
      if (!api) throw new Error('Gateway not started');
      const thread = await api.createThread(channelId, messageId, name);
      return { threadId: thread.id };
    },

    async replyInThread(threadId, text) {
      if (!outbound) throw new Error('Gateway not started');
      const messages = await outbound.sendText(threadId, text, { threadId });
      return {
        ok: true,
        messageIds: messages.map((m) => m.id),
      };
    },
  },

  actions: {
    async react(channelId, messageId, emoji) {
      if (!outbound) throw new Error('Gateway not started');
      await outbound.addReaction(channelId, messageId, emoji);
    },

    async unreact(channelId, messageId, emoji) {
      if (!outbound) throw new Error('Gateway not started');
      await outbound.removeReaction(channelId, messageId, emoji);
    },

    async edit(channelId, messageId, content) {
      if (!outbound) throw new Error('Gateway not started');
      await outbound.editMessage(channelId, messageId, content);
    },

    async delete(channelId, messageId) {
      if (!outbound) throw new Error('Gateway not started');
      await outbound.deleteMessage(channelId, messageId);
    },
  },

  mentions: {
    parse: parseMentions,
    format: formatMention,
    replaceWithNames: replaceMentionNames,
  },
};
