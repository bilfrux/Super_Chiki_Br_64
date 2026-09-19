// PART 8: end-to-end integration scenarios, exactly as Member A's game will experience them.
// Real server, real WebSockets, one SimClient per phone/screen. EVERY message every client receives
// is checked against the protocol (test/wire.ts): shape, ranges, and whether that role may receive it.
//
//   S0 cadence          S1 1 driver          S2 1 booster        S3 4 drivers
//   S4 many boosters, full race, memes, winner                   S5 simultaneous BOOST from 200 clients
//   S6 driver disconnect S7 booster disconnect                   S8 Monad: delayed, then unavailable

import { test } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey } from "viem/accounts";
import { TEAM_IDS, type MemeConfig, type RaceState, type Role, type TeamId } from "../../shared/index.js";
import { DEFAULT_RACE_CONFIG } from "../src/engine.js";
import { loadConfig, type ConfigOverrides } from "../src/config.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { SimClient, sleep, type SimHello } from "../tools/simclient.js";
import { startMockRpc } from "./mockRpc.js";
import { assertWire } from "./wire.js";

const CONTRACT = "0x1234567890123456789012345678901234567890";
const teamOf = (s: RaceState, id: string) => s.teams.find((t) => t.id === id)!;

type World = {
  server: ServerHandle;
  http: string;
  mk(h: SimHello): Promise<SimClient>;
  admin: SimClient;
  screen: SimClient;
  start(): Promise<void>;
  /** Validate every message every client received, and that roles only got what they may. */
  wire(): void;
  /** Longest gap (ms) between consecutive RACE_STATE messages the screen got since `from`. */
  maxStateGap(from: number): number;
};

async function world(o: ConfigOverrides & { stateHz?: number; realLimits?: boolean; memes?: MemeConfig } , fn: (w: World) => Promise<void>): Promise<void> {
  const { stateHz, realLimits, ...rest } = o;
  const config = loadConfig({}, {
    port: 0, host: "127.0.0.1", adminKey: "k", tickHz: 60, stateHz: stateHz ?? 30, heartbeatMs: 60_000, helloTimeoutMs: 60_000,
    ...rest,
    race: { countdownSeconds: 0.05, secondsAtSpeed1: 600, ...rest.race },
    rate: realLimits ? {} : { boostRatePerSec: 100_000, boostBurst: 100_000, steerRatePerSec: 100_000, maxMessagesPerSec: 100_000 },
  });
  const server = await startServer(config, () => {});
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const clients: { role: Role; c: SimClient }[] = [];
  const mk = async (h: SimHello) => { const c = new SimClient(url); clients.push({ role: h.role as Role, c }); return c.join(h); };
  try {
    const admin = await mk({ role: "admin", adminKey: "k" });
    const screen = await mk({ role: "screen" });
    const w: World = {
      server, http: `http://127.0.0.1:${server.port}`, mk, admin, screen,
      start: async () => { admin.send({ type: "CONTROL", action: "START" }); await screen.waitForState((s) => s.status === "RACING", { from: screen.mark() }); },
      wire: () => { for (const { role, c } of clients) assertWire(role, c.messages); },
      maxStateGap: (from) => {
        const t = screen.messages.map((m, i) => (i >= from && m.type === "RACE_STATE" ? screen.times[i]! : -1)).filter((x) => x >= 0);
        let gap = 0;
        for (let i = 1; i < t.length; i++) gap = Math.max(gap, t[i]! - t[i - 1]!);
        return gap;
      },
    };
    await fn(w);
    w.wire(); // final protocol check over everything received in the scenario
  } finally {
    for (const { c } of clients) c.drop();
    await server.close();
  }
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const boostAmount = (c: SimClient, team: string, from = 0) => sum(c.ofType("BOOST", from).filter((m) => m.team === team).map((m) => m.amount));

// -------------------------------------------------------------------------------------------------------------------

test("S0 broadcast cadence with the DEFAULT rates: RACE_STATE 15-20 Hz, TEAM_ACTIVITY ~4 Hz, immediate snapshot on connect", async (t) => {
  const config = loadConfig({}, { port: 0, host: "127.0.0.1", adminKey: "k" });
  assert.equal(config.stateHz, 20);
  await world({ stateHz: config.stateHz }, async (w) => {
    const b = await w.mk({ role: "booster", team: "red" });
    // immediate state right after WELCOME, before any periodic one
    const types = b.messages.slice(0, 2).map((m) => m.type);
    assert.deepEqual(types, ["WELCOME", "RACE_STATE"]);
    await w.start();
    const from = w.screen.mark();
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) { b.send({ type: "BOOST" }); await sleep(50); } // steady 20 boosts/s for 2 s
    const secs = (performance.now() - t0) / 1000;
    const states = w.screen.ofType("RACE_STATE", from).length / secs;
    const activity = w.screen.ofType("TEAM_ACTIVITY", from).filter((m) => m.team === "red").length / secs;
    t.diagnostic(`RACE_STATE ${states.toFixed(1)} Hz, TEAM_ACTIVITY ${activity.toFixed(1)} Hz`);
    assert.ok(states >= 15 && states <= 21, `RACE_STATE ${states.toFixed(1)} Hz`);
    assert.ok(activity >= 2 && activity <= 5, `TEAM_ACTIVITY ${activity.toFixed(1)} Hz`);
  });
});

test("S1 one Driver: DRIVER_STEER -> server -> authoritative state -> screen event; the car drives", async () => {
  await world({}, async (w) => {
    const d = await w.mk({ role: "driver", team: "red" });
    assert.deepEqual([d.welcome?.role, d.welcome?.team, d.welcome?.permissions], ["driver", "red", ["STEER"]]);
    await w.start();
    const from = w.screen.mark();
    for (const v of [0.5, -0.3, 2, -7, 0]) { d.send({ type: "DRIVER_STEER", value: v }); await sleep(40); }
    d.send({ type: "DRIVER_STEER", value: -0.6 });
    await w.screen.waitForState((s) => teamOf(s, "red").steer === -0.6, { from });

    const steers = w.screen.ofType("DRIVER_STEER", from);
    assert.ok(steers.every((m) => m.team === "red" && Math.abs(m.value) <= 1), "events name the team and are clamped");
    assert.ok(steers.some((m) => m.value === 1) && steers.some((m) => m.value === -1), "out-of-range values were clamped, not rejected");
    assert.equal(steers[steers.length - 1]!.value, -0.6);
    // ordering guarantee: the first snapshot after the last event already contains that steer
    const lastEvent = w.screen.messages.map((m, i) => ({ m, i })).filter(({ m }) => m.type === "DRIVER_STEER").pop()!;
    const next = w.screen.messages.slice(lastEvent.i + 1).find((m) => m.type === "RACE_STATE");
    assert.equal(teamOf((next as { state: RaceState }).state, "red").steer, -0.6);

    // the driver is a phone: no BOOST / DRIVER_STEER echo, only RACE_STATE, TEAM_ACTIVITY, MEME_EVENT
    assert.equal(d.ofType("DRIVER_STEER").length + d.ofType("BOOST").length, 0);
    const s = w.screen.latestState()!;
    assert.deepEqual([teamOf(s, "red").driverConnected, teamOf(s, "blue").driverConnected], [true, false]);
    assert.ok(teamOf(s, "red").position > 0 && Math.abs(teamOf(s, "red").speed - DEFAULT_RACE_CONFIG.baseSpeed) < 1e-6, "driver connected: full base speed");
    assert.equal(w.screen.errors().length + d.errors().length, 0);
  });
});

test("S2 one Booster: BOOST -> server -> BOOST/TEAM_ACTIVITY events + authoritative boostRate; no driver = safe speed", async () => {
  await world({}, async (w) => {
    const b = await w.mk({ role: "booster", team: "green" });
    assert.deepEqual([b.welcome?.role, b.welcome?.team, b.welcome?.permissions, b.welcome?.boostsSent], ["booster", "green", ["BOOST"], 0]);
    await w.screen.waitForState((s) => teamOf(s, "green").boosters === 1);
    await w.start();
    const from = w.screen.mark();
    for (let i = 0; i < 12; i++) b.send({ type: "BOOST" });
    await w.screen.waitForState((s) => teamOf(s, "green").boostRate >= 12, { from });
    await sleep(300);

    assert.equal(boostAmount(w.screen, "green", from), 12, "BOOST events aggregate to exactly the accepted boosts");
    const act = w.screen.ofType("TEAM_ACTIVITY", from).filter((m) => m.team === "green");
    assert.ok(act.length >= 1 && act.some((m) => m.rate > 0), "TEAM_ACTIVITY carries the team rate");
    assert.equal(b.ofType("BOOST").length, 0, "the booster's phone does not get BOOST effects, only screens do");
    assert.ok(b.ofType("TEAM_ACTIVITY").length >= 1, "but it does get TEAM_ACTIVITY");
    // ordering: the first RACE_STATE after a BOOST event already reflects it
    const ev = w.screen.messages.map((m, i) => ({ m, i })).find(({ m, i }) => i >= from && m.type === "BOOST")!;
    const after = w.screen.messages.slice(ev.i + 1).find((m) => m.type === "RACE_STATE") as { state: RaceState };
    assert.ok(teamOf(after.state, "green").boostRate >= 1 && teamOf(after.state, "green").boostEnergy > 0);
    const s = w.screen.latestState()!;
    assert.ok(teamOf(s, "green").speed <= DEFAULT_RACE_CONFIG.safeSpeed + 1e-9, "no driver: capped at safe speed");
    assert.equal(teamOf(s, "blue").boostRate, 0);
  });
});

test("S3 four Drivers: independent steering, all four cars move, fifth driver is refused with SEAT_TAKEN", async () => {
  await world({}, async (w) => {
    const ds = new Map<TeamId, SimClient>();
    for (const t of TEAM_IDS) ds.set(t, await w.mk({ role: "driver", team: t }));
    const fifth = new SimClient(`ws://127.0.0.1:${w.server.port}/ws`);
    await fifth.join({ role: "driver" });
    assert.equal(fifth.errors()[0]?.code, "SEAT_TAKEN");
    fifth.drop();

    await w.start();
    const want: Record<string, number> = { red: -1, blue: -0.25, green: 0.25, yellow: 1 };
    for (const t of TEAM_IDS) ds.get(t)!.send({ type: "DRIVER_STEER", value: want[t]! });
    const s = await w.screen.waitForState((st) => TEAM_IDS.every((t) => teamOf(st, t).steer === want[t]), { from: w.screen.mark() });
    assert.ok(TEAM_IDS.every((t) => teamOf(s, t).driverConnected));
    await sleep(200);
    const later = w.screen.latestState()!;
    assert.ok(TEAM_IDS.every((t) => teamOf(later, t).position > 0 && teamOf(later, t).speed > 0.4), "everyone is driving");
    assert.deepEqual(later.teams.map((t) => t.id), [...TEAM_IDS], "teams always in protocol order");
    for (const t of TEAM_IDS) assert.equal(w.screen.ofType("DRIVER_STEER").filter((m) => m.team === t && m.value === want[t]).length >= 1, true);
  });
});

test("S4 many Boosters + 4 Drivers, a whole race: TEAM_ACTIVITY, MEME_EVENT (once per team), CHAOS, FINAL_LAP, winner", async () => {
  const memes: MemeConfig = { memes: [
    { id: "MEME_DROP", name: "MEME DROP", threshold: 15, duration: 1, visual: "meme_drop", sound: "meme_drop", effect: "NONE" },
    { id: "CHAOS_MODE", name: "CHAOS MODE", threshold: 45, duration: 1.5, visual: "chaos_mode", sound: "chaos_mode", effect: "CHAOS" },
  ] };
  await world({ memes, race: { secondsAtSpeed1: 6 } as ConfigOverrides["race"] }, async (w) => {
    for (const t of TEAM_IDS) await w.mk({ role: "driver", team: t });
    const rates: Record<string, number> = { red: 3, blue: 2, green: 1, yellow: 0 }; // boosters per team
    const boosters: { c: SimClient; team: TeamId }[] = [];
    for (const t of TEAM_IDS) for (let i = 0; i < rates[t]!; i++) boosters.push({ c: await w.mk({ role: "booster", team: t }), team: t });
    await w.screen.waitForState((s) => teamOf(s, "red").boosters === 3 && teamOf(s, "yellow").driverConnected);
    const sawStatus = new Set<string>();
    await w.start();
    const from = w.screen.mark();

    // every booster taps ~10/s until there is a winner
    let winner: RaceState | undefined;
    const deadline = Date.now() + 25_000;
    while (!winner && Date.now() < deadline) {
      for (const { c } of boosters) c.send({ type: "BOOST" });
      await sleep(100);
      const s = w.screen.latestState()!;
      sawStatus.add(s.status);
      if (s.status === "FINISHED") winner = s;
    }
    assert.ok(winner, "the race finished");
    assert.equal(winner.winner, "red", "the team with the most boosters wins");
    assert.ok(TEAM_IDS.every((t) => teamOf(winner!, t).position <= 1));
    for (const st of ["RACING", "FINAL_LAP"]) assert.ok(sawStatus.has(st) || w.screen.ofType("RACE_STATE", from).some((m) => m.state.status === st), `saw ${st}`);
    assert.ok(w.screen.ofType("RACE_STATE", from).some((m) => m.state.status === "CHAOS"), "saw CHAOS");

    // MEME_EVENT: once per team per meme, only for teams that reached it, delivered to everybody
    const memeEvents = w.screen.ofType("MEME_EVENT", from);
    const key = (m: { team: string; event: { id: string } }) => `${m.team}/${m.event.id}`;
    assert.equal(new Set(memeEvents.map(key)).size, memeEvents.length, "no meme fires twice for a team");
    assert.ok(memeEvents.some((m) => m.team === "red" && m.event.id === "CHAOS_MODE"));
    assert.ok(!memeEvents.some((m) => m.team === "yellow"), "a team with no boosts gets no memes");
    for (const t of TEAM_IDS) if (rates[t]! > 0) assert.ok(w.screen.ofType("TEAM_ACTIVITY", from).some((m) => m.team === t && m.rate > 0), `TEAM_ACTIVITY for ${t}`);
    // phones get MEME_EVENT too (their UI reacts to it)
    assert.ok(boosters[0]!.c.ofType("MEME_EVENT").length >= 1);
    // the FINISHED state is frozen and boosts after it are ignored
    const before = w.server.engine.boostTotals().red;
    boosters[0]!.c.send({ type: "BOOST" });
    await sleep(100);
    assert.equal(w.server.engine.boostTotals().red, before);
    assert.equal(w.screen.errors().length, 0);
  });
});

test("S5 simultaneous BOOST from 200 clients (real rate limits): all counted, no errors, the state stream never stalls", async (t) => {
  await world({ realLimits: true, stateHz: 20 }, async (w) => {
    const phones: SimClient[] = [];
    for (let i = 0; i < 200; i++) phones.push(await w.mk({ role: "booster", team: TEAM_IDS[i % 4] }));
    for (const t of TEAM_IDS) await w.mk({ role: "driver", team: t });
    await w.screen.waitForState((s) => TEAM_IDS.every((t) => teamOf(s, t).boosters === 50), { from: w.screen.mark() });
    await w.start();
    const from = w.screen.mark();
    const t0 = performance.now();
    for (let n = 0; n < 10; n++) for (const p of phones) p.send({ type: "BOOST" }); // 2000 boosts in one synchronous burst
    const s = await w.screen.waitForState((st) => st.metrics.boostsPerSecond >= 1900, { from, timeoutMs: 5000 });
    const ms = performance.now() - t0;
    await sleep(400);

    assert.equal(sum(Object.values(w.server.engine.boostTotals())), 2000, "every accepted boost counted exactly once");
    for (const t of TEAM_IDS) assert.equal(boostAmount(w.screen, t, from), 500, `BOOST events for ${t} add up`);
    assert.ok(phones.every((p) => p.errors().length === 0 && !p.isClosed), "10 boosts inside the burst allowance: nobody limited or dropped");
    assert.ok(s.metrics.actionsPerSecond >= s.metrics.boostsPerSecond);
    assert.ok(ms < 2000, `burst visible in ${ms.toFixed(0)} ms`);
    const gap = w.maxStateGap(from);
    t.diagnostic(`2000 boosts from 200 clients visible in ${ms.toFixed(0)} ms; longest RACE_STATE gap ${gap.toFixed(0)} ms (nominal 50)`);
    assert.ok(gap < 250, `RACE_STATE never stalled: longest gap ${gap.toFixed(0)} ms (nominal 50 ms)`);
  });
});

test("S6 Driver disconnect: driverConnected false + safe speed in the very next snapshot, others unaffected, seat resumes", async () => {
  await world({}, async (w) => {
    const ds = new Map<TeamId, SimClient>();
    for (const t of TEAM_IDS) ds.set(t, await w.mk({ role: "driver", team: t }));
    const b = await w.mk({ role: "booster", team: "blue" });
    await w.start();
    for (let i = 0; i < 6; i++) b.send({ type: "BOOST" });
    await w.screen.waitForState((s) => teamOf(s, "blue").speed > 0.6, { from: w.screen.mark() });
    const mark = w.screen.mark();
    ds.get("blue")!.drop();
    const off = await w.screen.waitForState((s) => !teamOf(s, "blue").driverConnected, { from: mark });
    assert.ok(teamOf(off, "blue").speed <= DEFAULT_RACE_CONFIG.safeSpeed + 1e-9 && teamOf(off, "blue").steer === 0);
    assert.ok(TEAM_IDS.filter((t) => t !== "blue").every((t) => teamOf(off, t).driverConnected && teamOf(off, t).speed >= 0.49));
    const back = await w.mk({ role: "driver", token: ds.get("blue")!.welcome!.token });
    await w.screen.waitForState((s) => teamOf(s, "blue").driverConnected, { from: w.screen.mark() });
    assert.equal(back.welcome?.team, "blue");
  });
});

test("S7 Booster disconnect: boosters count drops in the next snapshot, remaining boosters keep working", async () => {
  await world({}, async (w) => {
    await w.mk({ role: "driver", team: "yellow" });
    const a = await w.mk({ role: "booster", team: "yellow" });
    const b = await w.mk({ role: "booster", team: "yellow" });
    await w.screen.waitForState((s) => teamOf(s, "yellow").boosters === 2, { from: w.screen.mark() });
    await w.start();
    const mark = w.screen.mark();
    a.drop();
    await w.screen.waitForState((s) => teamOf(s, "yellow").boosters === 1, { from: mark });
    for (let i = 0; i < 5; i++) b.send({ type: "BOOST" });
    await w.screen.waitForState((s) => teamOf(s, "yellow").boostRate >= 5, { from: mark });
    assert.equal(w.screen.latestState()!.status, "RACING");
    assert.ok(teamOf(w.screen.latestState()!, "yellow").driverConnected);
  });
});

test("S8 Monad delayed, then unavailable: race and cadence unaffected; chain metrics only ever reflect real results", async (t) => {
  const rpc = await startMockRpc(CONTRACT);
  try {
    await world({
      stateHz: 30,
      chain: { privateKey: generatePrivateKey(), contractAddress: CONTRACT, rpcUrls: [rpc.url], rpcTimeoutMs: 300,
        queue: { flushMs: 50, pollMs: 50, probeMs: 50, unavailableAfterMs: 250 } } as ConfigOverrides["chain"],
    }, async (w) => {
      const driver = await w.mk({ role: "driver", team: "red" });
      const booster = await w.mk({ role: "booster", team: "red" });
      await w.screen.waitForState((s) => s.chainMode === "LIVE");
      await w.start();
      const from = w.screen.mark();

      // (a) Monad -> async chain activity -> metrics: sent, then confirmed only after finalization
      for (let i = 0; i < 20; i++) booster.send({ type: "BOOST" });
      const sent = await w.screen.waitForState((s) => s.metrics.transactionsSent >= 1, { from, timeoutMs: 5000 });
      assert.equal(sent.metrics.transactionsConfirmed, 0);
      rpc.include();
      rpc.finalizedBlock = rpc.includeAtBlock - 1;
      await sleep(300);
      assert.equal(w.screen.latestState()!.metrics.transactionsConfirmed, 0, "included but not finalized: not confirmed");
      rpc.finalizedBlock = rpc.includeAtBlock;
      const conf = await w.screen.waitForState((s) => s.metrics.transactionsConfirmed >= 1 && s.metrics.eventsReceived >= 1, { from, timeoutMs: 5000 });
      // all roles see the same chain numbers
      await sleep(100);
      for (const c of [driver, booster]) assert.ok(c.latestState()!.metrics.transactionsConfirmed >= conf.metrics.transactionsConfirmed);

      // (b) delayed confirmation: slow RPC; the state stream keeps its cadence and boosts stay instant
      rpc.delayMs = 1500;
      const m1 = w.screen.mark();
      const t0 = performance.now();
      for (let i = 0; i < 30; i++) booster.send({ type: "BOOST" });
      await w.screen.waitForState((s) => teamOf(s, "red").boostRate >= 30, { from: m1 });
      assert.ok(performance.now() - t0 < 300, "boost visible without waiting for Monad");
      await sleep(1200);
      assert.ok(w.maxStateGap(m1) < 200, `state stream steady during slow RPC: gap ${w.maxStateGap(m1).toFixed(0)} ms`);

      // (c) RPC unavailable: chainMode OFF, race and boosting unaffected, cadence steady
      rpc.delayMs = 0;
      rpc.down = true;
      const m2 = w.screen.mark();
      await w.screen.waitForState((s) => s.chainMode === "OFF", { from: m2, timeoutMs: 5000 });
      const pos = teamOf(w.screen.latestState()!, "red").position;
      for (let i = 0; i < 20; i++) booster.send({ type: "BOOST" });
      await sleep(700);
      const s2 = w.screen.latestState()!;
      assert.ok(s2.status === "RACING" && teamOf(s2, "red").position > pos, "car keeps driving");
      assert.equal(s2.chainMode, "OFF");
      assert.ok(w.maxStateGap(m2) < 200, `state stream steady with RPC down: gap ${w.maxStateGap(m2).toFixed(0)} ms`);
      assert.equal(w.screen.errors().length + booster.errors().length + driver.errors().length, 0);
      t.diagnostic(`longest RACE_STATE gap: slow RPC ${w.maxStateGap(m1).toFixed(0)} ms, RPC down ${w.maxStateGap(m2).toFixed(0)} ms (nominal 33)`);

      // (d) it comes back by itself
      rpc.down = false;
      await w.screen.waitForState((s) => s.chainMode === "LIVE", { from: w.screen.mark(), timeoutMs: 6000 });
    });
  } finally {
    await rpc.close();
  }
});

test("wire validator is not vacuous: it rejects unknown keys, bad ranges and messages a role must not receive", () => {
  const good = { type: "BOOST", team: "red", amount: 3 } as const;
  assertWire("screen", [good]);
  assert.throws(() => assertWire("driver", [good]), /must not receive/);
  assert.throws(() => assertWire("screen", [{ ...good, extra: 1 } as never]), /unexpected key/);
  assert.throws(() => assertWire("screen", [{ ...good, team: "purple" } as never]), /bad team/);
  assert.throws(() => assertWire("screen", [{ type: "DRIVER_STEER", team: "red", value: 2 }]), /DRIVER_STEER.value/);
  assert.throws(() => assertWire("screen", [{ type: "RACE_STATE", state: { status: "RACING" } } as never]), /missing/);
});
