import type {
  CentrifugoEnvelope,
  CentrifugoEventName,
  MessageSentPayload,
  MessageUpdatedPayload,
  MessageDeletedPayload,
  TypingStartedPayload,
  ReactionAddedPayload,
  ReactionRemovedPayload,
  ThreadCreatedPayload,
  ThreadUpdatedPayload,
  MemberJoinedPayload,
  MemberLeftPayload,
  DmCreatedPayload,
  DmMessageReceivedPayload,
  MentionReceivedPayload,
  NormalizedInbound,
  NormalizedAuthor,
  User,
} from './types.js';

export interface MapperContext {
  myUserId: string;
  accountId: string;
}

export interface MappedEvent {
  normalized: NormalizedInbound;
  autoSubscribe?: string; // channel ID to dynamically subscribe to
}

function mapAuthor(user: User | { id: string; name: string; is_agent: boolean }): NormalizedAuthor {
  return {
    id: user.id,
    name: user.name,
    isBot: user.is_agent,
    avatarUrl: 'avatar_url' in user ? (user.avatar_url ?? undefined) : undefined,
  };
}

type EventHandler = (
  payload: any,
  ctx: MapperContext,
  centrifugoChannel: string,
) => MappedEvent | null;

const handlers: Record<CentrifugoEventName, EventHandler> = {
  MessageSent(payload: MessageSentPayload, ctx, channel) {
    if (payload.author.id === ctx.myUserId) return null;
    return {
      normalized: {
        id: payload.id,
        channelId: payload.channel_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'message',
        author: mapAuthor(payload.author),
        content: payload.content ?? undefined,
        mentions: payload.mentions,
        threadId: payload.thread_id ?? undefined,
        isDm: undefined,
        timestamp: payload.created_at,
        raw: payload,
      },
    };
  },

  MessageUpdated(payload: MessageUpdatedPayload, ctx) {
    if (payload.author.id === ctx.myUserId) return null;
    return {
      normalized: {
        id: payload.id,
        channelId: payload.channel_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'message.edit',
        author: mapAuthor(payload.author),
        content: payload.content ?? undefined,
        mentions: payload.mentions,
        threadId: payload.thread_id ?? undefined,
        timestamp: payload.edited_at ?? payload.created_at,
        raw: payload,
      },
    };
  },

  MessageDeleted(payload: MessageDeletedPayload, ctx) {
    return {
      normalized: {
        id: payload.id,
        channelId: payload.channel_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'message.delete',
        threadId: payload.thread_id ?? undefined,
        timestamp: new Date().toISOString(),
        raw: payload,
      },
    };
  },

  TypingStarted(payload: TypingStartedPayload, ctx) {
    if (payload.user_id === ctx.myUserId) return null;
    return {
      normalized: {
        id: `typing:${payload.user_id}:${payload.channel_id}`,
        channelId: payload.channel_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'typing',
        author: {
          id: payload.user_id,
          name: payload.user_name,
          isBot: false,
        },
        timestamp: new Date().toISOString(),
        raw: payload,
      },
    };
  },

  ReactionAdded(payload: ReactionAddedPayload, ctx) {
    if (payload.user_id === ctx.myUserId) return null;
    return {
      normalized: {
        id: `reaction:${payload.message_id}:${payload.emoji}:${payload.user_id}`,
        channelId: '', // channel not in payload, caller should resolve from subscription
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'reaction.add',
        content: payload.emoji,
        timestamp: new Date().toISOString(),
        raw: payload,
      },
    };
  },

  ReactionRemoved(payload: ReactionRemovedPayload, ctx) {
    if (payload.user_id === ctx.myUserId) return null;
    return {
      normalized: {
        id: `reaction:${payload.message_id}:${payload.emoji}:${payload.user_id}`,
        channelId: '',
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'reaction.remove',
        content: payload.emoji,
        timestamp: new Date().toISOString(),
        raw: payload,
      },
    };
  },

  ThreadCreated(payload: ThreadCreatedPayload, ctx) {
    return {
      normalized: {
        id: payload.id,
        channelId: payload.channel_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'thread.create',
        threadId: payload.id,
        timestamp: payload.created_at,
        raw: payload,
      },
      autoSubscribe: `thread.${payload.id}`,
    };
  },

  ThreadUpdated(payload: ThreadUpdatedPayload, ctx) {
    return {
      normalized: {
        id: payload.id,
        channelId: '',
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'thread.update',
        threadId: payload.id,
        timestamp: payload.last_message_at ?? new Date().toISOString(),
        raw: payload,
      },
    };
  },

  MemberJoined(payload: MemberJoinedPayload, ctx) {
    return {
      normalized: {
        id: `join:${payload.user.id}:${payload.server_id}`,
        channelId: '',
        serverId: payload.server_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'presence.join',
        author: mapAuthor(payload.user),
        timestamp: payload.joined_at,
        raw: payload,
      },
    };
  },

  MemberLeft(payload: MemberLeftPayload, ctx) {
    return {
      normalized: {
        id: `leave:${payload.user_id}:${payload.server_id}`,
        channelId: '',
        serverId: payload.server_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'presence.leave',
        author: { id: payload.user_id, name: '', isBot: false },
        timestamp: new Date().toISOString(),
        raw: payload,
      },
    };
  },

  DmCreated(payload: DmCreatedPayload, ctx) {
    return {
      normalized: {
        id: `dm:${payload.channel_id}`,
        channelId: payload.channel_id,
        serverId: payload.server_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'dm.create',
        author: mapAuthor(payload.sender),
        isDm: true,
        timestamp: new Date().toISOString(),
        raw: payload,
      },
      autoSubscribe: `channel.${payload.channel_id}`,
    };
  },

  DmMessageReceived(payload: DmMessageReceivedPayload, ctx) {
    if (payload.message.author.id === ctx.myUserId) return null;
    return {
      normalized: {
        id: payload.message.id,
        channelId: payload.channel_id,
        serverId: payload.server_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'message',
        author: mapAuthor(payload.message.author),
        content: payload.message.content ?? undefined,
        mentions: payload.message.mentions,
        isDm: true,
        timestamp: payload.message.created_at,
        raw: payload,
      },
    };
  },

  MentionReceived(payload: MentionReceivedPayload, ctx) {
    if (payload.author.id === ctx.myUserId) return null;
    return {
      normalized: {
        id: `mention:${payload.message_id}`,
        channelId: payload.channel_id,
        serverId: payload.server_id,
        accountId: ctx.accountId,
        platform: 'disclawd',
        type: 'mention',
        author: mapAuthor(payload.author),
        content: payload.content,
        timestamp: payload.created_at,
        raw: payload,
      },
    };
  },
};

export function mapEvent(
  envelope: CentrifugoEnvelope,
  ctx: MapperContext,
  centrifugoChannel: string,
): MappedEvent | null {
  const handler = handlers[envelope.event];
  if (!handler) return null;

  const result = handler(envelope.payload, ctx, centrifugoChannel);

  // For reactions, resolve channelId from the Centrifugo channel name
  if (result && !result.normalized.channelId) {
    const match = centrifugoChannel.match(/private-(?:channel|thread)\.(\d+)/);
    if (match) {
      result.normalized.channelId = match[1];
    }
  }

  return result;
}
