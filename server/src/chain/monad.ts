// MonadAdapter: records boost batches on Monad Testnet through a single server-side
// relayer wallet and the BoostLedger contract (contracts/src/BoostLedger.sol).
//
// Why a relayer: Boosters must never sign anything, and the public RPCs allow only
// ~20-50 requests/s (MONAD_RESOURCES.md), so boosts are aggregated into one
// transaction per batch window that the server pays for.
//
// Confirmation follows the Monad docs: a transaction counts as confirmed once its
// block is FINALIZED. "Pending" is tracked by us, because RPCs cannot query
// transactions that are not yet in a block.

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TEAM_IDS } from "../../../shared/index.js";
import { ChainConfigError } from "./queue.js";
import type { BoostBatch, ChainAdapter, TxCheck } from "./types.js";

export const BOOST_LEDGER_ABI = [
  {
    type: "function",
    name: "recordBatch",
    stateMutability: "nonpayable",
    inputs: [{ name: "counts", type: "uint32[4]" }],
    outputs: [],
  },
  {
    type: "event",
    name: "BoostsRecorded",
    inputs: [
      { name: "team", type: "uint8", indexed: true },
      { name: "count", type: "uint32", indexed: false },
      { name: "total", type: "uint64", indexed: false },
    ],
  },
] as const;

export type MonadConfig = {
  chainId: number;
  rpcUrls: string[]; // tried in order (fallback transport)
  privateKey: string; // relayer key: from the environment only, never logged
  contractAddress: string;
  gasLimit: bigint; // gas is charged on the LIMIT on Monad, so keep it tight
  rpcTimeoutMs: number;
};

const FEE_CACHE_MS = 30_000;

export class MonadAdapter implements ChainAdapter {
  readonly mode = "LIVE" as const;
  private readonly client: PublicClient;
  private readonly wallet;
  private readonly account;
  private readonly contract: Address;
  private nonce = 0;
  private fees?: { at: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

  constructor(private readonly cfg: MonadConfig) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(cfg.privateKey)) throw new ChainConfigError("RELAYER_PRIVATE_KEY must be 0x + 64 hex characters");
    if (!isAddress(cfg.contractAddress)) throw new ChainConfigError("BOOST_LEDGER_ADDRESS is not a valid address");
    if (cfg.rpcUrls.length === 0) throw new ChainConfigError("No RPC URL configured");
    this.contract = cfg.contractAddress;
    this.account = privateKeyToAccount(cfg.privateKey as Hex);

    const chain = defineChain({
      id: cfg.chainId,
      name: "Monad Testnet",
      nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
      rpcUrls: { default: { http: cfg.rpcUrls } },
    });
    const transport = fallback(cfg.rpcUrls.map((u) => http(u, { timeout: cfg.rpcTimeoutMs, retryCount: 0 })), { retryCount: 0 });
    this.client = createPublicClient({ chain, transport });
    this.wallet = createWalletClient({ chain, transport, account: this.account });
  }

  get relayerAddress(): Address {
    return this.account.address;
  }

  async init(): Promise<void> {
    const id = await this.client.getChainId();
    if (id !== this.cfg.chainId) throw new ChainConfigError(`RPC reports chain id ${id}, expected ${this.cfg.chainId}`);
    const code = await this.client.getCode({ address: this.contract });
    if (!code || code === "0x") throw new ChainConfigError(`No contract deployed at ${this.contract} on chain ${id}`);
    await this.syncNonce();
  }

  private async syncNonce(): Promise<void> {
    this.nonce = await this.client.getTransactionCount({ address: this.account.address, blockTag: "latest" });
  }

  private async feeData(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
    const now = Date.now();
    if (this.fees && now - this.fees.at < FEE_CACHE_MS) return this.fees;
    try {
      const f = await this.client.estimateFeesPerGas();
      this.fees = { at: now, maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    } catch (err) {
      if (!this.fees) throw err; // nothing cached: let the queue back off and retry
    }
    return this.fees!;
  }

  async submit(batch: BoostBatch): Promise<string> {
    const fees = await this.feeData();
    const counts = TEAM_IDS.map((t) => batch[t]) as [number, number, number, number];
    try {
      const hash = await this.wallet.writeContract({
        address: this.contract,
        abi: BOOST_LEDGER_ABI,
        functionName: "recordBatch",
        args: [counts],
        nonce: this.nonce,
        gas: this.cfg.gasLimit,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
      this.nonce += 1; // only after the RPC accepted it
      return hash;
    } catch (err) {
      if (/nonce too low/i.test(String((err as Error)?.message))) await this.syncNonce().catch(() => {});
      throw err;
    }
  }

  async check(hash: string): Promise<TxCheck> {
    let receipt;
    try {
      receipt = await this.client.getTransactionReceipt({ hash: hash as Hex });
    } catch (err) {
      if ((err as Error)?.name === "TransactionReceiptNotFoundError") return { state: "pending" };
      throw err;
    }
    if (receipt.status !== "success") return { state: "failed", reason: "transaction reverted" };
    // Included is not final: wait for the block to be Finalized (docs: treat Finalized as confirmed).
    const finalized = await this.client.getBlock({ blockTag: "finalized" });
    if (receipt.blockNumber > finalized.number) return { state: "pending" };
    const logs = parseEventLogs({ abi: BOOST_LEDGER_ABI, logs: receipt.logs, eventName: "BoostsRecorded" })
      .filter((l) => l.address.toLowerCase() === this.contract.toLowerCase());
    return { state: "confirmed", events: logs.length };
  }
}
