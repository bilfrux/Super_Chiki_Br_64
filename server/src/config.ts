// Server configuration. Every value has a default and can be overridden through
// environment variables (see loadConfig) or, in tests, through `overrides`.
// Rate-limit defaults come from the shared protocol (PROTOCOL.md §5.3).

import {
  DEFAULT_RATE_LIMITS,
  DEFAULT_MEME_CONFIG,
  type MemeConfig,
} from "../../shared/index.js";
import { DEFAULT_RACE_CONFIG, type RaceConfig } from "./engine.js";
import { DEFAULT_QUEUE_OPTIONS, type QueueOptions } from "./chain/queue.js";
import { defaultBoosterDir, defaultLobbyDir } from "./paths.js";

/** Monad Testnet values from https://docs.monad.xyz/developer-essentials/testnets (see MONAD_RESOURCES.md). */
export const MONAD_TESTNET_CHAIN_ID = 10143;
export const MONAD_TESTNET_RPC_URLS = ["https://testnet-rpc.monad.xyz", "https://rpc-testnet.monadinfra.com"];

export type ChainConfig = {
  /** DEMO_MODE=true: simulated chain activity, chainMode "DEMO". */
  demo: boolean;
  /** Live Monad is used only when both are set; otherwise chainMode is "OFF". */
  privateKey?: string; // RELAYER_PRIVATE_KEY, environment only
  contractAddress?: string; // BOOST_LEDGER_ADDRESS
  chainId: number;
  rpcUrls: string[];
  gasLimit: bigint;
  rpcTimeoutMs: number;
  queue: QueueOptions;
};

export type ServerConfig = {
  port: number;
  host: string;
  /** Operator key for the `admin` role. If unset, the admin role is disabled. */
  adminKey?: string;
  /**
   * Public base URL phones should use (e.g. an https tunnel or a deployment),
   * with no path. If unset, the QR code uses this machine's LAN address.
   */
  publicUrl?: string;
  boosterDir: string; // static files served at /booster/
  lobbyDir: string; // static files served at /lobby/
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
  chain: ChainConfig;
};

export type ConfigOverrides = Partial<Omit<ServerConfig, "rate" | "race" | "chain">> & {
  chain?: Partial<Omit<ChainConfig, "queue">> & { queue?: Partial<QueueOptions> };
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
    publicUrl: env.PUBLIC_URL || undefined,
    boosterDir: env.BOOSTER_DIR || defaultBoosterDir(),
    lobbyDir: env.LOBBY_DIR || defaultLobbyDir(),
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
    chain: {
      demo: /^(true|1)$/i.test(env.DEMO_MODE ?? ""),
      privateKey: env.RELAYER_PRIVATE_KEY || undefined,
      contractAddress: env.BOOST_LEDGER_ADDRESS || undefined,
      chainId: num(env, "CHAIN_ID", MONAD_TESTNET_CHAIN_ID, { min: 1, int: true }),
      rpcUrls: env.MONAD_RPC_URLS ? env.MONAD_RPC_URLS.split(",").map((u) => u.trim()).filter(Boolean) : MONAD_TESTNET_RPC_URLS,
      gasLimit: BigInt(num(env, "CHAIN_GAS_LIMIT", 150_000, { min: 21_000, int: true })),
      rpcTimeoutMs: num(env, "RPC_TIMEOUT_MS", 5000, { min: 100 }),
      queue: {
        flushMs: num(env, "CHAIN_FLUSH_MS", DEFAULT_QUEUE_OPTIONS.flushMs, { min: 50 }),
        pollMs: num(env, "CHAIN_POLL_MS", DEFAULT_QUEUE_OPTIONS.pollMs, { min: 50 }),
        confirmTimeoutMs: num(env, "CHAIN_CONFIRM_TIMEOUT_MS", DEFAULT_QUEUE_OPTIONS.confirmTimeoutMs, { min: 100 }),
        maxInFlight: num(env, "CHAIN_MAX_IN_FLIGHT", DEFAULT_QUEUE_OPTIONS.maxInFlight, { min: 1, int: true }),
        backoffMinMs: DEFAULT_QUEUE_OPTIONS.backoffMinMs,
        backoffMaxMs: DEFAULT_QUEUE_OPTIONS.backoffMaxMs,
        unavailableAfterMs: num(env, "CHAIN_UNAVAILABLE_AFTER_MS", DEFAULT_QUEUE_OPTIONS.unavailableAfterMs, { min: 0 }),
        probeMs: num(env, "CHAIN_PROBE_MS", DEFAULT_QUEUE_OPTIONS.probeMs, { min: 50 }),
      },
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
    chain: { ...base.chain, ...overrides.chain, queue: { ...base.chain.queue, ...overrides.chain?.queue } } as ChainConfig,
  };
}
