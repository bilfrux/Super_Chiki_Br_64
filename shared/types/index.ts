// Shared game-state types. Source of truth: shared/protocol/PROTOCOL.md §4.
// Pure types and const lists: no runtime logic, no imports from Node or the DOM.

export const TEAM_IDS = ["red", "blue", "green", "yellow"] as const;
export type TeamId = (typeof TEAM_IDS)[number];

export const RACE_STATUSES = [
  "LOBBY",
  "COUNTDOWN",
  "RACING",
  "FINAL_LAP",
  "CHAOS",
  "FINISHED",
] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

export const CHAIN_MODES = ["LIVE", "DEMO", "OFF"] as const;
export type ChainMode = (typeof CHAIN_MODES)[number];

export type MemeEvent = {
  id: string; // e.g. "CHIKI_BRR"
  name: string;
  threshold: number; // team boost count that triggers it
  duration: number; // seconds
  visual: string; // id; the game maps it to a visual
  sound?: string; // id; the game maps it to a sound
  effect: string; // id of a SERVER-side gameplay effect
};

export type ActiveMeme = {
  event: MemeEvent;
  remaining: number; // seconds left, > 0
};

export type TeamState = {
  id: TeamId;
  boostEnergy: number; // 0..1
  boostRate: number; // boosts/sec, >= 0
  position: number; // 0..1, 1 = finish line
  speed: number; // 0..1.5
  driverConnected: boolean;
  boosters: number; // integer >= 0
  steer: number; // -1..1
  activeEvent?: ActiveMeme; // meme currently affecting THIS team
};

export type RaceMetrics = {
  actionsPerSecond: number;
  boostsPerSecond: number;
  transactionsSent: number;
  transactionsConfirmed: number;
  eventsReceived: number;
};

export type RaceState = {
  status: RaceStatus;
  elapsed: number; // seconds; negative during COUNTDOWN
  teams: TeamState[]; // always exactly 4, order: red, blue, green, yellow
  winner?: TeamId; // present only when status === "FINISHED"
  metrics: RaceMetrics;
  chainMode: ChainMode;
};
