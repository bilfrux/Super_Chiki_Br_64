// Chain layer tests: the queue with a scripted adapter (failure / delay behaviour), and the
// real MonadAdapter (viem signing, finality, receipts) against a fake JSON-RPC node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { parseTransaction, type Hex } from "viem";
import { ChainConfigError, ChainQueue, DEFAULT_QUEUE_OPTIONS, type QueueOptions } from "../src/chain/queue.js";
import { MonadAdapter } from "../src/chain/monad.js";
import type { BoostBatch, ChainAdapter, TxCheck } from "../src/chain/types.js";
import { startMockRpc } from "./mockRpc.js";

const CONTRACT = "0x1234567890123456789012345678901234567890";
const OPTS: QueueOptions = { ...DEFAULT_QUEUE_OPTIONS, flushMs: 10_000, pollMs: 10_000, backoffMinMs: 1000, backoffMaxMs: 8000, confirmTimeoutMs: 30_000 };

/** Adapter whose behaviour the test scripts. */
class FakeAdapter implements ChainAdapter {
  readonly mode = "LIVE" as const;
  submitFails = false;
  checkFails = false;
  state: TxCheck = { state: "pending" };
  batches: BoostBatch[] = [];
  initError?: Error;
  async init() { if (this.initError) throw this.initError; }
  async submit(b: BoostBatch) {
    if (this.submitFails) throw new Error("RPC down");
    this.batches.push({ ...b });
    return `0x${this.batches.length}`;
  }
  async check(): Promise<TxCheck> {
    if (this.checkFails) throw new Error("RPC down");
    return this.state;
  }
}

const clock = () => { let t = 1_000_000; return { now: () => t, advance: (ms: number) => { t += ms; } }; };

test("queue: record() is synchronous and O(1); flush sends ONE aggregated batch, then confirmation moves the counters", async () => {
  const a = new FakeAdapter();
  const q = new ChainQueue(a, OPTS, () => {});
  const t0 = performance.now();
  for (let i = 0; i < 200_000; i++) q.record(i % 2 ? "red" : "blue");
  assert.ok(performance.now() - t0 < 200, "200k records are cheap");
  assert.equal(q.status().unsentBoosts, 200_000);
  assert.equal(q.status().transactionsSent, 0);

  await q.flush();
  assert.deepEqual(a.batches, [{ red: 100_000, blue: 100_000, green: 0, yellow: 0 }]);
  let s = q.status();
  assert.deepEqual([s.transactionsSent, s.transactionsConfirmed, s.pendingTransactions, s.unsentBoosts], [1, 0, 1, 0]);

  await q.poll(); // still pending: nothing confirmed
  assert.equal(q.status().transactionsConfirmed, 0);

  a.state = { state: "confirmed", events: 2 };
  await q.poll();
  s = q.status();
  assert.deepEqual([s.transactionsConfirmed, s.eventsReceived, s.pendingTransactions], [1, 2, 0]);
});

test("queue: RPC failure keeps the boosts, backs off exponentially, and recovers", async () => {
  const a = new FakeAdapter();
  const c = clock();
  const q = new ChainQueue(a, OPTS, () => {}, c.now);
  a.submitFails = true;
  q.record("red", 5);
  await q.flush();
  let s = q.status();
  assert.deepEqual([s.rpcHealthy, s.transactionsSent, s.unsentBoosts, s.lastError], [false, 0, 5, "RPC down"]);

  q.record("red", 3); // the game keeps producing boosts meanwhile
  await q.flush(); // inside the 1 s backoff: not even attempted
  assert.equal(a.batches.length, 0);

  c.advance(1001);
  await q.flush(); // fails again → backoff doubles to 2 s
  c.advance(1500);
  a.submitFails = false;
  await q.flush(); // still inside the 2 s backoff
  assert.equal(a.batches.length, 0, "exponential backoff honoured");
  c.advance(600);
  await q.flush();
  assert.deepEqual(a.batches, [{ red: 8, blue: 0, green: 0, yellow: 0 }], "nothing was lost");
  s = q.status();
  assert.deepEqual([s.rpcHealthy, s.transactionsSent, s.unsentBoosts, s.lastError], [true, 1, 0, undefined]);
});

test("queue: delayed confirmation never blocks; unconfirmed txs are eventually given up on and counted honestly", async () => {
  const a = new FakeAdapter();
  const c = clock();
  const q = new ChainQueue(a, OPTS, () => {}, c.now);
  q.record("green", 1);
  await q.flush();
  q.record("green", 1);
  c.advance(2000);
  await q.flush(); // a second tx goes out while the first is still unconfirmed
  assert.equal(q.status().pendingTransactions, 2);

  c.advance(27_000);
  await q.poll();
  assert.equal(q.status().pendingTransactions, 2, "still within the timeout");
  c.advance(4000);
  await q.poll();
  const s = q.status();
  assert.deepEqual([s.pendingTransactions, s.transactionsUnconfirmed, s.transactionsConfirmed], [0, 2, 0]);
  assert.equal(s.transactionsSent, 2, "sent stays true: they WERE accepted by the RPC");
});

test("queue: RPC failing while checking keeps txs tracked; a revert counts as failed, not confirmed", async () => {
  const a = new FakeAdapter();
  const q = new ChainQueue(a, OPTS, () => {});
  q.record("red", 1);
  await q.flush();
  a.checkFails = true;
  await q.poll();
  let s = q.status();
  assert.deepEqual([s.pendingTransactions, s.rpcHealthy], [1, false]);
  a.checkFails = false;
  a.state = { state: "failed", reason: "transaction reverted" };
  await q.poll();
  s = q.status();
  assert.deepEqual([s.transactionsFailed, s.transactionsConfirmed, s.pendingTransactions, s.rpcHealthy], [1, 0, 0, true]);
});

test("queue: maxInFlight stops submissions; RESET zeroes race counters and ignores late results of the old race", async () => {
  const a = new FakeAdapter();
  const c = clock();
  const q = new ChainQueue(a, { ...OPTS, maxInFlight: 1 }, () => {}, c.now);
  q.record("red", 1);
  await q.flush();
  q.record("red", 1);
  await q.flush();
  assert.equal(a.batches.length, 1, "second batch waits while one is in flight");

  q.reset();
  const s0 = q.status();
  assert.deepEqual([s0.transactionsSent, s0.unsentBoosts, s0.pendingTransactions], [0, 0, 0]);
  a.state = { state: "confirmed", events: 1 };
  await q.poll(); // confirmation of the OLD race's tx
  const s1 = q.status();
  assert.deepEqual([s1.transactionsConfirmed, s1.eventsReceived], [0, 0], "old race tx does not count in the new race");
});

test("queue: a permanent misconfiguration turns the chain OFF (game unaffected); an unreachable RPC does not", async () => {
  const bad = new FakeAdapter();
  bad.initError = new ChainConfigError("wrong chain id");
  const q = new ChainQueue(bad, OPTS, () => {});
  await q.start();
  q.stop();
  q.record("red", 1);
  assert.deepEqual([q.status().chainMode, q.status().unsentBoosts], ["OFF", 0]);

  const down = new FakeAdapter();
  down.initError = new Error("connect ECONNREFUSED");
  const q2 = new ChainQueue(down, OPTS, () => {});
  await q2.start();
  q2.stop();
  assert.deepEqual([q2.status().chainMode, q2.status().rpcHealthy], ["LIVE", false]);
  down.initError = undefined;
  q2.record("red", 1);
  await q2.flush(); // init is retried lazily, then the batch goes out
  assert.equal(q2.status().transactionsSent, 1);
});

// --- MonadAdapter against the fake node ------------------------------------------------------------

const adapterFor = (rpcUrls: string[], key: string = generatePrivateKey()) =>
  new MonadAdapter({ chainId: 10143, rpcUrls, privateKey: key, contractAddress: CONTRACT, gasLimit: 150_000n, rpcTimeoutMs: 1500 });

test("MonadAdapter: verifies chain id and contract code at init", async () => {
  const wrongChain = await startMockRpc(CONTRACT, { chainId: 1 });
  const noContract = await startMockRpc(CONTRACT, { hasContract: false });
  const ok = await startMockRpc(CONTRACT);
  try {
    await assert.rejects(adapterFor([wrongChain.url]).init(), (e) => e instanceof ChainConfigError && /chain id 1, expected 10143/.test((e as Error).message));
    await assert.rejects(adapterFor([noContract.url]).init(), (e) => e instanceof ChainConfigError && /No contract deployed/.test((e as Error).message));
    await adapterFor([ok.url]).init();
    assert.throws(() => new MonadAdapter({ chainId: 10143, rpcUrls: [ok.url], privateKey: "nope", contractAddress: CONTRACT, gasLimit: 1n, rpcTimeoutMs: 100 }), /RELAYER_PRIVATE_KEY/);
  } finally {
    await Promise.all([wrongChain.close(), noContract.close(), ok.close()]);
  }
});

test("MonadAdapter: submits a signed recordBatch tx (increasing nonce, tight gas); confirmed only once FINALIZED; receipt events are counted", async () => {
  const rpc = await startMockRpc(CONTRACT);
  const key = generatePrivateKey();
  try {
    const a = adapterFor([rpc.url], key);
    await a.init();
    const h1 = await a.submit({ red: 3, blue: 0, green: 1, yellow: 0 });
    const h2 = await a.submit({ red: 1, blue: 0, green: 0, yellow: 0 });
    assert.notEqual(h1, h2);

    const tx1 = parseTransaction(rpc.raw[0] as Hex);
    const tx2 = parseTransaction(rpc.raw[1] as Hex);
    assert.deepEqual([tx1.nonce, tx2.nonce], [0, 1]);
    assert.deepEqual([tx1.chainId, tx1.gas, tx1.to?.toLowerCase()], [10143, 150_000n, CONTRACT]);
    assert.ok(tx1.data && tx1.data.length > 10, "calldata present");
    assert.equal(a.relayerAddress.toLowerCase(), privateKeyToAccount(key).address.toLowerCase());

    assert.deepEqual(await a.check(h1), { state: "pending" }, "not in a block yet");
    rpc.include();
    rpc.includeAtBlock = 100; rpc.finalizedBlock = 99;
    assert.deepEqual(await a.check(h1), { state: "pending" }, "included but not finalized is NOT confirmed");
    rpc.finalizedBlock = 100;
    assert.deepEqual(await a.check(h1), { state: "confirmed", events: 2 });
    rpc.revert = true;
    assert.deepEqual(await a.check(h2), { state: "failed", reason: "transaction reverted" });
  } finally {
    await rpc.close();
  }
});

test("MonadAdapter: RPC failure and timeout throw (the queue backs off); fallback RPC takes over when the first one is down", async () => {
  const primary = await startMockRpc(CONTRACT);
  const secondary = await startMockRpc(CONTRACT);
  try {
    const a = adapterFor([primary.url, secondary.url]);
    await a.init();
    primary.down = true;
    const hash = await a.submit({ red: 1, blue: 0, green: 0, yellow: 0 });
    assert.match(hash, /^0x[0-9a-f]{64}$/);
    assert.equal(secondary.raw.length, 1, "served by the fallback endpoint");

    secondary.down = true;
    await assert.rejects(a.submit({ red: 1, blue: 0, green: 0, yellow: 0 }));
    await assert.rejects(a.check(hash));

    secondary.down = false;
    secondary.delayMs = 3000; // slower than rpcTimeoutMs
    const t0 = performance.now();
    await assert.rejects(a.check(hash));
    assert.ok(performance.now() - t0 < 2500, "request timed out instead of hanging");
  } finally {
    await Promise.all([primary.close(), secondary.close()]);
  }
});

// --- whole server + chain layer ----------------------------------------------------------------------

import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { SimClient, type SimHello } from "../tools/simclient.js";

async function withLiveServer(rpc: { url: string }, fn: (s: { url: string; http: string; boost(n: number): void; admin: SimClient; screen: SimClient; server: Awaited<ReturnType<typeof startServer>> }) => Promise<void>) {
  const config = loadConfig({}, {
    port: 0, host: "127.0.0.1", adminKey: "k", tickHz: 60, stateHz: 60,
    race: { countdownSeconds: 0.05, secondsAtSpeed1: 600 },
    rate: { boostRatePerSec: 100_000, boostBurst: 100_000, steerRatePerSec: 100_000, maxMessagesPerSec: 100_000 },
    chain: { privateKey: generatePrivateKey(), contractAddress: CONTRACT, rpcUrls: [rpc.url], rpcTimeoutMs: 500, queue: { flushMs: 50, pollMs: 50 } },
  });
  const server = await startServer(config, () => {});
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const clients: SimClient[] = [];
  const mk = async (hello: SimHello) => { const c = new SimClient(url); clients.push(c); return c.join(hello); };
  try {
    const admin = await mk({ role: "admin", adminKey: "k" });
    const screen = await mk({ role: "screen" });
    await mk({ role: "driver", team: "red" });
    const booster = await mk({ role: "booster", team: "red" });
    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "RACING");
    await fn({ url, http: `http://127.0.0.1:${server.port}`, boost: (n) => { for (let i = 0; i < n; i++) booster.send({ type: "BOOST" }); }, admin, screen, server });
  } finally {
    for (const c of clients) c.drop();
    await server.close();
  }
}

test("server + chain: RPC DOWN. Boosts still move the race, boosts queue up, and everything is sent once the RPC is back", async () => {
  const rpc = await startMockRpc(CONTRACT);
  try {
    await withLiveServer(rpc, async ({ boost, screen, http }) => {
      await screen.waitForState((s) => s.chainMode === "LIVE");
      rpc.down = true;
      const before = screen.latestState()!.teams[0]!.position;
      boost(30);
      const s = await screen.waitForState((st) => st.teams[0]!.boostRate >= 30 && st.teams[0]!.position > before);
      assert.ok(s.teams[0]!.boostEnergy > 0, "game reacted immediately");

      await new Promise((r) => setTimeout(r, 400)); // several flush attempts against a dead RPC
      const during = screen.latestState()!;
      assert.deepEqual([during.metrics.transactionsSent, during.metrics.transactionsConfirmed], [0, 0], "nothing is claimed that did not happen");
      assert.equal(during.chainMode, "LIVE");
      const m = await (await fetch(`${http}/api/metrics`)).json() as { blockchain: { rpcHealthy: boolean; unsentBoosts: number } };
      assert.deepEqual([m.blockchain.rpcHealthy, m.blockchain.unsentBoosts], [false, 30]);
      assert.ok(during.teams[0]!.position > before, "race kept running");

      rpc.down = false;
      await screen.waitForState((st) => st.metrics.transactionsSent >= 1, { timeoutMs: 8000 });
      rpc.include();
      const done = await screen.waitForState((st) => st.metrics.transactionsConfirmed >= 1 && st.metrics.eventsReceived >= 2, { timeoutMs: 5000 });
      assert.ok(done.metrics.transactionsSent >= done.metrics.transactionsConfirmed);
    });
  } finally {
    await rpc.close();
  }
});

test("server + chain: DELAYED confirmation (slow RPC, tx not final). The game is never blocked; counters only move when Monad says so", async () => {
  const rpc = await startMockRpc(CONTRACT);
  try {
    await withLiveServer(rpc, async ({ boost, screen }) => {
      await screen.waitForState((s) => s.chainMode === "LIVE");
      rpc.delayMs = 300; // every RPC call now takes 300 ms
      const t0 = performance.now();
      boost(50);
      await screen.waitForState((st) => st.teams[0]!.boostRate >= 50);
      assert.ok(performance.now() - t0 < 250, "boost visible far sooner than one RPC round trip");

      const sent = await screen.waitForState((st) => st.metrics.transactionsSent >= 1, { timeoutMs: 8000 });
      assert.equal(sent.metrics.transactionsConfirmed, 0, "sent but not confirmed yet");

      rpc.include();
      rpc.finalizedBlock = rpc.includeAtBlock - 1; // included, not finalized: still not confirmed
      await new Promise((r) => setTimeout(r, 900));
      assert.equal(screen.latestState()!.metrics.transactionsConfirmed, 0);

      rpc.finalizedBlock = rpc.includeAtBlock;
      const s = await screen.waitForState((st) => st.metrics.transactionsConfirmed >= 1, { timeoutMs: 8000 });
      assert.ok(s.metrics.eventsReceived >= 2);
    });
  } finally {
    await rpc.close();
  }
});

test("server + chain: a misconfigured chain id turns the chain OFF without affecting the game", async () => {
  const wrong = await startMockRpc(CONTRACT, { chainId: 1 });
  try {
    await withLiveServer(wrong, async ({ boost, screen, admin }) => {
      await new Promise((r) => setTimeout(r, 300));
      boost(10);
      const s = await screen.waitForState((st) => st.teams[0]!.boostRate >= 10);
      assert.deepEqual([s.chainMode, s.metrics.transactionsSent], ["OFF", 0]);
      admin.send({ type: "CONTROL", action: "RESET" });
      await screen.waitForState((st) => st.status === "LOBBY");
    });
  } finally {
    await wrong.close();
  }
});

test("server + DEMO_MODE: chainMode is DEMO and simulated counters move without any network", async () => {
  const config = loadConfig({}, {
    port: 0, host: "127.0.0.1", adminKey: "k", tickHz: 60, stateHz: 60,
    race: { countdownSeconds: 0.05, secondsAtSpeed1: 600 },
    rate: { boostRatePerSec: 100_000, boostBurst: 100_000, steerRatePerSec: 100_000, maxMessagesPerSec: 100_000 },
    chain: { demo: true, queue: { flushMs: 50, pollMs: 50 } },
  });
  const server = await startServer(config, () => {});
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const admin = await new SimClient(url).join({ role: "admin", adminKey: "k" });
  const screen = await new SimClient(url).join({ role: "screen" });
  const booster = await new SimClient(url).join({ role: "booster", team: "blue" });
  try {
    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "RACING");
    for (let i = 0; i < 20; i++) booster.send({ type: "BOOST" });
    const s = await screen.waitForState((st) => st.metrics.transactionsConfirmed >= 1, { timeoutMs: 5000 });
    assert.equal(s.chainMode, "DEMO");
  } finally {
    admin.drop(); screen.drop(); booster.drop();
    await server.close();
  }
});
