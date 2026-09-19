// Protocol-level constants. Source of truth: shared/protocol/PROTOCOL.md.
// Defaults for rate limits are the PROTOCOL.md §5.3 defaults; the server may
// override them from environment/config. Nothing here is Monad-specific.

import type { RaceStatus } from "../types/index.js";

/** Protocol version. Sent in HELLO and WELCOME (PROTOCOL.md §2). */
export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

// --- Value ranges (PROTOCOL.md §4.1) ---
export const STEER_MIN = -1;
export const STEER_MAX = 1;
export const SPEED_MAX = 1.5;

// --- Rate limiting defaults (PROTOCOL.md §5.3) ---
/** Sustained accepted BOOST messages per second, per connection. */
export const DEFAULT_BOOST_RATE_PER_SEC = 15;
/** Short burst allowance (token bucket size) for BOOST. */
export const DEFAULT_BOOST_BURST = 20;
/** Sustained DRIVER_STEER messages per second, per connection. */
export const DEFAULT_STEER_RATE_PER_SEC = 40;
/** Maximum frame size in bytes; larger frames are rejected. */
export const DEFAULT_MAX_MESSAGE_BYTES = 1024;
/** A connection exceeding a limit by this multiple, persistently, is disconnected. */
export const DEFAULT_ABUSE_DISCONNECT_FACTOR = 10;
/** RATE_LIMITED errors are sent at most once per this interval, per connection. */
export const RATE_LIMITED_ERROR_MIN_INTERVAL_MS = 1000;

/** Recommended driver send rate (PROTOCOL.md §5.2). Advisory; the limit above is enforced. */
export const DRIVER_STEER_RECOMMENDED_MAX_HZ = 30;

/** Grouped defaults, for servers that read overrides from configuration. */
export const DEFAULT_RATE_LIMITS = {
  BOOST_RATE_PER_SEC: DEFAULT_BOOST_RATE_PER_SEC,
  BOOST_BURST: DEFAULT_BOOST_BURST,
  STEER_RATE_PER_SEC: DEFAULT_STEER_RATE_PER_SEC,
  MAX_MESSAGE_BYTES: DEFAULT_MAX_MESSAGE_BYTES,
  ABUSE_DISCONNECT_FACTOR: DEFAULT_ABUSE_DISCONNECT_FACTOR,
} as const;

// --- BOOST acceptance by race status (PROTOCOL.md §5.2) ---
/** BOOST is accepted only in these statuses; in all others it is silently ignored. */
export const BOOST_ACCEPTING_STATUSES: readonly RaceStatus[] = [
  "RACING",
  "FINAL_LAP",
  "CHAOS",
] as const;
