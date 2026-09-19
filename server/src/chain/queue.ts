// ChainQueue: turns the boost stream into a few chain transactions, off the game path.
//
//   record(team, n)      O(1), synchronous, never throws, never awaits anything
//   every flushMs        one batch → adapter.submit()      (async, fire and forget)
//   every pollMs         adapter.check() for in-flight txs (async)
//
// Boosts are aggregated, not queued one by one, so memory is bounded (4 numbers)
// even when the RPC is down for minutes. Failed submissions put their counts back
// and retry with exponential backoff. Counters only move on real adapter results.

import { TEAM_IDS, type TeamId } from "../../../shared/index.js";
import type { BoostBatch, ChainAdapter, ChainStatus, TxCheck } from "./types.js";

export type QueueOptions = {
  flushMs: number;
  pollMs: number;
  confirmTimeoutMs: number; // stop tracking a tx after this long (it may still land)
  maxInFlight: number; // stop submitting while this many txs are unconfirmed
  backoffMinMs: number;
  backoffMaxMs: number;
  /** Real chain unreachable for this long → chainMode reports "OFF" (short blips do not flap it). */
  unavailableAfterMs: number;
  /** While idle, probe the RPC this often so an outage is noticed even with no boosts. */
  probeMs: number;
};

export const DEFAULT_QUEUE_OPTIONS: QueueOptions = {
  flushMs: 2000,
  pollMs: 1000,
  confirmTimeoutMs: 60_000,
  maxInFlight: 8,
  backoffMinMs: 1000,
  backoffMaxMs: 15_000,
  unavailableAfterMs: 10_000,
  probeMs: 5000,
};

type InFlight = { hash: string; gen: number; at: number };

const emptyBatch = (): BoostBatch => ({ red: 0, blue: 0, green: 0, yellow: 0 });

/** First line only, truncated: safe to show in the lobby and logs (viem errors are long). */
export const errText = (err: unknown): string =>
  String((err as Error)?.message ?? err).split("\n")[0]!.slice(0, 200);

export class ChainQueue {
  private unsent = emptyBatch();
  private sending = emptyBatch(); // the batch currently being submitted: still "waiting to send" until the RPC accepts it
  private inFlight: InFlight[] = [];
  private gen = 0; // bumped by reset(): results of older races no longer count
  private sent = 0;
  private confirmed = 0;
  private events = 0;
  private failed = 0;
  private unconfirmed = 0;
  private rpcHealthy = true;
  private lastError?: string;
  private unhealthySince = 0; // 0 = healthy
  private lastOk = 0;
  private failures = 0;
  private retryAt = 0;
  private submitting = false;
  private polling = false;
  private disabled?: string; // permanent misconfiguration (e.g. wrong chain id)
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly adapter: ChainAdapter,
    private readonly opts: QueueOptions = DEFAULT_QUEUE_OPTIONS,
    private readonly log: (m: string) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Verify the adapter, then start the timers. A permanent misconfiguration disables the
   * chain (mode OFF); a merely unreachable RPC does not (init is retried on the next flush).
   */
  async start(): Promise<void> {
    // Timer callbacks must never throw or reject: nothing here may take the server down.
    const flush = setInterval(() => void this.flush().catch(() => {}), this.opts.flushMs);
    const poll = setInterval(() => void this.poll().catch(() => {}), this.opts.pollMs);
    flush.unref(); poll.unref();
    this.timers = [flush, poll];
    await this.ensureInit().catch(() => {}); // failure is recorded in status(); the flush timer retries
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private initialised = false;
  private async ensureInit(): Promise<void> {
    if (this.initialised || this.disabled) return;
    try {
      await this.adapter.init();
      this.initialised = true;
      this.markHealthy();
    } catch (err) {
      if (err instanceof ChainConfigError) {
        this.disabled = errText(err);
        this.log(`! chain disabled: ${this.disabled}`);
      } else {
        this.markUnhealthy(err); // RPC down at startup: try again later
      }
      throw err;
    }
  }

  /** Called for every ACCEPTED boost, after the race state was updated. */
  record(team: TeamId, n = 1): void {
    if (this.disabled) return;
    this.unsent[team] += n;
  }

  /** New race: zero the race-scoped counters and drop boosts of the old race that were never sent. */
  reset(): void {
    this.gen += 1;
    this.unsent = emptyBatch();
    this.sending = emptyBatch();
    this.sent = this.confirmed = this.events = this.failed = this.unconfirmed = 0;
  }

  status(): ChainStatus {
    // A real chain is "LIVE" only once verified and while its RPC answers; never before, never during a long outage.
    const unavailable = this.adapter.mode === "LIVE" && (!this.initialised || (this.unhealthySince > 0 && this.now() - this.unhealthySince >= this.opts.unavailableAfterMs));
    const chainState = this.disabled ? "OFF" : unavailable ? "UNAVAILABLE" : this.adapter.mode;
    return {
      chainMode: chainState === "UNAVAILABLE" ? "OFF" : chainState,
      chainState,
      transactionsSent: this.sent,
      transactionsConfirmed: this.confirmed,
      eventsReceived: this.events,
      transactionsFailed: this.failed,
      transactionsUnconfirmed: this.unconfirmed,
      pendingTransactions: this.inFlight.filter((t) => t.gen === this.gen).length,
      unsentBoosts: TEAM_IDS.reduce((n, t) => n + this.unsent[t] + this.sending[t], 0),
      rpcHealthy: this.rpcHealthy,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  /** Exposed for tests; normally driven by the timer. */
  async flush(): Promise<void> {
    if (this.submitting || this.disabled) return;
    if (this.now() < this.retryAt || this.inFlight.length >= this.opts.maxInFlight) return;
    const batch = this.unsent;
    if (TEAM_IDS.every((t) => batch[t] === 0)) return this.probe();
    this.unsent = emptyBatch();
    this.sending = batch;
    const gen = this.gen;
    this.submitting = true;
    try {
      await this.ensureInit();
      const hash = await this.adapter.submit(batch);
      this.failures = 0;
      this.markHealthy();
      this.inFlight.push({ hash, gen, at: this.now() });
      if (gen === this.gen) this.sent += 1;
    } catch (err) {
      if (gen === this.gen && !this.disabled) for (const t of TEAM_IDS) this.unsent[t] += batch[t]; // keep them for the retry
      this.failures += 1;
      this.retryAt = this.now() + Math.min(this.opts.backoffMinMs * 2 ** (this.failures - 1), this.opts.backoffMaxMs);
      if (!this.disabled) this.markUnhealthy(err);
    } finally {
      this.sending = emptyBatch();
      this.submitting = false;
    }
  }

  /** Idle: keep an eye on the RPC so "unavailable" is reported even when nobody is boosting. */
  private async probe(): Promise<void> {
    if (this.now() - this.lastOk < this.opts.probeMs) return;
    this.submitting = true;
    try {
      await this.ensureInit();
      await this.adapter.ping();
      this.markHealthy();
    } catch (err) {
      if (!this.disabled) this.markUnhealthy(err);
    } finally {
      this.submitting = false;
    }
  }

  /** Exposed for tests; normally driven by the timer. */
  async poll(): Promise<void> {
    if (this.polling || this.inFlight.length === 0) return;
    this.polling = true;
    try {
      for (const tx of [...this.inFlight]) {
        let result: TxCheck;
        try {
          result = await this.adapter.check(tx.hash);
        } catch (err) {
          this.markUnhealthy(err); // RPC trouble: keep the tx tracked and look again next round
          if (this.now() - tx.at > this.opts.confirmTimeoutMs) this.giveUp(tx);
          continue;
        }
        this.markHealthy();
        const current = tx.gen === this.gen;
        if (result.state === "confirmed") {
          this.remove(tx);
          if (current) { this.confirmed += 1; this.events += result.events; }
        } else if (result.state === "failed") {
          this.remove(tx);
          if (current) this.failed += 1;
          this.log(`! tx ${tx.hash} failed: ${result.reason}`);
        } else if (this.now() - tx.at > this.opts.confirmTimeoutMs) {
          this.giveUp(tx);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private giveUp(tx: InFlight): void {
    this.remove(tx);
    if (tx.gen === this.gen) this.unconfirmed += 1;
    this.log(`! tx ${tx.hash} not confirmed after ${this.opts.confirmTimeoutMs} ms; no longer tracking`);
  }

  private remove(tx: InFlight): void {
    this.inFlight = this.inFlight.filter((t) => t !== tx);
  }

  private markHealthy(): void {
    if (!this.rpcHealthy) this.log("chain: RPC reachable again");
    this.rpcHealthy = true;
    this.unhealthySince = 0;
    this.lastOk = this.now();
    this.lastError = undefined;
  }

  private markUnhealthy(err: unknown): void {
    const text = errText(err);
    if (this.rpcHealthy || text !== this.lastError) this.log(`! chain: ${text} (game unaffected; retrying)`);
    if (this.rpcHealthy || !this.unhealthySince) this.unhealthySince = this.now();
    this.rpcHealthy = false;
    this.lastError = text;
  }
}

/** Thrown by adapters for problems retrying cannot fix (wrong chain id, no contract at the address). */
export class ChainConfigError extends Error {}
