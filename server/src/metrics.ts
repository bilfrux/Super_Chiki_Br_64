// Lobby metrics, served at GET /api/metrics. Two clearly separated groups:
//
//   application  measured by THIS server (players, boosts). Always real.
//   blockchain   reported by the chain layer only. Zero / "OFF" until one exists;
//                never estimated and never derived from application numbers.
//
// Nothing here is "Monad TPS".

import { TEAM_IDS, type RaceState, type Role, type TeamId } from "../../shared/index.js";

export type LobbyMetrics = {
  application: {
    connectedPlayers: number; // drivers + boosters
    connectedDrivers: number;
    connectedBoosters: number;
    connectedScreens: number; // read-only viewers (lobby, game screen), not players
    boostsPerSecond: number; // 1 s window, all teams
    actionsPerSecond: number; // accepted boosts + steer messages, 1 s window
    teams: Record<TeamId, { boosters: number; driverConnected: boolean; boostsPerSecond: number; boostsTotal: number }>;
    boostsTotal: number; // accepted this race
  };
  blockchain: {
    chainMode: RaceState["chainMode"];
    transactionsSent: number;
    transactionsConfirmed: number;
    eventsReceived: number;
  };
};

export function buildLobbyMetrics(
  state: RaceState,
  roles: readonly Role[],
  boostTotals: Record<TeamId, number>,
): LobbyMetrics {
  const count = (r: Role): number => roles.filter((x) => x === r).length;
  const teams = {} as LobbyMetrics["application"]["teams"];
  for (const id of TEAM_IDS) {
    const t = state.teams.find((x) => x.id === id)!;
    teams[id] = { boosters: t.boosters, driverConnected: t.driverConnected, boostsPerSecond: t.boostRate, boostsTotal: boostTotals[id] };
  }
  const drivers = count("driver");
  const boosters = count("booster");
  return {
    application: {
      connectedPlayers: drivers + boosters,
      connectedDrivers: drivers,
      connectedBoosters: boosters,
      connectedScreens: count("screen"),
      boostsPerSecond: state.metrics.boostsPerSecond,
      actionsPerSecond: state.metrics.actionsPerSecond,
      teams,
      boostsTotal: TEAM_IDS.reduce((n, id) => n + boostTotals[id], 0),
    },
    blockchain: {
      chainMode: state.chainMode,
      transactionsSent: state.metrics.transactionsSent,
      transactionsConfirmed: state.metrics.transactionsConfirmed,
      eventsReceived: state.metrics.eventsReceived,
    },
  };
}
