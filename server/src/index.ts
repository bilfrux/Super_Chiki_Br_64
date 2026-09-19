import { loadConfig } from "./config.js";
import { startServer } from "./server.js";

const config = loadConfig();
const server = await startServer(config);

console.log(`MONAD GRAND PRIX server (protocol v1)`);
console.log(`  WebSocket: ws://localhost:${server.port}/ws`);
console.log(`  Health:    http://localhost:${server.port}/health`);
console.log(
  config.adminKey
    ? `  Admin role: enabled (ADMIN_KEY set)`
    : `  Admin role: DISABLED. Set ADMIN_KEY to be able to START / RESET a race.`,
);

const shutdown = async () => {
  console.log("Shutting down...");
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
