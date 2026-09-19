// RaceEngine: the authoritative, deliberately tiny 1-D race model
// (PROTOCOL.md §6). No sockets, no timers, no chain: the caller drives it with
// tick(dt) and reads snapshot(). Pure and deterministic, so it is unit-tested
// without any network.
//
//   accepted BOOST:  boostEnergy += boostGain                     (clamped 0..1)
//   every tick:      boostEnergy -= energyDecayPerSec * dt
//                    speed = (baseSpeed + boostSpeed * boostEnergy) × meme multiplier
//                    no driver → speed capped at safeSpeed
//                    position += speed * dt / secondsAtSpeed1      → 1 = finish

import {
  BOOST_ACCEPTING_STATUSES,
  CHAOS_MEME_ID,
  SPEED_MAX,
  TEAM_IDS,
  memeSpeedMultiplier,
  memeThreshold,
  type ActiveMeme,
  type GameEvent,
  type MemeConfig,
  type ChainMode,
  type MemeEvent,
  type RaceMetrics,
  type RaceState,
  type RaceStatus,
  type TeamId,
  type TeamState,
} from "../../shared/index.js";

export type RaceConfig = {
  countdownSeconds: number;
  /** A car at speed 1 covers the whole race in this many seconds. */
  secondsAtSpeed1: number;
  baseSpeed: number; // speed with zero boost energy
  boostSpeed: number; // extra speed at full boost energy
  boostGain: number; // energy added per accepted boost
  energyDecayPerSec: number;
  safeSpeed: number; // speed cap when the team has no driver
  finalLapPosition: number; // leader position that starts FINAL_LAP
};

export const DEFAULT_RACE_CONFIG: RaceConfig = {
  countdownSeconds: 3,
  secondsAtSpeed1: 60,
  baseSpeed: 0.5,
  boostSpeed: 0.5,
  boostGain: 0.1,
  energyDecayPerSec: 0.25, // break-even = decay / gain = 2.5 boosts/s per team
  safeSpeed: 0.3,
  finalLapPosition: 0.75,
};

/** Read-only view of the chain layer. The engine never calls into the chain, it only reads counters. */
export type ChainSource = () => Pick<RaceMetrics, "transactionsSent" | "transactionsConfirmed" | "eventsReceived"> & { chainMode: ChainMode };

/** Internal race phase. Public `status` adds the CHAOS overlay on top of RACING/FINAL_LAP. */
type Phase = "LOBBY" | "COUNTDOWN" | "RACING" | "FINAL_LAP" | "FINISHED";

type TeamRuntime = {
  id: TeamId;
  boostEnergy: number;
  position: number;
  rawPosition: number; // unclamped, used only to break finish ties
  speed: number;
  driverConnected: boolean;
  boosters: number;
  steer: number;
  activeEvent?: { event: MemeEvent; remaining: number };
  boostTotal: number; // accepted boosts this race (meme thresholds)
  fired: Set<string>; // memes already fired this race
  thresholds: { meme: MemeEvent; threshold: number }[]; // ascending, per team
  boostRing: number[]; // accepted boosts per tick over the last ~1 s
  boostRingSum: number; // running sum of boostRing, so reading the rate is O(1)
  pendingBoosts: number; // accepted since last BOOST event
  steerDirty: boolean;
  lastActivityRate: number;
};

export class RaceEngine {
  private phase: Phase = "LOBBY";
  private elapsed = 0;
  private winner?: TeamId;
  private readonly teams: TeamRuntime[];
  private readonly ringLength: number;
  private ringIndex = 0;
  private actionRing: number[]; // accepted boosts + steer messages per tick
  private actionRingSum = 0; // running sum of actionRing
  private memeEvents: GameEvent[] = [];
  private chainSource: ChainSource = () => ({ chainMode: "OFF", transactionsSent: 0, transactionsConfirmed: 0, eventsReceived: 0 });

  constructor(
    private readonly cfg: RaceConfig,
    private readonly memes: MemeConfig,
    tickHz: number,
  ) {
    // +1: the slot being written this tick is always partial, so keep tickHz full ticks (1 s) behind it.
    this.ringLength = Math.max(1, Math.round(tickHz)) + 1;
    this.actionRing = new Array<number>(this.ringLength).fill(0);
    this.teams = TEAM_IDS.map((id) => this.newTeam(id));
  }

  private newTeam(id: TeamId): TeamRuntime {
    const thresholds = this.memes.memes
      .map((meme) => ({ meme, threshold: memeThreshold(this.memes, id, meme) }))
      .sort((a, b) => a.threshold - b.threshold);
    return {
      id, boostEnergy: 0, position: 0, rawPosition: 0, speed: 0,
      driverConnected: false, boosters: 0, steer: 0,
      boostTotal: 0, fired: new Set(), thresholds,
      boostRing: new Array<number>(this.ringLength).fill(0), boostRingSum: 0,
      pendingBoosts: 0, steerDirty: false, lastActivityRate: 0,
    };
  }

  setChainSource(source: ChainSource): void {
    this.chainSource = source;
  }

  // --- control ------------------------------------------------------------

  /** LOBBY → COUNTDOWN. Returns false (no change) in any other phase. */
  start(): boolean {
    if (this.phase !== "LOBBY") return false;
    this.phase = "COUNTDOWN";
    this.elapsed = -this.cfg.countdownSeconds;
    return true;
  }

  /** Any phase → LOBBY. Zeroes race state; keeps who is connected. */
  reset(): void {
    this.phase = "LOBBY";
    this.elapsed = 0;
    this.winner = undefined;
    this.memeEvents = [];
    this.actionRing.fill(0);
    this.actionRingSum = 0;
    for (const t of this.teams) {
      t.boostEnergy = 0; t.position = 0; t.rawPosition = 0; t.speed = 0; t.steer = 0;
      t.activeEvent = undefined; t.boostTotal = 0; t.fired.clear();
      t.boostRing.fill(0); t.boostRingSum = 0; t.pendingBoosts = 0; t.steerDirty = false; t.lastActivityRate = 0;
    }
  }

  // --- inputs (already validated and authorised by the caller) -------------

  /** One boost action. Returns whether it was accepted (only while racing). */
  applyBoost(team: TeamId): boolean {
    if (!BOOST_ACCEPTING_STATUSES.includes(this.status)) return false;
    const t = this.team(team);
    t.boostEnergy = Math.min(1, t.boostEnergy + this.cfg.boostGain);
    t.boostRing[this.ringIndex]! += 1;
    t.boostRingSum += 1;
    this.actionRing[this.ringIndex]! += 1;
    this.actionRingSum += 1;
    t.pendingBoosts += 1;
    t.boostTotal += 1;
    this.fireMemes(t);
    return true;
  }

  /** Latest driver steering (-1..1, already clamped). Cosmetic: no effect on position/speed. */
  applySteer(team: TeamId, value: number): void {
    const t = this.team(team);
    t.steer = value;
    t.steerDirty = true;
    this.actionRing[this.ringIndex]! += 1;
    this.actionRingSum += 1;
  }

  /** Connection bookkeeping, owned by the session layer. */
  setPresence(team: TeamId, driverConnected: boolean, boosters: number): void {
    const t = this.team(team);
    if (t.driverConnected && !driverConnected) {
      t.steer = 0;
      t.steerDirty = true;
      // Apply the safe-mode cap now, so a snapshot never shows driverConnected=false
      // together with an uncapped speed from the previous tick.
      t.speed = Math.min(t.speed, this.cfg.safeSpeed);
    }
    t.driverConnected = driverConnected;
    t.boosters = boosters;
  }

  // --- simulation ---------------------------------------------------------

  tick(dt: number): void {
    this.ringIndex = (this.ringIndex + 1) % this.ringLength;
    // Slide the window: the slot being reused leaves it.
    this.actionRingSum -= this.actionRing[this.ringIndex]!;
    this.actionRing[this.ringIndex] = 0;
    for (const t of this.teams) {
      t.boostRingSum -= t.boostRing[this.ringIndex]!;
      t.boostRing[this.ringIndex] = 0;
    }

    if (this.phase === "COUNTDOWN") {
      this.elapsed += dt;
      if (this.elapsed >= 0) {
        this.elapsed = 0;
        this.phase = "RACING";
      }
      return;
    }
    if (this.phase !== "RACING" && this.phase !== "FINAL_LAP") return;

    this.elapsed += dt;
    let winner: TeamRuntime | undefined;

    for (const t of this.teams) {
      t.boostEnergy = Math.max(0, t.boostEnergy - this.cfg.energyDecayPerSec * dt);

      let mult = 1;
      if (t.activeEvent) {
        t.activeEvent.remaining -= dt;
        if (t.activeEvent.remaining <= 0) t.activeEvent = undefined;
        else mult = memeSpeedMultiplier(t.activeEvent.event.effect);
      }

      let speed = (this.cfg.baseSpeed + this.cfg.boostSpeed * t.boostEnergy) * mult;
      if (!t.driverConnected) speed = Math.min(speed, this.cfg.safeSpeed);
      t.speed = Math.max(0, Math.min(SPEED_MAX, speed));

      t.rawPosition += (t.speed * dt) / this.cfg.secondsAtSpeed1;
      t.position = Math.min(1, t.rawPosition);
      if (t.rawPosition >= 1 && (!winner || t.rawPosition > winner.rawPosition)) winner = t;
    }

    if (winner) {
      this.finish(winner.id);
      return;
    }
    if (this.phase === "RACING") {
      const lead = Math.max(...this.teams.map((t) => t.position));
      if (lead >= this.cfg.finalLapPosition) this.phase = "FINAL_LAP";
    }
  }

  private finish(winner: TeamId): void {
    this.phase = "FINISHED";
    this.winner = winner;
    for (const t of this.teams) {
      t.speed = 0;
      t.boostEnergy = 0;
      t.activeEvent = undefined;
    }
  }

  private fireMemes(t: TeamRuntime): void {
    // Ascending thresholds: if several are crossed at once the highest ends up active.
    for (const { meme, threshold } of t.thresholds) {
      if (t.fired.has(meme.id) || t.boostTotal < threshold) continue;
      t.fired.add(meme.id);
      const event: MemeEvent = { ...meme, threshold };
      t.activeEvent = { event, remaining: meme.duration };
      this.memeEvents.push({ type: "MEME_EVENT", team: t.id, event });
    }
  }

  // --- outputs ------------------------------------------------------------

  get status(): RaceStatus {
    if (
      (this.phase === "RACING" || this.phase === "FINAL_LAP") &&
      this.teams.some((t) => t.activeEvent?.event.id === CHAOS_MEME_ID)
    ) {
      return "CHAOS";
    }
    return this.phase;
  }

  /** Authoritative state. A fresh object every call. */
  snapshot(): RaceState {
    const teams: TeamState[] = this.teams.map((t) => {
      const state: TeamState = {
        id: t.id,
        boostEnergy: t.boostEnergy,
        boostRate: this.boostRate(t),
        position: t.position,
        speed: t.speed,
        driverConnected: t.driverConnected,
        boosters: t.boosters,
        steer: t.steer,
      };
      if (t.activeEvent) {
        const active: ActiveMeme = { event: { ...t.activeEvent.event }, remaining: t.activeEvent.remaining };
        state.activeEvent = active;
      }
      return state;
    });

    const chain = this.chainSource();
    const boostsPerSecond = teams.reduce((sum, t) => sum + t.boostRate, 0);
    const state: RaceState = {
      status: this.status,
      elapsed: this.elapsed,
      teams,
      metrics: {
        // APPLICATION metrics, measured here over a 1 s window. Not Monad TPS.
        actionsPerSecond: this.actionRingSum,
        boostsPerSecond,
        // BLOCKCHAIN metrics: read from the chain layer (real adapter results only). Zero when chainMode is OFF.
        transactionsSent: chain.transactionsSent,
        transactionsConfirmed: chain.transactionsConfirmed,
        eventsReceived: chain.eventsReceived,
      },
      chainMode: chain.chainMode,
    };
    if (this.winner) state.winner = this.winner;
    return state;
  }

  /**
   * Events accumulated since the last call, in the order the server broadcasts
   * them: BOOST (aggregated per team), MEME_EVENT, DRIVER_STEER, TEAM_ACTIVITY.
   * All of them describe changes that are ALREADY applied to the state.
   */
  flushEvents(includeActivity: boolean): GameEvent[] {
    const out: GameEvent[] = [];
    for (const t of this.teams) {
      if (t.pendingBoosts > 0) {
        out.push({ type: "BOOST", team: t.id, amount: t.pendingBoosts });
        t.pendingBoosts = 0;
      }
    }
    out.push(...this.memeEvents);
    this.memeEvents = [];
    for (const t of this.teams) {
      if (t.steerDirty) {
        out.push({ type: "DRIVER_STEER", team: t.id, value: t.steer });
        t.steerDirty = false;
      }
    }
    if (includeActivity) {
      for (const t of this.teams) {
        const rate = this.boostRate(t);
        if (rate !== t.lastActivityRate) {
          out.push({ type: "TEAM_ACTIVITY", team: t.id, rate });
          t.lastActivityRate = rate;
        }
      }
    }
    return out;
  }

  private boostRate(t: TeamRuntime): number {
    return t.boostRingSum;
  }

  /** Accepted boosts per team this race (application metric; cleared by RESET). */
  boostTotals(): Record<TeamId, number> {
    const out = {} as Record<TeamId, number>;
    for (const t of this.teams) out[t.id] = t.boostTotal;
    return out;
  }

  private team(id: TeamId): TeamRuntime {
    return this.teams[TEAM_IDS.indexOf(id)]!;
  }
}
