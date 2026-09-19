// The only chain surface the rest of the server sees. Nothing outside src/chain/
// knows about RPC, wallets, gas or contract ABIs.

import type { ChainMode, TeamId } from "../../../shared/index.js";

/** Boosts already applied to the race, waiting to be recorded on chain. */
export type BoostBatch = Record<TeamId, number>;

export type TxCheck =
  | { state: "pending" }
  | { state: "confirmed"; events: number } // finalized; `events` = BoostsRecorded logs seen in the receipt
  | { state: "failed"; reason: string }; // included but reverted

export interface ChainAdapter {
  readonly mode: Exclude<ChainMode, "OFF">;
  /** Verify configuration (chain id, contract, nonce). Rejects on a permanent misconfiguration. */
  init(): Promise<void>;
  /** Resolves with the tx hash once the RPC accepted the transaction. Not a confirmation. */
  submit(batch: BoostBatch): Promise<string>;
  /** Cheap reachability probe (used while idle so an outage is noticed without boosts). Throws if unreachable. */
  ping(): Promise<void>;
  /** Look a submitted transaction up. Throws if the RPC cannot answer. */
  check(hash: string): Promise<TxCheck>;
}

/** What the rest of the server reads. Counters are race-scoped (cleared by RESET). */
export type ChainStatus = {
  /** What RACE_STATE reports. "LIVE" only while the RPC is answering; a real chain that has gone quiet reports "OFF". */
  chainMode: ChainMode;
  /** Precise state for the lobby: LIVE, DEMO, UNAVAILABLE (configured but RPC down), OFF (not configured / misconfigured). */
  chainState: "LIVE" | "DEMO" | "UNAVAILABLE" | "OFF";
  transactionsSent: number;
  transactionsConfirmed: number;
  eventsReceived: number;
  // Detail for the lobby only (never in RACE_STATE):
  transactionsFailed: number;
  transactionsUnconfirmed: number; // gave up waiting; may still land later
  pendingTransactions: number;
  unsentBoosts: number;
  rpcHealthy: boolean;
  lastError?: string;
};
