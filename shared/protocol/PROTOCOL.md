# MONAD GRAND PRIX — Shared Protocol

> **Protocol version: `1`**
> **Status: PROPOSED FOR MEMBER A REVIEW. Not final. Not committed. No code exists yet.**
> This file is the single contract between Member A (game) and Member B (server).
> Requirements source: `SPEC.md` §5, §6, §22. Companion: [`TEST_MATRIX.md`](TEST_MATRIX.md), ADR-001 in `ARCHITECTURE.md`.
>
> **Contract rule:** once this file is agreed, every type and field in it is part of the shared contract. Adding, changing or removing a field needs an explicit agreement between Member A and Member B and a version note here. Nobody drops or repurposes a field on their own.

---

## 1. Responsibility split

### Member B — server (`/server`, `/shared`, `/booster`, `/contracts`)

Owns and is **authoritative** for all shared multiplayer state:

- race `status`, `elapsed`, `winner`
- per team: `position`, `speed`, `boostEnergy`, `boostRate`, `boosters`, `driverConnected`, `steer`, `activeEvent`
- when a meme event fires, which one, for which team, and for how long
- metrics and `chainMode`
- player identity, team assignment, permissions, reconnection
- everything that touches Monad

### Member A — game (`/game`, `/driver`)

Owns everything **visual and tactile**:

- rendering: pseudo-3D road, camera, cars, particles, HUD, sound, meme visuals
- the Driver phone page (gyro, calibration, dead zone, smoothing → one steering number)
- `MOCK_MODE`

### The rule

> **The game renders server state. It never owns a competing copy of shared state.**

- The game does not decide who is ahead, who won, when the race starts or ends, or when a meme fires.
- **Client-side presentation is allowed:** interpolating between snapshots, camera, particles, lateral wobble, road curves, screen shake, sound. It is derived from server state, is overwritten by the next snapshot, and is never sent back.
- **`MOCK_MODE`** is a local stand-in *for the server*. With a real server connected, the mock simulation is off and the server wins.
- The server has **no physics, road geometry or collisions**. Its race model is tiny (§6). Member A never needs to know how the `RaceEngine` computes its numbers, only what the values mean (§4).

---

## 2. Transport and versioning

- One WebSocket endpoint: `/ws`. JSON text frames, each with a `type`.
- The server also serves static pages and `/health` (details are B's).
- **Version check:** the client sends `protocolVersion` in `HELLO`; the server answers `WELCOME.protocolVersion`. If they differ, the server sends `ERROR { code: "PROTOCOL_MISMATCH" }` and closes. There is no negotiation and no per-message versioning. Bump the number only for incompatible changes.

---

## 3. Roles and permissions

Roles are chosen in `HELLO`. Permissions are enforced **by the server on every message**, never by the client.

| Role | Purpose | May send | Receives |
|---|---|---|---|
| `screen` | Big-screen game (display only) | `HELLO`, `PING` | all broadcasts, incl. `DRIVER_STEER` and `BOOST` events |
| `admin` | Operator / authorized control client | `HELLO`, `PING`, **`CONTROL`** | same as `screen` |
| `driver` | Phone steering wheel, one per team | `HELLO`, `PING`, **`DRIVER_STEER`** | `RACE_STATE`, `TEAM_ACTIVITY`, `MEME_EVENT` |
| `booster` | Phone BOOST button | `HELLO`, `PING`, **`BOOST`** | `RACE_STATE`, `TEAM_ACTIVITY`, `MEME_EVENT` |

Rules:

- **`admin` requires a valid `adminKey`** in `HELLO` (matches the server's `ADMIN_KEY` environment variable). If the server has no `ADMIN_KEY` configured, the `admin` role is disabled. The key is never sent by any other message and never appears in the repo.
- **`CONTROL` from any role other than `admin` is rejected** with `ERROR { code: "NOT_AUTHORIZED" }`. A Booster (or Driver, or screen) can never start or reset a race.
- Any message a role is not allowed to send gets `NOT_AUTHORIZED`. For example, `BOOST` from a driver, or `DRIVER_STEER` from a booster.
- A game screen that wants to control the race connects as `admin` (with the key), or the operator uses a separate control page. Either works with no protocol change.
- A `driver` may only steer **its own team**. The team is decided by the server, never taken from a message.
- Unauthenticated or unknown connections (no `HELLO` first) get `ERROR { code: "NOT_HELLO" }` for any other message.

---

## 4. Shared state (exact structures)

```ts
type TeamId = "red" | "blue" | "green" | "yellow";

type TeamState = {
  id: TeamId;
  boostEnergy: number;      // 0..1
  boostRate: number;        // boosts/sec, >= 0
  position: number;         // 0..1
  speed: number;            // 0..1.5
  driverConnected: boolean;
  boosters: number;         // integer >= 0
  steer: number;            // -1..1
  activeEvent?: ActiveMeme; // meme currently affecting THIS team
};

type ActiveMeme = {
  event: MemeEvent;
  remaining: number;        // seconds left, > 0
};

type RaceState = {
  status: "LOBBY" | "COUNTDOWN" | "RACING" | "FINAL_LAP" | "CHAOS" | "FINISHED";
  elapsed: number;          // seconds, see below
  teams: TeamState[];       // always exactly 4, order: red, blue, green, yellow
  winner?: TeamId;          // present only when status === "FINISHED"
  metrics: {
    actionsPerSecond: number;
    boostsPerSecond: number;
    transactionsSent: number;
    transactionsConfirmed: number;
    eventsReceived: number;
  };
  chainMode: "LIVE" | "DEMO" | "OFF";
};

type MemeEvent = {
  id: string;               // e.g. "CHIKI_BRR"
  name: string;
  threshold: number;        // team boost count that triggers it
  duration: number;         // seconds
  visual: string;           // id; the game maps it to a visual
  sound?: string;           // id; the game maps it to a sound
  effect: string;           // id of a SERVER-side gameplay effect (§7)
};
```

### 4.1 Exact meaning of every value

| Field | Meaning |
|---|---|
| `position` | Fraction of the race distance completed. `0` = start line, `1` = finish line. Never decreases during a race; clamped to `1`. The team whose `position` reaches `1` first wins. It does **not** describe a lap, a curve, or a road coordinate. The game maps it onto whatever track it renders. |
| `speed` | Unitless, server-defined, `>= 0`. `0` = stopped, `1` = the speed of a fully boosted car, and it can exceed `1` (up to `1.5`) while a meme is active. Default tuning: a car at `speed = 1` covers the whole race in about 60 s. Treat it as a relative value to scale visual speed (linearly, or however looks best). Don't derive race results from it. Exact tuning constants are server config and may change without a protocol change. |
| `boostEnergy` | `0..1` charge from recent boosts. It rises when boosts arrive and decays over time. Use it for a boost bar or glow. |
| `boostRate` | Validated boosts per second for this team, averaged over a 1 s sliding window. |
| `boosters` | Number of currently connected boosters on this team. |
| `driverConnected` | Whether the team's driver is connected. When `false` the server caps the team's `speed` (safe mode). |
| `steer` | Latest accepted driver steering. `-1` = full left, `0` = neutral/straight, `+1` = full right. Cosmetic: it moves the car sideways in the renderer and has no effect on `position` or `speed`. `0` if there is no driver. |
| `activeEvent` | Present while a meme event triggered by this team's threshold is active. `remaining` counts down on the server. |
| `elapsed` | Seconds. **Negative during `COUNTDOWN`** (`-3.0` counting up to `0`, so `Math.ceil(-elapsed)` gives the 3-2-1). `0` at the start of `RACING`, then counts up. Frozen at its final value when `FINISHED`. `0` in `LOBBY`. |
| `winner` | Team that first reached `position = 1`. Only set in `FINISHED`. |
| `metrics.*` | Application metrics measured by the server (SPEC §15). They are **not** Monad network TPS. Counters are for the current race and reset on `RESET`. `eventsReceived` counts events the server received back from the chain layer. |
| `chainMode` | `LIVE` = real Monad Testnet. `DEMO` = `DEMO_MODE` fallback with simulated activity. `OFF` = no chain data available: not configured, misconfigured, not yet verified, **or the real chain's RPC has been unreachable for more than ~10 s** (it returns to `LIVE` when the RPC answers again; counters keep their last real values). Games must show chain metrics only when `LIVE` (or, clearly labelled as simulated, `DEMO`). In `DEMO` the game must not present chain metrics as real blockchain data. |

### 4.2 Status transitions (server-only)

```
LOBBY ──START──► COUNTDOWN ──► RACING ──► FINAL_LAP ──► FINISHED
                                  └────► CHAOS (overlay) ─┘
any status ──RESET──► LOBBY
```

- `FINAL_LAP` starts when the leader passes a configurable position (default `0.75`).
- **CHAOS is race-wide; the meme effect is team-specific.**
  - **Status (race-wide):** while *any* team has an active `CHAOS_MODE` meme, `RaceState.status = "CHAOS"` for the whole race. It returns to the previous status (`RACING` or `FINAL_LAP`) when no team has an active `CHAOS_MODE` meme any more. The status tells the game to run its chaos visuals for everyone.
  - **Gameplay effect (team-specific):** the meme's effect on `speed` applies **only to the triggering team** (the team whose `activeEvent` it is), unless that specific meme's definition explicitly says otherwise. No v0 meme does.
  - So in `CHAOS`, only the team(s) with `activeEvent.event.id === "CHAOS_MODE"` are sped up. The other teams race normally, under chaos visuals.
  - `BOOST` is accepted in `CHAOS` like in `RACING` and `FINAL_LAP` (§5.2).
- A winner ends the race regardless of status.

---

## 5. Messages

### 5.0 Direction of every message

Every message name is listed here with its direction. **Two names are used in both directions** (`DRIVER_STEER`, `BOOST`). Their payloads are different types, documented separately below: **the client message is an input request; the server message is a notification.** The client message never carries a team.

| Message | Direction | Schema |
|---|---|---|
| `HELLO` | Client → Server only | §5.2 |
| `CONTROL` | Client → Server only (`admin`) | §5.2 |
| `PING` | Client → Server only | §5.2 |
| `WELCOME` | Server → Client only (one client) | §5.4 |
| `ERROR` | Server → Client only (one client) | §5.4 |
| `PONG` | Server → Client only (one client) | §5.4 |
| `RACE_STATE` | Server → Client only (broadcast) | §5.1 |
| `TEAM_ACTIVITY` | Server → Client only (broadcast) | §5.1 |
| `MEME_EVENT` | Server → Client only (broadcast) | §5.1 |
| **`DRIVER_STEER`** | **Both**, different schemas | Client → Server: `ClientDriverSteer` (§5.2). Server → Client: `ServerDriverSteer` (§5.1) |
| **`BOOST`** | **Both**, different schemas | Client → Server: `ClientBoost` (§5.2). Server → Client: `ServerBoost` (§5.1) |

### 5.1 Server → clients (game events, SPEC §6)

```ts
type ServerEvent =
  | { type: "RACE_STATE";    state: RaceState }
  | ServerBoost
  | { type: "TEAM_ACTIVITY"; team: TeamId; rate: number }
  | { type: "MEME_EVENT";    team: TeamId; event: MemeEvent }
  | ServerDriverSteer;

type ServerBoost       = { type: "BOOST";        team: TeamId; amount: number };
type ServerDriverSteer = { type: "DRIVER_STEER"; team: TeamId; value: number };
```

| Message | Kind | Meaning |
|---|---|---|
| `RACE_STATE` | **authoritative current state** | Full snapshot, about 15–20 Hz, plus one immediately to every new connection and after `START` / `RESET`. |
| `BOOST` (Server → Client) | event / effect notification | Sent **after** the server has validated the boost(s) and applied them to `TeamState`. `amount` = number of **accepted** boosts for that team since the last `BOOST` event for it (server-side aggregation, not one message per tap). Use for particles/sound. |
| `TEAM_ACTIVITY` | activity information | `rate` = the team's current `boostRate`. About 4 Hz. For HUD/effects. |
| `MEME_EVENT` | server-triggered event | Sent once when a team reaches a meme threshold. `team` says whom it applies to. The state is also visible in `TeamState.activeEvent`. |
| `DRIVER_STEER` (Server → Client) | steering event | `value` (-1..1) is the value the server accepted, throttled. Same as `TeamState.steer`; use it for low-latency wobble. |

**Ordering guarantee.** For every input the server does, in this order: (1) validate, (2) update authoritative `TeamState`, (3) emit events, (4) broadcast `RACE_STATE`. No event is ever sent for a change that is not already in the server's state. Clients must not treat events as state changes. If an event and a snapshot disagree, the snapshot wins.

A screen that ignored every message except `RACE_STATE` would still be correct, just less flashy.

### 5.2 Clients → server

```ts
type ClientMessage =
  | { type: "HELLO";
      protocolVersion: 1;
      role: "screen" | "admin" | "driver" | "booster";
      token?: string;         // resume an earlier identity
      team?: TeamId;          // preference (driver/booster); server may override
      adminKey?: string }     // required for role "admin"
  | ClientDriverSteer
  | ClientBoost
  | { type: "CONTROL"; action: "START" | "RESET" }  // admin only
  | { type: "PING"; t: number };

type ClientDriverSteer = { type: "DRIVER_STEER"; value: number };  // driver only, -1..1
type ClientBoost       = { type: "BOOST" };                        // booster only; exactly one boost action
```

**`ClientBoost` has no payload.** One `BOOST` message is one boost action. There is no `count`, no amount, no team. Any extra field on it is ignored, never read. The server does all counting and aggregation. (Any later batching to Monad is a server-internal concern and never appears in this protocol.)

Server-side handling:

- **`DRIVER_STEER`:** value clamped to `-1..1`; non-numbers rejected. Recommended send rate ≤ 30 Hz; rate-limited by the server (§5.3).
- **`BOOST`:** one message = one boost action, subject to the state rule and the rate limit (§5.3). It is **accepted only** in `RACING`, `FINAL_LAP` and `CHAOS`:

  | Status | `BOOST` |
  |---|---|
  | `LOBBY` | ignored |
  | `COUNTDOWN` | ignored |
  | `RACING` | accepted |
  | `FINAL_LAP` | accepted |
  | `CHAOS` | accepted |
  | `FINISHED` | ignored |

  An **ignored** `BOOST` produces **no `ERROR`**, changes no state, and is **not counted** as an accepted boost (not in `boostRate`, `boostEnergy`, `boostsSent`, meme thresholds, or `metrics`).
- **`CONTROL START`:** only valid in `LOBBY` (→ `COUNTDOWN`), otherwise `ERROR { code: "INVALID_STATE" }`.
- **`CONTROL RESET`:** valid in any status. Returns to `LOBBY`, zeroes race state and race-scoped metrics, keeps players connected and on their teams.
- Clients **never** send team, position, speed, energy, winner, metrics or boost counts.

### 5.3 Rate limiting (server-enforced)

The server never relies on clients behaving. Limits are per connection, configurable through environment/config (defaults are proposals, tunable during testing):

| Setting | Meaning | Default |
|---|---|---|
| `BOOST_RATE_PER_SEC` | sustained accepted `BOOST` messages per second per connection | `15` |
| `BOOST_BURST` | short burst allowance (token bucket size) | `20` |
| `STEER_RATE_PER_SEC` | sustained `DRIVER_STEER` messages per second per connection | `40` |
| `MAX_MESSAGE_BYTES` | maximum frame size; larger frames are rejected | `1024` |
| `ABUSE_DISCONNECT_FACTOR` | a connection that keeps exceeding a limit by this multiple is disconnected | `10` |

Behaviour:

- Messages over the limit are **dropped and not counted**; state is unchanged. A buggy or malicious client cannot create more accepted boosts than `BOOST_RATE_PER_SEC` per connection, so it cannot flood the race.
- The server sends `ERROR { code: "RATE_LIMITED" }` at most once per second per connection (never one error per dropped message), and closes connections that persistently exceed the limit by `ABUSE_DISCONNECT_FACTOR`.
- Limits are **per connection, not per IP**, because many phones on venue Wi-Fi may share one address.
- Oversized frames, non-JSON, and unknown types count as invalid (`INVALID_MESSAGE`), also throttled.
- The limit applies before anything is applied to state, so a flood also cannot slow the tick loop.

### 5.4 Server → one client

```ts
type ServerReply =
  | { type: "WELCOME";
      protocolVersion: 1;
      playerId: string;
      token: string;                  // store it; send it in HELLO to reconnect
      role: "screen" | "admin" | "driver" | "booster";
      team?: TeamId;                  // driver/booster only
      permissions: ("STEER" | "BOOST" | "CONTROL")[];
      boostsSent?: number }           // booster's own running total
  | { type: "ERROR"; code: ErrorCode; message: string }
  | { type: "PONG"; t: number };

type ErrorCode =
  | "PROTOCOL_MISMATCH"   // HELLO.protocolVersion != server's
  | "NOT_HELLO"           // message sent before HELLO
  | "INVALID_MESSAGE"     // unparsable, unknown type, or bad field
  | "NOT_AUTHORIZED"      // role may not send this (incl. CONTROL from non-admin, bad adminKey)
  | "INVALID_STATE"       // e.g. START while a race is running
  | "SEAT_TAKEN"          // driver seat for that team already held by another live player
  | "RATE_LIMITED";
```

`ERROR` always carries a human-readable `message`. After `PROTOCOL_MISMATCH` and after a bad `adminKey` in `HELLO` the server closes the connection; other errors leave it open.

---

## 6. Server race model (informative)

Members A does not depend on this section. It is here so both sides know what "tiny" means. Fixed-step tick (~30 Hz), no physics engine:

```
on each accepted BOOST: boostEnergy += BOOST_GAIN                (clamped 0..1)
every tick:             boostEnergy -= DECAY * dt
                        speed = (BASE_SPEED + BOOST_SPEED * boostEnergy) × meme multiplier
                        no driver → speed capped at SAFE_SPEED
                        position += speed * dt / SECONDS_AT_SPEED_1
                        position >= 1 → FINISHED, winner = that team
```

All constants live in one server config file, tunable during the demo. Target race length is 60–120 s.

---

## 7. Meme events (team-based)

- Meme definitions are a config array of `MemeEvent` in `/shared`. The game never hardcodes thresholds.
- **Thresholds are per team.** Each team counts its own validated boosts during the current race. When that count reaches a meme's `threshold`, the **server** emits `MEME_EVENT` for **that team** and sets that team's `activeEvent`. Default thresholds are shared by all teams; the config may override thresholds per team.
- Each meme fires at most once per team per race. Two teams can have memes active at the same time.
- The **server** decides when a meme fires and applies its gameplay `effect` to the triggering team. The **game** decides only how it looks and sounds (`visual`, `sound`).
- v0 `effect` ids are a small closed set defined in `/shared` (e.g. `NONE`, `SPEED_MULT_<x>`, `CHAOS`).

---

## 8. Approved architecture and blockchain separation

```
Driver / Booster ──► WebSocket ──► SERVER ──► authoritative RaceState ──► GAME

                       (asynchronous, never awaited by the tick loop)
SERVER ──► ChainQueue ──► ChainAdapter ──► Monad
```

**The game loop never waits for Monad.**

- The game, driver and booster pages never talk to Monad and never see RPC details. The chain appears in the protocol only as `metrics.transactionsSent`, `metrics.transactionsConfirmed`, `metrics.eventsReceived` and `chainMode`.
- Inside the server, all chain code lives behind one `ChainAdapter` interface. Boosts update the race first; the `ChainQueue` is fed afterwards, is bounded, and can never block or slow the tick loop. Any batching or aggregation toward Monad happens **inside the server**, from already-validated boosts, and is completely invisible to the client protocol.
- Counters are incremented only from real adapter results. In `DEMO` mode simulated activity is labelled by `chainMode: "DEMO"` and must not be shown as real chain data (SPEC §15, §24).
- **The transaction mechanism (relayer, sponsorship, EIP-7702, ERC-4337, …) is not chosen.** It will be decided after the hackathon-specific resources are verified. See `MONAD_RESOURCES.md`.
- Whether confirmed chain activity should also feed back into gameplay is undecided. If it does, it enters the protocol as an ordinary `TEAM_ACTIVITY` / `MEME_EVENT`, not as a new chain-specific message.

---

## 9. Connections and reconnection

- The server issues a `token` in `WELCOME`. The client stores it (`localStorage`) and sends it in `HELLO` to resume the same identity, role and team (and `boostsSent`). A token only resumes an identity of the **same role**; otherwise it is ignored and a new identity is created.
- A new connection with the same token replaces the old one.
- **Team assignment:** default is the team with the fewest players. A `driver` takes the team's empty Driver seat; if another live driver holds it, the server answers `SEAT_TAKEN`. A `booster` can be assigned to any team.
- **Driver disconnect:** `driverConnected = false`, team speed capped (safe mode), race continues. On reconnect the seat is restored.
- **Booster disconnect:** `boosters` decrements. Nothing else changes.

---

## 10. What Member A builds against this

1. A `GameClient` interface with two implementations: `MockClient` (local sim) and `WsClient` (this protocol). The renderer depends only on the interface.
2. `WsClient` treats `RACE_STATE` as truth and interpolates only for smoothness.
3. `/driver` sends `HELLO { role: "driver" }` then `DRIVER_STEER` at ≤ 30 Hz.

---

## 11. Changes relative to SPEC.md (need explicit agreement)

These differ from the SPEC §5–§6 shapes. Together with the four fields already approved (`TeamState.steer`, `RaceState.winner`, `metrics.eventsReceived`, `chainMode`), they are the complete set of deviations:

1. **`MEME_EVENT` now carries `team`** (SPEC: `{ type, event }`). Needed because thresholds are per team.
2. **`RaceState.activeEvent` moved to `TeamState.activeEvent`** and now carries `remaining`. With per-team memes, several can be active at once, which a single race-wide field cannot express.
3. **`elapsed` is negative during `COUNTDOWN`.** This avoids adding a separate countdown field.
4. **`HELLO` / `WELCOME` / `ERROR` / `CONTROL` / `PING`** and the `admin` role are new (SPEC only defines the game-facing events).
5. **`BOOST` and `DRIVER_STEER` exist in both directions with different schemas** (§5.0). The client `BOOST` is `{ type: "BOOST" }` with no payload; only the server's `BOOST` event carries `team` and `amount`.
