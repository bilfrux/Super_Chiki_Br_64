# @mgp/shared — protocol v1 (types, constants, validation)

Contract: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md). This code implements it and must not diverge from it; `npm test` checks that.
Only Member B edits `/shared`. Changing a field needs agreement between A and B and a protocol version note.

## Use from the Game (Member A)

Everything is exported from one entry point, `shared/index.ts`. It is plain TypeScript with no runtime dependencies and no Node or DOM imports, so it works in a browser bundle. Type-only imports are erased at build time.

```ts
import type { RaceState, TeamState, GameEvent, ServerMessage, ClientBoost } from "../shared";
import { TEAM_IDS, PROTOCOL_VERSION } from "../shared";
```

Adjust the relative path to where your file lives (`../shared` from `/game`, `../../shared` from `/game/rendering`, etc.). If your bundler supports it, add a path alias (e.g. `@shared` → `../shared/index.ts`) in your own config.

Imports inside `/shared` use `.js` extensions (TypeScript ESM style). Vite, esbuild and tsx resolve these to the `.ts` sources.

## Commands (run inside `/shared`)

```sh
npm install        # once
npm run typecheck  # tsc --noEmit
npm test           # tsc build + node --test (36 tests)
```

## Layout

- `types/` — `TeamId`, `TeamState`, `RaceState`, `MemeEvent`, …
- `protocol/messages.ts` — every message type; direction is in the name (`ClientBoost` vs `ServerBoost`, `ClientDriverSteer` vs `ServerDriverSteer`)
- `protocol/constants.ts` — `PROTOCOL_VERSION`, rate-limit defaults, BOOST-accepting statuses
- `protocol/roles.ts` — roles and permission tables (data only, no authorization logic)
- `protocol/validate.ts` — `parseClientMessage(raw)` for incoming client frames (used by the server)
- `test/` — validation tests and contract tests
