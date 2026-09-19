# Connecting the game to the server (for Member A)

Everything here is already implemented and tested on the server side. Contract: [PROTOCOL.md](PROTOCOL.md). Types: `import type { ... } from "../shared"`.

## Already wired

The pages in this repo already use the server: `game/net/mgp-client.js` is the shared WebSocket client (origin-relative URL, `?server=` override), used by the big-screen lobby (`game/lobby`), the Driver page (`driver/`) and the race screen (`test/v5.teams.html?live=1`, "LIVE MODE" block). Serve them from the server itself (`npm start`): `/` lobby, `/join` phones, `/driver/`, `/lobby/` operator. The Vercel mock (`api/*`, `booster/mock/*`) is not used by these pages any more. The snippets below are for writing another client.

## 0. Run the backend

```sh
cd server
npm install
cp .env.example .env        # ADMIN_KEY=dev-admin-key
npm start                   # http://localhost:8080 , ws://localhost:8080/ws
npm run demo                # optional: scripted 4-team race against the running server
```

- `/lobby/` = big-screen lobby with QR + START/RESET (enter the ADMIN_KEY). `/booster/` = phone booster page.
- No blockchain needed: with nothing configured the chain fields are `0` and `chainMode` is `"OFF"`. `DEMO_MODE=true` in `.env` gives simulated chain counters with `chainMode: "DEMO"`.

## 1. The three connections your game makes

| Client | HELLO | Sends | Receives |
|---|---|---|---|
| Game screen (`/game`) | `{ role: "screen" }` | nothing (read-only) | `RACE_STATE`, `BOOST`, `TEAM_ACTIVITY`, `MEME_EVENT`, `DRIVER_STEER` |
| Driver phone (`/driver`) | `{ role: "driver", team?, token? }` | `DRIVER_STEER` (<= 30 Hz) | `RACE_STATE`, `TEAM_ACTIVITY`, `MEME_EVENT` |
| Operator (optional, or use `/lobby/`) | `{ role: "admin", adminKey }` | `CONTROL START / RESET` | everything |

Every HELLO is `{ type: "HELLO", protocolVersion: 1, role, ... }`. The server answers `WELCOME` (store `token`; send it again after a refresh to keep the same identity/seat) and immediately a `RACE_STATE`.

## 2. What to draw from what

| You want | Read |
|---|---|
| Car positions, speed, boost glow, HUD | `RACE_STATE.teams[i]`: `position` (0..1, 1 = finish), `speed`, `boostEnergy`, `boostRate`, `steer`, `boosters`, `driverConnected` |
| Race phase / countdown / winner | `status` (`LOBBY, COUNTDOWN, RACING, FINAL_LAP, CHAOS, FINISHED`), `elapsed` (negative during COUNTDOWN), `winner` (only when `FINISHED`) |
| "Crowd power" number | `metrics.boostsPerSecond` (all teams), `teams[i].boostRate` (per team) |
| Meme / chaos visuals and sounds | `MEME_EVENT { team, event }` once when it fires; `teams[i].activeEvent { event, remaining }` while it lasts. Map `event.visual` / `event.sound` to your assets. `status === "CHAOS"` = some team is in `CHAOS_MODE` |
| Particles on every boost burst | `BOOST { team, amount }` (aggregated per broadcast, not per tap) |
| Low-latency steering wobble | `DRIVER_STEER { team, value }` (same value as `teams[i].steer`) |
| Driver left | `driverConnected === false`: show "driver disconnected", the server already capped that car's speed |

Rules: **`RACE_STATE` is truth** (about 20 Hz; interpolate between snapshots for smoothness, never simulate). Events are hints; if an event and a snapshot disagree, the snapshot wins. A screen that only reads `RACE_STATE` is fully correct. `BOOST` / `MEME_EVENT` / `DRIVER_STEER` events always arrive *before* the snapshot that contains their effect.

## 3. Chain metrics: what may be shown

`RACE_STATE.chainMode` decides:

| `chainMode` | Show |
|---|---|
| `"LIVE"` | `metrics.transactionsSent`, `transactionsConfirmed`, `eventsReceived` as real Monad Testnet numbers |
| `"DEMO"` | the same numbers, **labelled "simulated"** |
| `"OFF"` | hide them. Not configured, misconfigured, or the RPC is currently unreachable (it goes back to `LIVE` by itself) |

`boostsPerSecond` / `actionsPerSecond` are application metrics. Never call them "Monad TPS". The game never talks to Monad and is never slowed by it: confirmations arrive late or never, and nothing in the race depends on them.

## 4. Minimal `WsClient` (drop-in starting point)

```ts
import type { GameEvent, RaceState, ServerMessage } from "../shared";
import { PROTOCOL_VERSION } from "../shared";

export function connect(url: string, role: "screen" | "driver", onState: (s: RaceState) => void, onEvent: (e: GameEvent) => void) {
  let ws: WebSocket, attempt = 0;
  const open = () => {
    ws = new WebSocket(url);                                  // ws://<server>:8080/ws
    ws.onopen = () => {
      attempt = 0;
      ws.send(JSON.stringify({ type: "HELLO", protocolVersion: PROTOCOL_VERSION, role,
        token: localStorage.getItem(`mgp.${role}.token`) ?? undefined }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as ServerMessage;
      if (m.type === "WELCOME") localStorage.setItem(`mgp.${role}.token`, m.token);
      else if (m.type === "RACE_STATE") onState(m.state);
      else if (m.type === "BOOST" || m.type === "TEAM_ACTIVITY" || m.type === "MEME_EVENT" || m.type === "DRIVER_STEER") onEvent(m);
    };
    ws.onclose = () => setTimeout(open, Math.min(5000, 400 * 2 ** attempt++)); // server restarts and phone sleeps are normal
  };
  open();
  return { steer: (value: number) => ws.readyState === 1 && ws.send(JSON.stringify({ type: "DRIVER_STEER", value })) };
}
```

Driver: call `steer(value)` at <= 30 Hz with `value` in -1..1 (out-of-range is clamped by the server). On `close` code `4001` the same identity opened elsewhere: do not auto-reconnect in a loop (the Booster page shows a "PLAY HERE" button for this). `ERROR` messages are informational; `PROTOCOL_MISMATCH` means the page is out of date.

## 5. Verified scenarios (`server/test/integration.test.ts`, run with `npm test` in `/server`)

Every message received by every client in every scenario is checked against the protocol (exact keys, ranges, and that the role may receive that message type).

| Scenario | Result |
|---|---|
| Cadence, default config | `RACE_STATE` 17.9 Hz, `TEAM_ACTIVITY` 3.6 Hz per team, `WELCOME` then `RACE_STATE` on connect |
| 1 Driver | steer clamped, `DRIVER_STEER` event to screens only, snapshot after the event already holds the value, car at full base speed |
| 1 Booster (no driver) | `BOOST` events add up to the accepted boosts, `TEAM_ACTIVITY` flows, car capped at safe speed |
| 4 Drivers | independent steering, all four cars move, 5th driver gets `SEAT_TAKEN` |
| Many Boosters, whole race | `TEAM_ACTIVITY`, `MEME_EVENT` once per team, `CHAOS`, `FINAL_LAP`, `FINISHED` with the right winner, boosts after the finish ignored |
| 200 Boosters, 2000 simultaneous BOOST | all 2000 counted exactly once, visible in 164 ms, no errors, longest `RACE_STATE` gap 66 ms (nominal 50) |
| Driver disconnect | next snapshot: `driverConnected=false`, speed capped, others untouched, seat resumes |
| Booster disconnect | `boosters` drops in the next snapshot, remaining boosters still count |
| Monad delayed / RPC unavailable | boosts visible without waiting for Monad; longest `RACE_STATE` gap 52 ms (slow RPC) and 49 ms (RPC down); `chainMode` goes `OFF` then back to `LIVE`; included-but-not-finalized is never counted as confirmed |
