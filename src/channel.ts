import { ApiClient } from './api-client.js';
import { CentrifugoGateway, BinaryGateway, isDsclAvailable, type EventCallback, type StatusCallback } from './centrifugo.js';
import { OutboundService } from './outbound.js';
import { parseMentions, replaceMentionNames, formatMention } from './mentions.js';
import type { DisclawdConfig, AccountConfig, NormalizedInbound } from './types.js';

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
    defaultAccountId: (cfg: any) => string;
  };
  gateway: {
    start: (cfg: DisclawdConfig, callbacks: GatewayCallbacks) => Promise<void>;
    stop: () => Promise<void>;
    login: (credentials: { token?: string; name?: string; description?: string }) => Promise<{ token: string }>;
  };
  outbound: {
    deliveryMode: string;
    sendText: (params: { channelId: string; text: string; threadId?: string; accountId?: string }) => Promise<{ ok: boolean; messageIds: string[] }>;
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

// ── Per-account runtime ──

interface AccountRuntime {
  api: ApiClient;
  gateway: CentrifugoGateway | BinaryGateway;
  outbound: OutboundService;
  userId: string;
  accountId: string;
}

const runtimes = new Map<string, AccountRuntime>();
let dsclAvailable: boolean | null = null;

// ── Account resolution helpers ──

function resolveAccountEntries(cfg: DisclawdConfig): Array<{ accountId: string; token: string; servers?: string[]; channels?: string[] }> {
  const entries: Array<{ accountId: string; token: string; servers?: string[]; channels?: string[] }> = [];

  if (cfg.accounts) {
    for (const [id, acct] of Object.entries(cfg.accounts)) {
      if (acct.enabled === false) continue;
      entries.push({
        accountId: id,
        token: acct.token,
        servers: acct.servers ?? cfg.servers,
        channels: acct.channels ?? cfg.channels,
      });
    }
  }

  // If no accounts defined, treat top-level token as the "default" account
  if (entries.length === 0 && cfg.token) {
    entries.push({
      accountId: 'default',
      token: cfg.token,
      servers: cfg.servers,
      channels: cfg.channels,
    });
  }

  return entries;
}

function getRuntime(accountId?: string): AccountRuntime {
  if (accountId && runtimes.has(accountId)) {
    return runtimes.get(accountId)!;
  }
  // Fall back to first runtime (default account)
  const first = runtimes.values().next();
  if (first.done) throw new Error('Gateway not started');
  return first.value;
}

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
    listAccountIds: (cfg: DisclawdConfig) => {
      const entries = resolveAccountEntries(cfg);
      return entries.map((e) => e.accountId);
    },

    resolveAccount: async (cfg: DisclawdConfig, accountId?: string) => {
      const entries = resolveAccountEntries(cfg);
      const entry = entries.find((e) => e.accountId === accountId) ?? entries[0];
      if (!entry) return null;

      const client = new ApiClient({ token: entry.token, baseUrl: cfg.baseUrl });
      let me;
      try {
        me = await client.getMe();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[disclawd] Failed to resolve account "${entry.accountId}": ${msg}`);
        return null;
      }
      return {
        id: me.id,
        accountId: entry.accountId,
        name: me.name,
        isBot: me.is_agent,
        avatarUrl: me.avatar_url,
      };
    },

    defaultAccountId: () => 'default',
  },

  gateway: {
    async start(cfg: DisclawdConfig, callbacks: GatewayCallbacks) {
      const entries = resolveAccountEntries(cfg);
      if (entries.length === 0) throw new Error('No accounts configured');

      // Check dscl availability once
      if (dsclAvailable === null) {
        dsclAvailable = await isDsclAvailable();
      }

      const errors: Array<{ accountId: string; error: Error }> = [];

      for (const entry of entries) {
        try {
          const api = new ApiClient({ token: entry.token, baseUrl: cfg.baseUrl });
          const outbound = new OutboundService(api, cfg.typingIndicators ?? true);

          const accountCfg: DisclawdConfig = {
            ...cfg,
            token: entry.token,
            servers: entry.servers,
            channels: entry.channels,
            safetyWrap: cfg.safetyWrap,
          };

          const useBinary = entry.servers?.length && dsclAvailable;
          const gateway = useBinary
            ? new BinaryGateway(api, accountCfg)
            : new CentrifugoGateway(api, accountCfg);

          gateway.setEventCallback((event) => {
            try {
              // Ensure accountId matches the account key, not the Disclawd user ID
              callbacks.onEvent({ ...event, accountId: entry.accountId });
            } catch (err) {
              console.error(`[disclawd] Error in event callback for account "${entry.accountId}":`, err);
            }
          });
          gateway.setStatusCallback(callbacks.onStatus);

          await gateway.start();

          const userId = gateway.getMyUserId();
          runtimes.set(entry.accountId, { api, gateway, outbound, userId, accountId: entry.accountId });
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          errors.push({ accountId: entry.accountId, error });
          callbacks.onStatus('disconnected', `Account "${entry.accountId}" failed to start: ${error.message}`);
        }
      }

      // If ALL accounts failed, throw so the gateway reports an error.
      // If only some failed, keep running with the ones that succeeded.
      if (runtimes.size === 0 && errors.length > 0) {
        throw new Error(
          `All Disclawd accounts failed to start:\n${errors.map((e) => `  ${e.accountId}: ${e.error.message}`).join('\n')}`,
        );
      }
    },

    async stop() {
      for (const rt of runtimes.values()) {
        rt.outbound.stopAll();
        await rt.gateway.stop();
      }
      runtimes.clear();
      dsclAvailable = null;
    },

    async login(credentials) {
      if (credentials.token) {
        return { token: credentials.token };
      }
      const res = await fetch('https://disclawd.com/api/v1/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: credentials.name,
          description: credentials.description,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Agent registration failed (${res.status}): ${text}`);
      }
      const data = await res.json();
      if (!data.token) {
        throw new Error('Agent registration response missing token');
      }
      return { token: data.token };
    },
  },

  outbound: {
    deliveryMode: 'direct',

    async sendText({ channelId, text, threadId, accountId }) {
      const rt = getRuntime(accountId);
      const messages = await rt.outbound.sendText(channelId, text, { threadId });
      return {
        ok: true,
        messageIds: messages.map((m) => m.id),
      };
    },
  },

  threading: {
    async createThread(channelId, messageId, name?) {
      const rt = getRuntime();
      const thread = await rt.api.createThread(channelId, messageId, name);
      return { threadId: thread.id };
    },

    async replyInThread(threadId, text) {
      const rt = getRuntime();
      const messages = await rt.outbound.sendText(threadId, text, { threadId });
      return {
        ok: true,
        messageIds: messages.map((m) => m.id),
      };
    },
  },

  actions: {
    async react(channelId, messageId, emoji) {
      const rt = getRuntime();
      await rt.outbound.addReaction(channelId, messageId, emoji);
    },

    async unreact(channelId, messageId, emoji) {
      const rt = getRuntime();
      await rt.outbound.removeReaction(channelId, messageId, emoji);
    },

    async edit(channelId, messageId, content) {
      const rt = getRuntime();
      await rt.outbound.editMessage(channelId, messageId, content);
    },

    async delete(channelId, messageId) {
      const rt = getRuntime();
      await rt.outbound.deleteMessage(channelId, messageId);
    },
  },

  mentions: {
    parse: parseMentions,
    format: formatMention,
    replaceWithNames: replaceMentionNames,
  },
};
