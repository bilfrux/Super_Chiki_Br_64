// A tiny fake Monad JSON-RPC node for tests. Real viem signing and encoding run against it;
// only the network is fake. Behaviour is switchable so failure modes can be exercised.

import http from "node:http";
import type { AddressInfo } from "node:net";
import { encodeAbiParameters, encodeEventTopics, keccak256, type Hex } from "viem";
import { BOOST_LEDGER_ABI } from "../src/chain/monad.js";

export type MockRpc = {
  url: string;
  /** Requests received, by method. */
  calls: Record<string, number>;
  raw: Hex[];
  /** true → answer every request with HTTP 503. */
  down: boolean;
  /** Delay every answer (ms). */
  delayMs: number;
  chainId: number;
  hasContract: boolean;
  /** Block the next transaction is "included" in, and the current finalized height. */
  includeAtBlock: number;
  finalizedBlock: number;
  /** Which sent txs count as included (by hash). Default: none until `include()` is called. */
  include(hash?: Hex): void;
  revert: boolean;
  close(): Promise<void>;
};

export async function startMockRpc(contract: string, opts: Partial<Pick<MockRpc, "chainId" | "hasContract">> = {}): Promise<MockRpc> {
  const included = new Set<string>();
  const sent: Hex[] = [];
  const m: MockRpc = {
    url: "",
    calls: {},
    raw: [],
    down: false,
    delayMs: 0,
    chainId: opts.chainId ?? 10143,
    hasContract: opts.hasContract ?? true,
    includeAtBlock: 100,
    finalizedBlock: 100,
    revert: false,
    include: (hash) => { if (hash) included.add(hash); else for (const h of sent) included.add(h); },
    close: async () => {},
  };
  const hex = (n: number | bigint) => "0x" + n.toString(16);

  const receiptFor = (hash: Hex) => {
    const logs = m.revert ? [] : [0, 1].map((team, i) => ({
      address: contract,
      topics: encodeEventTopics({ abi: BOOST_LEDGER_ABI, eventName: "BoostsRecorded", args: { team } }),
      data: encodeAbiParameters([{ type: "uint32" }, { type: "uint64" }], [5, 5n]),
      blockNumber: hex(m.includeAtBlock),
      blockHash: "0x" + "ab".repeat(32),
      logIndex: hex(i),
      transactionHash: hash,
      transactionIndex: "0x0",
      removed: false,
    }));
    return {
      blockHash: "0x" + "ab".repeat(32),
      blockNumber: hex(m.includeAtBlock),
      from: "0x" + "11".repeat(20),
      to: contract,
      transactionHash: hash,
      transactionIndex: "0x0",
      status: m.revert ? "0x0" : "0x1",
      logs,
      cumulativeGasUsed: "0x5208",
      gasUsed: "0x5208",
      effectiveGasPrice: "0x1",
      type: "0x2",
      logsBloom: "0x" + "00".repeat(256),
      contractAddress: null,
    };
  };

  const answer = (method: string, params: unknown[]): unknown => {
    switch (method) {
      case "eth_chainId": return hex(m.chainId);
      case "eth_getCode": return m.hasContract ? "0x6080" : "0x";
      case "eth_getTransactionCount": return "0x0";
      case "eth_maxPriorityFeePerGas": return hex(2_000_000_000);
      case "eth_gasPrice": return hex(100_000_000_000);
      case "eth_getBlockByNumber": {
        const tag = params[0];
        const number = tag === "finalized" ? m.finalizedBlock : m.includeAtBlock + 5;
        return {
          number: hex(number), hash: "0x" + "cd".repeat(32), parentHash: "0x" + "00".repeat(32), timestamp: "0x1",
          baseFeePerGas: hex(100_000_000_000), gasLimit: hex(150_000_000), gasUsed: "0x0", miner: "0x" + "00".repeat(20),
          nonce: "0x0000000000000000", difficulty: "0x0", totalDifficulty: "0x0", size: "0x1", extraData: "0x",
          logsBloom: "0x" + "00".repeat(256), sha3Uncles: "0x" + "00".repeat(32), stateRoot: "0x" + "00".repeat(32),
          receiptsRoot: "0x" + "00".repeat(32), transactionsRoot: "0x" + "00".repeat(32), mixHash: "0x" + "00".repeat(32),
          transactions: [], uncles: [],
        };
      }
      case "eth_sendRawTransaction": {
        const raw = params[0] as Hex;
        m.raw.push(raw);
        const hash = keccak256(raw);
        sent.push(hash);
        return hash;
      }
      case "eth_getTransactionReceipt": {
        const hash = params[0] as Hex;
        return included.has(hash) ? receiptFor(hash) : null;
      }
      default: throw new Error(`mock rpc: unsupported method ${method}`);
    }
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const reply = () => {
        if (m.down) { res.writeHead(503); return void res.end("unavailable"); }
        const one = (r: { id: number; method: string; params: unknown[] }) => {
          m.calls[r.method] = (m.calls[r.method] ?? 0) + 1;
          try { return { jsonrpc: "2.0", id: r.id, result: answer(r.method, r.params ?? []) }; }
          catch (e) { return { jsonrpc: "2.0", id: r.id, error: { code: -32601, message: (e as Error).message } }; }
        };
        const parsed = JSON.parse(body);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(Array.isArray(parsed) ? parsed.map(one) : one(parsed)));
      };
      if (m.delayMs > 0) setTimeout(reply, m.delayMs); else reply();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  m.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  m.close = () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); });
  return m;
}
