// Authoritative WebSocket server for protocol v1 (shared/protocol/PROTOCOL.md).
//
//   clients ──► parse/validate ──► identity + permission checks ──► rate limits
//                                        │
//                                        ▼
//                                   RaceEngine  (single source of truth)
//                                        │
//               events, then RACE_STATE ─┴──► broadcast to clients by role
//
// Clients only send inputs. Team, position, speed, energy, winner and every
// counter are decided here. No blockchain code exists in this file: a later
// ChainQueue/ChainAdapter will be fed from accepted boosts, never awaited here.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  PROTOCOL_VERSION,
  RATE_LIMITED_ERROR_MIN_INTERVAL_MS,
  ROLE_MAY_SEND,
  ROLE_PERMISSIONS,
  ROLE_RECEIVES,
  TEAM_IDS,
  parseClientMessage,
  type ClientHello,
  type ClientMessage,
  type ErrorCode,
  type GameEvent,
  type Role,
  type ServerMessage,
  type TeamId,
} from "../../shared/index.js";
import type { ServerConfig } from "./config.js";
import { createChain } from "./chain/index.js";
import { RaceEngine } from "./engine.js";
import { createRequestHandler } from "./http.js";
import { buildLobbyMetrics } from "./metrics.js";
import { Limiter } from "./rateLimit.js";

/** Skip sending to a client whose socket buffer is this backed up (slow phone). */
const MAX_BUFFERED_BYTES = 1_000_000;
/** Hard frame ceiling enforced by ws itself; the protocol limit (MAX_MESSAGE_BYTES) is checked by the validator. */
const HARD_MAX_PAYLOAD = 65_536;

const CLOSE_PROTOCOL_ERROR = 1002;
const CLOSE_POLICY = 1008;
const CLOSE_TRY_LATER = 1013;
const CLOSE_REPLACED = 4001;

/** Persistent identity. Survives disconnects so a phone can resume with its token. */
type Player = {
  id: string;
  token: string;
  role: Role;
  team?: TeamId; // driver/booster only
  boostsSent: number;
  conn?: Conn; // set while connected
  lastSeen: number;
};

/** One WebSocket connection. */
type Conn = {
  ws: WebSocket;
  id: number;
  player?: Player;
  alive: boolean;
  closing: boolean;
  general: Limiter;
  boost: Limiter;
  steer: Limiter;
  lastRateErrorAt: number;
};

export type ServerHandle = {
  port: number;
  engine: RaceEngine;
  connectionCount(): number;
  close(): Promise<void>;
};

export type Logger = (message: string) => void;

const safeEqual = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
};

const rawToString = (data: RawData): string =>
  Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : data instanceof ArrayBuffer
      ? Buffer.from(data).toString("utf8")
      : data.toString("utf8");

export async function startServer(config: ServerConfig, log: Logger = console.log): Promise<ServerHandle> {
  const engine = new RaceEngine(config.race, config.memes, config.tickHz);
  // Chain layer (optional). Fed AFTER the race state changed; nothing here ever awaits it.
  const chain = createChain(config, log);
  if (chain) engine.setChainSource(() => chain.status());
  void chain?.start();
  const players = new Map<string, Player>(); // by token
  const conns = new Set<Conn>(); // every open socket
  const live = new Set<Conn>(); // sockets that completed HELLO
  const startedAt = Date.now();
  let nextConnId = 1;

  // --- HTTP (static UIs, join info, QR, health) + WebSocket upgrade on /ws ---

  let listeningPort = config.port;
  const httpServer = http.createServer(
    createRequestHandler({
      config,
      getPort: () => listeningPort,
      metrics: () =>
        buildLobbyMetrics(engine.snapshot(), [...live].map((c) => c.player!.role), engine.boostTotals(), chain?.status()),
      health: () => {
        const roles: Record<string, number> = { screen: 0, admin: 0, driver: 0, booster: 0 };
        for (const c of live) roles[c.player!.role] = (roles[c.player!.role] ?? 0) + 1;
        return {
          ok: true,
          protocolVersion: PROTOCOL_VERSION,
          status: engine.status,
          connections: roles,
          uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        };
      },
    }),
  );

  const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: HARD_MAX_PAYLOAD });
  wss.on("error", (err) => log(`! websocket server error: ${err.message}`));
  httpServer.on("clientError", (_err, socket) => { if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n"); });

  // --- sending ---------------------------------------------------------------

  const send = (conn: Conn, msg: ServerMessage): void => {
    if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(msg));
  };

  const sendError = (conn: Conn, code: ErrorCode, message: string): void =>
    send(conn, { type: "ERROR", code, message });

  const closeConn = (conn: Conn, code: number, reason: string): void => {
    conn.closing = true;
    conn.ws.close(code, reason);
  };

  /** Send a game event to every live client whose role receives that message type. */
  const broadcast = (msg: GameEvent): void => {
    if (live.size === 0) return;
    const data = JSON.stringify(msg);
    for (const c of live) {
      if (!ROLE_RECEIVES[c.player!.role].includes(msg.type)) continue;
      if (c.ws.readyState !== WebSocket.OPEN || c.ws.bufferedAmount > MAX_BUFFERED_BYTES) continue;
      c.ws.send(data);
    }
  };

  const broadcastState = (): void => broadcast({ type: "RACE_STATE", state: engine.snapshot() });

  /** Events first (the state they describe is already applied), then the snapshot. */
  let flushCount = 0;
  const activityEvery = Math.max(1, Math.round(config.stateHz / config.activityHz));
  const flushAndBroadcast = (): void => {
    flushCount += 1;
    for (const event of engine.flushEvents(flushCount % activityEvery === 0)) broadcast(event);
    broadcastState();
  };

  // --- presence (who is connected) → engine ---------------------------------

  const syncPresence = (): void => {
    for (const team of TEAM_IDS) {
      let driver = false;
      let boosters = 0;
      for (const c of live) {
        if (c.player!.team !== team) continue;
        if (c.player!.role === "driver") driver = true;
        else if (c.player!.role === "booster") boosters += 1;
      }
      engine.setPresence(team, driver, boosters);
    }
  };

  const liveDriver = (team: TeamId): Player | undefined => {
    for (const c of live) if (c.player!.role === "driver" && c.player!.team === team) return c.player;
    return undefined;
  };

  const playersOnTeam = (team: TeamId): number => {
    let n = 0;
    for (const c of live) if (c.player!.team === team) n += 1;
    return n;
  };

  /** Fewest connected players wins; ties go to team order (red, blue, green, yellow). */
  const fewestPlayers = (candidates: readonly TeamId[]): TeamId | undefined => {
    let best: TeamId | undefined;
    let bestCount = Infinity;
    for (const team of candidates) {
      const n = playersOnTeam(team);
      if (n < bestCount) { best = team; bestCount = n; }
    }
    return best;
  };

  // --- connection lifecycle ---------------------------------------------------

  const detach = (conn: Conn): void => {
    live.delete(conn);
    const p = conn.player;
    if (p && p.conn === conn) {
      p.conn = undefined;
      p.lastSeen = Date.now();
    }
    syncPresence();
  };

  wss.on("connection", (ws) => {
    const r = config.rate;
    const conn: Conn = {
      ws,
      id: nextConnId++,
      alive: true,
      closing: false,
      general: new Limiter(r.maxMessagesPerSec, r.maxMessagesPerSec, r.abuseDisconnectFactor),
      boost: new Limiter(r.boostRatePerSec, r.boostBurst, r.abuseDisconnectFactor),
      steer: new Limiter(r.steerRatePerSec, r.steerRatePerSec, r.abuseDisconnectFactor),
      lastRateErrorAt: 0,
    };

    if (conns.size >= config.maxConnections) {
      ws.close(CLOSE_TRY_LATER, "Server full");
      return;
    }
    conns.add(conn);

    // Connections that never identify themselves are dropped.
    const helloTimer = setTimeout(() => {
      if (!conn.player) closeConn(conn, CLOSE_POLICY, "HELLO timeout");
    }, config.helloTimeoutMs);
    helloTimer.unref();

    ws.on("pong", () => { conn.alive = true; });
    ws.on("message", (data, isBinary) => {
      // A bug or a hostile frame must cost one message, never the process.
      try { onMessage(conn, data, isBinary); } catch (err) { log(`! error handling a message from conn ${conn.id}: ${(err as Error)?.message}`); }
    });
    ws.on("error", () => { /* the close event follows; nothing to do */ });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      conns.delete(conn);
      const wasLive = live.has(conn);
      detach(conn);
      if (wasLive) log(`- ${conn.player?.role} ${conn.player?.team ?? ""} disconnected (${conn.player?.id.slice(0, 8)})`);
    });
  });

  // --- message handling -------------------------------------------------------

  const rateLimited = (conn: Conn, result: "limited" | "abuse", what: string): void => {
    const now = Date.now();
    if (result === "abuse") {
      sendError(conn, "RATE_LIMITED", `Too many ${what} messages; disconnecting.`);
      closeConn(conn, CLOSE_POLICY, "Rate limit abuse");
      log(`! conn ${conn.id} disconnected for flooding (${what})`);
      return;
    }
    if (now - conn.lastRateErrorAt >= RATE_LIMITED_ERROR_MIN_INTERVAL_MS) {
      conn.lastRateErrorAt = now;
      sendError(conn, "RATE_LIMITED", `Too many ${what} messages; extra messages are dropped.`);
    }
  };

  function onMessage(conn: Conn, data: RawData, isBinary: boolean): void {
    if (conn.closing) return;

    // 1. flood protection before doing any parsing work
    const g = conn.general.take(performance.now());
    if (g !== "ok") return rateLimited(conn, g, "");

    if (isBinary) return sendError(conn, "INVALID_MESSAGE", "Binary frames are not supported.");

    // 2. shape and value validation (shared with the client contract)
    const parsed = parseClientMessage(rawToString(data), config.rate.maxMessageBytes);
    if (!parsed.ok) {
      sendError(conn, parsed.code, parsed.message);
      if (parsed.code === "PROTOCOL_MISMATCH") closeConn(conn, CLOSE_PROTOCOL_ERROR, "Protocol mismatch");
      return;
    }
    const msg = parsed.message;

    // 3. identity
    if (msg.type === "HELLO") return handleHello(conn, msg);
    const player = conn.player;
    if (!player) return sendError(conn, "NOT_HELLO", "Send HELLO first.");

    // 4. permission: a role may only send its own message types
    if (!ROLE_MAY_SEND[player.role].includes(msg.type)) {
      return sendError(conn, "NOT_AUTHORIZED", `Role "${player.role}" may not send ${msg.type}.`);
    }

    handleMessage(conn, player, msg);
  }

  function handleMessage(conn: Conn, player: Player, msg: Exclude<ClientMessage, ClientHello>): void {
    switch (msg.type) {
      case "DRIVER_STEER": {
        const l = conn.steer.take(performance.now());
        if (l !== "ok") return rateLimited(conn, l, "DRIVER_STEER");
        engine.applySteer(player.team!, msg.value);
        return;
      }
      case "BOOST": {
        const l = conn.boost.take(performance.now());
        if (l !== "ok") return rateLimited(conn, l, "BOOST");
        // Ignored outside RACING / FINAL_LAP / CHAOS: no error, not counted.
        if (engine.applyBoost(player.team!)) {
          player.boostsSent += 1;
          chain?.record(player.team!); // O(1) counter bump; the transaction is sent later, asynchronously
        }
        return;
      }
      case "PING":
        return send(conn, { type: "PONG", t: msg.t });
      case "CONTROL": {
        if (msg.action === "START") {
          if (!engine.start()) {
            return sendError(conn, "INVALID_STATE", `START is only valid in LOBBY (status is ${engine.status}).`);
          }
          log(`> race START by admin`);
        } else {
          engine.reset();
          chain?.reset();
          log(`> race RESET by admin`);
        }
        broadcastState(); // immediate snapshot after START / RESET
        return;
      }
    }
  }

  function handleHello(conn: Conn, hello: ClientHello): void {
    if (conn.player) return sendError(conn, "INVALID_STATE", "Already identified on this connection.");
    const role = hello.role;

    if (role === "admin") {
      if (!config.adminKey || !hello.adminKey || !safeEqual(hello.adminKey, config.adminKey)) {
        sendError(conn, "NOT_AUTHORIZED", config.adminKey ? "Invalid adminKey." : "Admin role is disabled on this server.");
        return closeConn(conn, CLOSE_POLICY, "Not authorized");
      }
    }

    // Resume an earlier identity only if the token exists and the role matches.
    let player = hello.token ? players.get(hello.token) : undefined;
    if (player && player.role !== role) player = undefined;

    if (player) {
      // Resumed drivers must still have a free seat.
      if (role === "driver") {
        const holder = liveDriver(player.team!);
        if (holder && holder !== player) return sendError(conn, "SEAT_TAKEN", `The ${player.team} driver seat is taken.`);
      }
    } else {
      let team: TeamId | undefined;
      if (role === "driver") {
        if (hello.team) {
          if (liveDriver(hello.team)) return sendError(conn, "SEAT_TAKEN", `The ${hello.team} driver seat is taken.`);
          team = hello.team;
        } else {
          team = fewestPlayers(TEAM_IDS.filter((t) => !liveDriver(t)));
          if (!team) return sendError(conn, "SEAT_TAKEN", "All four driver seats are taken.");
        }
      } else if (role === "booster") {
        team = hello.team ?? fewestPlayers(TEAM_IDS);
      }
      player = {
        id: randomUUID(),
        token: randomBytes(16).toString("hex"),
        role,
        team,
        boostsSent: 0,
        lastSeen: Date.now(),
      };
      players.set(player.token, player);
    }

    // Duplicate connection: the newest wins, the old socket is dropped right away
    // so counts are never doubled.
    const previous = player.conn;
    if (previous && previous !== conn) {
      detach(previous);
      closeConn(previous, CLOSE_REPLACED, "Replaced by a newer connection");
    }

    player.conn = conn;
    conn.player = player;
    live.add(conn);
    syncPresence();

    send(conn, {
      type: "WELCOME",
      protocolVersion: PROTOCOL_VERSION,
      playerId: player.id,
      token: player.token,
      role,
      ...(player.team ? { team: player.team } : {}),
      permissions: [...ROLE_PERMISSIONS[role]],
      ...(role === "booster" ? { boostsSent: player.boostsSent } : {}),
    });
    send(conn, { type: "RACE_STATE", state: engine.snapshot() }); // immediate state for every new connection
    log(`+ ${role}${player.team ? " " + player.team : ""} connected (${player.id.slice(0, 8)}${hello.token && hello.token === player.token ? ", resumed" : ""})`);
  }

  // --- timers ---------------------------------------------------------------

  let lastTick = performance.now();
  const tickTimer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - lastTick) / 1000, 0.25); // never simulate a huge gap in one step
    lastTick = now;
    try { engine.tick(dt); } catch (err) { log(`! tick error: ${(err as Error)?.message}`); }
  }, 1000 / config.tickHz);

  const stateTimer = setInterval(() => {
    try { flushAndBroadcast(); } catch (err) { log(`! broadcast error: ${(err as Error)?.message}`); }
  }, 1000 / config.stateHz);

  // Heartbeat: a socket that did not answer the previous ping is dead.
  const heartbeatTimer = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      c.ws.ping();
    }
  }, config.heartbeatMs);

  // Forget players that stayed disconnected past the TTL.
  const pruneTimer = setInterval(() => {
    const cutoff = Date.now() - config.playerTtlMs;
    for (const [token, p] of players) if (!p.conn && p.lastSeen < cutoff) players.delete(token);
  }, Math.min(60_000, config.playerTtlMs));

  for (const t of [tickTimer, stateTimer, heartbeatTimer, pruneTimer]) t.unref();

  // --- listen / close ---------------------------------------------------------

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const port = (httpServer.address() as AddressInfo).port;
  listeningPort = port;

  return {
    port,
    engine,
    connectionCount: () => live.size,
    close: async () => {
      for (const t of [tickTimer, stateTimer, heartbeatTimer, pruneTimer]) clearInterval(t);
      chain?.stop();
      for (const c of conns) c.ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
