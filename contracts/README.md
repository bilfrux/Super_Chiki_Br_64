# contracts

`src/BoostLedger.sol` — records the crowd's boosts on Monad Testnet. One `recordBatch(uint32[4])`
transaction per batch window, sent only by the `relayer` (the game server's wallet); emits
`BoostsRecorded(team, count, total)` per team. It has no funds and no game logic: the race never
reads it.

The Solidity was compiled with solc 0.8.37 (no errors). It has not been deployed by the agent:
that needs a funded testnet key.

## Deploy (Foundry, as in the official guide)

1. Get testnet MON from the faucet (https://faucet.monad.xyz; the Foundry guide links https://testnet.monad.xyz — see MONAD_RESOURCES.md).
2. Create the relayer keystore: `cast wallet import monad-deployer --private-key <throwaway testnet key>`
3. From this directory (`network`, RPC and chain id are in `foundry.toml`):

```
forge create src/BoostLedger.sol:BoostLedger --account monad-deployer --broadcast --constructor-args <RELAYER_ADDRESS>
```

`<RELAYER_ADDRESS>` must be the address of the key you will put in the server's `RELAYER_PRIVATE_KEY`
(`--constructor-args` is a standard Foundry flag; the Monad page shows no constructor example).
4. Put the printed address in `server/.env` as `BOOST_LEDGER_ADDRESS`, then run `npm run chain:check` in `/server`.
5. Record the address and deploy tx hash in `MONAD_RESOURCES.md`.
