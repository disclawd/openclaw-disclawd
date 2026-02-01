import { Centrifuge, Subscription } from 'centrifuge';
import WebSocket from 'ws';
import { ApiClient } from './api-client.js';
import { mapEvent, type MapperContext, type MappedEvent } from './event-mapper.js';
import type {
  CentrifugoEnvelope,
  DisclawdConfig,
  TokenResponse,
  NormalizedInbound,
} from './types.js';

export type EventCallback = (event: NormalizedInbound) => void;
export type StatusCallback = (status: 'connected' | 'disconnected', reason?: string) => void;

export class CentrifugoGateway {
  private client: Centrifuge | null = null;
  private subscriptions = new Map<string, Subscription>();
  private requestedChannels = new Set<string>(); // without private- prefix
  private myUserId = '';
  private mapperCtx: MapperContext = { myUserId: '', accountId: '' };
  private onEvent: EventCallback = () => {};
  private onStatus: StatusCallback = () => {};
  private tokenResponse: TokenResponse | null = null;

  constructor(
    private readonly api: ApiClient,
    private readonly config: DisclawdConfig,
  ) {}

  setEventCallback(cb: EventCallback): void {
    this.onEvent = cb;
  }

  setStatusCallback(cb: StatusCallback): void {
    this.onStatus = cb;
  }

  getMyUserId(): string {
    return this.myUserId;
  }

  async start(): Promise<void> {
    // 1. Get agent identity
    const me = await this.api.getMe();
    this.myUserId = me.id;
    this.mapperCtx = { myUserId: me.id, accountId: me.id };

    // 2. Build channel list
    this.requestedChannels.clear();
    this.requestedChannels.add(`user.${me.id}`);

    if (!this.config.listenMentionsOnly) {
      if (this.config.servers?.length) {
        for (const serverId of this.config.servers) {
          if (this.config.autoJoinServers) {
            await this.api.joinServer(serverId).catch(() => {}); // ignore if already joined
          }
          this.requestedChannels.add(`server.${serverId}`);
          const { data: channels } = await this.api.getServerChannels(serverId);
          for (const ch of channels) {
            this.requestedChannels.add(`channel.${ch.id}`);
          }
        }
      }

      if (this.config.channels?.length) {
        for (const chId of this.config.channels) {
          this.requestedChannels.add(`channel.${chId}`);
        }
      }
    }

    // 3. Get token and connect
    await this.connect();
  }

  async stop(): Promise<void> {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.requestedChannels.clear();
    this.client?.disconnect();
    this.client = null;
  }

  async addChannel(channel: string): Promise<void> {
    if (this.requestedChannels.has(channel)) return;
    this.requestedChannels.add(channel);

    // Refresh token to include the new channel
    const tok = await this.api.getEventToken(
      Array.from(this.requestedChannels),
    );
    this.tokenResponse = tok;

    // Add subscription
    const prefixed = tok.channels.find((c) => c.endsWith(channel.replace(/^(channel|server|thread|user)\./, '.$1.')));
    const subName = `private-${channel}`;
    if (!this.subscriptions.has(subName) && this.client) {
      const sub = this.client.newSubscription(subName);
      this.wireSubscription(sub, subName);
      sub.subscribe();
      this.subscriptions.set(subName, sub);
    }
  }

  async removeChannel(channel: string): Promise<void> {
    this.requestedChannels.delete(channel);
    const subName = `private-${channel}`;
    const sub = this.subscriptions.get(subName);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(subName);
    }
  }

  private async connect(): Promise<void> {
    const channelList = Array.from(this.requestedChannels);
    this.tokenResponse = await this.api.getEventToken(channelList);

    this.client = new Centrifuge(this.tokenResponse.websocket_endpoint, {
      token: this.tokenResponse.token,
      websocket: WebSocket as any,
      getToken: async () => {
        const tok = await this.api.getEventToken(
          Array.from(this.requestedChannels),
        );
        this.tokenResponse = tok;
        return tok.token;
      },
    });

    this.client.on('connected', () => {
      this.onStatus('connected');
    });

    this.client.on('disconnected', (ctx) => {
      this.onStatus('disconnected', ctx.reason);
    });

    // Create subscriptions for all authorized channels
    for (const channel of this.tokenResponse.channels) {
      const sub = this.client.newSubscription(channel);
      this.wireSubscription(sub, channel);
      sub.subscribe();
      this.subscriptions.set(channel, sub);
    }

    this.client.connect();
  }

  private wireSubscription(sub: Subscription, channel: string): void {
    sub.on('publication', (ctx) => {
      const data = ctx.data as CentrifugoEnvelope;
      const result = mapEvent(data, this.mapperCtx, channel);
      if (!result) return;

      this.onEvent(result.normalized);

      // Handle auto-subscribe requests (new threads, new DMs)
      if (result.autoSubscribe) {
        this.addChannel(result.autoSubscribe).catch(() => {});
      }
    });
  }
}
