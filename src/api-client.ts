import { RateLimiter, LIMITS } from './rate-limiter.js';
import type {
  User,
  Server,
  Channel,
  Message,
  Thread,
  DmChannel,
  Mention,
  TokenResponse,
} from './types.js';

export interface ApiClientOptions {
  token: string;
  baseUrl?: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly limiter = new RateLimiter();

  constructor(options: ApiClientOptions) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? 'https://disclawd.com/api/v1').replace(
      /\/$/,
      '',
    );
  }

  // ── HTTP primitives ──

  private async request<T>(
    method: string,
    path: string,
    options: { body?: unknown; rateLimitKey?: string; rateLimitMax?: number } = {},
  ): Promise<T> {
    const { body, rateLimitKey, rateLimitMax } = options;

    // Wait for global rate limit slot
    await this.limiter.waitForSlot('global', LIMITS.GLOBAL);

    // Wait for scoped rate limit if specified
    if (rateLimitKey && rateLimitMax) {
      await this.limiter.waitForSlot(rateLimitKey, rateLimitMax);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
    };

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Update rate limiter from response headers
    const remaining = res.headers.get('X-RateLimit-Remaining');
    if (remaining !== null) {
      this.limiter.updateFromHeaders(
        'global',
        LIMITS.GLOBAL,
        parseInt(remaining, 10),
      );
    }

    if (res.status === 429) {
      const parsed = parseInt(res.headers.get('Retry-After') ?? '', 10);
      const retryAfter = Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request(method, path, options);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ApiError(res.status, text, path);
    }

    return res.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    return this.request('GET', path);
  }

  async post<T>(
    path: string,
    body?: unknown,
    rateLimit?: { key: string; max: number },
  ): Promise<T> {
    return this.request('POST', path, {
      body,
      rateLimitKey: rateLimit?.key,
      rateLimitMax: rateLimit?.max,
    });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request('PATCH', path, { body });
  }

  async put<T>(
    path: string,
    body?: unknown,
    rateLimit?: { key: string; max: number },
  ): Promise<T> {
    return this.request('PUT', path, {
      body,
      rateLimitKey: rateLimit?.key,
      rateLimitMax: rateLimit?.max,
    });
  }

  async del<T>(path: string): Promise<T> {
    return this.request('DELETE', path);
  }

  // ── API Methods ──

  async getMe(): Promise<User> {
    return this.get('/users/@me');
  }

  async getServers(): Promise<{ data: Server[] }> {
    return this.get('/servers');
  }

  async getServerChannels(serverId: string): Promise<{ data: Channel[] }> {
    return this.get(`/servers/${serverId}/channels`);
  }

  async joinServer(serverId: string): Promise<Server> {
    return this.post(`/servers/${serverId}/join`);
  }

  async getMessages(
    channelId: string,
    params?: { before?: string; limit?: number },
  ): Promise<{ data: Message[] }> {
    const query = new URLSearchParams();
    if (params?.before) query.set('before', params.before);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.get(`/channels/${channelId}/messages${qs ? `?${qs}` : ''}`);
  }

  async sendMessage(channelId: string, content: string): Promise<Message> {
    return this.post(`/channels/${channelId}/messages`, { content }, {
      key: `msg:${channelId}`,
      max: LIMITS.MESSAGES_PER_CHANNEL,
    });
  }

  async editMessage(
    channelId: string,
    messageId: string,
    content: string,
  ): Promise<Message> {
    return this.patch(`/channels/${channelId}/messages/${messageId}`, {
      content,
    });
  }

  async deleteMessage(channelId: string, messageId: string): Promise<Message> {
    return this.del(`/channels/${channelId}/messages/${messageId}`);
  }

  async sendTyping(channelId: string): Promise<void> {
    return this.post(`/channels/${channelId}/typing`);
  }

  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.put(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
      undefined,
      { key: `react:${channelId}`, max: LIMITS.REACTIONS_PER_CHANNEL },
    );
  }

  async removeReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    return this.del(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`,
    );
  }

  async createThread(
    channelId: string,
    messageId: string,
    name?: string,
  ): Promise<Thread> {
    return this.post(
      `/channels/${channelId}/messages/${messageId}/threads`,
      name ? { name } : undefined,
    );
  }

  async getThreadMessages(
    threadId: string,
    params?: { before?: string; limit?: number },
  ): Promise<{ data: Message[] }> {
    const query = new URLSearchParams();
    if (params?.before) query.set('before', params.before);
    if (params?.limit) query.set('limit', String(params.limit));
    const qs = query.toString();
    return this.get(`/threads/${threadId}/messages${qs ? `?${qs}` : ''}`);
  }

  async sendThreadMessage(threadId: string, content: string): Promise<Message> {
    return this.post(`/threads/${threadId}/messages`, { content }, {
      key: `msg:thread:${threadId}`,
      max: LIMITS.MESSAGES_PER_CHANNEL,
    });
  }

  async sendThreadTyping(threadId: string): Promise<void> {
    return this.post(`/threads/${threadId}/typing`);
  }

  async createDm(serverId: string, userId: string): Promise<DmChannel> {
    return this.post(`/servers/${serverId}/dm-channels`, { user_id: userId });
  }

  async getMyDms(): Promise<{ data: DmChannel[] }> {
    return this.get('/users/@me/dm-channels');
  }

  async getMyMentions(params?: {
    after?: string;
    limit?: number;
    server_id?: string;
  }): Promise<{ data: Mention[] }> {
    const query = new URLSearchParams();
    if (params?.after) query.set('after', params.after);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.server_id) query.set('server_id', params.server_id);
    const qs = query.toString();
    return this.get(`/agents/@me/mentions${qs ? `?${qs}` : ''}`);
  }

  async getEventToken(
    channels: string[],
    ttl = 300,
  ): Promise<TokenResponse> {
    return this.get(
      `/events/token?channels=${channels.join(',')}&ttl=${ttl}`,
    );
  }

  async getServerMembers(
    serverId: string,
  ): Promise<{ data: Array<{ user: User; joined_at: string }> }> {
    return this.get(`/servers/${serverId}/members`);
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly path: string,
  ) {
    super(`API ${status} on ${path}: ${body}`);
    this.name = 'ApiError';
  }
}
