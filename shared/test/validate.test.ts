import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  parseClientMessage,
  type ClientMessage,
} from "../index.js";

const ok = (raw: unknown): ClientMessage => {
  const r = parseClientMessage(raw);
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r)}`);
  if (!r.ok) throw new Error("unreachable");
  return r.message;
};

const bad = (raw: unknown, code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH" = "INVALID_MESSAGE") => {
  const r = parseClientMessage(raw);
  assert.equal(r.ok, false, `expected rejection of ${JSON.stringify(raw)}`);
  if (r.ok) throw new Error("unreachable");
  assert.equal(r.code, code);
  assert.ok(r.message.length > 0, "rejection carries a human-readable message");
};

const hello = (extra: Record<string, unknown> = {}) => ({
  type: "HELLO",
  protocolVersion: PROTOCOL_VERSION,
  role: "booster",
  ...extra,
});

// --- valid messages ---------------------------------------------------------

test("valid HELLO for every role", () => {
  for (const role of ["screen", "admin", "driver", "booster"]) {
    assert.deepEqual(ok(hello({ role })), { type: "HELLO", protocolVersion: 1, role });
  }
});

test("valid HELLO with token, team and adminKey", () => {
  assert.deepEqual(
    ok(hello({ role: "admin", token: "abc", team: "red", adminKey: "k" })),
    { type: "HELLO", protocolVersion: 1, role: "admin", token: "abc", team: "red", adminKey: "k" },
  );
});

test("valid messages parse from JSON text frames", () => {
  assert.deepEqual(ok(JSON.stringify(hello())), { type: "HELLO", protocolVersion: 1, role: "booster" });
  assert.deepEqual(ok('{"type":"BOOST"}'), { type: "BOOST" });
  assert.deepEqual(ok('{"type":"DRIVER_STEER","value":0.25}'), { type: "DRIVER_STEER", value: 0.25 });
  assert.deepEqual(ok('{"type":"CONTROL","action":"START"}'), { type: "CONTROL", action: "START" });
  assert.deepEqual(ok('{"type":"PING","t":123}'), { type: "PING", t: 123 });
});

test("valid CONTROL actions", () => {
  assert.deepEqual(ok({ type: "CONTROL", action: "START" }), { type: "CONTROL", action: "START" });
  assert.deepEqual(ok({ type: "CONTROL", action: "RESET" }), { type: "CONTROL", action: "RESET" });
});

test("valid teams in HELLO", () => {
  for (const team of ["red", "blue", "green", "yellow"]) {
    assert.equal((ok(hello({ team })) as { team?: string }).team, team);
  }
});

// --- malformed input --------------------------------------------------------

test("rejects non-JSON, non-objects and empty input", () => {
  bad("not json");
  bad("");
  bad("[]");
  bad("42");
  bad('"HELLO"');
  bad("null");
  bad(null);
  bad(undefined);
  bad(42);
  bad([]);
});

test("rejects unknown and missing message type", () => {
  bad({ type: "NOPE" });
  bad({ type: "boost" }); // case-sensitive
  bad({});
  bad({ type: 5 });
  bad({ value: 1 });
});

test("server-only message types are not valid client messages", () => {
  for (const type of ["WELCOME", "ERROR", "PONG", "RACE_STATE", "TEAM_ACTIVITY", "MEME_EVENT"]) {
    bad({ type });
  }
});

test("rejects oversized frames", () => {
  const big = JSON.stringify({ type: "PING", t: 1, pad: "x".repeat(DEFAULT_MAX_MESSAGE_BYTES) });
  bad(big);
  // Limit is in bytes, not characters: 400 × 3-byte chars = 1200 bytes.
  bad(JSON.stringify({ type: "BOOST", pad: "€".repeat(400) }));
  // The limit is configurable by the caller.
  const r = parseClientMessage('{"type":"BOOST"}', 5);
  assert.equal(r.ok, false);
});

// --- HELLO ------------------------------------------------------------------

test("HELLO: protocol version mismatch is detectable", () => {
  for (const v of [0, 2, 999, -1, 1.5]) {
    const r = parseClientMessage(hello({ protocolVersion: v }));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.code, "PROTOCOL_MISMATCH");
  }
  // A different version is a mismatch even if the rest of the message has a different shape.
  bad({ type: "HELLO", protocolVersion: 2, somethingNew: true }, "PROTOCOL_MISMATCH");
});

test("HELLO: missing or non-numeric protocolVersion is INVALID_MESSAGE", () => {
  bad({ type: "HELLO", role: "booster" });
  bad(hello({ protocolVersion: "1" }));
  bad(hello({ protocolVersion: null }));
  bad(hello({ protocolVersion: NaN }));
});

test("HELLO: invalid or missing role", () => {
  bad({ type: "HELLO", protocolVersion: 1 });
  bad(hello({ role: "spectator" }));
  bad(hello({ role: "ADMIN" }));
  bad(hello({ role: "" }));
  bad(hello({ role: 3 }));
  bad(hello({ role: null }));
});

test("HELLO: invalid team", () => {
  bad(hello({ team: "purple" }));
  bad(hello({ team: "RED" }));
  bad(hello({ team: 1 }));
  bad(hello({ team: "" }));
  bad(hello({ team: null }));
});

test("HELLO: malformed token / adminKey", () => {
  bad(hello({ token: 12 }));
  bad(hello({ token: "" }));
  bad(hello({ adminKey: {} }));
  bad(hello({ adminKey: "" }));
});

test("HELLO: unknown extra fields are dropped, not passed on", () => {
  assert.deepEqual(ok(hello({ evil: "x", isAdmin: true })), {
    type: "HELLO",
    protocolVersion: 1,
    role: "booster",
  });
});

// --- DRIVER_STEER -----------------------------------------------------------

test("DRIVER_STEER: in-range values pass unchanged", () => {
  for (const value of [-1, -0.5, 0, 0.001, 0.5, 1]) {
    assert.deepEqual(ok({ type: "DRIVER_STEER", value }), { type: "DRIVER_STEER", value });
  }
});

test("DRIVER_STEER: out-of-range finite values are clamped (PROTOCOL.md §5.2, TEST_MATRIX #3)", () => {
  assert.equal((ok({ type: "DRIVER_STEER", value: 5 }) as { value: number }).value, 1);
  assert.equal((ok({ type: "DRIVER_STEER", value: -5 }) as { value: number }).value, -1);
  assert.equal((ok({ type: "DRIVER_STEER", value: 1.0001 }) as { value: number }).value, 1);
  assert.equal((ok({ type: "DRIVER_STEER", value: 1e308 }) as { value: number }).value, 1);
});

test("DRIVER_STEER: non-numbers and non-finite numbers are rejected", () => {
  bad({ type: "DRIVER_STEER" });
  bad({ type: "DRIVER_STEER", value: "left" });
  bad({ type: "DRIVER_STEER", value: "0.5" });
  bad({ type: "DRIVER_STEER", value: null });
  bad({ type: "DRIVER_STEER", value: NaN });
  bad({ type: "DRIVER_STEER", value: Infinity });
  bad({ type: "DRIVER_STEER", value: -Infinity });
  bad({ type: "DRIVER_STEER", value: [0.5] });
  bad('{"type":"DRIVER_STEER","value":1e999}'); // parses to Infinity
});

test("DRIVER_STEER: a client-supplied team is ignored", () => {
  assert.deepEqual(ok({ type: "DRIVER_STEER", value: 0.5, team: "red" }), {
    type: "DRIVER_STEER",
    value: 0.5,
  });
});

// --- BOOST ------------------------------------------------------------------

test("BOOST is exactly { type: 'BOOST' }: client cannot choose count, amount or team", () => {
  assert.deepEqual(ok({ type: "BOOST" }), { type: "BOOST" });
  assert.deepEqual(ok({ type: "BOOST", count: 999999 }), { type: "BOOST" });
  assert.deepEqual(ok({ type: "BOOST", amount: 50, team: "red", count: -5 }), { type: "BOOST" });
});

// --- CONTROL ----------------------------------------------------------------

test("CONTROL: malformed action is rejected", () => {
  bad({ type: "CONTROL" });
  bad({ type: "CONTROL", action: "start" });
  bad({ type: "CONTROL", action: "STOP" });
  bad({ type: "CONTROL", action: "PAUSE" });
  bad({ type: "CONTROL", action: "" });
  bad({ type: "CONTROL", action: 1 });
  bad({ type: "CONTROL", action: null });
  bad({ type: "CONTROL", action: ["START"] });
});

// --- PING -------------------------------------------------------------------

test("PING: t must be a finite number", () => {
  bad({ type: "PING" });
  bad({ type: "PING", t: "now" });
  bad({ type: "PING", t: NaN });
  bad({ type: "PING", t: null });
});

// --- robustness -------------------------------------------------------------

test("prototype-pollution style payloads do not throw or leak", () => {
  const r = parseClientMessage('{"type":"BOOST","__proto__":{"admin":true},"constructor":{"x":1}}');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.message, { type: "BOOST" });
    assert.equal(({} as Record<string, unknown>).admin, undefined);
  }
});

test("validator never throws on arbitrary junk", () => {
  const junk: unknown[] = [
    Symbol.iterator.toString(), "\u0000", "{", "}", "{\"type\":", "🚗".repeat(10),
    () => 1, 1n, true, false, {}, { type: {} }, { type: [] }, { type: "HELLO", role: {} },
  ];
  for (const j of junk) {
    assert.doesNotThrow(() => parseClientMessage(j));
    assert.equal(parseClientMessage(j).ok, false);
  }
});
