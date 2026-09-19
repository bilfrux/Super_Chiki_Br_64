# MONAD RESOURCES

This file contains the verified Monad resources and configuration used by MONAD GRAND PRIX.

All network-specific information must be verified against official Monad documentation.

---

## Official Resources

### Monad Documentation
https://docs.monad.xyz/

### Monad Guides
https://docs.monad.xyz/guides

### Monad Blitz Resources
https://blitz.devnads.com/resources

### Monad Blitz Paris
https://monad-foundation.notion.site/Monad-Blitz-Paris-2736367594f2836989b9010568428050

---

## Network Configuration

> TODO: Verify all values from official Monad documentation.

- Network:
- Chain ID:
- RPC URL:
- Explorer:
- Faucet:

---

## Smart Contract

> TODO: Fill after contract design/deployment.

- Contract name:
- Contract address:
- Deployment transaction:
- ABI:
- Explorer link:

---

## Blockchain Mechanism

The blockchain must NOT block gameplay.

Current architecture:

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

## Booster Transactions

> TODO: Determine the best mechanism using official Monad Blitz resources.

Investigate:

- Sponsored transactions
- Relayers
- Session authorization
- Batched transactions
- Other official Monad-supported approaches

Goal:

A Booster must NOT have to manually approve a wallet transaction for every BOOST.

---

## Game Events

Potential blockchain-related events:

- BOOST
- TEAM_ACTIVITY
- MEME_EVENT
- RACE_STATE

The final event architecture will be decided after testing Monad Testnet.

---

## Metrics

Do not claim application metrics are Monad network TPS.

We may display:

- BOOSTS / SEC
- ACTIONS / SEC
- TRANSACTIONS SENT
- TRANSACTIONS CONFIRMED
- EVENTS RECEIVED

These are application metrics unless explicitly verified otherwise.

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

## Final Verified Configuration

This section must be completed before the final demo.

- [ ] Network verified
- [ ] Chain ID verified
- [ ] RPC verified
- [ ] Explorer verified
- [ ] Faucet verified
- [ ] Contract deployed
- [ ] Contract address recorded
- [ ] Transaction tested
- [ ] Event tested
- [ ] Booster flow tested
- [ ] Failure/fallback tested