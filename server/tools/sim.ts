// `npm run sim -- [--url ws://localhost:8080/ws] [--admin-key KEY] [--boosters 3]`
// Runs the scripted scenario against an ALREADY RUNNING server (npm start).
// The server must have been started with the same ADMIN_KEY.

import { runScenario } from "./scenario.js";

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};

if (args.includes("--help")) {
  console.log("Usage: npm run sim -- [--url ws://localhost:8080/ws] [--admin-key KEY] [--boosters N]");
  process.exit(0);
}

const adminKey = opt("admin-key", process.env.ADMIN_KEY ?? "dev-admin-key");

try {
  await runScenario({
    url: opt("url", "ws://localhost:8080/ws"),
    adminKey,
    boostersPerTeam: Number(opt("boosters", "3")),
    boostHz: { red: 8, blue: 4, green: 6, yellow: 2 },
    maxSeconds: 300,
    print: console.log,
  });
} catch (err) {
  console.error(`sim failed: ${(err as Error).message}`);
  process.exitCode = 1;
}
