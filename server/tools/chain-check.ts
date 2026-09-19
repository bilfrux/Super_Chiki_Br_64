// `npm run chain:check` — verifies the chain configuration against the REAL RPC, sends nothing.
// Reads the same environment as the server (.env is loaded by node --env-file-if-exists).

import { createPublicClient, formatEther, http, isAddress, fallback } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loadConfig } from "../src/config.js";

const c = loadConfig().chain;
const ok = (m: string) => console.log(`  ok   ${m}`);
const bad = (m: string) => { console.log(`  FAIL ${m}`); process.exitCode = 1; };

console.log(`Chain mode: ${c.demo ? "DEMO (no network needed)" : c.privateKey && c.contractAddress ? "LIVE" : "OFF (set RELAYER_PRIVATE_KEY and BOOST_LEDGER_ADDRESS)"}`);
console.log(`RPC URLs:   ${c.rpcUrls.join(", ")}`);

const client = createPublicClient({ transport: fallback(c.rpcUrls.map((u) => http(u, { timeout: c.rpcTimeoutMs, retryCount: 0 })), { retryCount: 0 }) });

try {
  const id = await client.getChainId();
  id === c.chainId ? ok(`eth_chainId = ${id}`) : bad(`RPC reports chain id ${id}, config expects ${c.chainId}`);
  const fin = await client.getBlock({ blockTag: "finalized" });
  const latest = await client.getBlock();
  ok(`finalized block ${fin.number}, latest ${latest.number} (base fee ${latest.baseFeePerGas} wei)`);

  if (c.privateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(c.privateKey)) bad("RELAYER_PRIVATE_KEY is not 0x + 64 hex characters");
    else {
      const addr = privateKeyToAccount(c.privateKey as `0x${string}`).address;
      const bal = await client.getBalance({ address: addr });
      const perTx = c.gasLimit * (latest.baseFeePerGas ?? 0n) * 2n;
      console.log(`Relayer:    ${addr}`);
      bal > 0n ? ok(`balance ${formatEther(bal)} MON (~${perTx > 0n ? bal / perTx : "?"} transactions at the current base fee, gas charged on the limit)`) : bad("relayer has 0 MON: use the faucet");
    }
  }
  if (c.contractAddress) {
    if (!isAddress(c.contractAddress)) bad("BOOST_LEDGER_ADDRESS is not a valid address");
    else {
      const code = await client.getCode({ address: c.contractAddress });
      code && code !== "0x" ? ok(`contract code present at ${c.contractAddress}`) : bad(`no contract at ${c.contractAddress} on this chain`);
    }
  }
} catch (err) {
  bad(`RPC error: ${String((err as Error).message).split("\n")[0]}`);
}
