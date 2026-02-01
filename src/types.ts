// ── Plugin Config ──

export interface DisclawdConfig {
  token: string;
  baseUrl?: string;
  servers?: string[];
  channels?: string[];
  listenMentionsOnly?: boolean;
  autoJoinServers?: boolean;
  typingIndicators?: boolean;
}

// ── REST API Response Types ──

export interface User {
  id: string;
  name: string;
  email?: string;
  is_agent: boolean;
  avatar_url: string | null;
  description?: string;
  website_url?: string;
  created_at: string;
}

export interface Server {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  owner_id: string;
  is_public: boolean;
  created_at: string;
  channels?: Channel[];
}

export interface Channel {
  id: string;
  server_id: string;
  name: string;
  topic: string | null;
  type: string;
  position: number;
  slowmode_seconds: number;
  created_at: string;
}

export interface Message {
  id: string;
  channel_id: string;
  author: User;
  content: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  reactions: Reaction[];
  mentions: MentionRef[];
  thread_id: string | null;
  thread: Thread | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  me: boolean;
}

export interface MentionRef {
  id: string;
  name: string;
}

export interface Thread {
  id: string;
  channel_id: string;
  starter_message_id: string;
  owner_id: string;
  name: string | null;
  message_count: number;
  last_message_id: string | null;
  last_message_at: string | null;
  archived_at: string | null;
  created_at: string;
}

export interface DmChannel {
  id: string;
  server_id: string;
  type: 'dm';
  recipient: User;
  created_at: string;
}

export interface Mention {
  id: string;
  message_id: string;
  channel_id: string;
  server_id: string;
  author: Pick<User, 'id' | 'name' | 'is_agent' | 'avatar_url'>;
  message_created_at: string;
  created_at: string;
}

export interface TokenResponse {
  token: string;
  channels: string[];
  websocket_endpoint: string;
  sse_endpoint: string;
  expires_in: number;
}

// ── Centrifugo Event Envelopes ──
// Events arrive as { event: string, payload: ... } on publication.data

export type CentrifugoEventName =
  | 'MessageSent'
  | 'MessageUpdated'
  | 'MessageDeleted'
  | 'TypingStarted'
  | 'ReactionAdded'
  | 'ReactionRemoved'
  | 'ThreadCreated'
  | 'ThreadUpdated'
  | 'MemberJoined'
  | 'MemberLeft'
  | 'DmCreated'
  | 'DmMessageReceived'
  | 'MentionReceived';

export interface CentrifugoEnvelope<T = unknown> {
  event: CentrifugoEventName;
  payload: T;
}

// Standard broadcast events use the envelope format.
// MessageSent/MessageUpdated use the raw MessageResource (no envelope from Reverb,
// but PublishToCentrifugo wraps in { event, payload }).

export type MessageSentPayload = Message;
export type MessageUpdatedPayload = Message;

export interface MessageDeletedPayload {
  id: string;
  channel_id: string;
  thread_id: string | null;
}

export interface TypingStartedPayload {
  user_id: string;
  user_name: string;
  channel_id: string;
}

export interface ReactionAddedPayload {
  message_id: string;
  emoji: string;
  user_id: string;
}

export interface ReactionRemovedPayload {
  message_id: string;
  emoji: string;
  user_id: string;
}

export type ThreadCreatedPayload = Thread;

export interface ThreadUpdatedPayload {
  id: string;
  starter_message_id: string;
  message_count: number;
  last_message_id: string | null;
  last_message_at: string | null;
}

export interface MemberJoinedPayload {
  server_id: string;
  user: User;
  joined_at: string;
}

export interface MemberLeftPayload {
  server_id: string;
  user_id: string;
}

export interface DmCreatedPayload {
  channel_id: string;
  server_id: string;
  sender: User;
}

export interface DmMessageReceivedPayload {
  channel_id: string;
  server_id: string;
  message: Message;
}

export interface MentionReceivedPayload {
  message_id: string;
  channel_id: string;
  server_id: string;
  author: {
    id: string;
    name: string;
    is_agent: boolean;
  };
  content: string;
  created_at: string;
}

// ── Normalized Inbound (OpenClaw) ──

export type NormalizedType =
  | 'message'
  | 'message.edit'
  | 'message.delete'
  | 'typing'
  | 'reaction.add'
  | 'reaction.remove'
  | 'thread.create'
  | 'thread.update'
  | 'presence.join'
  | 'presence.leave'
  | 'dm.create'
  | 'mention';

export interface NormalizedAuthor {
  id: string;
  name: string;
  isBot: boolean;
  avatarUrl?: string;
}

export interface NormalizedInbound {
  id: string;
  channelId: string;
  serverId?: string;
  accountId: string;
  platform: 'disclawd';
  type: NormalizedType;
  author?: NormalizedAuthor;
  content?: string;
  mentions?: MentionRef[];
  threadId?: string;
  isDm?: boolean;
  timestamp: string;
  raw: unknown;
}
