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
    this.mapperCtx = { myUserId: me.id, accountId: me.id, safetyWrap: this.config.safetyWrap };

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
          try {
            const { data: channels } = await this.api.getServerChannels(serverId);
            for (const ch of channels) {
              this.requestedChannels.add(`channel.${ch.id}`);
            }
          } catch {
            // Server may be inaccessible; continue with server-level subscription only
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
    this.client?.removeAllListeners();
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
        try {
          const tok = await this.api.getEventToken(
            Array.from(this.requestedChannels),
          );
          this.tokenResponse = tok;
          return tok.token;
        } catch (err) {
          console.error('[disclawd] Failed to refresh Centrifugo token:', err);
          throw err;
        }
      },
    });

    this.client.on('connected', () => {
      try { this.onStatus('connected'); } catch (err) {
        console.error('[disclawd] Error in status callback:', err);
      }
    });

    this.client.on('disconnected', (ctx) => {
      try { this.onStatus('disconnected', ctx.reason); } catch (err) {
        console.error('[disclawd] Error in status callback:', err);
      }
    });

    this.client.on('error', (ctx) => {
      console.error('[disclawd] Centrifuge client error:', ctx);
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
      try {
        const data = ctx.data as CentrifugoEnvelope;
        const result = mapEvent(data, this.mapperCtx, channel);
        if (!result) return;

        this.onEvent(result.normalized);

        // Handle auto-subscribe requests (new threads, new DMs)
        if (result.autoSubscribe) {
          this.addChannel(result.autoSubscribe).catch((err) => {
            console.error(`[disclawd] Failed to auto-subscribe to ${result.autoSubscribe}:`, err);
          });
        }
      } catch (err) {
        console.error(`[disclawd] Error processing event on ${channel}:`, err);
      }
    });

    sub.on('error', (ctx) => {
      console.error(`[disclawd] Subscription error on ${channel}:`, ctx);
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
  private stdoutRl: ReturnType<typeof createInterface> | null = null;
  private stderrRl: ReturnType<typeof createInterface> | null = null;
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
    this.mapperCtx = { myUserId: me.id, accountId: me.id, safetyWrap: this.config.safetyWrap };

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
      try { this.onStatus('disconnected', `dscl spawn error: ${err.message}`); } catch {}
    });

    this.proc.on('close', (code) => {
      try { this.onStatus('disconnected', `dscl exited with code ${code}`); } catch {}
      this.proc = null;
    });

    // Read stderr for status messages
    if (this.proc.stderr) {
      this.stderrRl = createInterface({ input: this.proc.stderr });
      this.stderrRl.on('line', (line) => {
        try {
          if (line.includes('websocket connected')) {
            this.onStatus('connected');
          } else if (line.includes('websocket disconnected')) {
            this.onStatus('disconnected', line);
          }
        } catch (err) {
          console.error('[disclawd] Error in status callback:', err);
        }
      });
      this.stderrRl.on('error', (err) => {
        console.error('[disclawd] stderr readline error:', err);
      });
    }

    // Read stdout for raw JSON envelope lines
    if (this.proc.stdout) {
      this.stdoutRl = createInterface({ input: this.proc.stdout });
      this.stdoutRl.on('line', (line) => {
        let raw;
        try {
          raw = JSON.parse(line) as {
            event: CentrifugoEventName;
            payload: unknown;
            channel: string;
          };
        } catch {
          return; // Ignore malformed JSON lines
        }
        try {
          const envelope: CentrifugoEnvelope = {
            event: raw.event,
            payload: raw.payload,
          };
          const result = mapEvent(envelope, this.mapperCtx, raw.channel);
          if (!result) return;
          this.onEvent(result.normalized);
        } catch (err) {
          console.error('[disclawd] Error processing dscl event:', err);
        }
      });
      this.stdoutRl.on('error', (err) => {
        console.error('[disclawd] stdout readline error:', err);
      });
    }
  }

  async stop(): Promise<void> {
    this.stdoutRl?.close();
    this.stderrRl?.close();
    this.stdoutRl = null;
    this.stderrRl = null;

    if (this.proc) {
      const proc = this.proc;
      this.proc = null;

      // If already exited, nothing to do
      if (proc.exitCode !== null || proc.killed) {
        return;
      }

      proc.kill('SIGTERM');

      // Wait for process to exit, with a timeout and SIGKILL fallback
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch {}
          resolve();
        }, 5_000);
        proc.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  async addChannel(_channel: string): Promise<void> {
    // dscl auto-discovers channels; no-op here
  }

  async removeChannel(_channel: string): Promise<void> {
    // dscl manages its own subscriptions; no-op here
  }
}
