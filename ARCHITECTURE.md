# MONAD GRAND PRIX — Architecture

## High-level architecture

```text
                    BIG SCREEN
                        │
                        ▼
                 ┌─────────────┐
                 │    GAME     │
                 │   ENGINE    │
                 └──────┬──────┘
                        │
                 Game Event Protocol
                        │
                        ▼
                 ┌─────────────┐
                 │   SERVER    │
                 │ WebSocket   │
                 └──────┬──────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
       DRIVERS       BOOSTERS       MONAD
        phones        phones       Testnet

---

## ADR-001 — Server-authoritative state, thin shared protocol

Status: **approved by Member B; ready for Member A review. Not final until A agrees; not committed.** Full contract: [`shared/protocol/PROTOCOL.md`](shared/protocol/PROTOCOL.md). Tests: [`shared/protocol/TEST_MATRIX.md`](shared/protocol/TEST_MATRIX.md). Protocol version: `1`.

**Stack.** Node.js + TypeScript server, WebSocket (JSON), plain HTML/CSS/JS for the Booster page. Kept deliberately simple.

**Member A (`/game`, `/driver`).** Rendering, road, cars, camera, HUD, particles, sound, meme visuals, the Driver gyro page, `MOCK_MODE`.

**Member B (`/server`, `/shared`, `/booster`, `/contracts`).** WebSockets, players/teams, permissions, reconnection, the race model, meme triggering, metrics, everything Monad, deployment.

**Server-authoritative state.** The server owns race status, elapsed time, winner, and each team's position, speed, boost energy, boost rate, steering, and active meme. It runs a deliberately tiny 1-D model (boost energy → speed → progress) with no physics or road geometry. The game never needs the `RaceEngine` internals, only the documented meaning of each value.

**State vs events.** `RACE_STATE` is the authoritative current state. `BOOST`, `TEAM_ACTIVITY`, `MEME_EVENT` and `DRIVER_STEER` are notifications for effects. The server always updates `TeamState` first, then emits events, then broadcasts `RACE_STATE`. If an event and a snapshot disagree, the snapshot wins.

**Client-side rendering vs authoritative state.** The game renders server state. Interpolation, camera, particles and lateral wobble are presentation only and are overwritten by the next snapshot. `MOCK_MODE` is a local stand-in for the server and is off when a server is connected. The game must never create a competing source of truth.

**Permissions.** Roles `screen`, `admin`, `driver`, `booster`, enforced by the server on every message. Drivers may only `DRIVER_STEER`, Boosters only `BOOST`. `CONTROL START/RESET` is accepted only from an `admin` connection authenticated with the server's `ADMIN_KEY`; anything else gets `ERROR NOT_AUTHORIZED`.

**Team-based memes.** Each team counts its own accepted boosts. When a team reaches a threshold the server emits `MEME_EVENT` for that team. Member A only renders it. **CHAOS is race-wide** (`RaceState.status = "CHAOS"` while any team has an active `CHAOS_MODE` meme) but **the meme's gameplay effect is team-specific**, applying only to the triggering team unless a specific meme explicitly says otherwise.

**BOOST.** Client to server it is exactly `{ type: "BOOST" }`: one message, one boost action, no count. The server counts and aggregates. `BOOST` is accepted only in `RACING`, `FINAL_LAP` and `CHAOS`; in `LOBBY`, `COUNTDOWN` and `FINISHED` it is ignored (no `ERROR`, not counted). The server rate-limits it per connection (configurable), so a buggy or malicious client cannot flood the race.

**Message direction.** Every message is documented as Client to Server, Server to Client, or both. `BOOST` and `DRIVER_STEER` exist in both directions with separately documented schemas.

**Shared protocol.** Once agreed, every field is part of the contract; adding, changing or removing one needs explicit agreement between A and B. `protocolVersion: 1` exists only to detect incompatible client/server versions.

**Approved data flow.**

```text
Driver / Booster -> WebSocket -> SERVER -> authoritative RaceState -> GAME
SERVER -> ChainQueue -> ChainAdapter -> Monad      (asynchronous; the game loop never waits for Monad)
```

**Blockchain separation.** Boosts update the race first. Monad work happens afterwards in a bounded async queue behind one `ChainAdapter` interface, with a `DEMO_MODE` implementation. The game never sees RPC details and never waits on the chain; only metrics and `chainMode` cross the boundary. The transaction mechanism is **not chosen** until the hackathon-specific Monad resources are verified.
