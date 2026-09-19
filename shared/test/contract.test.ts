// Pins the approved protocol v1 so it cannot drift silently.
//  * Compile-time: exhaustive Record<keyof T, true> maps break the build if a
//    field is added to or removed from a shared type.
//  * Runtime: the constants and tables in code are compared against what
//    PROTOCOL.md (the source of truth) actually says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  BOOST_ACCEPTING_STATUSES,
  CLIENT_MESSAGE_TYPES,
  CONTROL_ACTIONS,
  DEFAULT_RATE_LIMITS,
  ERROR_CODES,
  PERMISSIONS,
  PROTOCOL_VERSION,
  RACE_STATUSES,
  ROLES,
  ROLE_MAY_SEND,
  ROLE_PERMISSIONS,
  ROLE_RECEIVES,
  SERVER_MESSAGE_TYPES,
  TEAM_IDS,
  type ActiveMeme,
  type ClientBoost,
  type ClientControl,
  type ClientDriverSteer,
  type ClientHello,
  type ClientPing,
  type GameEvent,
  type MemeEvent,
  type RaceMetrics,
  type RaceState,
  type ServerBoost,
  type ServerDriverSteer,
  type ServerError,
  type ServerMemeEvent,
  type ServerPong,
  type ServerRaceState,
  type ServerTeamActivity,
  type ServerWelcome,
  type TeamState,
} from "../index.js";

const here = dirname(fileURLToPath(import.meta.url));
// compiled to dist/test/, so PROTOCOL.md is two levels up in protocol/
const doc = readFileSync(join(here, "..", "..", "protocol", "PROTOCOL.md"), "utf8");

// ---------------------------------------------------------------------------
// Compile-time pins: exact field sets
// ---------------------------------------------------------------------------

const teamStateKeys: Record<keyof TeamState, true> = {
  id: true, boostEnergy: true, boostRate: true, position: true, speed: true,
  driverConnected: true, boosters: true, steer: true, activeEvent: true,
};
const raceStateKeys: Record<keyof RaceState, true> = {
  status: true, elapsed: true, teams: true, winner: true, metrics: true, chainMode: true,
};
const metricsKeys: Record<keyof RaceMetrics, true> = {
  actionsPerSecond: true, boostsPerSecond: true, transactionsSent: true,
  transactionsConfirmed: true, eventsReceived: true,
};
const memeKeys: Record<keyof MemeEvent, true> = {
  id: true, name: true, threshold: true, duration: true, visual: true, sound: true, effect: true,
};
const activeMemeKeys: Record<keyof ActiveMeme, true> = { event: true, remaining: true };

const helloKeys: Record<keyof ClientHello, true> = {
  type: true, protocolVersion: true, role: true, token: true, team: true, adminKey: true,
};
const clientSteerKeys: Record<keyof ClientDriverSteer, true> = { type: true, value: true };
const clientBoostKeys: Record<keyof ClientBoost, true> = { type: true };
const controlKeys: Record<keyof ClientControl, true> = { type: true, action: true };
const pingKeys: Record<keyof ClientPing, true> = { type: true, t: true };

const welcomeKeys: Record<keyof ServerWelcome, true> = {
  type: true, protocolVersion: true, playerId: true, token: true, role: true,
  team: true, permissions: true, boostsSent: true,
};
const errorKeys: Record<keyof ServerError, true> = { type: true, code: true, message: true };
const pongKeys: Record<keyof ServerPong, true> = { type: true, t: true };
const raceStateMsgKeys: Record<keyof ServerRaceState, true> = { type: true, state: true };
const serverBoostKeys: Record<keyof ServerBoost, true> = { type: true, team: true, amount: true };
const activityKeys: Record<keyof ServerTeamActivity, true> = { type: true, team: true, rate: true };
const memeMsgKeys: Record<keyof ServerMemeEvent, true> = { type: true, team: true, event: true };
const serverSteerKeys: Record<keyof ServerDriverSteer, true> = { type: true, team: true, value: true };

test("field sets of every shared type are pinned (compile-time; count here)", () => {
  assert.equal(Object.keys(teamStateKeys).length, 9);
  assert.equal(Object.keys(raceStateKeys).length, 6);
  assert.equal(Object.keys(metricsKeys).length, 5);
  assert.equal(Object.keys(memeKeys).length, 7);
  assert.equal(Object.keys(activeMemeKeys).length, 2);
  assert.equal(Object.keys(helloKeys).length, 6);
  assert.equal(Object.keys(clientSteerKeys).length, 2);
  assert.equal(Object.keys(clientBoostKeys).length, 1);
  assert.equal(Object.keys(controlKeys).length, 2);
  assert.equal(Object.keys(pingKeys).length, 2);
  assert.equal(Object.keys(welcomeKeys).length, 8);
  assert.equal(Object.keys(errorKeys).length, 3);
  assert.equal(Object.keys(pongKeys).length, 2);
  assert.equal(Object.keys(raceStateMsgKeys).length, 2);
  assert.equal(Object.keys(serverBoostKeys).length, 3);
  assert.equal(Object.keys(activityKeys).length, 3);
  assert.equal(Object.keys(memeMsgKeys).length, 3);
  assert.equal(Object.keys(serverSteerKeys).length, 3);
});

// ---------------------------------------------------------------------------
// Compile-time pins: direction is not ambiguous
// ---------------------------------------------------------------------------

// @ts-expect-error ClientBoost has no payload: the client cannot send a count
const boostWithCount: ClientBoost = { type: "BOOST", count: 5 };
// @ts-expect-error ClientBoost has no team
const boostWithTeam: ClientBoost = { type: "BOOST", team: "red" };
// @ts-expect-error ServerBoost requires team and amount
const serverBoostMissing: ServerBoost = { type: "BOOST" };
// @ts-expect-error ClientDriverSteer carries no team (the server decides it)
const steerWithTeam: ClientDriverSteer = { type: "DRIVER_STEER", value: 0, team: "red" };
// @ts-expect-error ServerDriverSteer requires team
const serverSteerMissing: ServerDriverSteer = { type: "DRIVER_STEER", value: 0 };
// @ts-expect-error a bad team id does not typecheck
const badTeam: ServerBoost = { type: "BOOST", team: "purple", amount: 1 };
// @ts-expect-error CONTROL only accepts START or RESET
const badControl: ClientControl = { type: "CONTROL", action: "PAUSE" };
// @ts-expect-error protocolVersion is literally 1
const badVersion: ClientHello = { type: "HELLO", protocolVersion: 2, role: "booster" };

const clientBoost: ClientBoost = { type: "BOOST" };
// @ts-expect-error a ClientBoost cannot be used where a ServerBoost is expected
const mixup: ServerBoost = clientBoost;

test("direction-specific types cannot be mixed up (compile-time)", () => {
  void [boostWithCount, boostWithTeam, serverBoostMissing, steerWithTeam,
    serverSteerMissing, badTeam, badControl, badVersion, mixup];
});

test("GameEvent is exactly the five SPEC §6 events", () => {
  const types: GameEvent["type"][] = ["RACE_STATE", "BOOST", "TEAM_ACTIVITY", "MEME_EVENT", "DRIVER_STEER"];
  assert.equal(new Set(types).size, 5);
});

// ---------------------------------------------------------------------------
// Runtime pins of the approved values
// ---------------------------------------------------------------------------

test("approved literal values", () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.deepEqual([...TEAM_IDS], ["red", "blue", "green", "yellow"]);
  assert.deepEqual([...RACE_STATUSES], ["LOBBY", "COUNTDOWN", "RACING", "FINAL_LAP", "CHAOS", "FINISHED"]);
  assert.deepEqual([...ROLES], ["screen", "admin", "driver", "booster"]);
  assert.deepEqual([...PERMISSIONS], ["STEER", "BOOST", "CONTROL"]);
  assert.deepEqual([...CONTROL_ACTIONS], ["START", "RESET"]);
  assert.deepEqual([...ERROR_CODES], [
    "PROTOCOL_MISMATCH", "NOT_HELLO", "INVALID_MESSAGE", "NOT_AUTHORIZED",
    "INVALID_STATE", "SEAT_TAKEN", "RATE_LIMITED",
  ]);
  assert.deepEqual({ ...DEFAULT_RATE_LIMITS }, {
    BOOST_RATE_PER_SEC: 15, BOOST_BURST: 20, STEER_RATE_PER_SEC: 40,
    MAX_MESSAGE_BYTES: 1024, ABUSE_DISCONNECT_FACTOR: 10,
  });
});

test("permissions: only admin has CONTROL; boosters cannot start or reset", () => {
  assert.deepEqual([...ROLE_PERMISSIONS.admin], ["CONTROL"]);
  assert.deepEqual([...ROLE_PERMISSIONS.driver], ["STEER"]);
  assert.deepEqual([...ROLE_PERMISSIONS.booster], ["BOOST"]);
  assert.deepEqual([...ROLE_PERMISSIONS.screen], []);
  for (const role of ROLES) {
    assert.equal(ROLE_MAY_SEND[role].includes("CONTROL"), role === "admin");
    assert.equal(ROLE_MAY_SEND[role].includes("BOOST"), role === "booster");
    assert.equal(ROLE_MAY_SEND[role].includes("DRIVER_STEER"), role === "driver");
    assert.ok(ROLE_MAY_SEND[role].includes("HELLO") && ROLE_MAY_SEND[role].includes("PING"));
  }
});

test("every message type is covered by the type lists", () => {
  assert.deepEqual([...CLIENT_MESSAGE_TYPES].sort(), ["BOOST", "CONTROL", "DRIVER_STEER", "HELLO", "PING"]);
  assert.deepEqual([...SERVER_MESSAGE_TYPES].sort(), [
    "BOOST", "DRIVER_STEER", "ERROR", "MEME_EVENT", "PONG", "RACE_STATE", "TEAM_ACTIVITY", "WELCOME",
  ]);
});

// ---------------------------------------------------------------------------
// Code == PROTOCOL.md (source of truth)
// ---------------------------------------------------------------------------

const backticked = (s: string) => [...s.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);

test("PROTOCOL.md declares protocol version 1", () => {
  assert.match(doc, /\*\*Protocol version: `1`\*\*/);
  assert.match(doc, /protocolVersion: 1;/);
});

test("rate-limit defaults match PROTOCOL.md §5.3", () => {
  for (const [key, value] of Object.entries(DEFAULT_RATE_LIMITS)) {
    const m = doc.match(new RegExp("\\| `" + key + "` \\|[^\\n]*\\| `(\\d+)` \\|"));
    assert.ok(m, `${key} row not found in PROTOCOL.md`);
    assert.equal(Number(m[1]), value, key);
  }
});

test("ErrorCode list matches PROTOCOL.md", () => {
  const block = doc.match(/type ErrorCode =([\s\S]*?);/);
  assert.ok(block, "ErrorCode block not found");
  const codes = [...(block[1] as string).matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(codes, [...ERROR_CODES]);
});

test("roles, what each may send, and what each receives match PROTOCOL.md §3", () => {
  const rows = [...doc.matchAll(/^\| `(screen|admin|driver|booster)` \|(.*)$/gm)];
  assert.equal(rows.length, 4);
  for (const row of rows) {
    const role = row[1] as (typeof ROLES)[number];
    const cells = (row[0] as string).split("|").map((c) => c.trim());
    // cells: ["", role, purpose, maysend, receives, ""]
    assert.deepEqual([...ROLE_MAY_SEND[role]].sort(), backticked(cells[3] as string).sort(), `${role} may-send`);
    if (role === "driver" || role === "booster") {
      assert.deepEqual([...ROLE_RECEIVES[role]].sort(), backticked(cells[4] as string).sort(), `${role} receives`);
    }
  }
  assert.deepEqual([...ROLE_RECEIVES.screen], [...ROLE_RECEIVES.admin]);
  assert.equal(ROLE_RECEIVES.screen.length, 5, "screen/admin receive all five broadcasts");
});

test("message directions match PROTOCOL.md §5.0", () => {
  const client = new Set<string>();
  const server = new Set<string>();
  for (const m of doc.matchAll(/^\| (\*\*)?`([A-Z_]+)`(\*\*)? \| (Client → Server only|Server → Client only|\*\*Both\*\*)/gm)) {
    const name = m[2] as string;
    const dir = m[4] as string;
    if (dir.startsWith("Client")) client.add(name);
    else if (dir.startsWith("Server")) server.add(name);
    else { client.add(name); server.add(name); }
  }
  assert.deepEqual([...client].sort(), [...CLIENT_MESSAGE_TYPES].sort());
  assert.deepEqual([...server].sort(), [...SERVER_MESSAGE_TYPES].sort());
  // Exactly BOOST and DRIVER_STEER exist in both directions.
  assert.deepEqual([...client].filter((t) => server.has(t)).sort(), ["BOOST", "DRIVER_STEER"]);
});

test("BOOST acceptance by status matches PROTOCOL.md §5.2", () => {
  // The table is indented inside a list item, so allow leading whitespace.
  const rows = [...doc.matchAll(/^\s*\| `(\w+)` \| (accepted|ignored) \|\s*$/gm)];
  assert.equal(rows.length, RACE_STATUSES.length);
  const accepted = rows.filter((r) => r[2] === "accepted").map((r) => r[1]).sort();
  assert.deepEqual(accepted, [...BOOST_ACCEPTING_STATUSES].sort());
  assert.deepEqual(rows.map((r) => r[1]), [...RACE_STATUSES]);
});
