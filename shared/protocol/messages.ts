// Protocol messages. Source of truth: shared/protocol/PROTOCOL.md §5.
//
// DIRECTION IS PART OF THE TYPE NAME. BOOST and DRIVER_STEER use the same
// `type` string in both directions with different payloads; never merge them:
//   Client → Server: ClientBoost, ClientDriverSteer   (input requests)
//   Server → Client: ServerBoost, ServerDriverSteer   (notifications)

import type {
  MemeEvent,
  RaceState,
  TeamId,
} from "../types/index.js";
import type { ProtocolVersion } from "./constants.js";
import type { Permission, Role } from "./roles.js";

export const CONTROL_ACTIONS = ["START", "RESET"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export const ERROR_CODES = [
  "PROTOCOL_MISMATCH", // HELLO.protocolVersion != server's
  "NOT_HELLO", // message sent before HELLO
  "INVALID_MESSAGE", // unparsable, unknown type, or bad field
  "NOT_AUTHORIZED", // role may not send this (incl. CONTROL from non-admin, bad adminKey)
  "INVALID_STATE", // e.g. START while a race is running
  "SEAT_TAKEN", // driver seat for that team already held by another live player
  "RATE_LIMITED",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientHello = {
  type: "HELLO";
  protocolVersion: ProtocolVersion;
  role: Role;
  token?: string; // resume an earlier identity
  team?: TeamId; // preference (driver/booster); server may override
  adminKey?: string; // required for role "admin"
};

/** Driver steering request. -1 = full left, 0 = straight, +1 = full right. */
export type ClientDriverSteer = {
  type: "DRIVER_STEER";
  value: number;
};

/** Exactly one boost action. No payload: no count, no amount, no team. */
export type ClientBoost = {
  type: "BOOST";
};

/** Admin-only race control. */
export type ClientControl = {
  type: "CONTROL";
  action: ControlAction;
};

export type ClientPing = {
  type: "PING";
  t: number;
};

export type ClientMessage =
  | ClientHello
  | ClientDriverSteer
  | ClientBoost
  | ClientControl
  | ClientPing;

export type ClientMessageType = ClientMessage["type"];

export const CLIENT_MESSAGE_TYPES = [
  "HELLO",
  "DRIVER_STEER",
  "BOOST",
  "CONTROL",
  "PING",
] as const satisfies readonly ClientMessageType[];

// ---------------------------------------------------------------------------
// Server → Client: broadcast events (the "game event" protocol, SPEC §6)
// ---------------------------------------------------------------------------

/** Authoritative current state. Source of truth. */
export type ServerRaceState = {
  type: "RACE_STATE";
  state: RaceState;
};

/** Notification sent AFTER the server validated and applied the boost(s). */
export type ServerBoost = {
  type: "BOOST";
  team: TeamId;
  amount: number; // accepted boosts for that team since the last BOOST event
};

export type ServerTeamActivity = {
  type: "TEAM_ACTIVITY";
  team: TeamId;
  rate: number; // the team's current boostRate
};

/** Sent once when a team reaches a meme threshold. */
export type ServerMemeEvent = {
  type: "MEME_EVENT";
  team: TeamId;
  event: MemeEvent;
};

/** Steering value the server accepted (throttled). Same as TeamState.steer. */
export type ServerDriverSteer = {
  type: "DRIVER_STEER";
  team: TeamId;
  value: number;
};

/** The five game events (SPEC §6). RACE_STATE is truth; the others are effect hints. */
export type GameEvent =
  | ServerRaceState
  | ServerBoost
  | ServerTeamActivity
  | ServerMemeEvent
  | ServerDriverSteer;

/** Alias used in PROTOCOL.md §5.1. */
export type ServerEvent = GameEvent;

// ---------------------------------------------------------------------------
// Server → one client (replies)
// ---------------------------------------------------------------------------

export type ServerWelcome = {
  type: "WELCOME";
  protocolVersion: ProtocolVersion;
  playerId: string;
  token: string; // store it; send it in HELLO to reconnect
  role: Role;
  team?: TeamId; // driver/booster only
  permissions: Permission[];
  boostsSent?: number; // booster's own running total
};

export type ServerError = {
  type: "ERROR";
  code: ErrorCode;
  message: string;
};

export type ServerPong = {
  type: "PONG";
  t: number;
};

export type ServerReply = ServerWelcome | ServerError | ServerPong;

export type ServerMessage = GameEvent | ServerReply;

export type ServerMessageType = ServerMessage["type"];

export const SERVER_MESSAGE_TYPES = [
  "WELCOME",
  "ERROR",
  "PONG",
  "RACE_STATE",
  "BOOST",
  "TEAM_ACTIVITY",
  "MEME_EVENT",
  "DRIVER_STEER",
] as const satisfies readonly ServerMessageType[];
