// Server configuration. Every value has a default and can be overridden through
// environment variables (see loadConfig) or, in tests, through `overrides`.
// Rate-limit defaults come from the shared protocol (PROTOCOL.md §5.3).

import {
  DEFAULT_RATE_LIMITS,
  DEFAULT_MEME_CONFIG,
  type MemeConfig,
} from "../../shared/index.js";
import { DEFAULT_RACE_CONFIG, type RaceConfig } from "./engine.js";

export type ServerConfig = {
  port: number;
  host: string;
  /** Operator key for the `admin` role. If unset, the admin role is disabled. */
  adminKey?: string;
  rate: {
    boostRatePerSec: number;
    boostBurst: number;
    steerRatePerSec: number;
    maxMessageBytes: number;
    abuseDisconnectFactor: number;
    /** Overall frames/second per connection, any type (flood protection). */
    maxMessagesPerSec: number;
  };
  tickHz: number; // race simulation rate
  stateHz: number; // RACE_STATE broadcast rate
  activityHz: number; // TEAM_ACTIVITY rate
  heartbeatMs: number; // WebSocket ping interval; a socket that misses one pong is dropped
  helloTimeoutMs: number; // connections that never send HELLO are closed
  playerTtlMs: number; // how long a disconnected player's token stays valid
  maxConnections: number;
  race: RaceConfig;
  memes: MemeConfig;
};

export type ConfigOverrides = Partial<Omit<ServerConfig, "rate" | "race">> & {
  rate?: Partial<ServerConfig["rate"]>;
  race?: Partial<RaceConfig>;
};

function num(env: NodeJS.ProcessEnv, key: string, fallback: number, opts: { min?: number; int?: boolean } = {}): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || (opts.min !== undefined && n < opts.min) || (opts.int && !Number.isInteger(n))) {
    throw new Error(`Invalid ${key}="${raw}": expected a${opts.int ? "n integer" : " number"}${opts.min !== undefined ? ` >= ${opts.min}` : ""}.`);
  }
  return n;
}

/** Build the config from environment variables, then apply explicit overrides. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: ConfigOverrides = {}): ServerConfig {
  const r = DEFAULT_RACE_CONFIG;
  const scale = num(env, "MEME_THRESHOLD_SCALE", 1, { min: 0.001 });

  const base: ServerConfig = {
    port: num(env, "PORT", 8080, { min: 0, int: true }),
    host: env.HOST || "0.0.0.0",
    adminKey: env.ADMIN_KEY || undefined,
    rate: {
      boostRatePerSec: num(env, "BOOST_RATE_PER_SEC", DEFAULT_RATE_LIMITS.BOOST_RATE_PER_SEC, { min: 0.001 }),
      boostBurst: num(env, "BOOST_BURST", DEFAULT_RATE_LIMITS.BOOST_BURST, { min: 1 }),
      steerRatePerSec: num(env, "STEER_RATE_PER_SEC", DEFAULT_RATE_LIMITS.STEER_RATE_PER_SEC, { min: 0.001 }),
      maxMessageBytes: num(env, "MAX_MESSAGE_BYTES", DEFAULT_RATE_LIMITS.MAX_MESSAGE_BYTES, { min: 16, int: true }),
      abuseDisconnectFactor: num(env, "ABUSE_DISCONNECT_FACTOR", DEFAULT_RATE_LIMITS.ABUSE_DISCONNECT_FACTOR, { min: 1 }),
      maxMessagesPerSec: num(env, "MAX_MESSAGES_PER_SEC", 100, { min: 1 }),
    },
    tickHz: num(env, "TICK_HZ", 30, { min: 1 }),
    stateHz: num(env, "STATE_HZ", 20, { min: 1 }),
    activityHz: num(env, "ACTIVITY_HZ", 4, { min: 0.1 }),
    heartbeatMs: num(env, "HEARTBEAT_MS", 15000, { min: 10 }),
    helloTimeoutMs: num(env, "HELLO_TIMEOUT_MS", 10000, { min: 10 }),
    playerTtlMs: num(env, "PLAYER_TTL_MS", 10 * 60 * 1000, { min: 1000 }),
    maxConnections: num(env, "MAX_CONNECTIONS", 500, { min: 1, int: true }),
    race: {
      countdownSeconds: num(env, "COUNTDOWN_SECONDS", r.countdownSeconds, { min: 0 }),
      secondsAtSpeed1: num(env, "SECONDS_AT_SPEED_1", r.secondsAtSpeed1, { min: 0.1 }),
      baseSpeed: num(env, "BASE_SPEED", r.baseSpeed, { min: 0 }),
      boostSpeed: num(env, "BOOST_SPEED", r.boostSpeed, { min: 0 }),
      boostGain: num(env, "BOOST_GAIN", r.boostGain, { min: 0 }),
      energyDecayPerSec: num(env, "ENERGY_DECAY_PER_SEC", r.energyDecayPerSec, { min: 0 }),
      safeSpeed: num(env, "SAFE_SPEED", r.safeSpeed, { min: 0 }),
      finalLapPosition: num(env, "FINAL_LAP_POSITION", r.finalLapPosition, { min: 0 }),
    },
    memes: scale === 1
      ? DEFAULT_MEME_CONFIG
      : {
          memes: DEFAULT_MEME_CONFIG.memes.map((m) => ({ ...m, threshold: Math.max(1, Math.round(m.threshold * scale)) })),
        },
  };

  return {
    ...base,
    ...overrides,
    rate: { ...base.rate, ...overrides.rate },
    race: { ...base.race, ...overrides.race },
  };
}
