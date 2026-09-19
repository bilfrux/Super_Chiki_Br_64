// Chain layer entry point. The rest of the server imports only from here.

import type { ServerConfig } from "../config.js";
import { DemoAdapter } from "./demo.js";
import { MonadAdapter } from "./monad.js";
import { ChainQueue, errText } from "./queue.js";
import type { ChainAdapter } from "./types.js";

export { ChainQueue } from "./queue.js";
export type { ChainStatus, ChainAdapter } from "./types.js";

/**
 * DEMO_MODE=true                          → simulated activity, chainMode "DEMO"
 * RELAYER_PRIVATE_KEY + BOOST_LEDGER_ADDRESS → real Monad Testnet, chainMode "LIVE"
 * otherwise                               → no chain, chainMode "OFF"
 */
export function createChain(config: ServerConfig, log: (m: string) => void): ChainQueue | undefined {
  const c = config.chain;
  let adapter: ChainAdapter | undefined;
  if (c.demo) {
    adapter = new DemoAdapter();
  } else if (c.privateKey && c.contractAddress) {
    try {
      adapter = new MonadAdapter({
        chainId: c.chainId,
        rpcUrls: c.rpcUrls,
        privateKey: c.privateKey,
        contractAddress: c.contractAddress,
        gasLimit: c.gasLimit,
        rpcTimeoutMs: c.rpcTimeoutMs,
      });
    } catch (err) {
      log(`! chain disabled: ${errText(err)}`); // never echo the key
    }
  }
  return adapter ? new ChainQueue(adapter, c.queue, log) : undefined;
}
