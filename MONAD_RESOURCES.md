# MONAD RESOURCES

This file contains the verified Monad resources and configuration used by MONAD GRAND PRIX.

All network-specific information must be verified against official Monad documentation.

**Research date:** 2026-09-19. Values below were read from the official pages listed under each heading. Nothing here is from memory. Pages were fetched through a summarising tool, so **re-open each linked page and confirm before the final demo** (see the checklist at the bottom).

---

## Official Resources

- Monad Documentation: https://docs.monad.xyz/
- Monad Guides: https://docs.monad.xyz/guides
- Monad docs index (machine-readable): https://docs.monad.xyz/llms.txt
- Monad Blitz Resources: https://blitz.devnads.com/resources
- Monad Blitz Portal: https://blitz.devnads.com
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

- Foundry (docs require `forge` ≥ 1.8.0). Template: `forge init --template monad-developers/foundry-monad <name>`
- Documented `foundry.toml` keys: `network = "monad"`, `eth-rpc-url = "https://testnet-rpc.monad.xyz"`, `chain_id = 10143`
- Documented deploy: `forge create src/<File>.sol:<Contract> --account <keystore> --broadcast`, with the keystore made by `cast wallet import`. The docs recommend a keystore over a raw private key.
- Verification guides exist for Foundry and Hardhat.

Contract state — **TODO, after design and deployment:**

- Contract name:
- Contract address:
- Deployment transaction:
- ABI:
- Explorer link:

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

### Decision status: **NOT DECIDED**

No mechanism is chosen: not a relayer, sponsorship, EIP-7702, ERC-4337, session keys, or anything else. The decision waits until the hackathon-specific resources (Blitz portal / Notion page, organiser guidance) have been verified. Until then all chain code stays behind the `ChainAdapter` interface, with a `DEMO_MODE` implementation, so the game and protocol do not depend on the choice.

The only thing the verified limits already force: with roughly 20–50 public RPC requests per second, boosts cannot be one transaction each, so whatever mechanism is chosen must aggregate.

---

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

- [ ] Read the Blitz Paris Notion page and Blitz portal (not fetchable by tooling)
- [ ] Confirm the faucet URL (two different ones in official docs) and get funds
- [ ] Confirm block time (300 ms per JSON-RPC page)
- [ ] Test `eth_subscribe` `logs` / `monadLogs` on the public testnet WebSocket
- [ ] Decide the transaction mechanism after a real test transaction
- [ ] Ask Blitz organisers whether sponsorship / API keys are provided

## Final Verified Configuration

This section must be completed before the final demo.

- [x] Network documented (Monad Testnet) — re-verify
- [x] Chain ID documented (10143) — re-verify
- [x] RPC documented — re-verify with a live `eth_chainId` call
- [x] Explorer documented — re-verify
- [ ] Faucet verified (conflicting URLs)
- [ ] Contract deployed
- [ ] Contract address recorded
- [ ] Transaction tested
- [ ] Event tested
- [ ] Booster flow tested
- [ ] Failure/fallback tested
