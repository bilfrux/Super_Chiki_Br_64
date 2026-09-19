# MONAD GRAND PRIX

> The driver drives. The crowd is the engine.

A multiplayer arcade racing game built for Monad Blitz Paris. One person drives each car from a phone; everyone else joins a team as a **Booster** and taps BOOST to power it. Boosts move the car instantly on the server and are recorded on **Monad Testnet** in batches, asynchronously: the race never waits for the chain.

| Folder | What | Owner |
|---|---|---|
| `server/` | Authoritative WebSocket server, race engine, lobby + QR, chain layer | Member B |
| `shared/` | Protocol v1: types, constants, validation, docs | Member B |
| `booster/` | Booster phone UI (plain HTML/CSS/JS, served by the server) | Member B |
| `contracts/` | `BoostLedger.sol` (Foundry) | Member B |
| `game/`, `driver/` | Big-screen game and Driver phone UI | Member A |

Contracts of the system: [`shared/protocol/PROTOCOL.md`](shared/protocol/PROTOCOL.md) (wire protocol), [`shared/protocol/GAME_INTEGRATION.md`](shared/protocol/GAME_INTEGRATION.md) (how the game connects), [`MONAD_RESOURCES.md`](MONAD_RESOURCES.md) (verified Monad configuration), [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SPEC.md`](SPEC.md).

---

## 1. Local setup

Requirements: **Node.js 22+** (developed on 22.17) and npm. Nothing else: no database, no blockchain needed to play.

```sh
git clone <this repo> && cd <repo>
cd server
npm install
cp .env.example .env      # then edit ADMIN_KEY (see section 2)
npm run dev               # builds, then starts (later runs: `npm start` if nothing changed)
```

The server prints the URLs:

```
Lobby + QR (open this on the big screen): http://localhost:8080/lobby/
Phones join at (encoded in the QR):       http://192.168.1.42:8080/booster/
```

The server also serves the whole front-end from the **same origin as the WebSocket**, so nothing needs configuring:

| URL | What | Who opens it |
|---|---|---|
| `/` | big-screen lobby (QR, team counts). When the race starts it hands over to the race screen `/test/v5.teams.html?live=1` and returns here after RESET | the big screen |
| `/lobby/` | operator page: enter `ADMIN_KEY`, press START RACE / RESET, see application vs blockchain metrics | the operator |
| `/join` | team picker; leads to `/booster/?team=<id>` | phones (this is what the QR encodes) |
| `/booster/` | Booster UI | phones |
| `/driver/` | Driver page (gyroscope steering); `?team=blue` picks a car | the four drivers |

1. Open `/` on the big screen and `/lobby/` on the operator laptop (enter `ADMIN_KEY`).
2. Phones on the **same Wi-Fi** scan the QR, pick a team and boost. Four drivers open `/driver/`.
3. Press START RACE in the operator page. No phones handy? `npm run demo` (server already running) plays a scripted 4-team race.

## 2. Environment variables

Read from the process environment; `npm start` also loads `server/.env` if it exists. **`.env` files are git-ignored: never commit one.** In production set them in your platform's secret manager. Everything is optional except that the admin role is disabled without `ADMIN_KEY`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP + WebSocket port (platforms inject this) |
| `HOST` | `0.0.0.0` | bind address |
| `ADMIN_KEY` | unset (admin disabled) | operator key for START/RESET. **Use a long random value in production**; the server warns if it is the example value |
| `PUBLIC_URL` | unset | public base URL of this server, no path, e.g. `https://mgp.example.com`. Used for the QR/join URL (section 7) |
| `DEMO_MODE` | `false` | `true` or `1`: simulated chain activity (section 9) |
| `RELAYER_PRIVATE_KEY` | unset | **SECRET.** Throwaway Monad **testnet** key that pays for batch transactions (section 8) |
| `BOOST_LEDGER_ADDRESS` | unset | address of the deployed `BoostLedger` |
| `CHAIN_ID` | `10143` | checked against the RPC at startup |
| `MONAD_RPC_URLS` | official testnet RPCs | comma separated, tried in order |
| `CHAIN_FLUSH_MS` `CHAIN_GAS_LIMIT` `RPC_TIMEOUT_MS` `CHAIN_POLL_MS` `CHAIN_CONFIRM_TIMEOUT_MS` `CHAIN_MAX_IN_FLIGHT` `CHAIN_UNAVAILABLE_AFTER_MS` `CHAIN_PROBE_MS` | see `server/src/config.ts` | chain batching / failure tuning |
| `BOOST_RATE_PER_SEC` `BOOST_BURST` `STEER_RATE_PER_SEC` `MAX_MESSAGE_BYTES` `ABUSE_DISCONNECT_FACTOR` `MAX_MESSAGES_PER_SEC` `MAX_CONNECTIONS` | protocol defaults | rate limits |
| `TICK_HZ` `STATE_HZ` `ACTIVITY_HZ` `HEARTBEAT_MS` `HELLO_TIMEOUT_MS` `PLAYER_TTL_MS` | 30 / 20 / 4 / 15000 / 10000 / 600000 | timing |
| `COUNTDOWN_SECONDS` `SECONDS_AT_SPEED_1` `BASE_SPEED` `BOOST_SPEED` `BOOST_GAIN` `ENERGY_DECAY_PER_SEC` `SAFE_SPEED` `FINAL_LAP_POSITION` `MEME_THRESHOLD_SCALE` | see `server/README.md` | race tuning (`MEME_THRESHOLD_SCALE=0.1` makes memes fire 10x sooner for rehearsals) |

Secrets are only `ADMIN_KEY` and `RELAYER_PRIVATE_KEY`. The server never logs them and never returns them from `/health`, `/api/join` or `/api/metrics`.

## 3. Development commands

Run inside `server/` unless noted.

| Command | What |
|---|---|
| `npm run dev` | build, then start |
| `npm start` | start the compiled server (`dist/`), loading `.env` if present |
| `npm run build` | `tsc` build to `server/dist` |
| `npm run typecheck` | type-check without emitting |
| `npm run demo` | scripted 4-team race against a running server |
| `npm run sim` | scripted scenario with configurable boosters (`--boosters N`) |
| `npm run chain:check` | verify chain configuration against the real RPC; sends nothing |
| `cd shared && npm run typecheck` | type-check the protocol package |

## 4. Test commands

```sh
cd server && npm test        # typecheck + build + all server tests (~110)
cd shared && npm test        # protocol tests (~40)
```

- Includes real-browser tests (Chrome/Edge headless); they are skipped if no browser is found. Set `BROWSER_PATH` to point at one, `SCREENSHOT_DIR` to save screenshots.
- The Monad tests run against a fake JSON-RPC node: no network, no funds needed.
- **Windows:** running the whole suite many times in a row can exhaust ephemeral ports (`connect EADDRINUSE 127.0.0.1:49xxx`, thousands of sockets in TIME_WAIT). That is the OS, not the code: wait a few minutes or reboot.

## 5. Production deployment

The server is one Node process with **in-memory state**: run exactly **one instance** (no horizontal scaling). A restart returns to an empty lobby; phones reconnect on their own and keep their team.

### Docker (`server/Dockerfile`)

Build from the **repository root** (the server needs `shared/` and `booster/`):

```sh
docker build -f server/Dockerfile -t mgp-server .
docker run --rm -p 8080:8080 \
  -e ADMIN_KEY="$(openssl rand -hex 24)" \
  -e PUBLIC_URL=https://mgp.example.com \
  mgp-server
```

Add `-e DEMO_MODE=true`, or `-e RELAYER_PRIVATE_KEY=... -e BOOST_LEDGER_ADDRESS=...` for chain modes. The image runs as a non-root user, has a `HEALTHCHECK` on `/health`, and contains no secrets. (The Dockerfile was written for Docker but could not be built in the development environment, which has no Docker: do one test build before the demo.)

### Without Docker (any Node host / VM)

```sh
cd server && npm ci && npm run build
PORT=8080 ADMIN_KEY=... PUBLIC_URL=https://... node dist/server/src/index.js
```

### Checklist for a public host

- Terminate **HTTPS** in front (platform load balancer or reverse proxy) and make sure it forwards **WebSocket upgrades** on `/ws` (Nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`, raise `proxy_read_timeout`).
- Set `PORT` if the platform gives you one (the server reads `process.env.PORT`), and `PUBLIC_URL` to the public https address.
- Set a long random `ADMIN_KEY`.
- Monitor `GET /health` (JSON: `ok`, `status`, connection counts by role, `uptimeSeconds`, `memoryMb`, and `chain` `{ mode, state, rpcHealthy, pendingTransactions, unsentBoosts }`). Logs go to stdout with ISO timestamps: connects, disconnects, START/RESET, chain warnings.
- `GET /api/metrics` gives the lobby's application vs blockchain numbers.

## 6. WebSocket endpoint & game/server connection configuration

- Endpoint: **`/ws`** on the same host and port as the HTTP server: `ws://<host>:<PORT>/ws` locally, `wss://<public-host>/ws` behind HTTPS. Protocol v1, JSON text frames.
- Every page the server serves (`/`, `/lobby/`, `/join`, `/booster/`, `/driver/`, `/test/v5.teams.html`) builds the URL from its own origin (http to ws, https to wss), so they need no configuration.
- The game and Driver pages all use **`game/net/mgp-client.js`** (`MgpClient.connect({ role, ... })`): HELLO with protocol version 1, token in localStorage, reconnect with backoff, throttled `DRIVER_STEER` (30 Hz). If a page is hosted somewhere other than the server, open it with **`?server=https://your-host`** (it becomes `wss://your-host/ws`); `MgpClient.link(path)` carries the override when navigating. Roles: big screen and race screen `{ role: "screen" }`, driver phone `{ role: "driver" }`. Details: [`GAME_INTEGRATION.md`](shared/protocol/GAME_INTEGRATION.md).
- The race screen (`/test/v5.teams.html`) runs the local single-player demo unless opened with **`?live=1`**, which makes the server the only source of truth (positions, winner, memes). The big-screen lobby opens it that way automatically.
- The QR image is just `GET /qr.svg`; the game can embed it.
- Anyone with `ADMIN_KEY` can START/RESET through role `admin` on this same endpoint.

## 7. Booster public URL

Phones open **`<PUBLIC_URL>/join`** (team picker, then `/booster/?team=<id>`; opening `<PUBLIC_URL>/booster/` directly also works and auto-assigns a team). The big-screen lobby at `/` encodes `/join` in its QR; the operator page `/lobby/` shows the server-computed join URL (`GET /api/join`).

- **Same Wi-Fi (no `PUBLIC_URL`):** the server picks this machine's LAN address. If it picks the wrong adapter, use the "Wrong address?" buttons on the lobby page.
- **Public host or tunnel:** set `PUBLIC_URL=https://your-host` (no path, no trailing slash needed). Check `GET /api/join` → `joinUrl`. Over HTTPS the pages automatically use `wss://`.
- Venue Wi-Fi with "client isolation" blocks phone-to-laptop traffic: use a public deployment or a tunnel (`PUBLIC_URL` = the tunnel address) instead.

## 8. Monad Testnet configuration

Verified values, sources and the design decision live in **[`MONAD_RESOURCES.md`](MONAD_RESOURCES.md)** (read that first; it is the source of truth). Summary: Monad Testnet, chain id **10143**, public RPCs `https://testnet-rpc.monad.xyz` and `https://rpc-testnet.monadinfra.com`, faucet linked from the official testnets page.

How it is used: the server batches accepted boosts into one `recordBatch` transaction every `CHAIN_FLUSH_MS` (2 s) from a single relayer wallet to `contracts/src/BoostLedger.sol`. Boosters never sign anything. A transaction counts as confirmed only once its block is finalized. Chain data never influences the race.

To go LIVE:

1. Fund a **throwaway** testnet wallet from the faucet.
2. Deploy `BoostLedger` with that wallet as relayer: see [`contracts/README.md`](contracts/README.md) (Foundry; the deployment is a manual step).
3. Set `RELAYER_PRIVATE_KEY` and `BOOST_LEDGER_ADDRESS` in the host's secrets.
4. `cd server && npm run chain:check` (chain id, finalized block, relayer balance, contract code). Then start the server: it prints `Chain: LIVE ...`.

## 9. DEMO_MODE fallback instructions

`DEMO_MODE=true` (or `1`) runs the full game with **simulated** chain transactions and no network access, for rehearsals or if Monad/RPC is unavailable on demo day.

- `RACE_STATE.chainMode` is `"DEMO"`; the lobby labels the counters "(simulated)". They must never be shown as real Monad data.
- Without `DEMO_MODE`, if the real RPC is unreachable the game keeps running, `chainMode` becomes `"OFF"` (lobby: `UNAVAILABLE`), boosts queue up and are recorded when the RPC returns. Nothing fake is generated.

| `chainMode` | Meaning | Game shows chain numbers |
|---|---|---|
| `LIVE` | real chain verified, RPC answering | yes, as real |
| `DEMO` | `DEMO_MODE` | only labelled simulated |
| `OFF` | not configured, misconfigured, or RPC down > 10 s | no |

**To switch to demo mode during the event:** set `DEMO_MODE=true` and restart the server (phones reconnect on their own within seconds; the race restarts from the lobby).

## 10. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Phones cannot open the QR link | Different Wi-Fi, guest/"client isolation" network, or firewall. Allow Node through the firewall (private networks), pick the right adapter on the lobby page, or set `PUBLIC_URL` to a tunnel/public URL |
| QR shows `localhost` | No network address found: join Wi-Fi or set `PUBLIC_URL` |
| Lobby has no START button | Enter the `ADMIN_KEY` under OPERATOR. If admin is disabled, the server was started without `ADMIN_KEY` |
| Page loads but stays "RECONNECTING" behind a proxy | The proxy is not forwarding WebSocket upgrades on `/ws` |
| Mixed-content / WebSocket blocked | `https` page must use `wss`: pages do this automatically; a custom game client must too |
| `EADDRINUSE` on start | Port taken: change `PORT` |
| `EADDRINUSE` in tests on Windows | Ephemeral port exhaustion (TIME_WAIT): wait or reboot |
| Lobby chain panel says `UNAVAILABLE`, `chainMode` is `OFF` | Monad RPC unreachable (or not verified yet). The race is unaffected; run `npm run chain:check`; use another RPC in `MONAD_RPC_URLS`; or `DEMO_MODE=true` |
| Server logs `chain disabled: RPC reports chain id ...` / `No contract deployed ...` | Wrong `CHAIN_ID` / `BOOST_LEDGER_ADDRESS` for the network |
| Relayer out of funds (`transactionsFailed` grows, `insufficient funds`) | Top up from the faucet; gas is charged on the gas limit |
| A driver phone dropped | Its car slows to safe speed at once; reopening `/driver` resumes the same seat |
| `SEAT_TAKEN` | Another live driver holds that team's seat |
| Everything looks stuck after a server restart | Expected: clean lobby. Phones reconnect by themselves; press START again |
| Need to see what the server thinks | `GET /health`, `GET /api/metrics`, `GET /api/join`, and the timestamped stdout log |
