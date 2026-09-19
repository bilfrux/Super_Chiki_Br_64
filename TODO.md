# MONAD GRAND PRIX — TODO

> Goal: build a playable, spectacular 3-minute demo in 7 hours.
>
> Rule: prioritize the core loop over polish.

---

# 🔴 CRITICAL — MUST WORK

## GAME — Member A

- [ ] Create basic game loop
- [ ] Create pseudo-3D road
- [ ] Create one playable car
- [ ] Add acceleration
- [ ] Add steering
- [ ] Add track boundaries
- [ ] Create 4 teams
- [ ] Create 4 cars
- [ ] Add team colors
- [ ] Add race countdown
- [ ] Add race start
- [ ] Add race finish
- [ ] Display winner
- [ ] Add BOOST effect
- [ ] Add team boost energy
- [ ] Add MOCK_MODE

---

## DRIVER — Member A

- [ ] Create mobile Driver page
- [ ] Request gyroscope permission
- [ ] Calibrate phone
- [ ] Convert gyro → steering value
- [ ] Add dead zone
- [ ] Add smoothing
- [ ] Send steering through WebSocket
- [ ] Handle reconnect
- [ ] Test on real phone

---

## BACKEND — Member B

- [ ] Create WebSocket server
- [ ] Create player model
- [ ] Create Driver connection
- [ ] Create Booster connection
- [ ] Create team assignment
- [ ] Receive DRIVER_STEER
- [ ] Receive BOOST
- [ ] Broadcast RACE_STATE
- [ ] Broadcast TEAM_ACTIVITY
- [ ] Handle disconnect
- [ ] Handle reconnect

---

## BOOSTER — Member B

- [ ] Create Booster mobile page
- [ ] Create team selection/join
- [ ] Create huge BOOST button
- [ ] Send BOOST events
- [ ] Display team
- [ ] Display boost count
- [ ] Display boost rate
- [ ] Create QR join flow

---

## MONAD — Member B

- [ ] Read official Monad documentation
- [ ] Verify network
- [ ] Verify chain ID
- [ ] Verify RPC
- [ ] Verify explorer
- [ ] Verify faucet
- [ ] Decide transaction architecture
- [ ] Create smart contract if needed
- [ ] Deploy to Monad Testnet
- [ ] Test transaction
- [ ] Test event
- [ ] Connect blockchain events to backend
- [ ] Verify everything on Testnet

---

# 🟠 CORE EXPERIENCE

## GAME

- [ ] Team positions
- [ ] Speed based on boost activity
- [ ] Live activity display
- [ ] Speed/energy HUD
- [ ] Race timer
- [ ] Final lap
- [ ] Final boost phase
- [ ] Chaos mode

---

## MEME SYSTEM

- [ ] Create MemeEvent structure
- [ ] Add configurable thresholds
- [ ] Add CHIKI_BRR
- [ ] Add GIGA_BOOST
- [ ] Add NPC_MODE
- [ ] Add CHAOS_MODE
- [ ] Add visual effects
- [ ] Add sound effects if time allows
- [ ] Trigger memes from team activity

Example:

100 boosts → MEME DROP

500 boosts → MEME ATTACK

1,000 boosts → CHIKI BRR

5,000 boosts → MEGA CHIKI

10,000 boosts → CHAOS MODE

---

# 🟡 MONAD / METRICS

- [ ] BOOSTS / SEC
- [ ] ACTIONS / SEC
- [ ] TRANSACTIONS SENT
- [ ] TRANSACTIONS CONFIRMED
- [ ] EVENTS RECEIVED
- [ ] Display live activity
- [ ] Verify metrics are correctly labeled

Do NOT call application metrics "Monad TPS".

---

# 🟢 RELIABILITY

- [ ] Driver reconnect
- [ ] Booster reconnect
- [ ] WebSocket failure handling
- [ ] RPC failure handling
- [ ] RPC delay handling
- [ ] Game continues without blockchain confirmation
- [ ] Race reset
- [ ] Multiple simultaneous BOOST events
- [ ] Multiple phones connected
- [ ] Test with 4 Drivers
- [ ] Test with many Boosters

---

# 🔵 DEMO

## Demo flow

- [ ] Lobby screen
- [ ] QR code visible
- [ ] Drivers connected
- [ ] Boosters connected
- [ ] Race starts
- [ ] Crowd boosts
- [ ] Activity increases
- [ ] Cars accelerate
- [ ] Monad activity visible
- [ ] Meme event
- [ ] FINAL LAP
- [ ] EVERYONE BOOST
- [ ] CHAOS MODE
- [ ] Winner

---

# ⏱️ HACKATHON CHECKPOINTS

## H+1

### Member A
- [ ] Car moves
- [ ] Basic road works
- [ ] Steering works locally

### Member B
- [ ] WebSocket server works
- [ ] Simulated Driver connects
- [ ] Simulated Booster connects

---

## H+2

- [ ] Game ↔ WebSocket connected
- [ ] Driver can control car
- [ ] BOOST affects team

---

## H+3 — HARD CHECKPOINT

> A playable multiplayer race MUST exist.

- [ ] 2+ Drivers connected
- [ ] Boosters connected
- [ ] Cars move
- [ ] Boost works
- [ ] Race can finish

### If this checkpoint fails:

STOP adding features.

Fix the core gameplay first.

---

## H+4

- [ ] Monad Testnet connected
- [ ] Transactions/events working
- [ ] Live metrics working

---

## H+5

- [ ] Meme system
- [ ] Final lap
- [ ] Chaos mode
- [ ] Visual polish

---

## H+6

- [ ] Deployment
- [ ] Full multiplayer test
- [ ] Testnet test
- [ ] Mobile test
- [ ] Reconnect test
- [ ] RPC failure test
- [ ] Demo fallback ready

---

## H+7

# 🛑 STOP BUILDING

- [ ] Final demo rehearsal
- [ ] Verify public URL
- [ ] Verify GitHub repository
- [ ] Verify Monad Testnet
- [ ] Prepare backup demo
- [ ] Prepare 3-minute pitch
- [ ] Submit project

---

# ❌ OUT OF SCOPE

Do NOT build unless everything above works:

- [ ] NFTs
- [ ] Profiles
- [ ] Authentication system
- [ ] Cosmetics
- [ ] Complex matchmaking
- [ ] Leaderboards
- [ ] Realistic physics
- [ ] Advanced collision system
- [ ] Complex 3D engine
- [ ] Mobile app
- [ ] Token economy
- [ ] DAO
- [ ] Unnecessary smart contract features

---

# 🏁 FINAL CORE LOOP

The project is considered successful when this works:

PHONE
  ↓
DRIVER STEERS
  ↓
SERVER
  ↓
CAR MOVES

CROWD
  ↓
BOOST
  ↓
SERVER
  ↓
TEAM POWER
  ↓
CAR GETS FASTER

MONAD
  ↓
ACTIVITY / EVENTS
  ↓
GAME EVENT
  ↓
MEME / CHAOS

        ↓

🏎️ MONAD GRAND PRIX 🏎️