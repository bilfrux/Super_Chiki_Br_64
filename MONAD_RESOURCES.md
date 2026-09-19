# MONAD RESOURCES

This file contains the verified Monad resources and configuration used by MONAD GRAND PRIX.

All network-specific information must be verified against official Monad documentation.

**Research date:** 2026-09-19. Values below were read from the official pages listed under each heading. Nothing here is from memory. Pages were fetched through a summarising tool, so **re-open each linked page and confirm before the final demo** (see the checklist at the bottom).

---

## Sources consulted (2026-09-19)

https://docs.monad.xyz/developer-essentials/testnets · /network-information (mainnet only) · /differences · /eip-7702 · /reserve-balance · https://docs.monad.xyz/guides/deploy-smart-contract/foundry · https://docs.monad.xyz/tooling-and-infra/wallet-infra/account-abstraction · https://docs.monad.xyz/templates/next-serwist-privy-smart-wallet · https://blitz.devnads.com and /resources · https://github.com/monad-developers/monad-blitz-paris · live JSON-RPC calls to both public testnet endpoints.

## Official Resources

- Monad Documentation: https://docs.monad.xyz/
- Monad Guides: https://docs.monad.xyz/guides
- Monad docs index (machine-readable): https://docs.monad.xyz/llms.txt
- Monad Blitz Resources: https://blitz.devnads.com/resources
- Monad Blitz Portal: https://blitz.devnads.com
- Monad Blitz Paris repo (submission = fork it): https://github.com/monad-developers/monad-blitz-paris — README only explains the fork steps and points to the portal
- Monad Blitz Paris (Notion): https://monad-foundation.notion.site/Monad-Blitz-Paris-2736367594f2836989b9010568428050
  - **Not read.** The page is JavaScript-rendered and could not be fetched. Someone must open it by hand (rules, funding, any sponsored-transaction offer).

---

## Network Configuration — Monad Testnet

Source: https://docs.monad.xyz/developer-essentials/testnets

> ⚠️ https://docs.monad.xyz/developer-essentials/network-information now documents **Mainnet** (chain ID 143). Do **not** use it. The hackathon requires **Testnet**.

- Network: **Monad Testnet**
- Chain ID: **10143**
- Currency symbol: **MON**
- Block explorers:
  - MonadVision: https://testnet.monadvision.com
  - Monadscan: https://testnet.monadscan.com
- Faucet: https://faucet.monad.xyz
  - ⚠️ The Foundry deploy guide links a *different* faucet URL (https://testnet.monad.xyz). Open both and confirm which works.

### RPC endpoints (from the testnets page)

| URL | Provider | Rate limit (as documented) |
|---|---|---|
| https://testnet-rpc.monad.xyz | QuickNode | 50 rps; 25 rps for `eth_call` / `eth_estimateGas` |
| wss://testnet-rpc.monad.xyz | QuickNode | same |
| https://rpc.ankr.com/monad_testnet | Ankr | 300 reqs / 10 s; 12,000 reqs / 10 min |
| https://rpc-testnet.monadinfra.com | Monad Foundation | 20 rps |
| wss://rpc-testnet.monadinfra.com | Monad Foundation | 20 rps |

Batching: QuickNode up to 100 batched requests; Ankr 100 (no `debug_*`); Monad Foundation endpoint does **not** allow batch requests.

**Consequence for design:** public RPC allows roughly 20–50 requests/second. A crowd pressing BOOST will exceed that by orders of magnitude, so boosts **cannot** be one transaction each. They must be aggregated. This is decided by documented limits, not by preference.

---

## Chain behaviour relevant to the server

Sources: https://docs.monad.xyz/reference/json-rpc/overview.md, https://docs.monad.xyz/monad-arch/consensus/block-states, https://docs.monad.xyz/developer-essentials/differences

- **Block states:** Proposed → Voted → Finalized → Verified. RPC tag mapping: `latest` = Proposed, `safe` = Voted, `finalized` = Finalized. The docs say to **treat Finalized as confirmed**. The docs page on block states does not state a block time.
- **Block frequency:** the JSON-RPC page says blocks are produced every **300 ms**. ⚠️ Verify; other pages may quote a different figure.
- **Pending transactions are not queryable.** `eth_getTransactionByHash` only returns transactions included in blocks. The RPC may accept transactions with a nonce gap or insufficient balance. So "sent" must be tracked by our own server, and "confirmed" by receipt / finalized block.
- **Gas is charged on gas *limit*, not gas used:** `value + gas_bid * gas_limit`. Keep gas limits tight.
- **No global mempool:** transactions are forwarded to the next few leaders.
- **`eth_getLogs` range limit:** 100 blocks on QuickNode and the Monad Foundation endpoint (1,000 on Ankr; Alchemy 1,000 blocks / 10,000 logs). Historical scans must be paged; live listening should use subscriptions.
- **`eth_subscribe`:** supports `newHeads` and `logs`, plus Monad-specific `monadNewHeads` and `monadLogs` (which carry block state). `newPendingTransactions` and `syncing` are **not** supported. ⚠️ Not yet confirmed: whether the *public testnet* WebSocket endpoints support these; test against the real endpoint.
- `eth_maxPriorityFeePerGas` returns a hardcoded 2 gwei suggestion (documented as temporary).
- Blob (type 3) transactions are unsupported.

---

## Smart Contract — deploy tooling

Sources: https://docs.monad.xyz/guides/deploy-smart-contract/foundry, https://docs.monad.xyz/guides/deploy-smart-contract/ (Hardhat and Remix are also documented), https://docs.monad.xyz/guides/verify-smart-contract/

- Foundry (deploy steps in `contracts/README.md`; docs require `forge` ≥ 1.8.0). Template: `forge init --template monad-developers/foundry-monad <name>`
- Documented `foundry.toml` keys: `network = "monad"`, `eth-rpc-url = "https://testnet-rpc.monad.xyz"`, `chain_id = 10143`
- Documented deploy: `forge create src/<File>.sol:<Contract> --account <keystore> --broadcast`, with the keystore made by `cast wallet import`. The docs recommend a keystore over a raw private key.
- Verification guides exist for Foundry and Hardhat.

Contract state — **DEPLOYED on Monad Testnet (chain id 10143)** (source: `contracts/src/BoostLedger.sol`, compiles with solc 0.8.37):

- Contract name: BoostLedger
- **Contract address: `0xC8ff1fe4d81e476Ae682a1898869f34781BD6Ff0`** (deployed manually by the operator; `server/.env` `BOOST_LEDGER_ADDRESS`)
- **Relayer wallet (the only address allowed to call `recordBatch`): `0x53304048455325fBFFecC34a62976CB3f4D7b519`**. Throwaway testnet key, funded with 5 MON, kept only in `server/.env` (git-ignored). Verified on chain: `BoostLedger.relayer()` returns this address.
- Deployment transaction: not recorded here (deployed outside this repo's tooling); find it on the explorer from the contract address.
- ABI: `recordBatch(uint32[4] counts)`, `totals(uint256) view returns (uint64)`, `relayer() view returns (address)`, `event BoostsRecorded(uint8 indexed team, uint32 count, uint64 total)` (team 0 red, 1 blue, 2 green, 3 yellow); see `server/src/chain/monad.ts`.
- Explorer: MonadVision https://testnet.monadvision.com or Monadscan https://testnet.monadscan.com (search the address; the direct `/tx/<hash>` URLs below were not opened by tooling).

### Live rehearsal (real server → real Monad Testnet, 2026-09-19)

One rehearsal race (server started with `server/.env`, `SECONDS_AT_SPEED_1=25`; 1 driver + 3 red boosters + 2 blue boosters at 5-8 clicks/s):

- The server reported `chainMode: LIVE` (`/health` `chain.state: "LIVE"`) before the race and throughout.
- **13 transactions sent, 13 confirmed (finalized), 0 failed, 0 unconfirmed**; RACE_STATE `metrics.transactionsSent = 13`, `transactionsConfirmed = 13`, `eventsReceived = 26`.
- On-chain check by reading the contract and logs directly from the RPC: 13/13 receipts `status: success`, 26 `BoostsRecorded` events, `totals` moved by exactly the boosts the server accepted (**red +454, blue +305**, green 0, yellow 0).
- Each batch carried about 60 boosts (a whole 2 s window) instead of one transaction per click. `gasUsed` was 150,000 = the gas limit on every transaction (Monad charges the limit, as documented); cost ≈ 0.0153 MON per transaction, 0.1989 MON for the whole rehearsal (relayer balance 4.9615 → 4.7626 MON, about 310 more batches).
- Sample transactions (block, boosts recorded):
  - `0xf38534200d34fdb00ad5aaf5ebf7c43606667953441c6e063fc1f7c16c9eb906` (block 63931049, red+12 blue+8)
  - `0x71c7cf5336b8d9e27c89d481fe222c1b8ce6c7d727dfc46cbac7f0e44d06bc72` (block 63931055, red+37 blue+25)
  - `0x7f5ada78e0018a5888099e52e484d9c5a708b0a525ef06d08696e171a1979a0d` (block 63931128, red+34 blue+22)
- The contract totals are cumulative across all races (and the rehearsal started from all zeros); the server's counters reset on each RESET.

---

## Booster Transactions — what the docs offer

A Booster must NOT have to approve a wallet transaction for every BOOST. The official docs describe these options. **None has been tested and no choice has been made.**

| Option | What the docs say | Source |
|---|---|---|
| **EIP-7702** | Supported on Monad (tx type `0x04`); an EOA can sign an authorization that a sponsor submits, so the EOA can act as a smart account without holding gas. Caveats: a delegated account's transactions that would reduce its balance below **10 MON** revert; `CREATE`/`CREATE2` disallowed in delegated context. | https://docs.monad.xyz/developer-essentials/eip-7702 |
| **ERC-4337 bundler + paymaster providers** | Alchemy, Biconomy, Pimlico, Sequence, thirdweb, ZeroDev listed for mainnet and testnet; Gelato and Openfort listed testnet-only. Sequence is described as a relayer for "gasless, batched, parallelized transactions". Usually needs an account and API key from the provider. | https://docs.monad.xyz/tooling-and-infra/wallet-infra/account-abstraction.md |
| **Official sponsored-tx templates** | Next.js PWA (Privy + Pimlico, Kernel smart account, EntryPoint v7, supports batching) and React Native (Privy + Pimlico). Targets Monad Testnet. Needs a Privy app ID and a Pimlico bundler URL. | https://docs.monad.xyz/templates/next-serwist-privy-smart-wallet |
| **Reserve balance rules** | Monad restricts account balance dips at consensus level; relevant to any sponsor or delegated account. | https://docs.monad.xyz/developer-essentials/reserve-balance |

**Not found in any official page read:** a Blitz-specific relayer, sponsor, session-key service, or pre-funded team wallet. Session keys are not documented in the pages read. Absence in these pages does not prove they don't exist. Check the Blitz Notion page and Blitz portal by hand.

### Decision: server-side relayer + batched `BoostLedger` transactions

Chosen 2026-09-19 after reading the official pages above. Reasons, all from documented facts:

- Public RPC limits (20-50 rps) make one transaction per boost impossible → **batching** (SPEC §14 allows this).
- The Blitz resources page lists only *templates* for sponsored transactions (Privy + Pimlico smart wallets); they need a third-party account and API key and target per-user wallets. Boosters here are anonymous phones with no wallet, so that stack adds setup risk with no benefit. No Blitz relayer/sponsor/session-key service exists on any page read.
- One server wallet ("relayer", funded from the faucet) pays for one aggregated transaction per window (default 2 s). Boosters never sign anything. EIP-7702 / ERC-4337 / session keys are **not used**.

Flow: `BOOST → engine applies it immediately → ChainQueue counter += 1 → (every CHAIN_FLUSH_MS) one recordBatch tx → receipt → block Finalized → transactionsConfirmed++ and BoostsRecorded logs → eventsReceived++`.

Not implemented on purpose: `eth_subscribe` (the docs list `logs`/`monadLogs`, but support on the public testnet WebSocket was never tested). Events are read from the receipt of our own transactions instead.

Config (environment only; the key is never logged, never in the repo, never in `/api/*`):

| Variable | Default | Note |
|---|---|---|
| `RELAYER_PRIVATE_KEY` + `BOOST_LEDGER_ADDRESS` | unset | both set → `chainMode: "LIVE"`; otherwise `"OFF"` |
| `DEMO_MODE=true` | false | simulated activity, `chainMode: "DEMO"` |
| `CHAIN_ID` | 10143 | checked against `eth_chainId` at startup; mismatch → chain OFF |
| `MONAD_RPC_URLS` | testnet-rpc.monad.xyz, rpc-testnet.monadinfra.com | tried in order; both from the testnets page; no batching used (the Foundation endpoint disallows it) |
| `CHAIN_GAS_LIMIT` | 150000 | gas is charged on the limit; **not measured on the real chain yet** |

Verified live on 2026-09-19 (read-only, `npm run chain:check`): both public RPCs answer `eth_chainId = 0x279f` (10143); `finalized` block tag works; base fee ≈ 100 gwei.

Confirmed = the receipt's block is at or below the `finalized` block (docs: treat Finalized as confirmed). A tx not confirmed after 60 s is counted as `transactionsUnconfirmed` (lobby only) and no longer tracked.

## Blockchain Mechanism

The blockchain must NOT block gameplay.

BOOST
  ↓
Game reacts immediately
  ↓
Blockchain interaction asynchronously
  ↓
Transaction / event
  ↓
Server
  ↓
Game event

---

## Game Events

Potential blockchain-related events:

- BOOST
- TEAM_ACTIVITY
- MEME_EVENT
- RACE_STATE

The final event architecture will be decided after testing Monad Testnet. See `shared/protocol/PROTOCOL.md`.

---

## Metrics

Do not claim application metrics are Monad network TPS.

We may display:

- BOOSTS / SEC
- ACTIONS / SEC
- TRANSACTIONS SENT
- TRANSACTIONS CONFIRMED
- EVENTS RECEIVED

These are application metrics unless explicitly verified otherwise. In `DEMO_MODE` they must never be shown as blockchain data.

---

## Development Rules

1. Never invent Monad configuration.
2. Verify RPC and chain ID using official documentation.
3. Verify contract addresses before using them.
4. Never put private keys or secrets in this repository.
5. Blockchain operations must be asynchronous.
6. The game must continue if RPC confirmation is delayed.
7. Use Monad Testnet for the hackathon demo.
8. Record the final verified configuration here.

---

## Open items (need a human or a real test)

- [ ] Read the Blitz Paris Notion page by hand (not fetchable); the portal home page and resources page were read and contain no rules, faucet or sponsor offer
- [ ] Confirm the faucet URL (two different ones in official docs) and get funds
- [ ] Confirm block time (300 ms per JSON-RPC page)
- [ ] (optional) test `eth_subscribe` `logs` on the public testnet WebSocket; not used
- [x] Transaction mechanism decided: relayer + batched BoostLedger (see above); needs a real test transaction
- [ ] Ask Blitz organisers whether sponsorship / API keys are provided

## Final Verified Configuration

This section must be completed before the final demo.

- [x] Network documented (Monad Testnet) — re-verify
- [x] Chain ID documented (10143) — re-verify
- [x] RPC documented — re-verify with a live `eth_chainId` call
- [x] Explorer documented — re-verify
- [ ] Faucet verified (testnets page says https://faucet.monad.xyz; Foundry guide says https://testnet.monad.xyz)
- [x] Contract deployed (0xC8ff1fe4d81e476Ae682a1898869f34781BD6Ff0)
- [x] Contract address recorded
- [x] Transaction tested on the real testnet (13/13 batch transactions succeeded, 2026-09-19 rehearsal)
- [x] Event tested on the real testnet (26 BoostsRecorded events; eventsReceived = 26)
- [x] Booster flow tested (simulated boosters over WebSocket against the LIVE chain; not yet with real phones)
- [x] Failure/fallback tested (RPC down, slow RPC, not-yet-finalized, wrong chain id; fake node only, not against the real RPC)
