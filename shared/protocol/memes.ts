// Meme definitions as CONFIG (PROTOCOL.md §7). The server decides WHEN a meme
// fires (per-team boost thresholds) and applies its gameplay `effect`; the game
// only decides how it LOOKS and SOUNDS (`visual`, `sound`).
//
// Default thresholds are demo-friendly starting points, not fixed values:
// SPEC.md §17 says they must be tunable. The server can scale or override them.

import type { MemeEvent, TeamId } from "../types/index.js";
import { SPEED_MAX } from "./constants.js";

/** The meme whose activity puts the whole race into status "CHAOS" (PROTOCOL.md §4.2). */
export const CHAOS_MEME_ID = "CHAOS_MODE";

/** Speed multiplier of the `CHAOS` effect. With a fully boosted car (speed 1) this reaches SPEED_MAX. */
export const CHAOS_SPEED_MULT = SPEED_MAX;

export type MemeConfig = {
  memes: readonly MemeEvent[];
  /** Optional per-team threshold overrides: teamThresholds.red.CHIKI_BRR = 250 */
  teamThresholds?: Partial<Record<TeamId, Record<string, number>>>;
};

/**
 * Closed set of v0 `effect` ids:
 *   "NONE"            no gameplay effect
 *   "SPEED_MULT_<x>"  multiply the team's speed by x, e.g. "SPEED_MULT_1.25"
 *   "CHAOS"           multiply by CHAOS_SPEED_MULT
 */
export const DEFAULT_MEMES: readonly MemeEvent[] = [
  { id: "MEME_DROP", name: "MEME DROP", threshold: 100, duration: 4, visual: "meme_drop", sound: "meme_drop", effect: "NONE" },
  { id: "CHIKI_BRR", name: "CHIKI BRR", threshold: 400, duration: 5, visual: "chiki_brr", sound: "chiki_brr", effect: "SPEED_MULT_1.25" },
  { id: "GIGA_BOOST", name: "GIGA BOOST", threshold: 800, duration: 5, visual: "giga_boost", sound: "giga_boost", effect: "SPEED_MULT_1.4" },
  { id: CHAOS_MEME_ID, name: "CHAOS MODE", threshold: 1500, duration: 8, visual: "chaos_mode", sound: "chaos_mode", effect: "CHAOS" },
];

export const DEFAULT_MEME_CONFIG: MemeConfig = { memes: DEFAULT_MEMES };

/** Speed multiplier for a meme `effect` id. Unknown ids have no effect (1). */
export function memeSpeedMultiplier(effect: string): number {
  if (effect === "CHAOS") return CHAOS_SPEED_MULT;
  const m = /^SPEED_MULT_(\d+(?:\.\d+)?)$/.exec(effect);
  if (m) {
    const x = Number(m[1]);
    if (Number.isFinite(x) && x > 0) return Math.min(x, CHAOS_SPEED_MULT);
  }
  return 1;
}

/** Effective threshold of `meme` for `team`, honouring per-team overrides. */
export function memeThreshold(config: MemeConfig, team: TeamId, meme: MemeEvent): number {
  return config.teamThresholds?.[team]?.[meme.id] ?? meme.threshold;
}
