# Protocol Test Matrix (v1)

> Defined **before** implementation. Each row will become an automated test that drives the server with simulated WebSocket clients (no game, no browser, no chain). Terms follow [`PROTOCOL.md`](PROTOCOL.md).
> Assumed test setup: server started with `ADMIN_KEY=test-key`, `chainMode: "OFF"` (or mock adapter), fast tick config, no network access.

## Required minimum

| # | Scenario | Steps | Expected |
|---|---|---|---|
| 1 | Driver connects | Connect; `HELLO {role:"driver", protocolVersion:1}` | `WELCOME` with `role:"driver"`, a `team`, `permissions:["STEER"]`, a `token`. Next `RACE_STATE` has that team's `driverConnected:true`. |
| 2 | Booster connects | Connect; `HELLO {role:"booster"}` | `WELCOME` with a `team`, `permissions:["BOOST"]`, `boostsSent:0`. That team's `boosters` = 1 in the next `RACE_STATE`. |
| 3 | Driver sends `DRIVER_STEER` | Race is `RACING`; driver sends `{value:0.5}` | That team's `steer` becomes `0.5` in `RACE_STATE`; screen/admin clients receive `DRIVER_STEER {team, value:0.5}`. Out-of-range (`5`) is clamped to `1`. |
| 4 | Booster sends `BOOST` | Race is `RACING`; booster sends `{type:"BOOST"}` once | Team's `boostEnergy` rises above 0 and `boostRate > 0`; screen/admin receive `BOOST {team, amount≥1}`; booster's `boostsSent` increases. |
| 5 | Server updates `TeamState` | Same as #4, inspect state | The `RACE_STATE` snapshot that follows contains the effect (energy up, later `speed` and `position` up). No `BOOST` event arrives that isn't already reflected in the next snapshot. |
| 6 | Server broadcasts `RACE_STATE` | Connect any client | Receives one `RACE_STATE` immediately, then periodic snapshots (~15–20 Hz). Always exactly 4 teams in order red, blue, green, yellow. |
| 7 | Unauthorized `CONTROL` is rejected | Booster sends `CONTROL {action:"START"}`; repeat as driver and screen | Each gets `ERROR {code:"NOT_AUTHORIZED"}` with a message. Status stays `LOBBY`. |
| 8 | Authorized `START` works | `HELLO {role:"admin", adminKey:"test-key"}` → `WELCOME.permissions` includes `"CONTROL"`; send `CONTROL START` in `LOBBY` | Status goes `COUNTDOWN` (`elapsed < 0`) → `RACING` (`elapsed ≥ 0`). `START` again while racing → `ERROR {code:"INVALID_STATE"}`. |
| 9 | Authorized `RESET` works | As admin, `CONTROL RESET` mid-race | Status `LOBBY`; all `position`, `boostEnergy`, `boostRate`, `steer` are `0`; `winner` absent; `elapsed` 0; race metrics zeroed; players still connected on the same teams. |
| 10 | Reconnect works | Booster connects, boosts, drops the socket, reconnects with `HELLO {token}` | Same `playerId` and `team`; `boostsSent` preserved; `boosters` count ends at 1 (no duplicate). Driver variant: `driverConnected` goes `false` (speed capped) then back to `true`. |
| 11 | Invalid message is rejected | Send non-JSON; unknown `type`; `DRIVER_STEER {value:"left"}`; a frame over `MAX_MESSAGE_BYTES`; any message before `HELLO` | `ERROR {code:"INVALID_MESSAGE"}` (or `NOT_HELLO` before `HELLO`). Server keeps running; other clients are unaffected. |

## Additional (cheap, high value)

| # | Scenario | Expected |
|---|---|---|
| 12 | Protocol mismatch: `HELLO {protocolVersion:999}` | `ERROR {code:"PROTOCOL_MISMATCH"}` then close. |
| 13 | Bad `adminKey`, or `role:"admin"` when server has no `ADMIN_KEY` | `ERROR {code:"NOT_AUTHORIZED"}` then close. |
| 14 | Role limits: driver sends `BOOST`; booster sends `DRIVER_STEER` | `ERROR {code:"NOT_AUTHORIZED"}`. State unchanged. |
| 15 | `BOOST` in `LOBBY` / `COUNTDOWN` / `FINISHED` | Ignored: **no `ERROR`**, no state change, not counted (`boostRate`, `boostEnergy`, `boostsSent`, meme thresholds, metrics all unchanged). Accepted in `RACING`, `FINAL_LAP` and `CHAOS`. |
| 16 | Second driver for a team that has a live driver | `ERROR {code:"SEAT_TAKEN"}`. Original driver unaffected. |
| 17 | Duplicate connection (same token twice) | Old socket closed, new one active, counts not doubled. |
| 18 | Team-based meme threshold | Booster on team X sends boosts to reach a meme threshold. `MEME_EVENT {team:X}` is emitted once; only team X has `activeEvent`; other teams don't. Further boosts don't refire it. After `duration`, `activeEvent` disappears. |
| 19 | Race completes | With scripted boosts a team reaches `position = 1`; status `FINISHED`; `winner` set; `position` never decreased; `elapsed` frozen. |
| 20 | Driver leaves mid-race | `driverConnected:false`; that team's `speed ≤ SAFE_SPEED`; race continues and other teams unaffected. |
| 21 | BOOST rate limit — One booster sends `{type:"BOOST"}` at far above `BOOST_RATE_PER_SEC` (e.g. 1000 msgs/s) for 2 s | Accepted boosts ≤ burst + rate × time; the rest are dropped and not counted; at most one `RATE_LIMITED` per second; persistent flooding beyond `ABUSE_DISCONNECT_FACTOR` closes that connection only. Tick cadence and other clients unaffected. |
| 22 | Chain never blocks | With a mock `ChainAdapter` that never resolves, `RACE_STATE` cadence and boost handling are unchanged; `transactionsSent` grows, `transactionsConfirmed` doesn't. |
| 23 | Client cannot choose boost size — Send `{type:"BOOST", count:999999}` and `{type:"BOOST", team:"red", amount:50}` | Each counts as exactly **one** boost action for the sender's own team (extra fields ignored, never read). |
| 24 | CHAOS is race-wide, effect is team-specific — Team X reaches the `CHAOS_MODE` threshold | `RaceState.status = "CHAOS"` for the whole race; only team X has `activeEvent` and the sped-up `speed`; other teams keep normal speed. When X's meme expires, status returns to the previous status. |
| 25 | Rate limits are per connection — Two boosters share an IP; one floods, one taps normally | Only the flooder is limited; the normal booster's boosts are all accepted. |
| 26 | START only in LOBBY, RESET anywhere — Admin sends `START` in each status; then `RESET` in each status | `START` succeeds only in `LOBBY` (`INVALID_STATE` otherwise); `RESET` succeeds in `LOBBY`, `COUNTDOWN`, `RACING`, `FINAL_LAP`, `CHAOS` and `FINISHED`. |
