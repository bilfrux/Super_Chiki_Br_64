// RaceEngine unit tests: deterministic, no sockets, manual clock.

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHAOS_MEME_ID, SPEED_MAX, TEAM_IDS, type MemeConfig } from "../../shared/index.js";
import { DEFAULT_RACE_CONFIG, RaceEngine, type RaceConfig } from "../src/engine.js";

const HZ = 30;
const DT = 1 / HZ;

const memes: MemeConfig = {
  memes: [
    { id: "SMALL", name: "Small", threshold: 3, duration: 1, visual: "v", effect: "NONE" },
    { id: "SPEEDY", name: "Speedy", threshold: 6, duration: 1, visual: "v", effect: "SPEED_MULT_1.4" },
    { id: CHAOS_MEME_ID, name: "Chaos", threshold: 9, duration: 1, visual: "v", effect: "CHAOS" },
  ],
};

const make = (race: Partial<RaceConfig> = {}, m: MemeConfig = memes) => {
  const e = new RaceEngine({ ...DEFAULT_RACE_CONFIG, countdownSeconds: 1, secondsAtSpeed1: 10, ...race }, m, HZ);
  for (const t of TEAM_IDS) e.setPresence(t, true, 0);
  return e;
};

const run = (e: RaceEngine, seconds: number) => { for (let i = 0; i < Math.round(seconds * HZ); i++) e.tick(DT); };
const racing = (e: RaceEngine) => { e.start(); run(e, 1.1); assert.equal(e.status, "RACING"); };
const team = (e: RaceEngine, id: string) => e.snapshot().teams.find((t) => t.id === id)!;

test("initial state: LOBBY, four teams in order, everything zero", () => {
  const s = make().snapshot();
  assert.equal(s.status, "LOBBY");
  assert.equal(s.elapsed, 0);
  assert.deepEqual(s.teams.map((t) => t.id), ["red", "blue", "green", "yellow"]);
  for (const t of s.teams) {
    assert.deepEqual([t.boostEnergy, t.boostRate, t.position, t.speed, t.steer], [0, 0, 0, 0, 0]);
    assert.equal(t.activeEvent, undefined);
  }
  assert.equal(s.winner, undefined);
  assert.equal(s.chainMode, "OFF");
  assert.deepEqual(s.metrics, { actionsPerSecond: 0, boostsPerSecond: 0, transactionsSent: 0, transactionsConfirmed: 0, eventsReceived: 0 });
});

test("START: LOBBY → COUNTDOWN (elapsed negative) → RACING (elapsed 0); START elsewhere is refused", () => {
  const e = make();
  assert.equal(e.start(), true);
  assert.equal(e.status, "COUNTDOWN");
  assert.equal(e.snapshot().elapsed, -1);
  run(e, 0.5);
  const mid = e.snapshot().elapsed;
  assert.ok(mid < 0 && mid > -1, `elapsed ${mid}`);
  assert.equal(e.start(), false, "START during COUNTDOWN refused");
  let ticks = 0;
  while (e.status === "COUNTDOWN" && ticks++ < 100) {
    assert.ok(e.snapshot().elapsed < 0, "negative for the whole countdown");
    e.tick(DT);
  }
  assert.equal(e.status, "RACING");
  assert.equal(e.snapshot().elapsed, 0, "elapsed is exactly 0 on the tick RACING begins");
  e.tick(DT);
  assert.ok(e.snapshot().elapsed > 0, "then counts up");
  assert.equal(e.start(), false, "START during RACING refused");
});

test("nobody moves during LOBBY or COUNTDOWN", () => {
  const e = make();
  run(e, 1);
  e.start();
  run(e, 0.5);
  for (const t of e.snapshot().teams) assert.deepEqual([t.position, t.speed], [0, 0]);
});

test("BOOST is ignored (not counted) in LOBBY, COUNTDOWN and FINISHED; accepted in RACING", () => {
  const e = make({ secondsAtSpeed1: 1 });
  assert.equal(e.applyBoost("red"), false);
  e.start();
  assert.equal(e.applyBoost("red"), false);
  run(e, 1.1);
  assert.equal(e.applyBoost("red"), true);
  assert.ok(team(e, "red").boostEnergy > 0);
  run(e, 3);
  assert.equal(e.status, "FINISHED");
  const before = e.snapshot();
  assert.equal(e.applyBoost("blue"), false);
  assert.deepEqual(e.snapshot().teams, before.teams);
  assert.equal(e.flushEvents(false).filter((x) => x.type === "BOOST" && x.team === "blue").length, 0);
});

test("accepted boosts raise energy (clamped to 1), rate and speed; energy decays", () => {
  const e = make();
  racing(e);
  e.applyBoost("red");
  assert.ok(Math.abs(team(e, "red").boostEnergy - DEFAULT_RACE_CONFIG.boostGain) < 1e-9);
  for (let i = 0; i < 100; i++) e.applyBoost("red");
  assert.equal(team(e, "red").boostEnergy, 1, "clamped");
  assert.equal(team(e, "red").boostRate, 101);
  e.tick(DT);
  assert.ok(team(e, "red").speed > team(e, "blue").speed, "boosted team is faster");
  assert.ok(team(e, "red").speed <= SPEED_MAX);
  run(e, 5);
  assert.equal(team(e, "red").boostEnergy, 0, "decays to 0");
  assert.equal(team(e, "red").boostRate, 0, "rate window empties after ~1 s");
});

test("tuning: a single player tapping 3-4 times/s holds and builds boost energy; 2/s cannot", () => {
  // Simulate one tapper for `seconds`; return the final energy and the lowest energy seen in the last 5 s
  // (energy that never returns to zero between taps means the player is at or above break-even).
  const tapper = (hz: number, seconds: number) => {
    const e = make({ secondsAtSpeed1: 1000 });
    racing(e);
    let carry = 0;
    let minLate = Infinity;
    for (let i = 0; i < seconds * HZ; i++) {
      carry += hz * DT;
      while (carry >= 1) { e.applyBoost("red"); carry -= 1; }
      e.tick(DT);
      if (i > (seconds - 5) * HZ) minLate = Math.min(minLate, team(e, "red").boostEnergy);
    }
    return { final: team(e, "red").boostEnergy, minLate };
  };
  assert.ok(DEFAULT_RACE_CONFIG.energyDecayPerSec / DEFAULT_RACE_CONFIG.boostGain < 3, "break-even is below 3 boosts/s");
  const at3 = tapper(3, 15);
  const at4 = tapper(4, 15);
  assert.ok(at3.minLate > 0, `3 taps/s never drains to zero: ${at3.minLate}`);
  assert.ok(at3.final > 0.3, `3 taps/s builds energy over 15 s: ${at3.final}`);
  assert.ok(at4.final > at3.final, `4 taps/s builds faster: ${at4.final} vs ${at3.final}`);
  assert.equal(tapper(2, 15).minLate, 0, "2 taps/s is below break-even and drains to zero between taps");
  assert.ok(tapper(20, 3).final >= 0.9, "a crowd saturates it");
});

test("boostRate is a 1-second sliding window", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 10; i++) e.applyBoost("blue");
  assert.equal(team(e, "blue").boostRate, 10);
  run(e, 0.5);
  assert.equal(team(e, "blue").boostRate, 10, "still inside the window");
  run(e, 0.6);
  assert.equal(team(e, "blue").boostRate, 0, "left the window");
  const s = e.snapshot();
  assert.equal(s.metrics.boostsPerSecond, 0);
});

test("metrics: boostsPerSecond sums teams; actionsPerSecond also counts steering", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 4; i++) e.applyBoost("red");
  for (let i = 0; i < 2; i++) e.applyBoost("green");
  e.applySteer("red", 0.3);
  const m = e.snapshot().metrics;
  assert.equal(m.boostsPerSecond, 6);
  assert.equal(m.actionsPerSecond, 7);
});

test("no driver → speed capped at safeSpeed; other teams unaffected", () => {
  const e = make();
  racing(e);
  e.setPresence("red", false, 0);
  for (let i = 0; i < 40; i++) e.applyBoost("red");
  e.tick(DT);
  assert.ok(team(e, "red").speed <= DEFAULT_RACE_CONFIG.safeSpeed + 1e-9);
  assert.ok(team(e, "blue").speed >= DEFAULT_RACE_CONFIG.baseSpeed - 1e-9);
  assert.equal(team(e, "red").driverConnected, false);
});

test("driver leaving caps speed immediately (a snapshot never shows no driver with uncapped speed)", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 40; i++) e.applyBoost("red");
  e.tick(DT);
  assert.ok(team(e, "red").speed > DEFAULT_RACE_CONFIG.safeSpeed);
  e.setPresence("red", false, 0); // no tick in between
  assert.ok(team(e, "red").speed <= DEFAULT_RACE_CONFIG.safeSpeed + 1e-9);
});

test("steer is stored, cosmetic, and zeroed when the driver leaves", () => {
  const e = make();
  racing(e);
  e.applySteer("green", -0.7);
  assert.equal(team(e, "green").steer, -0.7);
  run(e, 1);
  assert.equal(team(e, "green").position, team(e, "blue").position, "steering does not affect progress");
  e.setPresence("green", false, 0);
  assert.equal(team(e, "green").steer, 0);
});

test("race finishes: winner set, positions never decrease and clamp at 1, state frozen after", () => {
  const e = make({ secondsAtSpeed1: 2 });
  racing(e);
  for (let i = 0; i < 60; i++) e.applyBoost("yellow"); // yellow is fastest
  let last = TEAM_IDS.map(() => 0);
  for (let i = 0; i < 20 * HZ && e.status !== "FINISHED"; i++) {
    e.tick(DT);
    const pos = e.snapshot().teams.map((t) => t.position);
    pos.forEach((p, k) => { assert.ok(p >= last[k]!, "monotonic"); assert.ok(p <= 1); });
    last = pos;
  }
  const s = e.snapshot();
  assert.equal(s.status, "FINISHED");
  assert.equal(s.winner, "yellow");
  assert.equal(s.teams.find((t) => t.id === "yellow")!.position, 1);
  for (const t of s.teams) assert.equal(t.speed, 0);
  const elapsed = s.elapsed;
  run(e, 1);
  assert.equal(e.snapshot().elapsed, elapsed, "elapsed frozen");
  assert.equal(e.snapshot().winner, "yellow");
});

test("FINAL_LAP starts when the leader passes finalLapPosition, then FINISHED", () => {
  const e = make({ secondsAtSpeed1: 4 });
  racing(e);
  const seen = new Set<string>();
  for (let i = 0; i < 20 * HZ && e.status !== "FINISHED"; i++) { e.tick(DT); seen.add(e.status); }
  assert.ok(seen.has("FINAL_LAP") && seen.has("FINISHED"));
});

test("team-based memes: fire once per team at that team's own threshold, expire after duration", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 3; i++) e.applyBoost("red");
  const events = e.flushEvents(false);
  const memesFired = events.filter((x) => x.type === "MEME_EVENT");
  assert.equal(memesFired.length, 1);
  assert.equal(memesFired[0]!.type === "MEME_EVENT" && memesFired[0]!.team, "red");
  assert.equal(team(e, "red").activeEvent?.event.id, "SMALL");
  assert.ok(team(e, "red").activeEvent!.remaining > 0);
  assert.equal(team(e, "blue").activeEvent, undefined, "other teams unaffected");
  e.applyBoost("red"); e.applyBoost("red");
  assert.equal(e.flushEvents(false).filter((x) => x.type === "MEME_EVENT").length, 0, "does not refire");
  run(e, 1.2);
  assert.equal(team(e, "red").activeEvent, undefined, "expired");
});

test("per-team threshold override", () => {
  const e = make({}, { ...memes, teamThresholds: { blue: { SMALL: 1 } } });
  racing(e);
  e.applyBoost("blue");
  e.applyBoost("red");
  const fired = e.flushEvents(false).filter((x) => x.type === "MEME_EVENT");
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.type === "MEME_EVENT" && fired[0]!.team, "blue");
});

test("meme effect: speed multiplier applies to the triggering team only", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 6; i++) e.applyBoost("red"); // SMALL then SPEEDY (x1.4)
  for (let i = 0; i < 6; i++) e.applyBoost("blue"); // same energy, same meme
  // give green the same energy but no meme by using a big-threshold override
  e.tick(DT);
  const red = team(e, "red").speed;
  const green = team(e, "green").speed;
  assert.ok(red > green * 1.3, `red ${red} should be much faster than un-memed green ${green}`);
});

test("CHAOS is a race-wide status while any team has CHAOS_MODE; its effect is team-specific", () => {
  const e = make();
  racing(e);
  for (let i = 0; i < 9; i++) e.applyBoost("red"); // reaches CHAOS_MODE threshold
  assert.equal(e.status, "CHAOS");
  assert.equal(e.snapshot().status, "CHAOS");
  assert.equal(team(e, "red").activeEvent?.event.id, CHAOS_MEME_ID);
  e.tick(DT);
  assert.ok(team(e, "red").speed > team(e, "blue").speed * 1.4, "only red is sped up");
  assert.equal(team(e, "blue").speed, DEFAULT_RACE_CONFIG.baseSpeed);
  assert.equal(team(e, "blue").activeEvent, undefined);
  run(e, 1.2);
  assert.equal(e.status, "RACING", "returns to the previous status when chaos ends");
});

test("flushEvents: BOOST aggregated per team, then MEME_EVENT, DRIVER_STEER, TEAM_ACTIVITY", () => {
  const e = make();
  racing(e);
  e.applyBoost("red"); e.applyBoost("red"); e.applyBoost("blue");
  e.applySteer("green", 0.4);
  const ev = e.flushEvents(true);
  assert.deepEqual(ev.map((x) => x.type), ["BOOST", "BOOST", "DRIVER_STEER", "TEAM_ACTIVITY", "TEAM_ACTIVITY"]);
  assert.deepEqual(ev[0], { type: "BOOST", team: "red", amount: 2 });
  assert.deepEqual(ev[1], { type: "BOOST", team: "blue", amount: 1 });
  assert.deepEqual(ev[2], { type: "DRIVER_STEER", team: "green", value: 0.4 });
  assert.deepEqual(e.flushEvents(true).filter((x) => x.type !== "TEAM_ACTIVITY"), [], "drained");
});

test("RESET: back to LOBBY, race state zeroed, presence kept, events dropped", () => {
  const e = make();
  racing(e);
  e.setPresence("red", true, 4);
  for (let i = 0; i < 20; i++) e.applyBoost("red");
  e.applySteer("red", 0.9);
  run(e, 0.5);
  e.reset();
  const s = e.snapshot();
  assert.equal(s.status, "LOBBY");
  assert.equal(s.elapsed, 0);
  assert.equal(s.winner, undefined);
  for (const t of s.teams) assert.deepEqual([t.position, t.speed, t.boostEnergy, t.boostRate, t.steer, t.activeEvent], [0, 0, 0, 0, 0, undefined]);
  assert.equal(team(e, "red").boosters, 4);
  assert.equal(team(e, "red").driverConnected, true);
  assert.equal(s.metrics.boostsPerSecond, 0);
  assert.deepEqual(e.flushEvents(true), []);
  assert.equal(e.start(), true, "a new race can start after RESET");
});

test("RESET after a finished race allows a fresh race (memes can fire again)", () => {
  const e = make({ secondsAtSpeed1: 1 });
  racing(e);
  run(e, 3);
  assert.equal(e.status, "FINISHED");
  e.reset();
  racing(e);
  for (let i = 0; i < 3; i++) e.applyBoost("red");
  assert.equal(team(e, "red").activeEvent?.event.id, "SMALL");
});
