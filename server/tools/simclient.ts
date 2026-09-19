// A tiny scriptable protocol client. Used by the integration tests, `npm run demo`
// and `npm run sim`. It speaks the raw protocol (JSON over WebSocket) on purpose,
// so it also serves as a reference for how Member A's game connects.

import { WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  type RaceState,
  type ServerMessage,
  type ServerWelcome,
} from "../../shared/index.js";

export type SimHello = {
  role: string;
  team?: string;
  token?: string;
  adminKey?: string;
  protocolVersion?: number;
};

export class SimClient {
  readonly messages: ServerMessage[] = [];
  welcome?: ServerWelcome;
  closeCode?: number;
  private ws!: WebSocket;
  private listeners = new Set<() => void>();
  private closed = false;

  constructor(
    private readonly url: string,
    private readonly wsOptions: ConstructorParameters<typeof WebSocket>[2] = {},
  ) {}

  /** Open the socket (does not send HELLO). */
  connect(): Promise<this> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url, this.wsOptions);
      this.ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString()) as ServerMessage;
          this.messages.push(msg);
          if (msg.type === "WELCOME") this.welcome = msg;
        } catch { /* ignore non-JSON */ }
        this.notify();
      });
      this.ws.on("close", (code) => {
        this.closed = true;
        this.closeCode = code;
        this.notify();
      });
      this.ws.on("open", () => resolve(this));
      this.ws.on("error", reject);
    });
  }

  /** Connect, send HELLO, and wait for WELCOME (or an ERROR, which is returned via `errors()`). */
  async join(hello: SimHello): Promise<this> {
    await this.connect();
    this.hello(hello);
    await this.waitFor((m) => m.type === "WELCOME" || m.type === "ERROR");
    return this;
  }

  hello(h: SimHello): void {
    this.send({ type: "HELLO", protocolVersion: PROTOCOL_VERSION, ...h });
  }

  send(obj: unknown): void {
    this.ws.send(typeof obj === "string" ? obj : JSON.stringify(obj));
  }

  sendRaw(data: string | Buffer, binary = false): void {
    this.ws.send(data, { binary });
  }

  /** Index to pass as `from` to waitFor, to ignore everything received so far. */
  mark(): number {
    return this.messages.length;
  }

  errors(from = 0) {
    return this.messages.slice(from).filter((m): m is Extract<ServerMessage, { type: "ERROR" }> => m.type === "ERROR");
  }

  ofType<T extends ServerMessage["type"]>(type: T, from = 0): Extract<ServerMessage, { type: T }>[] {
    return this.messages.slice(from).filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  }

  latestState(): RaceState | undefined {
    const all = this.ofType("RACE_STATE");
    return all[all.length - 1]?.state;
  }

  /** Resolve with the first message (at index >= from) matching `pred`. */
  waitFor(pred: (m: ServerMessage) => boolean, opts: { from?: number; timeoutMs?: number } = {}): Promise<ServerMessage> {
    const from = opts.from ?? 0;
    const timeoutMs = opts.timeoutMs ?? 3000;
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        const found = this.messages.slice(from).find(pred);
        if (found) { cleanup(); resolve(found); return true; }
        return false;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for message. Received: ${this.messages.slice(from).map((m) => m.type).join(", ") || "(none)"}`));
      }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(check); };
      if (!check()) this.listeners.add(check);
    });
  }

  /** Wait for a RACE_STATE (arriving after `from`) satisfying `pred`. */
  async waitForState(pred: (s: RaceState) => boolean, opts: { from?: number; timeoutMs?: number } = {}): Promise<RaceState> {
    const m = await this.waitFor((x) => x.type === "RACE_STATE" && pred(x.state), opts);
    return (m as Extract<ServerMessage, { type: "RACE_STATE" }>).state;
  }

  waitForClose(timeoutMs = 3000): Promise<number> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        if (this.closed) { cleanup(); resolve(this.closeCode ?? 0); return true; }
        return false;
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("Timed out waiting for close")); }, timeoutMs);
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(check); };
      if (!check()) this.listeners.add(check);
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Drop the socket without a close handshake (simulates a phone losing signal). */
  drop(): void {
    this.ws.terminate();
  }

  close(): void {
    if (!this.closed) this.ws.close();
  }

  private notify(): void {
    for (const l of [...this.listeners]) l();
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
