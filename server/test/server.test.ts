// Integration tests: a real server on an ephemeral port, real WebSocket clients.
// "#N" refers to rows of shared/protocol/TEST_MATRIX.md.

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROTOCOL_VERSION, TEAM_IDS, type MemeConfig, type RaceState } from "../../shared/index.js";
import { loadConfig, type ConfigOverrides } from "../src/config.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { SimClient, sleep, type SimHello } from "../tools/simclient.js";

const BASE: ConfigOverrides = {
  port: 0,
  host: "127.0.0.1",
  adminKey: "test-key",
  tickHz: 60,
  stateHz: 60,
  activityHz: 10,
  heartbeatMs: 60_000,
  helloTimeoutMs: 60_000,
  race: { countdownSeconds: 0.1, secondsAtSpeed1: 30 },
  // Functional tests run without rate limits in the way; limit tests opt back in.
  rate: { boostRatePerSec: 100_000, boostBurst: 100_000, steerRatePerSec: 100_000, maxMessagesPerSec: 100_000 },
};

type Ctx = {
  server: ServerHandle;
  url: string;
  client(hello: SimHello): Promise<SimClient>;
  raw(options?: ConstructorParameters<typeof SimClient>[1]): Promise<SimClient>;
  admin(): Promise<SimClient>;
  screen(): Promise<SimClient>;
  start(admin: SimClient, screen: SimClient): Promise<void>;
};

async function withServer(overrides: ConfigOverrides, fn: (ctx: Ctx) => Promise<void>): Promise<void> {
  const config = loadConfig({}, {
    ...BASE,
    ...overrides,
    race: { ...BASE.race, ...overrides.race },
    rate: { ...BASE.rate, ...overrides.rate },
  });
  const server = await startServer(config, () => {});
  const url = `ws://127.0.0.1:${server.port}/ws`;
  const clients: SimClient[] = [];
  const ctx: Ctx = {
    server,
    url,
    client: async (hello) => { const c = new SimClient(url); clients.push(c); return c.join(hello); },
    raw: async (options) => { const c = new SimClient(url, options); clients.push(c); return c.connect(); },
    admin: () => ctx.client({ role: "admin", adminKey: "test-key" }),
    screen: () => ctx.client({ role: "screen" }),
    start: async (admin, screen) => {
      admin.send({ type: "CONTROL", action: "START" });
      await screen.waitForState((s) => s.status === "RACING");
    },
  };
  try {
    await fn(ctx);
  } finally {
    for (const c of clients) c.drop();
    await server.close();
  }
}

const teamOf = (s: RaceState, id: string) => s.teams.find((t) => t.id === id)!;

// --- #1, #2, #6 connections and state ---------------------------------------------------

test("#1 driver connects: WELCOME with team, STEER permission, token; driverConnected in state", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const d = await ctx.client({ role: "driver" });
    assert.equal(d.welcome?.role, "driver");
    assert.equal(d.welcome?.protocolVersion, PROTOCOL_VERSION);
    assert.ok(TEAM_IDS.includes(d.welcome!.team!));
    assert.deepEqual(d.welcome?.permissions, ["STEER"]);
    assert.ok(d.welcome!.token.length >= 16 && d.welcome!.playerId.length > 0);
    const s = await screen.waitForState((x) => teamOf(x, d.welcome!.team!).driverConnected);
    assert.equal(teamOf(s, d.welcome!.team!).driverConnected, true);
  });
});

test("#2 booster connects: WELCOME with team, BOOST permission, boostsSent 0; boosters counted", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const b = await ctx.client({ role: "booster", team: "green" });
    assert.equal(b.welcome?.team, "green");
    assert.deepEqual(b.welcome?.permissions, ["BOOST"]);
    assert.equal(b.welcome?.boostsSent, 0);
    const s = await screen.waitForState((x) => teamOf(x, "green").boosters === 1);
    assert.equal(teamOf(s, "green").boosters, 1);
  });
});

test("#6 every new connection gets RACE_STATE right after WELCOME; then periodic snapshots with 4 teams in order", async () => {
  await withServer({}, async (ctx) => {
    for (const hello of [{ role: "screen" }, { role: "booster" }, { role: "driver" }, { role: "admin", adminKey: "test-key" }]) {
      const c = await ctx.client(hello);
      assert.equal(c.messages[0]?.type, "WELCOME");
      assert.equal(c.messages[1]?.type, "RACE_STATE", `${hello.role} gets an immediate snapshot`);
    }
    const screen = await ctx.screen();
    const before = screen.ofType("RACE_STATE").length;
    await sleep(250);
    const after = screen.ofType("RACE_STATE");
    assert.ok(after.length - before >= 5, `expected periodic snapshots, got ${after.length - before}`);
    assert.deepEqual(after[after.length - 1]!.state.teams.map((t) => t.id), ["red", "blue", "green", "yellow"]);
    assert.equal(after[after.length - 1]!.state.status, "LOBBY");
  });
});

test("team assignment: boosters spread to the team with fewest players; preference is honoured", async () => {
  await withServer({}, async (ctx) => {
    const teams: string[] = [];
    for (let i = 0; i < 8; i++) teams.push((await ctx.client({ role: "booster" })).welcome!.team!);
    assert.deepEqual(teams, ["red", "blue", "green", "yellow", "red", "blue", "green", "yellow"]);
    assert.equal((await ctx.client({ role: "booster", team: "yellow" })).welcome?.team, "yellow");
  });
});

// --- #3 #4 #5 steering and boosting ----------------------------------------------------

test("#3 DRIVER_STEER updates the team's steer; screens get the event; out-of-range is clamped", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const driver = await ctx.client({ role: "driver", team: "red" });
    await ctx.start(admin, screen);

    let mark = screen.mark();
    driver.send({ type: "DRIVER_STEER", value: 0.5 });
    await screen.waitFor((m) => m.type === "DRIVER_STEER" && m.team === "red" && m.value === 0.5, { from: mark });
    const s = await screen.waitForState((x) => teamOf(x, "red").steer === 0.5, { from: mark });
    assert.equal(teamOf(s, "blue").steer, 0);

    mark = screen.mark();
    driver.send({ type: "DRIVER_STEER", value: 5 });
    await screen.waitForState((x) => teamOf(x, "red").steer === 1, { from: mark });
    driver.send({ type: "DRIVER_STEER", value: -99 });
    await screen.waitForState((x) => teamOf(x, "red").steer === -1, { from: mark });
  });
});

test("#4/#5 BOOST: server validates, updates TeamState, then notifies; snapshot after the event reflects it", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const booster = await ctx.client({ role: "booster", team: "blue" });
    const driver = await ctx.client({ role: "driver", team: "red" });
    await ctx.start(admin, screen);

    const mark = screen.mark();
    booster.send({ type: "BOOST" });
    const ev = await screen.waitFor((m) => m.type === "BOOST" && m.team === "blue", { from: mark });
    assert.ok(ev.type === "BOOST" && ev.amount >= 1);
    // The next snapshot after the event already contains its effect (state is updated first).
    const idx = screen.messages.indexOf(ev);
    const next = await screen.waitFor((m) => m.type === "RACE_STATE", { from: idx + 1 });
    assert.ok(next.type === "RACE_STATE");
    const blue = teamOf(next.state, "blue");
    assert.ok(blue.boostEnergy > 0 && blue.boostRate >= 1, "state reflects the boost");
    assert.equal(teamOf(next.state, "red").boostEnergy, 0);
    assert.ok(next.state.metrics.boostsPerSecond >= 1);

    // Phones do not receive per-boost / per-steer events, only state, activity and memes.
    driver.send({ type: "DRIVER_STEER", value: 0.2 });
    await sleep(150);
    for (const phone of [booster, driver]) {
      assert.equal(phone.ofType("BOOST").length, 0);
      assert.equal(phone.ofType("DRIVER_STEER").length, 0);
      assert.ok(phone.ofType("RACE_STATE").length > 0);
    }
    assert.ok(booster.ofType("TEAM_ACTIVITY").some((m) => m.team === "blue"), "TEAM_ACTIVITY reaches phones");
  });
});

test("#23 client cannot choose boost size or team: extra fields are ignored", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const booster = await ctx.client({ role: "booster", team: "red" });
    await ctx.start(admin, screen);
    const mark = screen.mark();
    booster.send({ type: "BOOST", count: 999999, team: "blue", amount: 50 });
    const ev = await screen.waitFor((m) => m.type === "BOOST", { from: mark });
    assert.deepEqual({ team: (ev as { team: string }).team, amount: (ev as { amount: number }).amount }, { team: "red", amount: 1 });
    await sleep(100);
    const total = screen.ofType("BOOST", mark).reduce((a, m) => a + m.amount, 0);
    assert.equal(total, 1);
    assert.equal(teamOf(ctx.server.engine.snapshot(), "blue").boostEnergy, 0);
  });
});

// --- #7 #8 #9 #13 #26 control and permissions -----------------------------------------------

test("#7 CONTROL from screen, driver or booster is rejected with NOT_AUTHORIZED and changes nothing", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const others = [await ctx.client({ role: "booster" }), await ctx.client({ role: "driver" }), screen];
    for (const c of others) {
      const mark = c.mark();
      c.send({ type: "CONTROL", action: "START" });
      c.send({ type: "CONTROL", action: "RESET" });
      await c.waitFor((m) => m.type === "ERROR", { from: mark });
      await sleep(50);
      const errs = c.errors(mark);
      assert.equal(errs.length, 2);
      assert.ok(errs.every((e) => e.code === "NOT_AUTHORIZED" && e.message.length > 0));
    }
    await sleep(100);
    assert.equal(screen.latestState()?.status, "LOBBY");
  });
});

test("#8 admin START: COUNTDOWN (elapsed<0) → RACING (elapsed≥0); START again → INVALID_STATE", async () => {
  await withServer({ race: { countdownSeconds: 0.3 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    assert.ok(admin.welcome!.permissions.includes("CONTROL"));
    assert.deepEqual(screen.welcome!.permissions, []);

    admin.send({ type: "CONTROL", action: "START" });
    const cd = await screen.waitForState((s) => s.status === "COUNTDOWN");
    assert.ok(cd.elapsed < 0, `countdown elapsed ${cd.elapsed}`);
    const racing = await screen.waitForState((s) => s.status === "RACING");
    assert.ok(racing.elapsed >= 0);

    const mark = admin.mark();
    admin.send({ type: "CONTROL", action: "START" });
    const err = await admin.waitFor((m) => m.type === "ERROR", { from: mark });
    assert.ok(err.type === "ERROR" && err.code === "INVALID_STATE");
  });
});

test("#13 admin with a wrong key, no key, or on a server without ADMIN_KEY is refused and disconnected", async () => {
  await withServer({}, async (ctx) => {
    for (const hello of [{ role: "admin", adminKey: "nope" }, { role: "admin" }]) {
      const c = await ctx.client(hello);
      assert.equal(c.errors()[0]?.code, "NOT_AUTHORIZED");
      assert.equal(await c.waitForClose(), 1008);
      assert.equal(c.welcome, undefined);
    }
    // adminKey on a non-admin role is meaningless and harmless
    const b = await ctx.client({ role: "booster", adminKey: "test-key" });
    assert.deepEqual(b.welcome?.permissions, ["BOOST"]);
  });
  await withServer({ adminKey: undefined }, async (ctx) => {
    const c = await ctx.client({ role: "admin", adminKey: "anything" });
    assert.equal(c.errors()[0]?.code, "NOT_AUTHORIZED");
    assert.match(c.errors()[0]!.message, /disabled/i);
    assert.equal(await c.waitForClose(), 1008);
  });
});

test("#14 role limits: driver cannot BOOST; booster cannot DRIVER_STEER; screen cannot do either", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const driver = await ctx.client({ role: "driver", team: "red" });
    const booster = await ctx.client({ role: "booster", team: "red" });
    await ctx.start(admin, screen);
    const cases: [SimClient, unknown][] = [
      [driver, { type: "BOOST" }],
      [booster, { type: "DRIVER_STEER", value: 1 }],
      [screen, { type: "BOOST" }],
      [screen, { type: "DRIVER_STEER", value: 1 }],
      [admin, { type: "BOOST" }],
    ];
    for (const [c, msg] of cases) {
      const mark = c.mark();
      c.send(msg);
      const e = await c.waitFor((m) => m.type === "ERROR", { from: mark });
      assert.ok(e.type === "ERROR" && e.code === "NOT_AUTHORIZED");
    }
    await sleep(100);
    const red = teamOf(ctx.server.engine.snapshot(), "red");
    assert.deepEqual([red.boostEnergy, red.steer], [0, 0], "state unchanged");
  });
});

test("#9 admin RESET mid-race: back to LOBBY, race state zeroed, players stay connected on their teams", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const driver = await ctx.client({ role: "driver", team: "red" });
    const booster = await ctx.client({ role: "booster", team: "red" });
    await ctx.start(admin, screen);
    for (let i = 0; i < 10; i++) booster.send({ type: "BOOST" });
    driver.send({ type: "DRIVER_STEER", value: 0.8 });
    await screen.waitForState((s) => teamOf(s, "red").boostRate >= 10 && teamOf(s, "red").steer === 0.8 && teamOf(s, "red").position > 0);

    const mark = screen.mark();
    admin.send({ type: "CONTROL", action: "RESET" });
    const s = await screen.waitForState((x) => x.status === "LOBBY", { from: mark });
    assert.equal(s.elapsed, 0);
    assert.equal(s.winner, undefined);
    for (const t of s.teams) assert.deepEqual([t.position, t.speed, t.boostEnergy, t.boostRate, t.steer, t.activeEvent], [0, 0, 0, 0, 0, undefined]);
    assert.deepEqual([s.metrics.boostsPerSecond, s.metrics.actionsPerSecond], [0, 0]);
    assert.equal(teamOf(s, "red").driverConnected, true);
    assert.equal(teamOf(s, "red").boosters, 1);
    assert.equal(driver.isClosed || booster.isClosed, false);

    admin.send({ type: "CONTROL", action: "START" }); // a fresh race can start
    await screen.waitForState((x) => x.status === "RACING", { from: mark });
  });
});

test("#26 START only works in LOBBY; RESET works in every status", async () => {
  await withServer({ race: { countdownSeconds: 0.5, secondsAtSpeed1: 1 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const expectInvalid = async () => {
      const mark = admin.mark();
      admin.send({ type: "CONTROL", action: "START" });
      const e = await admin.waitFor((m) => m.type === "ERROR", { from: mark });
      assert.ok(e.type === "ERROR" && e.code === "INVALID_STATE");
    };
    const reset = async () => {
      const mark = screen.mark();
      admin.send({ type: "CONTROL", action: "RESET" });
      await screen.waitForState((s) => s.status === "LOBBY", { from: mark });
    };

    await reset(); // RESET in LOBBY is fine
    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "COUNTDOWN");
    await expectInvalid();
    await reset(); // from COUNTDOWN

    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "RACING");
    await expectInvalid();
    await reset(); // from RACING

    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "FINISHED", { timeoutMs: 8000 });
    await expectInvalid();
    await reset(); // from FINISHED
  });
});

// --- #10 #16 #17 sessions -----------------------------------------------------------------

test("#10 booster reconnect with token: same identity, team and boostsSent; no duplicate count", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const b = await ctx.client({ role: "booster", team: "yellow" });
    await ctx.start(admin, screen);
    for (let i = 0; i < 3; i++) b.send({ type: "BOOST" });
    await screen.waitForState((s) => teamOf(s, "yellow").boostRate >= 3);

    b.drop();
    await screen.waitForState((s) => teamOf(s, "yellow").boosters === 0);
    const again = await ctx.client({ role: "booster", token: b.welcome!.token });
    assert.equal(again.welcome?.playerId, b.welcome?.playerId);
    assert.equal(again.welcome?.token, b.welcome?.token);
    assert.equal(again.welcome?.team, "yellow");
    assert.equal(again.welcome?.boostsSent, 3);
    const s = await screen.waitForState((x) => teamOf(x, "yellow").boosters === 1);
    assert.equal(teamOf(s, "yellow").boosters, 1);
  });
});

test("#10 driver disconnect → safe mode (driverConnected=false); reconnect with token restores the seat", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const d = await ctx.client({ role: "driver", team: "green" });
    await screen.waitForState((s) => teamOf(s, "green").driverConnected);
    d.drop();
    const off = await screen.waitForState((s) => !teamOf(s, "green").driverConnected);
    assert.equal(teamOf(off, "green").steer, 0);
    const again = await ctx.client({ role: "driver", token: d.welcome!.token });
    assert.equal(again.welcome?.team, "green");
    assert.equal(again.welcome?.playerId, d.welcome?.playerId);
    await screen.waitForState((s) => teamOf(s, "green").driverConnected);
  });
});

test("a token only resumes an identity of the same role; unknown tokens create a new identity", async () => {
  await withServer({}, async (ctx) => {
    const b = await ctx.client({ role: "booster", team: "red" });
    const asDriver = await ctx.client({ role: "driver", token: b.welcome!.token });
    assert.notEqual(asDriver.welcome?.playerId, b.welcome?.playerId);
    const bogus = await ctx.client({ role: "booster", token: "does-not-exist" });
    assert.ok(bogus.welcome);
    assert.notEqual(bogus.welcome?.token, "does-not-exist");
  });
});

test("#16 driver seat: second driver on a live seat gets SEAT_TAKEN; free seats are assigned; 5th driver refused", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const d1 = await ctx.client({ role: "driver", team: "red" });
    const d2 = await ctx.client({ role: "driver", team: "red" });
    assert.equal(d2.errors()[0]?.code, "SEAT_TAKEN");
    assert.equal(d2.welcome, undefined);
    assert.equal(d1.isClosed, false);
    assert.equal(teamOf((await screen.waitForState((s) => teamOf(s, "red").driverConnected)), "red").driverConnected, true);

    // a refused client stays connected and may join as a booster instead
    d2.hello({ role: "booster", team: "red" });
    await d2.waitFor((m) => m.type === "WELCOME");
    assert.equal((d2 as SimClient).welcome?.role, "booster");

    const auto: string[] = [];
    for (let i = 0; i < 3; i++) auto.push((await ctx.client({ role: "driver" })).welcome!.team!);
    assert.deepEqual([...auto].sort(), ["blue", "green", "yellow"]);
    const fifth = await ctx.client({ role: "driver" });
    assert.equal(fifth.errors()[0]?.code, "SEAT_TAKEN");

    // once the seat is free again, a new driver can take it
    d1.drop();
    await screen.waitForState((s) => !teamOf(s, "red").driverConnected);
    const replacement = await ctx.client({ role: "driver", team: "red" });
    assert.equal(replacement.welcome?.team, "red");
  });
});

test("#17 duplicate connection (same token): old socket is closed, new one active, counts not doubled", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const first = await ctx.client({ role: "booster", team: "blue" });
    await screen.waitForState((s) => teamOf(s, "blue").boosters === 1);
    const second = await ctx.client({ role: "booster", token: first.welcome!.token });
    assert.equal(await first.waitForClose(), 4001);
    assert.equal(second.welcome?.playerId, first.welcome?.playerId);
    await sleep(150);
    assert.equal(teamOf(screen.latestState()!, "blue").boosters, 1);
    assert.equal(ctx.server.connectionCount(), 2); // screen + the new booster
    // same for a driver
    const d1 = await ctx.client({ role: "driver", team: "red" });
    const d2 = await ctx.client({ role: "driver", token: d1.welcome!.token });
    assert.equal(await d1.waitForClose(), 4001);
    assert.equal(d2.welcome?.team, "red");
  });
});

// --- #11 #12 invalid input ---------------------------------------------------------------

test("#11 invalid and malformed messages are rejected with INVALID_MESSAGE; the connection and server survive", async () => {
  await withServer({}, async (ctx) => {
    const b = await ctx.client({ role: "booster" });
    const bad: (string | object)[] = [
      "not json", "", "[]", "42", '{"type":"NOPE"}', '{"value":1}', { type: "DRIVER_STEER", value: "left" },
      { type: "CONTROL", action: "PAUSE" }, { type: "HELLO", protocolVersion: 1, role: "spectator" },
      { type: "HELLO", protocolVersion: 1, role: "booster", team: "purple" }, { type: "PING", t: "now" },
      JSON.stringify({ type: "PING", t: 1, pad: "x".repeat(2000) }), // over MAX_MESSAGE_BYTES
    ];
    const mark = b.mark();
    for (const m of bad) b.send(m);
    b.sendRaw(Buffer.from([1, 2, 3]), true); // binary frame
    await b.waitFor(() => b.errors(mark).length >= bad.length + 1);
    const errs = b.errors(mark);
    assert.equal(errs.length, bad.length + 1);
    assert.ok(errs.every((e) => e.code === "INVALID_MESSAGE" && e.message.length > 0), JSON.stringify(errs.map((e) => e.code)));

    // still alive, and other clients are unaffected
    const m2 = b.mark();
    b.send({ type: "PING", t: 42 });
    const pong = await b.waitFor((m) => m.type === "PONG", { from: m2 });
    assert.ok(pong.type === "PONG" && pong.t === 42);
    const other = await ctx.client({ role: "screen" });
    assert.ok(other.welcome);
  });
});

test("#11 messages before HELLO → NOT_HELLO (or INVALID_MESSAGE if unparsable); a second HELLO → INVALID_STATE", async () => {
  await withServer({}, async (ctx) => {
    const c = await ctx.raw();
    c.send({ type: "BOOST" });
    c.send({ type: "PING", t: 1 });
    c.send({ type: "CONTROL", action: "START" });
    c.send("garbage");
    await c.waitFor(() => c.errors().length >= 4);
    assert.deepEqual(c.errors().map((e) => e.code), ["NOT_HELLO", "NOT_HELLO", "NOT_HELLO", "INVALID_MESSAGE"]);
    c.hello({ role: "booster" });
    await c.waitFor((m) => m.type === "WELCOME");
    const mark = c.mark();
    c.hello({ role: "booster" });
    const e = await c.waitFor((m) => m.type === "ERROR", { from: mark });
    assert.ok(e.type === "ERROR" && e.code === "INVALID_STATE");
  });
});

test("#12 protocol version mismatch → PROTOCOL_MISMATCH and the connection is closed", async () => {
  await withServer({}, async (ctx) => {
    for (const v of [999, 0, 2]) {
      const c = await ctx.raw();
      c.hello({ role: "booster", protocolVersion: v });
      await c.waitFor((m) => m.type === "ERROR");
      assert.equal(c.errors()[0]?.code, "PROTOCOL_MISMATCH");
      assert.equal(await c.waitForClose(), 1002);
      assert.equal(c.welcome, undefined);
    }
  });
});

// --- #15 boost only while racing -----------------------------------------------------------

test("#15 BOOST in LOBBY and COUNTDOWN is ignored: no error, not counted", async () => {
  await withServer({ race: { countdownSeconds: 0.6 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const b = await ctx.client({ role: "booster", team: "red" });

    for (let i = 0; i < 10; i++) b.send({ type: "BOOST" }); // LOBBY
    await sleep(150);
    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "COUNTDOWN");
    for (let i = 0; i < 10; i++) b.send({ type: "BOOST" }); // COUNTDOWN
    const racing = await screen.waitForState((s) => s.status === "RACING");

    assert.equal(b.errors().length, 0, "ignored boosts produce no ERROR");
    assert.equal(teamOf(racing, "red").boostEnergy, 0);
    assert.equal(teamOf(racing, "red").boostRate, 0);
    assert.equal(screen.ofType("BOOST").length, 0, "no BOOST event was ever emitted");

    // reconnecting shows boostsSent stayed at 0
    b.drop();
    const again = await ctx.client({ role: "booster", token: b.welcome!.token });
    assert.equal(again.welcome?.boostsSent, 0);
  });
});

// --- #19 race completion --------------------------------------------------------------------

test("#19 race completes: winner set, positions monotonic and ≤1, elapsed frozen, later BOOST ignored", async () => {
  await withServer({ race: { secondsAtSpeed1: 0.8 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const booster = await ctx.client({ role: "booster", team: "green" });
    const others = [await ctx.client({ role: "driver", team: "red" }), await ctx.client({ role: "driver", team: "green" })];
    void others;
    admin.send({ type: "CONTROL", action: "START" });
    await screen.waitForState((s) => s.status === "RACING");
    const pump = setInterval(() => booster.send({ type: "BOOST" }), 5);
    const final = await screen.waitForState((s) => s.status === "FINISHED", { timeoutMs: 8000 });
    clearInterval(pump);

    assert.equal(final.winner, "green", "the boosted team with a driver wins");
    assert.equal(teamOf(final, "green").position, 1);
    const seen = screen.ofType("RACE_STATE").map((m) => m.state);
    for (const team of TEAM_IDS) {
      const ps = seen.map((s) => teamOf(s, team).position);
      assert.ok(ps.every((p, i) => p <= 1 && (i === 0 || p >= ps[i - 1]!)), `${team} positions monotonic`);
    }
    for (const t of final.teams) assert.equal(t.speed, 0);

    await sleep(200);
    const later = screen.latestState()!;
    assert.equal(later.status, "FINISHED");
    assert.equal(later.elapsed, final.elapsed, "elapsed frozen");
    assert.equal(later.winner, "green");
    // boostsPerSecond is a 1 s window, so it may still hold pre-finish boosts; a BOOST sent
    // now must not be counted: no BOOST event, no error, and the rate can only decay.
    const rateBefore = later.metrics.boostsPerSecond;
    const mark = screen.mark();
    booster.send({ type: "BOOST" });
    await sleep(150);
    assert.equal(booster.errors().length, 0);
    assert.equal(screen.ofType("BOOST", mark).length, 0, "no BOOST event after the finish");
    assert.ok(screen.latestState()!.metrics.boostsPerSecond <= rateBefore, "rate did not increase");
    assert.equal(screen.latestState()!.teams.find((t) => t.id === "green")!.boostEnergy, 0);
  });
});

// --- #18 #24 memes ---------------------------------------------------------------------------

const testMemes: MemeConfig = {
  memes: [
    { id: "A_MEME", name: "A", threshold: 3, duration: 0.4, visual: "a", effect: "NONE" },
    { id: "CHAOS_MODE", name: "Chaos", threshold: 5, duration: 0.5, visual: "c", effect: "CHAOS" },
  ],
};

test("#18 team-based meme: server emits MEME_EVENT once for the triggering team only; it expires", async () => {
  await withServer({ memes: { memes: [testMemes.memes[0]!] } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const booster = await ctx.client({ role: "booster", team: "red" });
    const blueBooster = await ctx.client({ role: "booster", team: "blue" });
    await ctx.start(admin, screen);

    for (let i = 0; i < 2; i++) blueBooster.send({ type: "BOOST" }); // blue stays below threshold
    for (let i = 0; i < 3; i++) booster.send({ type: "BOOST" });
    const s = await screen.waitForState((x) => teamOf(x, "red").activeEvent !== undefined);
    assert.equal(teamOf(s, "red").activeEvent?.event.id, "A_MEME");
    assert.ok(teamOf(s, "red").activeEvent!.remaining > 0);
    assert.equal(teamOf(s, "blue").activeEvent, undefined);

    for (let i = 0; i < 5; i++) booster.send({ type: "BOOST" }); // no refire
    await screen.waitForState((x) => teamOf(x, "red").activeEvent === undefined, { timeoutMs: 3000 });
    await sleep(100);
    const events = screen.ofType("MEME_EVENT");
    assert.equal(events.length, 1);
    assert.equal(events[0]!.team, "red");
    assert.equal(events[0]!.event.id, "A_MEME");
    assert.equal(booster.ofType("MEME_EVENT").length, 1, "phones receive MEME_EVENT too");
  });
});

test("#24 CHAOS is race-wide (status) but its speed effect is team-specific; status returns afterwards", async () => {
  await withServer({ memes: testMemes }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const booster = await ctx.client({ role: "booster", team: "red" });
    for (const t of TEAM_IDS) await ctx.client({ role: "driver", team: t });
    await ctx.start(admin, screen);
    for (let i = 0; i < 5; i++) booster.send({ type: "BOOST" });
    const chaos = await screen.waitForState((s) => s.status === "CHAOS");
    assert.equal(teamOf(chaos, "red").activeEvent?.event.id, "CHAOS_MODE");
    assert.ok(teamOf(chaos, "red").speed > teamOf(chaos, "blue").speed * 1.4, "only red is sped up");
    assert.equal(teamOf(chaos, "blue").activeEvent, undefined);
    assert.equal(teamOf(chaos, "blue").speed, 0.5, "other teams race normally");
    await screen.waitForState((s) => s.status === "RACING", { timeoutMs: 3000 });
  });
});

// --- #20 driver leaves ----------------------------------------------------------------------

test("#20 driver leaves mid-race: that team is capped at safe speed, the others carry on", async () => {
  await withServer({}, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const red = await ctx.client({ role: "driver", team: "red" });
    await ctx.client({ role: "driver", team: "blue" });
    const booster = await ctx.client({ role: "booster", team: "red" });
    await ctx.start(admin, screen);
    red.drop();
    for (let i = 0; i < 30; i++) booster.send({ type: "BOOST" }); // boosting cannot exceed the cap
    const s = await screen.waitForState((x) => !teamOf(x, "red").driverConnected && teamOf(x, "red").boostEnergy > 0.3);
    assert.ok(teamOf(s, "red").speed <= 0.3 + 1e-9, `red speed ${teamOf(s, "red").speed}`);
    assert.ok(teamOf(s, "blue").speed >= 0.5 - 1e-9, "blue unaffected");
    assert.equal(s.status, "RACING", "the race is not aborted");
  });
});

// --- #21 #25 rate limiting ------------------------------------------------------------------

test("#21/#25 BOOST flood: capped by the limiter, one throttled RATE_LIMITED, flooder disconnected, others unaffected", async () => {
  await withServer({ rate: { boostRatePerSec: 15, boostBurst: 20 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const flooder = await ctx.client({ role: "booster", team: "red" });
    const polite = await ctx.client({ role: "booster", team: "blue" });
    await ctx.start(admin, screen);

    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) flooder.send({ type: "BOOST" });
    assert.equal(await flooder.waitForClose(), 1008, "persistent flooding closes the connection");
    const elapsedS = (Date.now() - t0) / 1000;

    const errs = flooder.errors();
    assert.ok(errs.length >= 1 && errs.length <= 4, `errors are throttled, got ${errs.length}`);
    assert.ok(errs.every((e) => e.code === "RATE_LIMITED"));

    // a normal booster, from the same IP, is not affected
    for (let i = 0; i < 5; i++) polite.send({ type: "BOOST" });
    await sleep(100);
    assert.equal(polite.errors().length, 0);

    const back = await ctx.client({ role: "booster", token: flooder.welcome!.token });
    const accepted = back.welcome!.boostsSent!;
    assert.ok(accepted >= 15 && accepted <= 20 + Math.ceil(15 * (elapsedS + 0.5)), `accepted ${accepted} boosts of 1000`);
    const politeBack = await ctx.client({ role: "booster", token: polite.welcome!.token });
    assert.equal(politeBack.welcome?.boostsSent, 5);
    assert.ok(ctx.server.connectionCount() >= 3, "server keeps serving everyone else");
  });
});

test("DRIVER_STEER flood is rate-limited too", async () => {
  await withServer({ rate: { steerRatePerSec: 10 } }, async (ctx) => {
    const d = await ctx.client({ role: "driver", team: "red" });
    for (let i = 0; i < 500; i++) d.send({ type: "DRIVER_STEER", value: 0.1 });
    assert.equal(await d.waitForClose(), 1008);
    assert.ok(d.errors().every((e) => e.code === "RATE_LIMITED"));
  });
});

test("general per-connection frame limit protects against garbage floods", async () => {
  await withServer({ rate: { maxMessagesPerSec: 50 } }, async (ctx) => {
    const c = await ctx.client({ role: "screen" });
    for (let i = 0; i < 2000; i++) c.send("junk");
    assert.equal(await c.waitForClose(), 1008);
    const other = await ctx.client({ role: "screen" });
    assert.ok(other.welcome, "server still accepts new clients");
  });
});

// --- connection housekeeping ---------------------------------------------------------------

test("heartbeat: a client that stops answering pings is dropped; a normal client is kept", async () => {
  await withServer({ heartbeatMs: 100 }, async (ctx) => {
    const zombie = new SimClient(ctx.url, { autoPong: false });
    await zombie.join({ role: "booster" });
    const healthy = await ctx.client({ role: "booster" });
    await zombie.waitForClose(2000);
    assert.equal(zombie.isClosed, true);
    await sleep(300);
    assert.equal(healthy.isClosed, false, "healthy client survives several heartbeats");
  });
});

test("connections that never send HELLO are closed", async () => {
  await withServer({ helloTimeoutMs: 100 }, async (ctx) => {
    const c = await ctx.raw();
    assert.equal(await c.waitForClose(2000), 1008);
  });
});

test("maxConnections: extra connections are turned away", async () => {
  await withServer({ maxConnections: 2 }, async (ctx) => {
    await ctx.screen();
    await ctx.screen();
    const third = new SimClient(ctx.url);
    await third.connect().catch(() => {});
    assert.equal(await third.waitForClose(2000), 1013);
  });
});

test("/health reports status and connection counts; unknown paths are 404", async () => {
  await withServer({}, async (ctx) => {
    await ctx.client({ role: "booster" });
    await ctx.client({ role: "driver" });
    const res = await fetch(`http://127.0.0.1:${ctx.server.port}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number; status: string; connections: Record<string, number> };
    assert.equal(body.ok, true);
    assert.equal(body.protocolVersion, PROTOCOL_VERSION);
    assert.equal(body.status, "LOBBY");
    assert.deepEqual([body.connections.booster, body.connections.driver], [1, 1]);
    assert.equal((await fetch(`http://127.0.0.1:${ctx.server.port}/nope`)).status, 404);
  });
});

test("server never sends server-only fields back as client-controlled: state comes only from the server", async () => {
  await withServer({}, async (ctx) => {
    const screen = await ctx.screen();
    const b = await ctx.client({ role: "booster", team: "red" });
    // a client trying to inject state gets rejected/ignored and nothing changes
    b.send({ type: "RACE_STATE", state: { status: "FINISHED", winner: "red" } });
    b.send({ type: "HELLO", protocolVersion: 1, role: "booster", team: "blue", position: 1 });
    await sleep(150);
    const s = screen.latestState()!;
    assert.equal(s.status, "LOBBY");
    assert.equal(s.winner, undefined);
    assert.equal(b.welcome?.team, "red");
  });
});

test("BOOST storm: many simultaneous boosters move the race at once; app metrics are exact, chain metrics stay zero", async () => {
  await withServer({ race: { countdownSeconds: 0.05, secondsAtSpeed1: 600 } }, async (ctx) => {
    const admin = await ctx.admin();
    const screen = await ctx.screen();
    const drivers = await Promise.all(TEAM_IDS.map((team) => ctx.client({ role: "driver", team })));
    const boosters: SimClient[] = [];
    for (let i = 0; i < 100; i++) boosters.push(await ctx.client({ role: "booster", team: TEAM_IDS[i % 4] }));
    await ctx.start(admin, screen);

    const PER_BOOSTER = 20;
    const t0 = performance.now();
    for (let n = 0; n < PER_BOOSTER; n++) for (const b of boosters) b.send({ type: "BOOST" });
    const total = boosters.length * PER_BOOSTER; // 2000, all in one burst

    const s = await screen.waitForState((st) => st.metrics.boostsPerSecond >= total * 0.9, { timeoutMs: 5000 });
    const applyMs = performance.now() - t0;
    assert.ok(applyMs < 3000, `2000 boosts applied and visible in ${applyMs.toFixed(0)} ms`);
    assert.equal(s.metrics.boostsPerSecond, s.teams.reduce((n, t) => n + t.boostRate, 0), "total = sum of teams");
    assert.ok(s.metrics.actionsPerSecond >= s.metrics.boostsPerSecond);
    for (const t of s.teams) assert.equal(t.boosters, 25);
    assert.deepEqual([s.metrics.transactionsSent, s.metrics.transactionsConfirmed, s.metrics.eventsReceived, s.chainMode], [0, 0, 0, "OFF"]);

    // Boost energy and speed reacted immediately (no chain in the loop).
    assert.ok(s.teams.every((t) => t.boostEnergy > 0));

    // Lobby endpoint: exact per-team totals, application vs blockchain separated.
    const m = await (await fetch(`http://127.0.0.1:${ctx.server.port}/api/metrics`)).json() as {
      application: { connectedPlayers: number; connectedDrivers: number; connectedBoosters: number; connectedScreens: number; boostsTotal: number; teams: Record<string, { boostsTotal: number; boosters: number }> };
      blockchain: { chainMode: string; transactionsSent: number; transactionsConfirmed: number };
    };
    assert.deepEqual(
      [m.application.connectedPlayers, m.application.connectedDrivers, m.application.connectedBoosters, m.application.connectedScreens],
      [104, 4, 100, 1],
    );
    assert.equal(m.application.boostsTotal, total, "every accepted boost counted once");
    for (const id of TEAM_IDS) {
      assert.equal(m.application.teams[id]!.boostsTotal, total / 4);
      assert.equal(m.application.teams[id]!.boosters, 25);
    }
    assert.deepEqual(m.blockchain, { chainMode: "OFF", chainState: "OFF", transactionsSent: 0, transactionsConfirmed: 0, eventsReceived: 0, transactionsFailed: 0, transactionsUnconfirmed: 0, pendingTransactions: 0, unsentBoosts: 0, rpcHealthy: true });
    void drivers;

    // After RESET the race-scoped counters are zero again.
    admin.send({ type: "CONTROL", action: "RESET" });
    await screen.waitForState((st) => st.status === "LOBBY");
    const after = await (await fetch(`http://127.0.0.1:${ctx.server.port}/api/metrics`)).json() as { application: { boostsTotal: number } };
    assert.equal(after.application.boostsTotal, 0);
  });
});
