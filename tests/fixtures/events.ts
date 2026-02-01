import type {
  CentrifugoEnvelope,
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
} from '../../src/types.js';

export const OTHER_USER_ID = '858320438953122700';
export const MY_USER_ID = '858320438953122799';
export const CHANNEL_ID = '858320438953122712';
export const SERVER_ID = '858320438953122600';
export const THREAD_ID = '858320438953122800';
export const MESSAGE_ID = '858320438953122900';

const otherUser = {
  id: OTHER_USER_ID,
  name: 'alice',
  is_agent: false,
  avatar_url: null,
  created_at: '2025-01-15T10:30:00Z',
};

const myUser = {
  id: MY_USER_ID,
  name: 'my-agent',
  is_agent: true,
  avatar_url: null,
  created_at: '2025-01-15T10:00:00Z',
};

export const messageSent: CentrifugoEnvelope<MessageSentPayload> = {
  event: 'MessageSent',
  payload: {
    id: MESSAGE_ID,
    channel_id: CHANNEL_ID,
    author: otherUser,
    content: `Hello <@${MY_USER_ID}> how are you?`,
    edited_at: null,
    deleted_at: null,
    created_at: '2025-01-15T10:35:00Z',
    reactions: [],
    mentions: [{ id: MY_USER_ID, name: 'my-agent' }],
    thread_id: null,
    thread: null,
  },
};

export const messageSentSelf: CentrifugoEnvelope<MessageSentPayload> = {
  event: 'MessageSent',
  payload: {
    ...messageSent.payload,
    id: '858320438953122901',
    author: myUser,
    content: 'My own message',
    mentions: [],
  },
};

export const messageUpdated: CentrifugoEnvelope<MessageUpdatedPayload> = {
  event: 'MessageUpdated',
  payload: {
    ...messageSent.payload,
    content: 'Edited content',
    edited_at: '2025-01-15T10:36:00Z',
  },
};

export const messageDeleted: CentrifugoEnvelope<MessageDeletedPayload> = {
  event: 'MessageDeleted',
  payload: {
    id: MESSAGE_ID,
    channel_id: CHANNEL_ID,
    thread_id: null,
  },
};

export const typingStarted: CentrifugoEnvelope<TypingStartedPayload> = {
  event: 'TypingStarted',
  payload: {
    user_id: OTHER_USER_ID,
    user_name: 'alice',
    channel_id: CHANNEL_ID,
  },
};

export const typingStartedSelf: CentrifugoEnvelope<TypingStartedPayload> = {
  event: 'TypingStarted',
  payload: {
    user_id: MY_USER_ID,
    user_name: 'my-agent',
    channel_id: CHANNEL_ID,
  },
};

export const reactionAdded: CentrifugoEnvelope<ReactionAddedPayload> = {
  event: 'ReactionAdded',
  payload: {
    message_id: MESSAGE_ID,
    emoji: '👍',
    user_id: OTHER_USER_ID,
  },
};

export const reactionRemoved: CentrifugoEnvelope<ReactionRemovedPayload> = {
  event: 'ReactionRemoved',
  payload: {
    message_id: MESSAGE_ID,
    emoji: '👍',
    user_id: OTHER_USER_ID,
  },
};

export const threadCreated: CentrifugoEnvelope<ThreadCreatedPayload> = {
  event: 'ThreadCreated',
  payload: {
    id: THREAD_ID,
    channel_id: CHANNEL_ID,
    starter_message_id: MESSAGE_ID,
    owner_id: OTHER_USER_ID,
    name: 'Discussion',
    message_count: 1,
    last_message_id: MESSAGE_ID,
    last_message_at: '2025-01-15T10:45:00Z',
    archived_at: null,
    created_at: '2025-01-15T10:45:00Z',
  },
};

export const threadUpdated: CentrifugoEnvelope<ThreadUpdatedPayload> = {
  event: 'ThreadUpdated',
  payload: {
    id: THREAD_ID,
    starter_message_id: MESSAGE_ID,
    message_count: 5,
    last_message_id: '858320438953122950',
    last_message_at: '2025-01-15T11:00:00Z',
  },
};

export const memberJoined: CentrifugoEnvelope<MemberJoinedPayload> = {
  event: 'MemberJoined',
  payload: {
    server_id: SERVER_ID,
    user: otherUser,
    joined_at: '2025-01-15T10:30:00Z',
  },
};

export const memberLeft: CentrifugoEnvelope<MemberLeftPayload> = {
  event: 'MemberLeft',
  payload: {
    server_id: SERVER_ID,
    user_id: OTHER_USER_ID,
  },
};

export const dmCreated: CentrifugoEnvelope<DmCreatedPayload> = {
  event: 'DmCreated',
  payload: {
    channel_id: '858320438953123000',
    server_id: SERVER_ID,
    sender: otherUser,
  },
};

export const dmMessageReceived: CentrifugoEnvelope<DmMessageReceivedPayload> = {
  event: 'DmMessageReceived',
  payload: {
    channel_id: '858320438953123000',
    server_id: SERVER_ID,
    message: {
      id: '858320438953123001',
      channel_id: '858320438953123000',
      author: otherUser,
      content: 'Hey there!',
      edited_at: null,
      deleted_at: null,
      created_at: '2025-01-15T10:50:00Z',
      reactions: [],
      mentions: [],
      thread_id: null,
      thread: null,
    },
  },
};

export const mentionReceived: CentrifugoEnvelope<MentionReceivedPayload> = {
  event: 'MentionReceived',
  payload: {
    message_id: MESSAGE_ID,
    channel_id: CHANNEL_ID,
    server_id: SERVER_ID,
    author: {
      id: OTHER_USER_ID,
      name: 'alice',
      is_agent: false,
    },
    content: `Hey <@${MY_USER_ID}> can you help?`,
    created_at: '2025-01-15T10:35:00Z',
  },
};
