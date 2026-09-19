# @mgp/server — authoritative WebSocket server (protocol v1)

Contract: [`../shared/protocol/PROTOCOL.md`](../shared/protocol/PROTOCOL.md). No Monad code yet (`chainMode` is `"OFF"`).

## Run

```sh
cd server
npm install
cp .env.example .env     # sets ADMIN_KEY=dev-admin-key (gitignored). Without ADMIN_KEY the admin role is disabled.
npm start                # ws://localhost:8080/ws   health: http://localhost:8080/health
```

## Try it locally

```sh
npm run demo                                   # starts its own server + 4 drivers, 12 boosters, an admin; short race; prints a live table
npm run sim -- --admin-key dev-admin-key       # same scenario against the server you started with `npm start`
npm test                                       # 57 tests (engine, limiter, real-socket integration)
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

## Configuration (environment variables, all optional)

`PORT` `HOST` `ADMIN_KEY` · rate limits: `BOOST_RATE_PER_SEC` `BOOST_BURST` `STEER_RATE_PER_SEC` `MAX_MESSAGE_BYTES` `ABUSE_DISCONNECT_FACTOR` `MAX_MESSAGES_PER_SEC` ·
timing: `TICK_HZ` `STATE_HZ` `ACTIVITY_HZ` `HEARTBEAT_MS` `HELLO_TIMEOUT_MS` `PLAYER_TTL_MS` `MAX_CONNECTIONS` ·
race tuning: `COUNTDOWN_SECONDS` `SECONDS_AT_SPEED_1` `BASE_SPEED` `BOOST_SPEED` `BOOST_GAIN` `ENERGY_DECAY_PER_SEC` `SAFE_SPEED` `FINAL_LAP_POSITION` · memes: `MEME_THRESHOLD_SCALE`.

## Layout

- `src/engine.ts` — `RaceEngine`: the authoritative 1-D race model. Pure (no sockets/timers), driven by `tick(dt)`.
- `src/server.ts` — sessions, HELLO/token/reconnect, permission checks, rate limiting, heartbeat, broadcast by role.
- `src/rateLimit.ts` — token-bucket limiter with abuse detection.
- `src/config.ts` — environment → config.
- `tools/` — `simclient.ts` (scriptable protocol client), `scenario.ts`, `demo.ts`, `sim.ts`.
- `test/` — `engine`, `limiter`, and `server` (real WebSockets) tests; rows are tagged with TEST_MATRIX numbers.
