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