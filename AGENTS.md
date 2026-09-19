# AGENTS.md

## Project

This repository contains MONAD GRAND PRIX, a multiplayer arcade racing game built specifically for Monad Blitz Paris.

The core idea:

> The driver drives. The crowd is the engine.

---

## General rules

1. Keep the project small and demo-focused.
2. Prefer the simplest working solution.
3. Do not over-engineer.
4. Do not refactor working code without a concrete reason.
5. Do not add dependencies unless necessary.
6. Do not invent Monad configuration.
7. Verify Monad-specific information using official Monad documentation.
8. Never block the game loop waiting for blockchain confirmation.
9. The game must remain playable if blockchain confirmation is delayed.
10. Always support a local/mock mode for development.
11. Test before declaring a feature complete.
12. Do not modify another team member's area unnecessarily.
13. Respect the ownership boundaries defined in ARCHITECTURE.md.
14. Keep shared interfaces small and stable.
15. Prioritize the live 3-minute demo over secondary features.

---

## Existing code

The project must comply with the Monad Blitz rules.

Do not reuse substantial existing codebases as the foundation of the project.

Standard libraries, frameworks and permitted boilerplates are allowed.

Existing racing projects may be studied for ideas and techniques, but do not copy a substantial racing engine into this repository.

Use original project code for the core gameplay, multiplayer mechanics and Monad integration.

---

## Ownership

### Member A — GAME

Owns:

- /game
- /driver

Responsible for:

- racing
- rendering
- cars
- physics
- steering
- gyro input
- HUD
- memes
- game effects
- race progression

### Member B — MONAD / BACKEND

Owns:

- /server
- /contracts
- /booster
- /shared

Responsible for:

- WebSockets
- multiplayer
- QR joining
- boosters
- Monad
- transactions
- events
- metrics
- deployment

---

## Shared interface

The main interface between the two systems is:

- DRIVER_STEER
- BOOST
- TEAM_ACTIVITY
- MEME_EVENT
- RACE_STATE

Keep this interface simple.

Do not couple the game directly to blockchain implementation details.

---

## Blockchain

Blockchain operations must be asynchronous.

Bad:

BOOST → wait for blockchain → update game

Good:

BOOST → update game immediately → blockchain operation asynchronously

Never invent:

- RPC URLs
- chain IDs
- contract addresses
- network configuration
- transaction mechanisms

---

## Demo priority

The minimum successful demo is:

1. Drivers control cars.
2. Boosters join teams.
3. Boosters affect car performance.
4. Multiple players interact simultaneously.
5. Monad Testnet is involved.
6. Meme/chaos events happen.
7. A race has a winner.

Anything outside this list is secondary.