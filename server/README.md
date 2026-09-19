# @mgp/server — authoritative WebSocket server (protocol v1)

Contract: [`../shared/protocol/PROTOCOL.md`](../shared/protocol/PROTOCOL.md). Chain layer: see "Monad Testnet" below. With nothing configured, `chainMode` is `"OFF"`.

The same port also serves the Booster phone UI (`/booster/`), the lobby + QR page (`/lobby/`), and a few JSON/SVG endpoints.

## Run

```sh
cd server
npm install
cp .env.example .env     # sets ADMIN_KEY=dev-admin-key (gitignored). Without ADMIN_KEY the admin role is disabled.
npm start                # prints the URLs below
```

`npm start` prints, for example:

```
Lobby + QR (open this on the big screen): http://localhost:8080/lobby/
Phones join at (encoded in the QR):       http://192.168.1.42:8080/booster/
```

1. Open the **lobby URL** on the big screen / laptop. It shows the QR code, the join URL under it, and a live team table.
2. Phones on the **same Wi-Fi** scan the QR and land on the Booster page, which assigns them a team (fewest players first).
3. To start: on the lobby page enter `ADMIN_KEY` under OPERATOR, press UNLOCK, then START RACE (RESET stops it). Without the key the page is read-only.

**If phones cannot connect:** allow Node through the Windows firewall (private networks) when prompted, make sure the phone and laptop are on the same network (guest/“client isolation” Wi-Fi blocks this), and if the machine has several adapters pick the Wi-Fi one from the "Wrong address?" buttons on the lobby page. For a tunnel or deployment set `PUBLIC_URL=https://your-host` and the QR uses that instead.

## Try it locally

```sh
npm run demo                                   # starts its own server + 4 drivers, 12 boosters, an admin; short race; prints a live table
npm run sim -- --admin-key dev-admin-key       # same scenario against the server you started with `npm start`
npm test                                       # 74 tests: engine, limiter, sockets, HTTP/QR, and real-browser tests (Chrome/Edge)
```

Manual test from a browser console (any page):

```js
const ws = new WebSocket("ws://localhost:8080/ws");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.onopen = () => ws.send(JSON.stringify({ type: "HELLO", protocolVersion: 1, role: "booster", team: "red" }));
// after START: ws.send(JSON.stringify({ type: "BOOST" }))
// driver:      role "driver" then ws.send(JSON.stringify({ type: "DRIVER_STEER", value: 0.5 }))
// admin:       role "admin", adminKey "dev-admin-key", then { type: "CONTROL", action: "START" }
```

## HTTP endpoints

| Path | What |
|---|---|
| `/booster/` | Booster phone UI (`/booster` directory, plain HTML/CSS/JS). `?team=red` picks a team. |
| `/lobby/` | Lobby: QR, live teams, operator START/RESET (`server/public/lobby`) |
| `/api/join` | JSON: the URL(s) phones should open + detected network addresses |
| `/qr.svg` | QR code of the join URL. `?host=<address>` picks one of the detected addresses (nothing else is accepted) |
| `/health` | JSON status |
| `/ws` | WebSocket (protocol v1) |
| `/` | redirects to `/booster/` |

Member A: the QR is just an `<img src="/qr.svg">`, so the big-screen game can show it in its own lobby without any server change.

## Configuration (environment variables, all optional)

`PORT` `HOST` `ADMIN_KEY` `PUBLIC_URL` (base URL for the QR, no path) `BOOSTER_DIR` `LOBBY_DIR` · rate limits: `BOOST_RATE_PER_SEC` `BOOST_BURST` `STEER_RATE_PER_SEC` `MAX_MESSAGE_BYTES` `ABUSE_DISCONNECT_FACTOR` `MAX_MESSAGES_PER_SEC` ·
timing: `TICK_HZ` `STATE_HZ` `ACTIVITY_HZ` `HEARTBEAT_MS` `HELLO_TIMEOUT_MS` `PLAYER_TTL_MS` `MAX_CONNECTIONS` ·
race tuning: `COUNTDOWN_SECONDS` `SECONDS_AT_SPEED_1` `BASE_SPEED` `BOOST_SPEED` `BOOST_GAIN` `ENERGY_DECAY_PER_SEC` `SAFE_SPEED` `FINAL_LAP_POSITION` · memes: `MEME_THRESHOLD_SCALE`.

## Layout

- `src/engine.ts` — `RaceEngine`: the authoritative 1-D race model. Pure (no sockets/timers), driven by `tick(dt)`.
- `src/server.ts` — sessions, HELLO/token/reconnect, permission checks, rate limiting, heartbeat, broadcast by role.
- `src/rateLimit.ts` — token-bucket limiter with abuse detection.
- `src/config.ts` — environment → config.
- `src/http.ts`, `src/staticFiles.ts` — HTTP router and a small safe static file server.
- `src/network.ts` — picks the LAN address for the QR (Wi-Fi first, VM/VPN adapters last). `src/qr.ts` — QR to SVG.
- `public/lobby/` — the lobby/operator page.
- `tools/` — `simclient.ts` (scriptable protocol client), `scenario.ts`, `demo.ts`, `sim.ts`.
- `test/` — `engine`, `limiter`, `server` (real WebSockets, rows tagged with TEST_MATRIX numbers), `http`, and `browser` (headless Chrome/Edge drives the real pages; skipped if none is installed, set `BROWSER_PATH` to point at one; `SCREENSHOT_DIR=dir` saves PNGs).

## Metrics: application vs blockchain

Two groups, never mixed. Nothing is called "Monad TPS".

**Application metrics** (measured by this server, always real):

| Where | Field | Meaning |
|---|---|---|
| `RACE_STATE.metrics` | `boostsPerSecond` | accepted boosts, all teams, 1 s sliding window |
| | `actionsPerSecond` | accepted boosts + `DRIVER_STEER` messages, same window |
| `RACE_STATE.teams[i]` | `boostRate`, `boosters`, `driverConnected` | per team |
| `GET /api/metrics` → `application` | `connectedPlayers/Drivers/Boosters/Screens`, per-team `boostsTotal`, `boostsPerSecond`, `boosters` | lobby only; race totals reset on `RESET` |

Only accepted boosts count (`RACING`/`FINAL_LAP`/`CHAOS`); rate-limited or ignored ones do not. Reading a rate is O(1) (running sums over a tick ring), so a burst of thousands of BOOSTs costs one addition each.

**Blockchain metrics** (reported by the chain layer only): `RACE_STATE.metrics.transactionsSent`, `transactionsConfirmed`, `eventsReceived`, plus `chainMode`. With no chain layer they are `0` and `chainMode` is `"OFF"`; the lobby shows `–` and "No chain configured". In `DEMO` mode the lobby labels them simulated.

**How the game consumes them:** it needs nothing beyond `RACE_STATE`. Show `metrics.boostsPerSecond` as "crowd power" (or use `teams[i].boostRate` per car), and show `transactionsSent/Confirmed` only when `chainMode === "LIVE"`. `/api/metrics` is for the lobby page; the game should not poll it.

## Monad Testnet (chain layer)

Code: `src/chain/`. Contract: `../contracts`. Decisions and sources: `../MONAD_RESOURCES.md`.

`BOOST` → race state updated at once → `chain.record(team)` (a counter bump) → every `CHAIN_FLUSH_MS` one batched `recordBatch` transaction from the server's relayer wallet → receipt → block finalized → `transactionsConfirmed` / `eventsReceived`. Nothing in the game path awaits the chain. RPC down or slow: boosts keep applying, counts are kept and retried with backoff (1 s → 15 s), the lobby shows RPC "DELAYED". Wrong chain id or no contract at the address: chain turns `OFF`, game unaffected.

| Mode | How | `chainMode` |
|---|---|---|
| none | default | `OFF` |
| simulated | `DEMO_MODE=true` | `DEMO` (counters are simulated) |
| real | `RELAYER_PRIVATE_KEY` + `BOOST_LEDGER_ADDRESS` | `LIVE` |

`npm run chain:check` verifies the configuration against the real RPC (chain id, finalized block, relayer balance, contract code) and sends nothing.

## Reliability and fallback (demo day)

- **Handlers cannot kill the server:** each incoming message, the simulation tick and the broadcast are wrapped; `index.ts` also logs (and survives) stray exceptions and rejections. A frame over 64 KiB or a flood costs only its sender the connection.
- **Driver leaves:** `driverConnected=false`, that car's speed is capped at `safeSpeed` in the same tick (boosts cannot lift it), the other cars are untouched, the seat is free for the same token or a new driver. **Booster leaves:** the team's `boosters` count drops, everything else carries on.
- **Refresh / reconnect / duplicates:** the token resumes the same identity; the newest socket wins and the old one is closed, so counts are never doubled.
- **Server restart:** state is in memory, so a restart is a clean lobby. Phones reconnect with their old token plus saved team and land on the same team/seat.
- **How the chain state shows up** (`RACE_STATE.chainMode`, details in the lobby's `/api/metrics` → `blockchain.chainState`):

| Situation | `chainMode` in RACE_STATE | lobby `chainState` |
|---|---|---|
| `DEMO_MODE=true` (or `1`) | `DEMO` (simulated) | `DEMO` |
| real chain verified and RPC answering | `LIVE` | `LIVE` |
| real chain configured, RPC unreachable > `CHAIN_UNAVAILABLE_AFTER_MS` (10 s), or not verified yet | `OFF` | `UNAVAILABLE` |
| nothing configured / wrong chain id / no contract | `OFF` | `OFF` |

The game must show chain numbers only for `LIVE`, or labelled as simulated for `DEMO`. Nothing is ever generated to fill in for a dead RPC: while it is down the counters stop, boosts queue up (`unsentBoosts`) and are recorded when it returns. `CHAIN_PROBE_MS` (5 s) pings an idle RPC so an outage is noticed even with nobody boosting.
