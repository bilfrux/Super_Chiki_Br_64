// Strict structural check of everything the server sends, against shared/protocol/PROTOCOL.md §4-§5.
// Unknown or missing keys fail: this is what Member A's WsClient can rely on.

import {
  CHAIN_MODES,
  RACE_STATUSES,
  ROLE_RECEIVES,
  SPEED_MAX,
  TEAM_IDS,
  type Role,
  type ServerMessage,
} from "../../shared/index.js";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const int = (v: unknown): v is number => num(v) && Number.isInteger(v);

function keys(o: Record<string, unknown>, required: string[], optional: string[], where: string): void {
  for (const k of required) if (!(k in o)) throw new Error(`${where}: missing "${k}"`);
  for (const k of Object.keys(o)) if (!required.includes(k) && !optional.includes(k)) throw new Error(`${where}: unexpected key "${k}"`);
}
function check(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function team(v: unknown, where: string): void {
  check((TEAM_IDS as readonly unknown[]).includes(v), `${where}: bad team ${JSON.stringify(v)}`);
}

function memeEvent(e: unknown, where: string): void {
  check(isObj(e), `${where}: not an object`);
  keys(e, ["id", "name", "threshold", "duration", "visual", "effect"], ["sound"], where);
  check(typeof e.id === "string" && typeof e.name === "string" && typeof e.visual === "string" && typeof e.effect === "string", `${where}: strings`);
  check(num(e.threshold) && num(e.duration) && e.duration > 0, `${where}: numbers`);
  check(e.sound === undefined || typeof e.sound === "string", `${where}: sound`);
}

export function assertRaceState(state: unknown): void {
  check(isObj(state), "RACE_STATE.state not an object");
  keys(state, ["status", "elapsed", "teams", "metrics", "chainMode"], ["winner"], "state");
  check((RACE_STATUSES as readonly unknown[]).includes(state.status), `status ${String(state.status)}`);
  check(num(state.elapsed), "elapsed");
  check((state.status === "COUNTDOWN") === (num(state.elapsed) && state.elapsed < 0), "elapsed is negative exactly during COUNTDOWN");
  check((CHAIN_MODES as readonly unknown[]).includes(state.chainMode), `chainMode ${String(state.chainMode)}`);
  check(state.winner === undefined || (state.status === "FINISHED" && (TEAM_IDS as readonly unknown[]).includes(state.winner)), "winner only when FINISHED");
  check(state.status !== "FINISHED" || state.winner !== undefined, "FINISHED has a winner");

  const m = state.metrics;
  check(isObj(m), "metrics");
  keys(m, ["actionsPerSecond", "boostsPerSecond", "transactionsSent", "transactionsConfirmed", "eventsReceived"], [], "metrics");
  for (const k of Object.keys(m)) check(num(m[k]) && (m[k] as number) >= 0, `metrics.${k}`);
  check(int(m.transactionsSent) && int(m.transactionsConfirmed) && int(m.eventsReceived), "chain counters are integers");
  check((m.transactionsConfirmed as number) <= (m.transactionsSent as number), "confirmed <= sent");

  check(Array.isArray(state.teams) && state.teams.length === 4, "exactly 4 teams");
  state.teams.forEach((t: unknown, i: number) => {
    const w = `teams[${i}]`;
    check(isObj(t), w);
    keys(t, ["id", "boostEnergy", "boostRate", "position", "speed", "driverConnected", "boosters", "steer"], ["activeEvent"], w);
    check(t.id === TEAM_IDS[i], `${w}.id order`);
    check(num(t.boostEnergy) && t.boostEnergy >= 0 && t.boostEnergy <= 1, `${w}.boostEnergy`);
    check(num(t.boostRate) && t.boostRate >= 0, `${w}.boostRate`);
    check(num(t.position) && t.position >= 0 && t.position <= 1, `${w}.position`);
    check(num(t.speed) && t.speed >= 0 && t.speed <= SPEED_MAX, `${w}.speed`);
    check(typeof t.driverConnected === "boolean", `${w}.driverConnected`);
    check(int(t.boosters) && t.boosters >= 0, `${w}.boosters`);
    check(num(t.steer) && t.steer >= -1 && t.steer <= 1, `${w}.steer`);
    if (t.activeEvent !== undefined) {
      check(isObj(t.activeEvent), `${w}.activeEvent`);
      keys(t.activeEvent, ["event", "remaining"], [], `${w}.activeEvent`);
      memeEvent(t.activeEvent.event, `${w}.activeEvent.event`);
      check(num(t.activeEvent.remaining) && t.activeEvent.remaining > 0, `${w}.activeEvent.remaining`);
    }
  });
}

/** Throws with a precise message if `msg` is not exactly a protocol v1 server message. */
export function assertServerMessage(msg: ServerMessage): void {
  const m = msg as unknown as Record<string, unknown>;
  switch (msg.type) {
    case "RACE_STATE": keys(m, ["type", "state"], [], "RACE_STATE"); return assertRaceState(m.state);
    case "BOOST": keys(m, ["type", "team", "amount"], [], "BOOST"); team(m.team, "BOOST"); check(int(m.amount) && (m.amount as number) >= 1, "BOOST.amount"); return;
    case "TEAM_ACTIVITY": keys(m, ["type", "team", "rate"], [], "TEAM_ACTIVITY"); team(m.team, "TEAM_ACTIVITY"); check(num(m.rate) && (m.rate as number) >= 0, "TEAM_ACTIVITY.rate"); return;
    case "MEME_EVENT": keys(m, ["type", "team", "event"], [], "MEME_EVENT"); team(m.team, "MEME_EVENT"); return memeEvent(m.event, "MEME_EVENT.event");
    case "DRIVER_STEER": keys(m, ["type", "team", "value"], [], "DRIVER_STEER"); team(m.team, "DRIVER_STEER"); check(num(m.value) && Math.abs(m.value as number) <= 1, "DRIVER_STEER.value"); return;
    case "WELCOME": keys(m, ["type", "protocolVersion", "playerId", "token", "role", "permissions"], ["team", "boostsSent"], "WELCOME"); return;
    case "ERROR": keys(m, ["type", "code", "message"], [], "ERROR"); return;
    case "PONG": keys(m, ["type", "t"], [], "PONG"); return;
    default: throw new Error(`unknown server message type ${(msg as { type: string }).type}`);
  }
}

/** Every message a client of `role` received must be valid AND of a type that role is meant to receive. */
export function assertWire(role: Role, messages: readonly ServerMessage[]): void {
  const allowed = new Set<string>([...ROLE_RECEIVES[role], "WELCOME", "ERROR", "PONG"]);
  for (const msg of messages) {
    assertServerMessage(msg);
    if (!allowed.has(msg.type)) throw new Error(`${role} received ${msg.type}, which its role must not receive`);
  }
}
