// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// MONAD GRAND PRIX: on-chain ledger of the crowd's boosts.
/// The game server (the single `relayer`) submits ONE transaction per batch window
/// with the boosts it already applied to the race, so Boosters never sign anything.
contract BoostLedger {
    address public immutable relayer;

    /// Boosts recorded per team since deployment (0 red, 1 blue, 2 green, 3 yellow).
    uint64[4] public totals;

    /// One event per team with boosts in the batch.
    event BoostsRecorded(uint8 indexed team, uint32 count, uint64 total);

    error NotRelayer();

    constructor(address relayer_) {
        relayer = relayer_;
    }

    /// counts[i] = boosts for team i in this batch.
    function recordBatch(uint32[4] calldata counts) external {
        if (msg.sender != relayer) revert NotRelayer();
        for (uint8 i = 0; i < 4; i++) {
            if (counts[i] == 0) continue;
            totals[i] += counts[i];
            emit BoostsRecorded(i, counts[i], totals[i]);
        }
    }
}
