// HTTP layer: static files, join info, QR code, network address selection.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { NetworkInterfaceInfo } from "node:os";
import { join } from "node:path";
import { PROTOCOL_VERSION } from "../../shared/index.js";
import { loadConfig, type ConfigOverrides } from "../src/config.js";
import { lanAddresses, joinInfo } from "../src/network.js";
import { defaultBoosterDir, defaultLobbyDir, findRepoRoot } from "../src/paths.js";
import { qrMatrix, qrSvg } from "../src/qr.js";
import { startServer, type ServerHandle } from "../src/server.js";

async function withServer(overrides: ConfigOverrides, fn: (base: string, server: ServerHandle) => Promise<void>): Promise<void> {
  const server = await startServer(loadConfig({}, { port: 0, host: "127.0.0.1", ...overrides }), () => {});
  try {
    await fn(`http://127.0.0.1:${server.port}`, server);
  } finally {
    await server.close();
  }
}

/** Raw request, so paths are sent exactly as written (fetch would normalise ".."). */
function rawGet(port: number, path: string, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// --- static files ------------------------------------------------------------------------

test("asset directories are found (booster/ and server/public/lobby)", () => {
  const root = findRepoRoot();
  assert.ok(defaultBoosterDir().startsWith(root));
  assert.match(readFileSync(join(defaultBoosterDir(), "index.html"), "utf8"), /BOOST/);
  assert.match(readFileSync(join(defaultLobbyDir(), "index.html"), "utf8"), /SCAN TO JOIN/);
});

test("serves the Booster UI with correct content types", async () => {
  await withServer({}, async (base) => {
    const html = await fetch(`${base}/booster/`);
    assert.equal(html.status, 200);
    assert.match(html.headers.get("content-type")!, /^text\/html/);
    assert.match(await html.text(), /id="boost"/);
    assert.equal(html.headers.get("x-content-type-options"), "nosniff");

    const js = await fetch(`${base}/booster/app.js`);
    assert.match(js.headers.get("content-type")!, /^text\/javascript/);
    const css = await fetch(`${base}/booster/style.css`);
    assert.match(css.headers.get("content-type")!, /^text\/css/);
    assert.equal(css.headers.get("cache-control"), "no-cache");

    const lobby = await fetch(`${base}/lobby/`);
    assert.equal(lobby.status, 200);
    assert.match(await lobby.text(), /SCAN TO JOIN/);
    assert.equal((await fetch(`${base}/lobby/lobby.js`)).status, 200);
  });
});

test("redirects: /booster → /booster/, /lobby → /lobby/, / → /booster/", async () => {
  await withServer({}, async (_base, server) => {
    for (const [from, to, status] of [["/booster", "/booster/", 301], ["/lobby", "/lobby/", 301], ["/", "/booster/", 302]] as const) {
      const r = await rawGet(server.port, from);
      assert.equal(r.status, status, from);
      assert.equal(r.headers.location, to);
    }
  });
});

test("HEAD returns headers without a body; POST is 405; unknown files are 404", async () => {
  await withServer({}, async (_base, server) => {
    const head = await rawGet(server.port, "/booster/app.js", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.ok(Number(head.headers["content-length"]) > 100);
    assert.equal((await rawGet(server.port, "/booster/app.js", "POST")).status, 405);
    assert.equal((await rawGet(server.port, "/booster/nope.js")).status, 404);
    assert.equal((await rawGet(server.port, "/nowhere")).status, 404);
  });
});

test("path traversal, encoded traversal, dotfiles and NUL bytes are refused", async () => {
  await withServer({}, async (_base, server) => {
    const secret = /PROTOCOL_VERSION|ADMIN_KEY|createRequestHandler|"name"/;
    for (const path of [
      "/booster/../server/src/config.ts",
      "/booster/..%2fserver%2fsrc%2fconfig.ts",
      "/booster/%2e%2e/server/src/config.ts",
      "/booster/%2e%2e%2f%2e%2e%2fserver%2fpackage.json",
      "/booster/..%5cserver%5cpackage.json",
      "/lobby/../../package.json",
      "/booster/.env",
      "/booster/.git/config",
      "/booster/%00.html",
      "/booster/%ZZ",
    ]) {
      const r = await rawGet(server.port, path);
      assert.ok([400, 404].includes(r.status), `${path} → ${r.status}`);
      assert.doesNotMatch(r.body, secret, path);
    }
  });
});

test("WebSocket path /ws still works alongside HTTP", async () => {
  await withServer({}, async (base) => {
    const health = await (await fetch(`${base}/health`)).json() as { ok: boolean };
    assert.equal(health.ok, true);
    const { SimClient } = await import("../tools/simclient.js");
    const c = await new SimClient(base.replace("http", "ws") + "/ws").join({ role: "booster" });
    assert.ok(c.welcome?.team);
    c.close();
  });
});

// --- join info and QR ----------------------------------------------------------------------

test("/api/join returns the booster URL; PUBLIC_URL overrides the LAN address", async () => {
  await withServer({}, async (base, server) => {
    const info = await (await fetch(`${base}/api/join`)).json() as { joinUrl: string; source: string; candidates: { address: string; url: string }[]; port: number };
    assert.equal(info.port, server.port);
    assert.ok(info.joinUrl.endsWith(`:${server.port}/booster/`), info.joinUrl);
    assert.ok(info.candidates.length >= 1);
    assert.equal(info.candidates[0]!.url, info.joinUrl);
    if (info.source === "LAN") assert.doesNotMatch(info.joinUrl, /localhost|127\.0\.0\.1/, "the QR must not point at loopback");
  });
  await withServer({ publicUrl: "https://mgp.example.com/" }, async (base) => {
    const info = await (await fetch(`${base}/api/join`)).json() as { joinUrl: string; source: string };
    assert.equal(info.joinUrl, "https://mgp.example.com/booster/");
    assert.equal(info.source, "PUBLIC_URL");
  });
});

test("/qr.svg returns an SVG; ?host only accepts detected addresses", async () => {
  await withServer({}, async (base) => {
    const info = await (await fetch(`${base}/api/join`)).json() as { candidates: { address: string }[] };
    const res = await fetch(`${base}/qr.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/svg+xml");
    const svg = await res.text();
    assert.match(svg, /^<svg /);
    assert.match(svg, /<path d="M/);

    const chosen = await fetch(`${base}/qr.svg?host=${encodeURIComponent(info.candidates[0]!.address)}`);
    assert.equal(chosen.status, 200);
    assert.equal(await chosen.text(), svg);

    for (const evil of ["evil.example.com", "http://evil.example.com", "127.0.0.1@evil.com"]) {
      assert.equal((await fetch(`${base}/qr.svg?host=${encodeURIComponent(evil)}`)).status, 400, evil);
    }
  });
});

test("QR matrix has the three finder patterns and grows with the payload", () => {
  const m = qrMatrix("http://192.168.1.23:8080/booster/");
  const n = m.length;
  assert.ok(n >= 21 && (n - 21) % 4 === 0, `valid QR size, got ${n}`);
  // 7×7 finder: dark border, light ring, dark 3×3 centre
  const finder = (r0: number, c0: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const border = r === 0 || r === 6 || c === 0 || c === 6;
        const centre = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        assert.equal(m[r0 + r]![c0 + c], border || centre, `finder at ${r0},${c0} module ${r},${c}`);
      }
    }
  };
  finder(0, 0);
  finder(0, n - 7);
  finder(n - 7, 0);
  assert.ok(qrMatrix("x".repeat(200)).length > n);
  assert.deepEqual(qrMatrix("same"), qrMatrix("same"), "deterministic");
});

test("QR SVG has a 4-module quiet zone and is black on white", () => {
  const svg = qrSvg("hello");
  const n = qrMatrix("hello").length;
  assert.match(svg, new RegExp(`viewBox="0 0 ${n + 8} ${n + 8}"`));
  assert.match(svg, /fill="#fff"/);
  assert.match(svg, /fill="#000"/);
  assert.doesNotMatch(svg, /M[0-3],\d/, "no dark module inside the quiet zone (x < 4)");
});

// --- network address choice ---------------------------------------------------------------

const nic = (address: string, internal = false, family: "IPv4" | "IPv6" = "IPv4"): NetworkInterfaceInfo =>
  ({ address, netmask: "255.255.255.0", family, mac: "00:00:00:00:00:00", internal, cidr: `${address}/24` }) as NetworkInterfaceInfo;

test("network: prefers Wi-Fi/LAN ranges, ranks virtual adapters last, skips loopback/link-local/IPv6", () => {
  const interfaces = {
    Loopback: [nic("127.0.0.1", true)],
    "vEthernet (WSL)": [nic("172.28.0.1")],
    "VirtualBox Host-Only Network": [nic("192.168.56.1")],
    "Wi-Fi": [nic("192.168.1.42"), nic("fe80::1", false, "IPv6")],
    Ethernet: [nic("10.0.0.7")],
    "Ethernet 2": [nic("169.254.10.10")],
  };
  const list = lanAddresses(interfaces);
  assert.equal(list[0]!.address, "192.168.1.42");
  assert.equal(list[1]!.address, "10.0.0.7");
  assert.deepEqual(list.slice(2).map((l) => l.virtual), [true, true]);
  assert.ok(!list.some((l) => l.address.startsWith("127.") || l.address.startsWith("169.254.") || l.address.includes(":")));
});

test("network: joinInfo builds http://<lan-ip>:<port>/booster/, falls back to localhost, honours PUBLIC_URL", () => {
  const lan = joinInfo({ port: 8080, boosterPath: "/booster/", interfaces: { "Wi-Fi": [nic("192.168.1.42")] } });
  assert.equal(lan.joinUrl, "http://192.168.1.42:8080/booster/");
  assert.equal(lan.source, "LAN");
  assert.equal(joinInfo({ port: 80, boosterPath: "/booster/", interfaces: { "Wi-Fi": [nic("192.168.1.42")] } }).joinUrl, "http://192.168.1.42/booster/");
  const none = joinInfo({ port: 8080, boosterPath: "/booster/", interfaces: { lo: [nic("127.0.0.1", true)] } });
  assert.equal(none.source, "LOCALHOST");
  assert.equal(none.joinUrl, "http://localhost:8080/booster/");
  assert.equal(joinInfo({ publicUrl: "https://x.y", port: 1, boosterPath: "/booster/" }).joinUrl, "https://x.y/booster/");
});

// --- front-end/protocol consistency --------------------------------------------------------

test("front-end files declare the same protocol version as shared/protocol", () => {
  for (const file of [join(defaultBoosterDir(), "app.js"), join(defaultLobbyDir(), "lobby.js")]) {
    const m = /var PROTOCOL_VERSION = (\d+);/.exec(readFileSync(file, "utf8"));
    assert.ok(m, `${file} declares PROTOCOL_VERSION`);
    assert.equal(Number(m[1]), PROTOCOL_VERSION, file);
  }
});

test("the Booster page only ever sends the protocol's client messages", () => {
  const src = readFileSync(join(defaultBoosterDir(), "app.js"), "utf8");
  const sent = [...src.matchAll(/send\(\{\s*type:\s*"([A-Z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(sent)].sort(), ["BOOST", "HELLO"]);
  assert.doesNotMatch(src, /"CONTROL"|"DRIVER_STEER"|count:|amount:/, "no CONTROL, steering or boost counts from a booster");
  assert.match(src, /role: "booster"/);
});
