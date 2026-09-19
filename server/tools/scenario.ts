// A scripted local race: 4 drivers + N boosters per team + an admin connect to a
// server, the admin starts the race, everyone plays, and the state is printed
// until there is a winner. Shared by `npm run demo` and `npm run sim`.

import { TEAM_IDS, type RaceState, type TeamId } from "../../shared/index.js";
import { SimClient, sleep } from "./simclient.js";

export type ScenarioOptions = {
  url: string;
  adminKey: string;
  boostersPerTeam: number;
  /** Boost presses per second per booster, per team (uneven on purpose, so a team can win). */
  boostHz: Record<TeamId, number>;
  maxSeconds: number;
  print: (line: string) => void;
};

const bar = (v: number, width = 20) => "█".repeat(Math.round(Math.max(0, Math.min(1, v)) * width)).padEnd(width, "░");

function render(s: RaceState): string {
  const head = `${s.status.padEnd(9)} t=${s.elapsed.toFixed(1).padStart(5)}s  boosts/s=${s.metrics.boostsPerSecond}  actions/s=${s.metrics.actionsPerSecond}`;
  const rows = s.teams.map((t) =>
    `  ${t.id.padEnd(6)} ${bar(t.position)} pos=${t.position.toFixed(2)} spd=${t.speed.toFixed(2)} en=${t.boostEnergy.toFixed(2)} rate=${String(t.boostRate).padStart(3)} ` +
    `D=${t.driverConnected ? "y" : "n"} B=${t.boosters}${t.activeEvent ? "  ★" + t.activeEvent.event.name : ""}`,
  );
  return [head, ...rows].join("\n");
}

export async function runScenario(o: ScenarioOptions): Promise<RaceState> {
  const clients: SimClient[] = [];
  const boosters: { client: SimClient; team: TeamId }[] = [];
  const drivers: SimClient[] = [];

  const admin = await new SimClient(o.url).join({ role: "admin", adminKey: o.adminKey });
  clients.push(admin);
  if (admin.welcome?.role !== "admin") throw new Error(`Admin join failed: ${JSON.stringify(admin.errors())}`);

  const screen = await new SimClient(o.url).join({ role: "screen" });
  clients.push(screen);

  for (const team of TEAM_IDS) {
    const d = await new SimClient(o.url).join({ role: "driver", team });
    drivers.push(d);
    clients.push(d);
    for (let i = 0; i < o.boostersPerTeam; i++) {
      const b = await new SimClient(o.url).join({ role: "booster", team });
      boosters.push({ client: b, team });
      clients.push(b);
    }
  }
  o.print(`Connected: 1 admin, 1 screen, ${drivers.length} drivers, ${boosters.length} boosters`);

  admin.send({ type: "CONTROL", action: "START" });

  // Drivers wiggle the wheel; boosters press at their team's rate.
  let t = 0;
  const timers: NodeJS.Timeout[] = [];
  timers.push(setInterval(() => {
    t += 0.05;
    drivers.forEach((d, i) => d.send({ type: "DRIVER_STEER", value: Math.sin(t + i) }));
  }, 50));
  for (const { client, team } of boosters) {
    const hz = o.boostHz[team];
    timers.push(setInterval(() => client.send({ type: "BOOST" }), 1000 / hz));
  }

  let last = 0;
  const started = Date.now();
  let final: RaceState | undefined;
  while (Date.now() - started < o.maxSeconds * 1000) {
    await sleep(500);
    const s = screen.latestState();
    if (!s) continue;
    if (Date.now() - last >= 1000) { o.print(render(s)); last = Date.now(); }
    if (s.status === "FINISHED") { final = s; break; }
  }

  timers.forEach(clearInterval);
  const memes = screen.ofType("MEME_EVENT");
  clients.forEach((c) => c.close());
  if (!final) throw new Error(`Race did not finish within ${o.maxSeconds}s.`);
  o.print(`\n🏁 WINNER: ${final.winner?.toUpperCase()}  (race time ${final.elapsed.toFixed(1)}s)`);
  o.print(`Meme events seen by the screen: ${memes.map((m) => `${m.team}:${m.event.id}`).join(", ") || "none"}`);
  return final;
}
