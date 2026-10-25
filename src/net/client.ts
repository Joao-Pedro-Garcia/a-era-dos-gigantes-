import { PROTOCOL_VERSION, type ClientMsg, type ErrorCode, type ServerMsg } from './protocol';

/**
 * Browser side of the co-op connection: opens the WebSocket, creates or joins a room,
 * reconnects with backoff (resuming the same player with its session token), measures
 * the round trip and hands every server message to `onMessage`.
 */
export type NetStatus = 'connecting' | 'online' | 'reconnecting' | 'closed';

export interface NetClientOptions {
  url: string;
  /** Socket factory (tests). */
  socket?: (url: string) => WebSocket;
  onMessage(m: ServerMsg): void;
  onStatus?(s: NetStatus, err?: ErrorCode | string): void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];

export class NetClient {
  status: NetStatus = 'connecting';
  /** Round-trip time (ms), smoothed. */
  rtt = 0;
  token: string | null = null;
  private ws: WebSocket | null = null;
  private attempt = 0;
  private first: ClientMsg;
  private closedByUs = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly opts: NetClientOptions,
    first: { t: 'create'; name: string; seed: number } | { t: 'join'; name: string; code: string },
  ) {
    this.first = { ...first, v: PROTOCOL_VERSION } as ClientMsg;
    this.open();
  }

  send(m: ClientMsg): void {
    if (this.ws && this.ws.readyState === 1 && this.status === 'online') this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closedByUs = true;
    this.send({ t: 'leave' });
    this.stopTimers();
    this.ws?.close();
    this.setStatus('closed');
  }

  private setStatus(s: NetStatus, err?: ErrorCode | string): void {
    this.status = s;
    this.opts.onStatus?.(s, err);
  }

  private stopTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.pingTimer = this.retryTimer = null;
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = this.opts.socket ? this.opts.socket(this.opts.url) : new WebSocket(this.opts.url);
    } catch (e) {
      this.retry(String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      // First contact creates or joins; later ones resume the same player.
      const hello: ClientMsg = this.token ? { t: 'resume', v: PROTOCOL_VERSION, token: this.token } : this.first;
      ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try {
        m = JSON.parse(String(ev.data)) as ServerMsg;
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        this.token = m.token;
        this.attempt = 0;
        this.setStatus('online');
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping', at: performance.now() }), 2000);
      } else if (m.t === 'pong') {
        const r = performance.now() - m.at;
        this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
        return;
      } else if (m.t === 'error' && (m.code === 'version' || m.code === 'no-room' || m.code === 'room-full' || m.code === 'cheat' || m.code === 'bad-token')) {
        // Fatal: do not reconnect (a bad token means the slot expired).
        this.closedByUs = true;
        this.stopTimers();
        this.setStatus('closed', m.code);
      }
      this.opts.onMessage(m);
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.closedByUs) return;
      this.retry('connection lost');
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private retry(why: string): void {
    if (this.closedByUs) return;
    // Without a token (never welcomed) there is nothing to resume after a few tries.
    if (!this.token && this.attempt >= 3) {
      this.setStatus('closed', why);
      return;
    }
    this.setStatus('reconnecting', why);
    const wait = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
    this.attempt++;
    this.retryTimer = setTimeout(() => this.open(), wait);
  }
}

/** Default server address: same host as the page (ws/wss), path /ws; overridable by `?server=`. */
export function defaultServerUrl(loc: Location = location): string {
  const q = new URLSearchParams(loc.search).get('server');
  if (q) return q;
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}/ws`;
}
