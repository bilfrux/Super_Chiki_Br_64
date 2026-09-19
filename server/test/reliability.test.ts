// PART 7: things that must survive the live demo. Real server, real sockets, fake Monad node.

import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { TEAM_IDS, type RaceState } from "../../shared/index.js";
import { ChainQueue, DEFAULT_QUEUE_OPTIONS } from "../src/chain/queue.js";
import { DEFAULT_RACE_CONFIG } from "../src/engine.js";
import { loadConfig, type ConfigOverrides, type ServerConfig } from "../src/config.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { SimClient, sleep, type SimHello } from "../tools/simclient.js";
import { startMockRpc } from "./mockRpc.js";

const CONTRACT = "0x1234567890123456789012345678901234567890";
const teamOf = (s: RaceState, id: string) => s.teams.find((t) => t.id === id)!;

const cfg = (o: ConfigOverrides = {}, port = 0): ServerConfig =>
  loadConfig({}, {
    port, host: "127.0.0.1", adminKey: "k", tickHz: 60, stateHz: 60, heartbeatMs: 60_000, helloTimeoutMs: 60_000,
    race: { countdownSeconds: 0.05, secondsAtSpeed1: 600, ...o.race },
    rate: { boostRatePerSec: 100_000, boostBurst: 100_000, steerRatePerSec: 100_000, maxMessagesPerSec: 100_000 },
    ...(o.chain ? { chain: o.chain } : {}),
  });

async function withServer(o: ConfigOverrides, fn: (c: { server: ServerHandle; url: string; mk(h: SimHello): Promise<SimClient>; admin: SimClient; screen: SimClient; http: string }) => Promise<void>) {
  const server = await startServer(cfg(o), () => {});
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const clients: SimClient[] = [];
  const mk = async (h: SimHello) => { const c = new SimClient(url); clients.push(c); return c.join(h); };
  try {
    const admin = await mk({ role: "admin", adminKey: "k" });
    const screen = await mk({ role: "screen" });
    await fn({ server, url, mk, admin, screen, http: `http://127.0.0.1:${server.port}` });
  } finally {
    for (const c of clients) c.drop();
    await server.close();
  }
}

const start = async (admin: SimClient, screen: SimClient) => {
  admin.send({ type: "CONTROL", action: "START" });
  await screen.waitForState((s) => s.status === "RACING");
};

// --- Driver leaving ------------------------------------------------------------------------------------

test("Driver leaves abruptly mid-race: server survives, that car drops to safe speed at once, others race on, seat can be resumed", async () => {
  await withServer({}, async ({ mk, admin, screen }) => {
    const drivers = new Map<string, SimClient>();
    for (const t of TEAM_IDS) drivers.set(t, await mk({ role: "driver", team: t }));
    const boosters = new Map<string, SimClient>();
    for (const t of TEAM_IDS) boosters.set(t, await mk({ role: "booster", team: t }));
    await start(admin, screen);
    for (const t of TEAM_IDS) for (let i = 0; i < 6; i++) boosters.get(t)!.send({ type: "BOOST" });
    await screen.waitForState((s) => TEAM_IDS.every((t) => teamOf(s, t).speed > 0.6));
    const safe = DEFAULT_RACE_CONFIG.safeSpeed;

    const mark = screen.mark();
    drivers.get("red")!.drop(); // no close handshake: a phone losing signal
    const off = await screen.waitForState((s) => !teamOf(s, "red").driverConnected, { from: mark });
    assert.ok(teamOf(off, "red").speed <= safe + 1e-9, `red capped immediately, speed ${teamOf(off, "red").speed}`);
    assert.equal(teamOf(off, "red").steer, 0);
    assert.ok(teamOf(off, "blue").speed > safe + 0.1, "others unaffected (not capped)");

    // boosting cannot lift the cap; the other cars keep racing
    const pos = teamOf(off, "blue").position;
    for (let i = 0; i < 20; i++) boosters.get("red")!.send({ type: "BOOST" });
    await sleep(300);
    const later = screen.latestState()!;
    assert.ok(teamOf(later, "red").speed <= safe + 1e-9);
    assert.ok(teamOf(later, "blue").position > pos, "blue keeps moving");
    assert.equal(later.status, "RACING");

    // the seat can be taken again (with the token, or a fresh driver)
    const back = await mk({ role: "driver", token: drivers.get("red")!.welcome!.token });
    assert.equal(back.welcome?.team, "red");
    await screen.waitForState((s) => teamOf(s, "red").driverConnected, { from: mark });
  });
});

test("Booster leaves and rejoins: counts follow, the team keeps racing, boosts from the remaining boosters still count", async () => {
  await withServer({}, async ({ mk, admin, screen }) => {
    await mk({ role: "driver", team: "green" });
    const a = await mk({ role: "booster", team: "green" });
    const b = await mk({ role: "booster", team: "green" });
    await screen.waitForState((s) => teamOf(s, "green").boosters === 2);
    await start(admin, screen);
    const m1 = screen.mark();
    a.drop();
    await screen.waitForState((s) => teamOf(s, "green").boosters === 1, { from: m1 });
    for (let i = 0; i < 5; i++) b.send({ type: "BOOST" });
    await screen.waitForState((s) => teamOf(s, "green").boostRate >= 5);
    const m2 = screen.mark();
    const a2 = await mk({ role: "booster", token: a.welcome!.token });
    assert.equal(a2.welcome?.team, "green");
    await screen.waitForState((s) => teamOf(s, "green").boosters === 2, { from: m2 });
  });
});

// --- server restart ------------------------------------------------------------------------------------

test("Server restart: drivers and boosters come back on the SAME team with their old (now unknown) token", async () => {
  let server = await startServer(cfg(), () => {});
  const port = server.port;
  const url = `ws://127.0.0.1:${port}/ws`;
  const all: SimClient[] = [];
  try {
    const d = await new SimClient(url).join({ role: "driver", team: "yellow" });
    const b = await new SimClient(url).join({ role: "booster", team: "blue" });
    all.push(d, b);
    const tokens = { d: d.welcome!.token, b: b.welcome!.token };
    d.drop(); b.drop();
    await server.close();

    server = await startServer(cfg({}, port), () => {});
    // What the Booster page does after a restart: old token + saved team.
    const d2 = await new SimClient(url).join({ role: "driver", token: tokens.d, team: "yellow" });
    const b2 = await new SimClient(url).join({ role: "booster", token: tokens.b, team: "blue" });
    all.push(d2, b2);
    assert.equal(d2.welcome?.team, "yellow");
    assert.equal(b2.welcome?.team, "blue");
    const screen = await new SimClient(url).join({ role: "screen" });
    all.push(screen);
    const s = await screen.waitForState((st) => teamOf(st, "yellow").driverConnected && teamOf(st, "blue").boosters === 1);
    assert.equal(s.status, "LOBBY", "a restarted server is a clean lobby");
  } finally {
    for (const c of all) c.drop();
    await server.close();
  }
});

// --- malformed / hostile input -----------------------------------------------------------------------------

test("Garbage in every shape, from every role, never crashes the server or disturbs other players", async () => {
  await withServer({}, async ({ mk, admin, screen, server }) => {
    const driver = await mk({ role: "driver", team: "red" });
    const booster = await mk({ role: "booster", team: "red" });
    const bystander = await mk({ role: "booster", team: "blue" });
    await start(admin, screen);

    const deep = "[".repeat(5000) + "]".repeat(5000);
    const garbage: (string | object)[] = [
      "", " ", "null", "true", "0", "[]", "{}", '"str"', "{", '{"type":', "\u0000\u0001\u0002", "\ud800", // lone surrogate
      deep, '{"type":"BOOST","__proto__":{"role":"admin"}}', '{"__proto__":{"type":"CONTROL","action":"START"}}',
      '{"type":"constructor"}', '{"type":"toString"}', '{"type":"__proto__"}', { type: "BOOST", team: { $ne: 1 }, amount: 1e309 },
      { type: "DRIVER_STEER", value: null }, { type: "DRIVER_STEER", value: NaN as unknown as number }, { type: "DRIVER_STEER", value: {} },
      { type: "HELLO", protocolVersion: 1, role: "admin", adminKey: 123 }, { type: "CONTROL", action: ["START"] },
      { type: ["BOOST"] }, { type: "PING", t: 1e400 }, { type: "PING" }, { t: 1 }, [{ type: "BOOST" }], 
    ];
    for (const who of [driver, booster, bystander, screen]) {
      for (const g of garbage) who.send(g);
      who.sendRaw(Buffer.from([0xff, 0xfe, 0x00, 0x01]), true);
    }
    // A frame over the hard ceiling costs its sender the connection, and only that.
    const rude = await mk({ role: "booster", team: "green" });
    rude.sendRaw("x".repeat(70_000));
    await rude.waitForClose();
    await sleep(500);

    // The server is alive, in the same race, and every legitimate client still works.
    assert.equal(server.engine.status, "RACING");
    const alive = [driver, booster, bystander, screen].filter((c) => !c.isClosed);
    assert.equal(alive.length, 4, "one well-formed-enough connection is never dropped for garbage of normal size");
    const fresh = await mk({ role: "booster", team: "green" });
    const mark = fresh.mark();
    fresh.send({ type: "PING", t: 7 });
    await fresh.waitFor((m) => m.type === "PONG" && m.t === 7, { from: mark });
    const before = server.engine.boostTotals().blue;
    if (!bystander.isClosed) {
      bystander.send({ type: "BOOST" });
      await sleep(150);
      assert.equal(server.engine.boostTotals().blue, before + 1, "a normal boost still works after the garbage");
    }
    // nobody escalated to admin / changed the race
    assert.equal(server.engine.status, "RACING");
    assert.ok(screen.latestState());
  });
});

// --- duplicate connections -------------------------------------------------------------------------------------

test("Duplicate connections (refresh storms): 20 rapid reconnects with one token leave exactly one live booster", async () => {
  await withServer({}, async ({ mk, url, screen }) => {
    const first = await mk({ role: "booster", team: "yellow" });
    const token = first.welcome!.token;
    const rest: SimClient[] = [];
    for (let i = 0; i < 20; i++) rest.push(await mk({ role: "booster", token }));
    const s = await screen.waitForState((st) => teamOf(st, "yellow").boosters === 1);
    await sleep(200);
    assert.equal(teamOf(screen.latestState()!, "yellow").boosters, 1, "never doubled");
    assert.equal(rest.filter((c) => !c.isClosed).length, 1, "only the newest socket is open");
    assert.equal(s.status, "LOBBY");
    void url;
  });
});

// --- Monad: RPC unavailable / demo -------------------------------------------------------------------------------

const liveChain = (rpc: { url: string }): ConfigOverrides => ({
  chain: {
    privateKey: generatePrivateKey(), contractAddress: CONTRACT, rpcUrls: [rpc.url], rpcTimeoutMs: 300,
    queue: { flushMs: 50, pollMs: 50, probeMs: 50, unavailableAfterMs: 250 },
  },
});

test("RPC dies mid-race: RACE_STATE says chainMode OFF (never LIVE), lobby says UNAVAILABLE, the race is unaffected; recovery returns to LIVE", async () => {
  const rpc = await startMockRpc(CONTRACT);
  try {
    await withServer(liveChain(rpc), async ({ mk, admin, screen, http }) => {
      const booster = await mk({ role: "booster", team: "red" });
      await mk({ role: "driver", team: "red" });
      await screen.waitForState((s) => s.chainMode === "LIVE");
      await start(admin, screen);

      rpc.down = true; // RPC dies; nobody is even boosting, the idle probe must notice
      const dead = await screen.waitForState((s) => s.chainMode === "OFF", { timeoutMs: 4000 });
      const lobby = async () => (await (await fetch(`${http}/api/metrics`)).json()) as { blockchain: { chainMode: string; chainState: string; rpcHealthy: boolean; unsentBoosts: number } };
      assert.deepEqual([(await lobby()).blockchain.chainState, (await lobby()).blockchain.rpcHealthy], ["UNAVAILABLE", false]);

      // the race is completely unaffected
      const pos = teamOf(dead, "red").position;
      for (let i = 0; i < 25; i++) booster.send({ type: "BOOST" });
      const s = await screen.waitForState((st) => teamOf(st, "red").boostRate >= 25 && teamOf(st, "red").position > pos);
      assert.equal(s.status, "RACING");
      assert.equal(s.chainMode, "OFF", "still not claiming LIVE");
      assert.equal((await lobby()).blockchain.unsentBoosts, 25, "boosts are queued for later");

      rpc.down = false;
      const mark = screen.mark();
      const back = await screen.waitForState((st) => st.chainMode === "LIVE", { from: mark, timeoutMs: 6000 });
      assert.ok(back.status === "RACING" || back.status === "FINAL_LAP");
      await screen.waitForState((st) => st.metrics.transactionsSent >= 1, { timeoutMs: 6000 });
      assert.equal((await lobby()).blockchain.unsentBoosts, 0);
    });
  } finally {
    await rpc.close();
  }
});

test("RPC dead from the start: the game runs normally, chainMode stays OFF, then flips to LIVE when the node appears", async () => {
  const rpc = await startMockRpc(CONTRACT);
  rpc.down = true;
  try {
    await withServer(liveChain(rpc), async ({ mk, admin, screen }) => {
      const booster = await mk({ role: "booster", team: "blue" });
      const s0 = await screen.waitForState(() => true);
      assert.equal(s0.chainMode, "OFF");
      await start(admin, screen);
      for (let i = 0; i < 10; i++) booster.send({ type: "BOOST" });
      const s = await screen.waitForState((st) => teamOf(st, "blue").boostRate >= 10);
      assert.deepEqual([s.chainMode, s.metrics.transactionsSent, s.metrics.transactionsConfirmed], ["OFF", 0, 0]);
      rpc.down = false;
      await screen.waitForState((st) => st.chainMode === "LIVE", { timeoutMs: 6000 });
    });
  } finally {
    await rpc.close();
  }
});

test("A slow RPC (every call slower than the timeout) never slows the race", async () => {
  const rpc = await startMockRpc(CONTRACT);
  try {
    await withServer(liveChain(rpc), async ({ mk, admin, screen }) => {
      const booster = await mk({ role: "booster", team: "green" });
      await screen.waitForState((s) => s.chainMode === "LIVE");
      await start(admin, screen);
      rpc.delayMs = 2000;
      const t0 = performance.now();
      for (let i = 0; i < 40; i++) booster.send({ type: "BOOST" });
      await screen.waitForState((s) => teamOf(s, "green").boostRate >= 40);
      assert.ok(performance.now() - t0 < 300, "boosts visible without waiting for any RPC");
      // state broadcasts keep coming at full rate while the RPC is stuck
      const n0 = screen.ofType("RACE_STATE").length;
      await sleep(500);
      assert.ok(screen.ofType("RACE_STATE").length - n0 >= 15, "RACE_STATE keeps flowing");
    });
  } finally {
    await rpc.close();
  }
});

test("DEMO_MODE=true: chainMode is DEMO in RACE_STATE and the lobby; counters move, are simulated, and never claim LIVE", async () => {
  await withServer({ chain: { demo: true, queue: { ...DEFAULT_QUEUE_OPTIONS, flushMs: 50, pollMs: 50 } } as ConfigOverrides["chain"] }, async ({ mk, admin, screen, http }) => {
    const booster = await mk({ role: "booster", team: "yellow" });
    await start(admin, screen);
    for (let i = 0; i < 10; i++) booster.send({ type: "BOOST" });
    const s = await screen.waitForState((st) => st.metrics.transactionsConfirmed >= 1, { timeoutMs: 5000 });
    assert.equal(s.chainMode, "DEMO");
    assert.ok(screen.ofType("RACE_STATE").every((m) => m.state.chainMode !== "LIVE"));
    const m = (await (await fetch(`${http}/api/metrics`)).json()) as { blockchain: { chainMode: string; chainState: string } };
    assert.deepEqual([m.blockchain.chainMode, m.blockchain.chainState], ["DEMO", "DEMO"]);
  });
});

test("no chain configured: chainMode OFF, chain counters zero", async () => {
  await withServer({}, async ({ screen }) => {
    const s = await screen.waitForState(() => true);
    assert.deepEqual([s.chainMode, s.metrics.transactionsSent, s.metrics.transactionsConfirmed, s.metrics.eventsReceived], ["OFF", 0, 0, 0]);
  });
});

// --- ChainQueue state machine (deterministic clock) -----------------------------------------------------------------

test("queue: a short RPC blip does not flip chainMode; a long outage does; recovery flips it back; unverified chain is never LIVE", async () => {
  let t = 1_000_000;
  const now = () => t;
  let down = false;
  const adapter = {
    mode: "LIVE" as const,
    async init() { if (down) throw new Error("ECONNREFUSED"); },
    async ping() { if (down) throw new Error("ECONNREFUSED"); },
    async submit() { if (down) throw new Error("ECONNREFUSED"); return "0x1"; },
    async check() { return { state: "pending" as const }; },
  };
  const q = new ChainQueue(adapter, { ...DEFAULT_QUEUE_OPTIONS, unavailableAfterMs: 10_000, probeMs: 1000 }, () => {}, now);

  down = true;
  await q.start(); q.stop(); // init fails: not verified yet
  assert.equal(q.status().chainMode, "OFF", "an unverified real chain is not LIVE");
  down = false;
  t += 2000;
  q.record("red", 1);
  await q.flush();
  assert.equal(q.status().chainMode, "LIVE");

  down = true;
  t += 2000; await q.flush(); // idle probe fails
  assert.equal(q.status().chainMode, "LIVE", "2 s blip: still LIVE");
  t += 10_000; await q.flush();
  assert.deepEqual([q.status().chainMode, q.status().chainState], ["OFF", "UNAVAILABLE"]);
  down = false;
  t += 2000; await q.flush();
  assert.equal(q.status().chainMode, "LIVE");
});
