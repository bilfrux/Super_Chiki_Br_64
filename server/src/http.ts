// HTTP side of the server (same port as the WebSocket):
//
//   /booster/    the Booster phone UI                  (static: /booster)
//   /lobby/      lobby + QR + operator controls        (static: server/public/lobby)
//   /api/join    JSON: the URL(s) phones should open   (drives the QR code)
//   /qr.svg      the QR code for that URL, as SVG
//   /health      JSON status
//   /api/metrics JSON: application vs blockchain metrics for the lobby
//   /            the big-screen lobby (game/lobby); it leads to the race screen (/test/v5.teams.html?live=1)
//   /join        team picker for phones; leads to /booster/?team=<id>
//   /game/ /driver/ /test/ /shared/   Member A's pages (served from the same origin as /ws)
//   /ws          WebSocket upgrade (handled by the ws library, not here)

import type { IncomingMessage, RequestListener, ServerResponse } from "node:http";
import type { ServerConfig } from "./config.js";
import { joinInfo } from "./network.js";
import { qrSvg } from "./qr.js";
import { serveFile, serveMount, type Mount } from "./staticFiles.js";

export const BOOSTER_PATH = "/booster/";
export const LOBBY_PATH = "/lobby/";

export type HttpDeps = {
  config: ServerConfig;
  /** The actual listening port (known only after listen(); matters when PORT=0). */
  getPort(): number;
  health(): unknown;
  metrics(): unknown;
};

const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

export function createRequestHandler(deps: HttpDeps): RequestListener {
  const { config } = deps;
  const mounts: Mount[] = [
    { prefix: BOOSTER_PATH, dir: config.boosterDir },
    { prefix: LOBBY_PATH, dir: config.lobbyDir },
    { prefix: "/game/", dir: config.gameDir },
    { prefix: "/driver/", dir: config.driverDir },
    { prefix: "/test/", dir: config.racerDir },
    { prefix: "/shared/", dir: config.sharedDir, allow: /^(protocol|types)\/[\w.-]+\.js$/ },
  ];

  const currentJoin = () =>
    joinInfo({ publicUrl: config.publicUrl, port: deps.getPort(), boosterPath: BOOSTER_PATH });

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;

    try {
      if (req.method === "GET" && path === "/health") return json(res, 200, deps.health());
      if (req.method === "GET" && path === "/api/metrics") return json(res, 200, deps.metrics());

      if (req.method === "GET" && path === "/api/join") {
        return json(res, 200, { ...currentJoin(), port: deps.getPort(), lobbyPath: LOBBY_PATH, boosterPath: BOOSTER_PATH });
      }

      if (req.method === "GET" && path === "/qr.svg") {
        // ?host=<address> selects one of the detected addresses. Anything else is refused,
        // so this endpoint cannot be used to mint QR codes for arbitrary URLs.
        const info = currentJoin();
        const host = url.searchParams.get("host");
        const chosen = host ? info.candidates.find((c) => c.address === host) : info.candidates[0];
        if (!chosen) return json(res, 400, { error: "Unknown host. See /api/join for the valid addresses." });
        res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
        return void res.end(qrSvg(chosen.url));
      }

      // The big screen opens the bare address; phones scan the QR (which points at /join).
      if (path === "/") return void (await serveMount(req, res, "/game/lobby/", { prefix: "/game/", dir: config.gameDir }));
      if (path === "/join") return void (await serveFile(req, res, config.joinPage));

      for (const m of mounts) if (await serveMount(req, res, path, m)) return;

      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found. Try /booster/, /lobby/ or the WebSocket endpoint /ws");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("Internal error");
      console.error("HTTP handler error:", err);
    }
  };
}
