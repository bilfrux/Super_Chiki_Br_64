import { loadConfig } from "./config.js";
import { BOOSTER_PATH, LOBBY_PATH } from "./http.js";
import { joinInfo } from "./network.js";
import { startServer } from "./server.js";

const config = loadConfig();
const server = await startServer(config);
const join = joinInfo({ publicUrl: config.publicUrl, port: server.port, boosterPath: BOOSTER_PATH });

console.log(`MONAD GRAND PRIX server (protocol v1)`);
console.log(`  Lobby + QR (open this on the big screen): http://localhost:${server.port}${LOBBY_PATH}`);
console.log(`  Phones join at (encoded in the QR):       ${join.joinUrl}`);
if (join.source === "LOCALHOST") {
  console.log(`  ! No network address found. Phones cannot reach localhost: join Wi-Fi or set PUBLIC_URL.`);
} else if (join.candidates.length > 1) {
  console.log(`  Other addresses: ${join.candidates.slice(1).map((c) => `${c.address} (${c.name})`).join(", ")}`);
}
console.log(`  WebSocket:                                ws://localhost:${server.port}/ws`);
console.log(`  Health:                                   http://localhost:${server.port}/health`);
console.log(
  config.chain.demo
    ? `  Chain: DEMO_MODE (simulated transactions, labelled chainMode "DEMO"; not real Monad data)`
    : config.chain.privateKey && config.chain.contractAddress
      ? `  Chain: LIVE Monad Testnet (chain id ${config.chain.chainId}); the race never waits for it`
      : `  Chain: OFF (set DEMO_MODE=true, or RELAYER_PRIVATE_KEY + BOOST_LEDGER_ADDRESS)`,
);
console.log(
  config.adminKey
    ? `  Admin role: enabled (ADMIN_KEY set)`
    : `  Admin role: DISABLED. Set ADMIN_KEY to be able to START / RESET a race.`,
);

// Last line of defence for the live demo: a stray error is logged, the race keeps running.
process.on("uncaughtException", (err) => console.error("! uncaught exception (continuing):", err));
process.on("unhandledRejection", (err) => console.error("! unhandled rejection (continuing):", err));

const shutdown = async () => {
  console.log("Shutting down...");
  await server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
