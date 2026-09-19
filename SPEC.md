# MONAD GRAND PRIX

### Monad Blitz Paris — Final Project Specification

> **Tagline:** The driver drives. The crowd is the engine.
> **Core idea:** Turn blockchain activity and massive concurrent user interaction into a visible gameplay mechanic.

---

# 1. Vision

**MONAD GRAND PRIX** is a multiplayer arcade racing game designed specifically for Monad Blitz.

The game is intentionally simple to understand:

* 4 teams race simultaneously.
* Each team has **one Driver**.
* The Driver controls their car using the **gyroscope of their phone**.
* Everyone else joins the race as a **Booster** using a QR code.
* Boosters repeatedly press a giant **BOOST** button.
* The team's collective activity powers its car.
* Monad transactions/events are used as part of the game mechanics.
* High activity creates increasingly chaotic meme events.

The key idea is:

> **We turned blockchain throughput and concurrent activity into a game mechanic.**

Monad is therefore not merely used as a wallet or leaderboard.

The network activity itself becomes part of the gameplay.

---

# 2. Hackathon constraints

The project must respect the Monad Blitz rules.

The project must:

* be conceived specifically for Monad Blitz;
* be deployed and operational on Monad Testnet;
* have a public submission repository;
* provide a live demo;
* clearly demonstrate the Monad-specific innovation;
* prioritize novelty, experimentation and learning over unnecessary polish.

## Existing code

We may use:

* standard libraries;
* standard frameworks;
* standard boilerplates;
* small generic utilities where permitted.

We must **not rely on a substantial existing racing codebase** as the foundation of the project.

In particular, `javascript-racer` may be studied for pseudo-3D racing techniques and architecture, but the project should not simply become a modified copy of its racing engine.

If a specific small component is considered for reuse, its exact origin and scope must be checked before integration.

The project should have its own:

* game logic;
* team mechanics;
* multiplayer architecture;
* boost system;
* Monad integration;
* meme/event system;
* mobile control system.

---

# 3. Team structure

There are **2 people**.

The most important constraint is:

> **Each person should be able to vibe-code independently for most of the hackathon.**

We deliberately minimize shared files and shared code.

## Member A — GAME / EXPERIENCE

Owns everything the player sees and touches on the racing side.

### Responsibilities

* racing game
* pseudo-3D road
* cars
* movement
* steering input interface
* team colors
* boost effects
* collisions / boundaries
* camera
* particles
* HUD
* countdown
* race states
* meme events
* chaos mode
* victory screen
* spectator experience
* responsive mobile Booster UI if needed visually
* local game simulation

### Main directory

```text
/game
```

and, if needed:

```text
/driver
```

for the Driver phone interface.

### Member A should NOT need to touch

```text
/contracts
/server/blockchain
```

unless integration requires it.

---

# 4. Member B — MONAD / MULTIPLAYER / INFRA

Owns everything connecting players, the server and Monad.

### Responsibilities

* WebSocket server
* multiplayer state synchronization
* Driver connections
* Booster connections
* QR join flow
* team assignment
* boost events
* Monad Testnet integration
* smart contract
* transaction/event handling
* activity metrics
* relaying/sponsorship/session mechanism if supported
* blockchain fallback
* reconnection
* deployment
* production configuration
* monitoring/debug information

### Main directories

```text
/server
/contracts
/shared
```

and, if needed:

```text
/booster
```

for the Booster interface.

### Member B should NOT need to touch

the internal rendering implementation of the racing game.

---

# 5. Interface between the two members

The two systems communicate through a **very small shared protocol**.

The goal is that Member A can build the entire game using fake/local data while Member B builds the entire backend independently.

## Shared game state

```ts
type TeamId = "red" | "blue" | "green" | "yellow";

type TeamState = {
  id: TeamId;
  boostEnergy: number;
  boostRate: number;
  position: number;
  speed: number;
  driverConnected: boolean;
  boosters: number;
};

type RaceState = {
  status:
    | "LOBBY"
    | "COUNTDOWN"
    | "RACING"
    | "FINAL_LAP"
    | "CHAOS"
    | "FINISHED";

  elapsed: number;

  teams: TeamState[];

  activeEvent?: MemeEvent;

  metrics: {
    actionsPerSecond: number;
    boostsPerSecond: number;
    transactionsSent: number;
    transactionsConfirmed: number;
  };
};
```

---

# 6. Event protocol

The backend sends events to the game.

Example:

```ts
type GameEvent =
  | {
      type: "DRIVER_STEER";
      team: TeamId;
      value: number;
    }
  | {
      type: "BOOST";
      team: TeamId;
      amount: number;
    }
  | {
      type: "TEAM_ACTIVITY";
      team: TeamId;
      rate: number;
    }
  | {
      type: "MEME_EVENT";
      event: MemeEvent;
    }
  | {
      type: "RACE_STATE";
      state: RaceState;
    };
```

Member A only needs to consume this protocol.

Member B only needs to produce it.

---

# 7. Development strategy

The project must be playable even if the backend does not exist yet.

## Member A's local mode

Member A creates a:

```text
MOCK_MODE=true
```

mode.

In mock mode:

* fake Drivers can steer;
* fake Boosters generate boost;
* fake Monad activity is generated;
* meme events trigger normally;
* race can be completed locally.

This means Member A can work completely independently.

---

## Member B's local mode

Member B creates a backend that can generate:

```text
DRIVER_STEER
BOOST
TEAM_ACTIVITY
MEME_EVENT
```

without requiring the actual game.

This allows backend testing using:

* browser clients;
* scripts;
* simulated users;
* transaction tests.

---

# 8. Race gameplay

The entire race should last approximately:

**60–120 seconds.**

The experience should be immediately understandable.

## Phase 1 — Lobby

Large screen displays:

```text
MONAD GRAND PRIX

SCAN TO JOIN

🔴 RED
🔵 BLUE
🟢 GREEN
🟡 YELLOW
```

Players scan a QR code.

They select or are assigned to a team.

---

# 9. Drivers

Each team has one Driver.

The Driver opens:

```text
/driver
```

on their phone.

The browser requests gyroscope permission.

The phone becomes a steering wheel.

Conceptually:

```text
PHONE ROTATION
      ↓
GYROSCOPE
      ↓
STEERING VALUE
      ↓
WEBSOCKET
      ↓
SERVER
      ↓
GAME
```

## Steering requirements

Implement:

* calibration;
* dead zone;
* smoothing;
* reconnect;
* neutral steering;
* sensitivity configuration.

Example:

```text
tilt left  → steer left
center     → straight
tilt right → steer right
```

The game must remain playable with imperfect phone sensors.

---

# 10. Boosters

Everyone who is not driving becomes a Booster.

They scan the QR code and get:

```text
YOUR TEAM

🔴 RED

        BOOST

     [ HUGE BUTTON ]

BOOSTS: 1,284
RATE: 42/s
```

The interface must be extremely simple.

No complicated menus.

The audience should understand it immediately.

---

# 11. Boost mechanic

Each Booster interaction creates activity.

Conceptually:

```text
BOOST
  ↓
TEAM ACTIVITY
  ↓
SERVER
  ↓
GAME ENERGY
  ↓
CAR ACCELERATION
```

More people pressing simultaneously means more activity.

The race therefore reacts to the crowd.

---

# 12. Blockchain mechanic

Monad is used as part of the activity pipeline.

The blockchain should **not block the rendering/game loop**.

Bad:

```text
BOOST
 ↓
wait for blockchain confirmation
 ↓
update game
```

Good:

```text
BOOST
 ↓
GAME IMMEDIATELY REACTS
 ↓
ASYNC MONAD ACTIVITY
 ↓
EVENT / CONFIRMATION
 ↓
GAME EFFECT / METRIC
```

The game must remain responsive even if RPC confirmation is delayed.

---

# 13. Monad integration

Member B must use the **official Monad documentation and Blitz resources** before implementing network-specific configuration.

Create:

```text
MONAD_RESOURCES.md
```

containing the verified:

* network;
* chain ID;
* RPC;
* explorer;
* faucet;
* contract address;
* deployment information;
* transaction mechanism;
* event mechanism;
* sponsorship/relayer/session mechanism if used;
* official documentation consulted.

Never invent configuration values.

---

# 14. Transaction UX

A Booster should NOT have to approve a wallet transaction for every button press.

That would destroy the gameplay.

The implementation should investigate the official Blitz resources for an appropriate mechanism such as:

* sponsored transactions;
* relayers;
* session authorization;
* batching;
* another appropriate architecture.

If the final architecture cannot make every button press directly on-chain, that is acceptable.

The important point is:

> Monad activity must meaningfully influence the game.

The exact mechanism should be selected based on what can be implemented reliably during the hackathon.

---

# 15. Important metric distinction

Do not fake or mislabel metrics.

Do NOT display:

```text
MONAD TPS: 12,000
```

unless that is genuinely measured network TPS.

Instead display metrics such as:

```text
BOOSTS / SEC
42

ACTIONS / SEC
127

TX SENT
384

TX CONFIRMED
361

EVENTS
92
```

These are metrics generated by our application.

---

# 16. Meme engine

Meme events are a core part of the fun.

They must be configurable rather than hardcoded into the game logic.

```ts
type MemeEvent = {
  id: string;
  name: string;
  threshold: number;
  duration: number;
  visual: string;
  sound?: string;
  effect: string;
};
```

Possible events:

```text
CHIKI_BRR
GIGA_BOOST
NPC_MODE
SKIBIDI_MODE
EMOTIONAL_DAMAGE
BRO_WHAT
CHAOS_MODE
```

---

# 17. Example thresholds

```text
100 boosts
    ↓
MEME DROP

500 boosts
    ↓
MEME ATTACK

1,000 boosts
    ↓
CHIKI BRR

5,000 boosts
    ↓
MEGA CHIKI

10,000 boosts
    ↓
CHAOS MODE
```

The exact thresholds should be configurable so they can be tuned during the demo.

---

# 18. Race progression

Recommended race structure:

```text
LOBBY
  ↓
COUNTDOWN
  ↓
RACE
  ↓
BOOST
  ↓
MEME EVENT
  ↓
CHAOS
  ↓
FINAL LAP
  ↓
EVERYONE BOOST
  ↓
FINAL MEME
  ↓
WINNER
```

---

# 19. Final Lap

Near the end:

# FINAL LAP

Then:

# EVERYONE. BOOST.

The entire screen shows:

```text
🔴 🔵 🟢 🟡

BOOST BOOST BOOST BOOST
```

Activity spikes.

A final meme event triggers.

Example:

# CHIKI B████

followed by:

# CHAOS MODE

The purpose is to create a memorable final 20–30 seconds.

---

# 20. Racing engine

The game does not need to be a complete realistic racing simulator.

It should be an arcade pseudo-3D racer.

Required elements:

* road;
* perspective;
* curves;
* hills if feasible;
* car sprite;
* steering;
* acceleration;
* speed;
* track position;
* simple obstacles/boundaries;
* camera movement;
* particles;
* boost effects.

The visual target is:

> convincing enough to look like a racing game from a distance.

Not:

> build a complete Mario Kart engine.

---

# 21. Pseudo-3D

The road can use a lightweight pseudo-3D projection.

Conceptually:

```text
       horizon
  ----------------
       \      /
        \    /
         \  /
          \/
          ||
          ||
          ||
```

Track segments can define:

```ts
{
  curve: number;
  hill: number;
  length: number;
}
```

The game should prioritize:

1. speed;
2. readability;
3. spectacle;
4. reliability.

---

# 22. Multiplayer model

The server is authoritative for shared state.

Clients send inputs.

The server broadcasts state.

Conceptually:

```text
DRIVER A ─┐
DRIVER B ─┤
DRIVER C ─┼──> SERVER ───> GAME SCREEN
DRIVER D ─┤
BOOSTERS ─┘
              │
              ↓
            MONAD
```

The browser game should not trust clients for final race state.

---

# 23. Connection handling

The system must survive:

* phone refresh;
* temporary disconnect;
* reconnect;
* duplicate connection;
* Booster leaving;
* Driver leaving;
* RPC delay;
* RPC failure.

If a Driver disconnects:

```text
CAR
 ↓
SLOW / SAFE MODE
```

rather than crashing the race.

---

# 24. Fallback mode

A live demo must not depend on one fragile external component.

Create a fallback:

```text
DEMO_MODE=true
```

If Monad/RPC is temporarily unavailable:

* game continues;
* fake activity can be generated;
* UI clearly remains in demo mode internally;
* no fake claim should be presented as real blockchain data.

The final presentation should still demonstrate real Monad Testnet integration.

---

# 25. Directory structure

```text
monad-grand-prix/

├── README.md
├── SPEC.md
├── AGENTS.md
├── ARCHITECTURE.md
├── TODO.md
├── MONAD_RESOURCES.md
├── DEMO_SCRIPT.md
├── KILL_SWITCH.md
│
├── game/
│   ├── racer/
│   ├── memes/
│   ├── rendering/
│   ├── ui/
│   └── mock/
│
├── driver/
│   ├── gyro/
│   └── network/
│
├── server/
│   ├── game/
│   ├── websocket/
│   ├── players/
│   ├── metrics/
│   └── blockchain/
│
├── booster/
│   └── ui/
│
├── contracts/
│
└── shared/
    ├── types/
    └── protocol/
```

---

# 26. Ownership map

## MEMBER A

```text
/game/*
/driver/*
```

Primary objectives:

```text
RACING
VISUALS
GAMEPLAY
GYRO INPUT
MEMES
HUD
DEMO EXPERIENCE
```

---

## MEMBER B

```text
/server/*
/contracts/*
/booster/*
/shared/*
```

Primary objectives:

```text
MULTIPLAYER
WEBSOCKETS
BOOSTERS
QR JOIN
MONAD
TRANSACTIONS
EVENTS
DEPLOYMENT
```

---

# 27. Shared files

Only a very small number of files should be shared.

```text
/shared/types/*
/shared/protocol/*
```

If possible, Member A and Member B should not edit the same files.

Changes to shared interfaces should be communicated explicitly.

---

# 28. Git workflow

The repository should remain simple.

Each member works on their own branch:

```text
member-a-game
member-b-monad
```

Merge only when a feature works.

Avoid large refactors during integration.

The goal is:

```text
A works independently
        +
B works independently
        ↓
small integration
        ↓
working demo
```

---

# 29. AI / vibe coding strategy

AI agents are used aggressively.

Humans are primarily:

* architects;
* directors;
* testers;
* integrators;
* demo operators.

Each member should give their coding agent:

1. the relevant specification;
2. ownership boundaries;
3. explicit constraints;
4. acceptance criteria.

Agents should not randomly modify the whole repository.

---

# 30. Agent rules

Create `AGENTS.md`:

```text
# AGENTS

1. Reuse standard libraries and permitted boilerplates where appropriate.
2. Do not reuse substantial existing codebases unless explicitly permitted.
3. Do not rewrite working systems unnecessarily.
4. Do not refactor for aesthetics.
5. Do not add dependencies without justification.
6. Do not block gameplay on blockchain confirmation.
7. Do not modify another member's area unnecessarily.
8. Keep shared interfaces inside /shared.
9. Test before declaring success.
10. Prefer the smallest working solution.
11. Verify Monad-specific information against official documentation.
12. Never invent RPCs, chain IDs or contract configuration.
13. If uncertain, state the assumption.
14. Prioritize demo reliability over architectural perfection.
15. Do not add features that are not required for the 3-minute demo.
```

---

# 31. Member A — AI prompt

The Game member should give their coding agent the following mission:

```text
You are the GAME ENGINE agent for MONAD GRAND PRIX.

Your job is to build the racing experience.

You own:
/game
/driver

You do NOT own:
/server
/contracts

Build a lightweight pseudo-3D arcade racer.

Requirements:
- 4 teams: red, blue, green, yellow
- one Driver per team
- phone gyro provides steering input
- game can run completely in MOCK_MODE
- external steering values can be injected through a clean interface
- external BOOST events can be injected through a clean interface
- boost affects acceleration/speed
- team activity is visible
- meme events are configurable
- race lasts approximately 60–120 seconds
- final lap creates a dramatic activity spike
- huge readable HUD
- spectator-friendly visuals
- responsive design

Do not build a realistic racing simulator.

Do not rewrite the entire application.

Do not depend on the blockchain to render the game.

Create clean interfaces so the backend can later inject:
- steering
- boosts
- team state
- meme events
- metrics

Implement MOCK_MODE first.

The game must be playable without the server.
```

---

# 32. Member B — AI prompt

The Monad member should give their coding agent:

```text
You are the MULTIPLAYER + MONAD agent for MONAD GRAND PRIX.

You own:
/server
/contracts
/booster
/shared

You do NOT own:
/game/rendering

Build the backend and blockchain infrastructure.

Requirements:
- 4 teams
- Driver connections
- Booster connections
- QR-based join flow
- WebSocket communication
- authoritative shared game state
- BOOST events
- steering events
- team activity metrics
- Monad Testnet integration
- blockchain events
- transaction tracking
- reconnect handling
- RPC failure handling
- DEMO_MODE fallback

Use official Monad documentation and Blitz resources.

Never invent:
- RPC URLs
- chain IDs
- contract addresses
- transaction mechanisms

Do not make every BOOST require a manual wallet confirmation.

Investigate the appropriate sponsored/relayed/session/batched architecture from official resources.

The game must never wait synchronously for blockchain confirmation.

Expose a clean event protocol to the game:
- DRIVER_STEER
- BOOST
- TEAM_ACTIVITY
- MEME_EVENT
- RACE_STATE

Build and test the backend independently using simulated clients before integration.
```

---

# 33. Integration checkpoint

The first real integration should happen only after both sides have local functionality.

## Member A can demonstrate:

```text
phone/mock steering
        ↓
car moves

fake BOOST
        ↓
car accelerates

fake activity
        ↓
meme event

race
        ↓
winner
```

## Member B can demonstrate:

```text
Driver connects
Booster connects
        ↓
team assignment
        ↓
BOOST
        ↓
server state
        ↓
Monad activity
        ↓
event broadcast
```

Then connect:

```text
Member A game
      ↕
shared protocol
      ↕
Member B server
```

---

# 34. Timeline — 7 hours

## H+0 → H+1

### Both

* repository setup;
* verify official Monad resources;
* establish branches;
* define shared protocol;
* confirm responsibilities.

### Member A

Build basic road + car + movement.

### Member B

Build WebSocket server + player model.

---

# 35. H+1 → H+2

### Member A

* pseudo-3D;
* 4 cars;
* steering;
* HUD;
* race loop.

### Member B

* Driver connection;
* Booster connection;
* team assignment;
* BOOST event.

---

# 36. H+2 → H+3

### Member A

* gyro interface;
* mock mode;
* boost effects;
* meme engine.

### Member B

* Monad contract;
* Testnet transaction/event flow;
* metrics;
* QR join.

---

# 37. H+3 milestone

**Hard checkpoint.**

There must be a playable race.

At minimum:

```text
2–4 phones
       ↓
drivers/boosters
       ↓
server
       ↓
cars move
       ↓
winner
```

If this does not work:

**STOP ADDING FEATURES.**

Fix the core loop.

---

# 38. H+3 → H+4

Integrate:

```text
GAME
 +
WEBSOCKET
 +
MONAD
```

Verify:

* steering;
* boost;
* team state;
* metrics;
* events.

---

# 39. H+4 → H+5

Polish only the things visible in the demo:

* big typography;
* animations;
* particles;
* meme effects;
* sound;
* QR screen;
* final lap;
* chaos mode.

No major architecture changes.

---

# 40. H+5 → H+6

QA.

Test:

* 4 Drivers;
* many Boosters;
* simultaneous BOOST;
* disconnect;
* reconnect;
* phone refresh;
* RPC delay;
* RPC failure;
* game reset;
* race restart;
* mobile browser permissions.

Prepare fallback mode.

---

# 41. H+6 → H+7

STOP BUILDING.

Do:

* deployment;
* Testnet verification;
* public URL;
* README;
* submission repository;
* demo rehearsal;
* backup demo/video;
* final bug fixes only.

---

# 42. Demo requirements

The entire concept must be understandable within 10 seconds.

The audience sees:

```text
MONAD GRAND PRIX

THE DRIVER DRIVES.

THE CROWD IS THE ENGINE.
```

Then immediately:

```text
SCAN TO JOIN
```

---

# 43. Three-minute demo

## 0:00–0:15

Show the race.

Say:

> "This is Monad Grand Prix. One person drives each car, but the crowd controls the engine."

---

## 0:15–0:45

Show phones.

Drivers tilt phones.

Boosters scan QR codes.

Say:

> "Drivers use their phones as steering wheels. Everyone else joins as Boosters."

---

## 0:45–1:30

Everyone presses BOOST.

Cars visibly accelerate.

Show:

```text
BOOSTS/SEC
ACTIONS/SEC
```

Say:

> "The more people interact simultaneously, the more powerful the team becomes."

---

## 1:30–2:00

Show Monad activity.

Trigger a meme.

Example:

# CHIKI BRR

Say:

> "Those interactions are connected to Monad, and blockchain activity becomes part of the game state."

---

## 2:00–2:40

Trigger:

# FINAL LAP

Then:

# EVERYONE BOOST

Activity explodes.

Trigger:

# CHAOS MODE

Cars accelerate.

Crowd reacts.

---

## 2:40–3:00

End with:

```text
THE DRIVER DRIVES.

THE CROWD IS THE ENGINE.

MONAD IS THE TURBO.
```

Then briefly explain:

* multiplayer WebSockets;
* mobile gyro;
* concurrent activity;
* Monad Testnet;
* event-driven gameplay.

---

# 44. What makes the project interesting

The project is not primarily about making a racing game.

The racing game is the visualization layer.

The actual experiment is:

> **What happens when blockchain-scale concurrent activity becomes a real-time multiplayer game mechanic?**

The audience should be able to see the relationship:

```text
MORE PEOPLE
     ↓
MORE ACTIVITY
     ↓
MORE BOOST
     ↓
FASTER CAR
     ↓
MORE CHAOS
```

This creates a direct connection between:

**people → transactions/events → gameplay.**

---

# 45. Success criteria

The project is successful if:

### Gameplay

* 4 cars can race;
* Drivers can steer;
* Boosters can boost;
* race can finish;
* winner is visible.

### Multiplayer

* multiple phones can connect;
* state is synchronized;
* reconnect works.

### Monad

* real Monad Testnet integration exists;
* transactions/events can be demonstrated;
* blockchain does not block gameplay.

### Spectacle

* audience understands the mechanic immediately;
* BOOST creates visible effects;
* meme events create crowd reactions;
* final lap is memorable.

### Hackathon

* project is new;
* submission repository is public;
* project runs on Monad Testnet;
* demo works live;
* technical architecture can be explained in under 30 seconds.

---

# 46. Kill list

If time is running out, remove:

* realistic physics;
* complex collision;
* sophisticated matchmaking;
* accounts;
* profiles;
* leaderboards;
* cosmetics;
* NFT mechanics;
* complicated smart contracts;
* elaborate 3D;
* unnecessary backend abstractions.

Never sacrifice:

```text
DRIVE
+
BOOST
+
MULTIPLAYER
+
MONAD
+
MEME
```

---

# 47. Final product definition

At the end of the hackathon, MONAD GRAND PRIX should feel like:

> **Mario Kart meets a crypto rave, where the audience itself is the engine.**

But technically, it should demonstrate a serious experiment:

> **Using Monad's high-throughput, low-latency environment to turn large amounts of concurrent blockchain activity into a real-time gameplay mechanic.**

The project succeeds through the combination of:

```text
PHONE GYROSCOPE
       +
REAL-TIME MULTIPLAYER
       +
CROWD INTERACTION
       +
MONAD
       +
MEME CHAOS
       =
MONAD GRAND PRIX
```

# END OF SPEC
