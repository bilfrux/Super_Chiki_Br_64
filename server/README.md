# @mgp/server — authoritative WebSocket server (protocol v1)

Contract: [`../shared/protocol/PROTOCOL.md`](../shared/protocol/PROTOCOL.md). No Monad code yet (`chainMode` is `"OFF"`).

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
