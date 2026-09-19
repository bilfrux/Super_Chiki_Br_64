// DEMO_MODE adapter: simulated transactions, no network. chainMode is "DEMO" so
// nothing it produces may be presented as real blockchain data (PROTOCOL.md §4).

import { TEAM_IDS } from "../../../shared/index.js";
import type { BoostBatch, ChainAdapter, TxCheck } from "./types.js";

export class DemoAdapter implements ChainAdapter {
  readonly mode = "DEMO" as const;
  private n = 0;
  private pending = new Map<string, { at: number; events: number }>();

  constructor(private readonly latencyMs = 700, private readonly now: () => number = Date.now) {}

  async init(): Promise<void> {}

  async submit(batch: BoostBatch): Promise<string> {
    const hash = `0xdemo${(++this.n).toString(16).padStart(60, "0")}`;
    this.pending.set(hash, { at: this.now() + this.latencyMs, events: TEAM_IDS.filter((t) => batch[t] > 0).length });
    return hash;
  }

  async check(hash: string): Promise<TxCheck> {
    const tx = this.pending.get(hash);
    if (!tx) return { state: "failed", reason: "unknown demo tx" };
    if (this.now() < tx.at) return { state: "pending" };
    this.pending.delete(hash);
    return { state: "confirmed", events: tx.events };
  }
}
