import { describe, it, expect } from 'vitest';
import { mapEvent, type MapperContext } from '../src/event-mapper.js';
import * as fixtures from './fixtures/events.js';

const ctx: MapperContext = {
  myUserId: fixtures.MY_USER_ID,
  accountId: fixtures.MY_USER_ID,
};

const channelSub = `private-channel.${fixtures.CHANNEL_ID}`;
const serverSub = `private-server.${fixtures.SERVER_ID}`;
const userSub = `private-user.${fixtures.MY_USER_ID}`;

describe('event-mapper', () => {
  // ── MessageSent ──

  it('maps MessageSent to message', () => {
    const result = mapEvent(fixtures.messageSent, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('message');
    expect(result!.normalized.id).toBe(fixtures.MESSAGE_ID);
    expect(result!.normalized.channelId).toBe(fixtures.CHANNEL_ID);
    expect(result!.normalized.author?.name).toBe('alice');
    expect(result!.normalized.author?.isBot).toBe(false);
    expect(result!.normalized.content).toContain('Hello');
    expect(result!.normalized.mentions).toHaveLength(1);
    expect(result!.normalized.platform).toBe('disclawd');
  });

  it('filters self-echo on MessageSent', () => {
    const result = mapEvent(fixtures.messageSentSelf, ctx, channelSub);
    expect(result).toBeNull();
  });

  // ── MessageUpdated ──

  it('maps MessageUpdated to message.edit', () => {
    const result = mapEvent(fixtures.messageUpdated, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('message.edit');
    expect(result!.normalized.content).toBe('Edited content');
    expect(result!.normalized.timestamp).toBe('2025-01-15T10:36:00Z');
  });

  // ── MessageDeleted ──

  it('maps MessageDeleted to message.delete', () => {
    const result = mapEvent(fixtures.messageDeleted, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('message.delete');
    expect(result!.normalized.id).toBe(fixtures.MESSAGE_ID);
    expect(result!.normalized.channelId).toBe(fixtures.CHANNEL_ID);
  });

  // ── TypingStarted ──

  it('maps TypingStarted to typing', () => {
    const result = mapEvent(fixtures.typingStarted, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('typing');
    expect(result!.normalized.author?.name).toBe('alice');
  });

  it('filters self-echo on TypingStarted', () => {
    const result = mapEvent(fixtures.typingStartedSelf, ctx, channelSub);
    expect(result).toBeNull();
  });

  // ── Reactions ──

  it('maps ReactionAdded to reaction.add', () => {
    const result = mapEvent(fixtures.reactionAdded, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('reaction.add');
    expect(result!.normalized.content).toBe('👍');
    expect(result!.normalized.channelId).toBe(fixtures.CHANNEL_ID);
  });

  it('maps ReactionRemoved to reaction.remove', () => {
    const result = mapEvent(fixtures.reactionRemoved, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('reaction.remove');
  });

  // ── Threads ──

  it('maps ThreadCreated with auto-subscribe', () => {
    const result = mapEvent(fixtures.threadCreated, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('thread.create');
    expect(result!.normalized.threadId).toBe(fixtures.THREAD_ID);
    expect(result!.autoSubscribe).toBe(`thread.${fixtures.THREAD_ID}`);
  });

  it('maps ThreadUpdated', () => {
    const result = mapEvent(fixtures.threadUpdated, ctx, channelSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('thread.update');
    expect(result!.normalized.threadId).toBe(fixtures.THREAD_ID);
  });

  // ── Presence ──

  it('maps MemberJoined to presence.join', () => {
    const result = mapEvent(fixtures.memberJoined, ctx, serverSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('presence.join');
    expect(result!.normalized.serverId).toBe(fixtures.SERVER_ID);
    expect(result!.normalized.author?.name).toBe('alice');
  });

  it('maps MemberLeft to presence.leave', () => {
    const result = mapEvent(fixtures.memberLeft, ctx, serverSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('presence.leave');
    expect(result!.normalized.author?.id).toBe(fixtures.OTHER_USER_ID);
  });

  // ── DMs ──

  it('maps DmCreated with auto-subscribe', () => {
    const result = mapEvent(fixtures.dmCreated, ctx, userSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('dm.create');
    expect(result!.normalized.isDm).toBe(true);
    expect(result!.normalized.author?.name).toBe('alice');
    expect(result!.autoSubscribe).toBe('channel.858320438953123000');
  });

  it('maps DmMessageReceived to message with isDm', () => {
    const result = mapEvent(fixtures.dmMessageReceived, ctx, userSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('message');
    expect(result!.normalized.isDm).toBe(true);
    expect(result!.normalized.content).toBe('Hey there!');
  });

  // ── MentionReceived ──

  it('maps MentionReceived to mention', () => {
    const result = mapEvent(fixtures.mentionReceived, ctx, userSub);
    expect(result).not.toBeNull();
    expect(result!.normalized.type).toBe('mention');
    expect(result!.normalized.channelId).toBe(fixtures.CHANNEL_ID);
    expect(result!.normalized.serverId).toBe(fixtures.SERVER_ID);
    expect(result!.normalized.content).toContain('can you help');
  });

  // ── Unknown events ──

  it('returns null for unknown events', () => {
    const result = mapEvent(
      { event: 'UnknownEvent' as any, payload: {} },
      ctx,
      channelSub,
    );
    expect(result).toBeNull();
  });

  // ── Channel ID resolution ──

  it('resolves channelId from Centrifugo channel for reactions', () => {
    const result = mapEvent(fixtures.reactionAdded, ctx, `private-channel.${fixtures.CHANNEL_ID}`);
    expect(result!.normalized.channelId).toBe(fixtures.CHANNEL_ID);
  });
});
