// Runtime validation of INCOMING (client → server) messages.
// Source of truth: shared/protocol/PROTOCOL.md §3, §5.
//
// This validates shape and values only. It does NOT decide whether a role may
// send a message, whether HELLO came first, or whether the race state allows it
// (NOT_AUTHORIZED / NOT_HELLO / INVALID_STATE are the server's job).
//
// Returned messages are rebuilt from known fields only, so unknown extra
// fields sent by a client are never passed on (e.g. BOOST is always exactly
// { type: "BOOST" }).

import { TEAM_IDS, type TeamId } from "../types/index.js";
import {
  DEFAULT_MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  STEER_MAX,
  STEER_MIN,
} from "./constants.js";
import {
  CLIENT_MESSAGE_TYPES,
  CONTROL_ACTIONS,
  type ClientMessage,
  type ControlAction,
} from "./messages.js";
import { ROLES, type Role } from "./roles.js";

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: "INVALID_MESSAGE" | "PROTOCOL_MISMATCH"; message: string };

const invalid = (message: string): ParseResult => ({
  ok: false,
  code: "INVALID_MESSAGE",
  message,
});

export function isTeamId(v: unknown): v is TeamId {
  return typeof v === "string" && (TEAM_IDS as readonly string[]).includes(v);
}

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function isControlAction(v: unknown): v is ControlAction {
  return typeof v === "string" && (CONTROL_ACTIONS as readonly string[]).includes(v);
}

/** Clamp a steering value into [-1, 1] (PROTOCOL.md §5.2: server clamps). */
export function clampSteer(value: number): number {
  return Math.max(STEER_MIN, Math.min(STEER_MAX, value));
}

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

/**
 * Parse and validate one incoming frame.
 *
 * @param raw       the raw text frame, or an already-parsed value
 * @param maxBytes  frame size limit (default: PROTOCOL.md MAX_MESSAGE_BYTES)
 */
export function parseClientMessage(
  raw: unknown,
  maxBytes: number = DEFAULT_MAX_MESSAGE_BYTES,
): ParseResult {
  let data: unknown = raw;

  if (typeof raw === "string") {
    // A string longer than maxBytes in UTF-16 units is certainly over the limit;
    // otherwise measure real UTF-8 bytes.
    if (raw.length > maxBytes || new TextEncoder().encode(raw).length > maxBytes) {
      return invalid(`Message exceeds ${maxBytes} bytes.`);
    }
    try {
      data = JSON.parse(raw);
    } catch {
      return invalid("Message is not valid JSON.");
    }
  }

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return invalid("Message must be a JSON object.");
  }
  const m = data as Record<string, unknown>;

  if (typeof m.type !== "string") return invalid("Missing message type.");
  if (!(CLIENT_MESSAGE_TYPES as readonly string[]).includes(m.type)) {
    return invalid(`Unknown message type "${m.type}".`);
  }

  switch (m.type) {
    case "HELLO": {
      // Version is checked first so a different protocol version is reported as
      // a mismatch even if its other fields have a different shape.
      if (!isFiniteNumber(m.protocolVersion)) {
        return invalid("HELLO.protocolVersion is required and must be a number.");
      }
      if (m.protocolVersion !== PROTOCOL_VERSION) {
        return {
          ok: false,
          code: "PROTOCOL_MISMATCH",
          message: `Unsupported protocolVersion ${m.protocolVersion}; server speaks ${PROTOCOL_VERSION}.`,
        };
      }
      if (!isRole(m.role)) {
        return invalid(`HELLO.role must be one of: ${ROLES.join(", ")}.`);
      }
      const hello: ClientMessage = {
        type: "HELLO",
        protocolVersion: PROTOCOL_VERSION,
        role: m.role,
      };
      if (m.token !== undefined) {
        if (!isNonEmptyString(m.token)) return invalid("HELLO.token must be a non-empty string.");
        hello.token = m.token;
      }
      if (m.team !== undefined) {
        if (!isTeamId(m.team)) {
          return invalid(`HELLO.team must be one of: ${TEAM_IDS.join(", ")}.`);
        }
        hello.team = m.team;
      }
      if (m.adminKey !== undefined) {
        if (!isNonEmptyString(m.adminKey)) {
          return invalid("HELLO.adminKey must be a non-empty string.");
        }
        hello.adminKey = m.adminKey;
      }
      return { ok: true, message: hello };
    }

    case "DRIVER_STEER": {
      if (!isFiniteNumber(m.value)) {
        return invalid("DRIVER_STEER.value must be a finite number.");
      }
      // Out-of-range finite values are clamped, per PROTOCOL.md §5.2 / TEST_MATRIX #3.
      return { ok: true, message: { type: "DRIVER_STEER", value: clampSteer(m.value) } };
    }

    case "BOOST":
      // One message = one boost action. Any extra field (count, team, amount…) is ignored.
      return { ok: true, message: { type: "BOOST" } };

    case "CONTROL": {
      if (!isControlAction(m.action)) {
        return invalid(`CONTROL.action must be one of: ${CONTROL_ACTIONS.join(", ")}.`);
      }
      return { ok: true, message: { type: "CONTROL", action: m.action } };
    }

    case "PING": {
      if (!isFiniteNumber(m.t)) return invalid("PING.t must be a finite number.");
      return { ok: true, message: { type: "PING", t: m.t } };
    }

    default:
      // Unreachable: every entry of CLIENT_MESSAGE_TYPES is handled above.
      return invalid(`Unknown message type "${String(m.type)}".`);
  }
}
