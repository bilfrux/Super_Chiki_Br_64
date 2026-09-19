// `npm run demo`: starts a server IN THIS PROCESS on a random port with a short
// race, then runs the scripted scenario against it. No setup, no env vars.

import { loadConfig } from "../src/config.js";
import { startServer } from "../src/server.js";
import { runScenario } from "./scenario.js";

const adminKey = "demo-key";
const server = await startServer(
  loadConfig({}, { port: 0, host: "127.0.0.1", adminKey, race: { countdownSeconds: 2, secondsAtSpeed1: 12 } }),
  () => {}, // keep the output to the race table
);
console.log(`Demo server on ws://127.0.0.1:${server.port}/ws (short race: ~12-24 s)\n`);

try {
  await runScenario({
    url: `ws://127.0.0.1:${server.port}/ws`,
    adminKey,
    boostersPerTeam: 3,
    boostHz: { red: 8, blue: 4, green: 6, yellow: 2 },
    maxSeconds: 60,
    print: console.log,
  });
} finally {
  await server.close();
}
