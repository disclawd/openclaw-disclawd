import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Centrifuge, Subscription } from 'centrifuge';
import WebSocket from 'ws';
import { ApiClient } from './api-client.js';
import { mapEvent, type MapperContext, type MappedEvent } from './event-mapper.js';
import type {
  CentrifugoEnvelope,
  CentrifugoEventName,
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

    // The token endpoint returns the uni_websocket URL, but centrifuge-js
    // uses the bidirectional protocol. Replace uni_websocket → websocket.
    const wsEndpoint = this.tokenResponse.websocket_endpoint.replace(
      '/uni_websocket',
      '/websocket',
    );
    this.client = new Centrifuge(wsEndpoint, {
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

// ── dscl binary gateway ──

export async function isDsclAvailable(): Promise<boolean> {
  try {
    const proc = spawn('dscl', ['--help'], { stdio: 'ignore' });
    return new Promise((resolve) => {
      proc.on('error', () => resolve(false));
      proc.on('close', (code) => resolve(code === 0));
    });
  } catch {
    return false;
  }
}

/**
 * Spawns the `dscl` binary with `--raw` and reads full Centrifugo envelopes
 * from its stdout. Falls back to CentrifugoGateway if the process fails.
 */
export class BinaryGateway {
  private proc: ChildProcess | null = null;
  private myUserId = '';
  private mapperCtx: MapperContext = { myUserId: '', accountId: '' };
  private onEvent: EventCallback = () => {};
  private onStatus: StatusCallback = () => {};

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
    // Get agent identity for the mapper context
    const me = await this.api.getMe();
    this.myUserId = me.id;
    this.mapperCtx = { myUserId: me.id, accountId: me.id };

    const serverId = this.config.servers?.[0];
    if (!serverId) {
      throw new Error('BinaryGateway requires at least one server ID');
    }

    const args = [
      '--token', this.config.token,
      '--server', serverId,
      '--raw',
    ];

    if (this.config.baseUrl) {
      args.push('--base-url', this.config.baseUrl);
    }

    this.proc = spawn('dscl', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.proc.on('error', (err) => {
      this.onStatus('disconnected', `dscl spawn error: ${err.message}`);
    });

    this.proc.on('close', (code) => {
      this.onStatus('disconnected', `dscl exited with code ${code}`);
      this.proc = null;
    });

    // Read stderr for status messages
    if (this.proc.stderr) {
      const stderrRl = createInterface({ input: this.proc.stderr });
      stderrRl.on('line', (line) => {
        if (line.includes('websocket connected')) {
          this.onStatus('connected');
        } else if (line.includes('websocket disconnected')) {
          this.onStatus('disconnected', line);
        }
      });
    }

    // Read stdout for raw JSON envelope lines
    if (this.proc.stdout) {
      const stdoutRl = createInterface({ input: this.proc.stdout });
      stdoutRl.on('line', (line) => {
        try {
          const raw = JSON.parse(line) as {
            event: CentrifugoEventName;
            payload: unknown;
            channel: string;
          };
          const envelope: CentrifugoEnvelope = {
            event: raw.event,
            payload: raw.payload,
          };
          const result = mapEvent(envelope, this.mapperCtx, raw.channel);
          if (!result) return;
          this.onEvent(result.normalized);
        } catch {
          // Ignore malformed lines
        }
      });
    }
  }

  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = null;
    }
  }

  async addChannel(_channel: string): Promise<void> {
    // dscl auto-discovers channels; no-op here
  }

  async removeChannel(_channel: string): Promise<void> {
    // dscl manages its own subscriptions; no-op here
  }
}
