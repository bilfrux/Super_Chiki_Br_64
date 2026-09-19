// End-to-end test in a REAL browser: headless Chrome/Edge loads the actual Booster
// page from the actual server, and is driven with touch events over the DevTools
// protocol. Skipped (not failed) if no Chrome/Edge is installed; set BROWSER_PATH to
// point at one. Set SCREENSHOT_DIR to save PNGs of what the phone shows.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { TEAM_IDS, type RaceState } from "../../shared/index.js";
import { loadConfig, type ServerConfig } from "../src/config.js";
import { startServer, type ServerHandle } from "../src/server.js";
import { SimClient, sleep } from "../tools/simclient.js";

// --- finding a browser -------------------------------------------------------------------

function findBrowser(): string | undefined {
  const candidates = [
    process.env.BROWSER_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
  return candidates.find((p) => p && existsSync(p));
}

const browserPath = findBrowser();

// --- minimal DevTools protocol client ------------------------------------------------------

class Cdp {
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

  private constructor(private ws: WebSocket) {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.message}`));
      else p.resolve(msg.result);
    });
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.on("open", () => resolve(new Cdp(ws)));
      ws.on("error", reject);
    });
  }

  send(method: string, params: object = {}): Promise<any> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }

  /** Poll a page expression until it returns something truthy. */
  async until<T>(expression: string, what: string, timeoutMs = 8000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
      try {
        last = await this.eval(expression);
        if (last) return last as T;
      } catch (err) { last = (err as Error).message; }
      await sleep(50);
    }
    throw new Error(`Timed out waiting for ${what}. Last value: ${JSON.stringify(last)}`);
  }

  /** A real touch tap at the centre of an element (fires pointerdown, like a phone). */
  async tap(selector: string): Promise<void> {
    const box = await this.eval<{ x: number; y: number }>(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    await this.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x, y: box.y }] });
    await this.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async screenshot(name: string): Promise<void> {
    const dir = process.env.SCREENSHOT_DIR;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    const shot = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(dir, `${name}.png`), Buffer.from(shot.data, "base64"));
  }

  close(): void { this.ws.close(); }
}

// --- launching the browser -------------------------------------------------------------------

type Browser = { cdp: Cdp; stop: () => void };

async function launchBrowser(): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), "mgp-browser-"));
  const child: ChildProcess = spawn(browserPath!, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });

  const stop = () => {
    try {
      if (process.platform === "win32" && child.pid) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      else child.kill("SIGKILL");
    } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* locked; temp dir, harmless */ }
  };

  try {
    // With --remote-debugging-port=0 the browser writes the chosen port to DevToolsActivePort.
    const portFile = join(profile, "DevToolsActivePort");
    let port = 0;
    for (let i = 0; i < 150 && !port; i++) {
      if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").split("\n")[0]);
      else await sleep(100);
    }
    if (!port) throw new Error("Browser did not start (no DevToolsActivePort)");

    let wsUrl: string | undefined;
    for (let i = 0; i < 50 && !wsUrl; i++) {
      const targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[];
      wsUrl = targets.find((t) => t.type === "page")?.webSocketDebuggerUrl;
      if (!wsUrl) await sleep(100);
    }
    if (!wsUrl) throw new Error("No page target");

    const cdp = await Cdp.connect(wsUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // Look like a phone.
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    return { cdp, stop: () => { cdp.close(); stop(); } };
  } catch (err) {
    stop();
    throw err;
  }
}

// --- the test -----------------------------------------------------------------------------------

const config = (port = 0): ServerConfig =>
  loadConfig({}, {
    port,
    host: "127.0.0.1",
    adminKey: "test-key",
    tickHz: 60,
    stateHz: 30,
    heartbeatMs: 60_000,
    race: { countdownSeconds: 0.2, secondsAtSpeed1: 60 },
  });

const teamOf = (s: RaceState, id: string) => s.teams.find((t) => t.id === id)!;

test("Booster UI in a real browser: gets a team, BOOST reaches the RaceEngine, survives reload, reconnect and takeover",
  { skip: browserPath ? false : "no Chrome/Edge found (set BROWSER_PATH)", timeout: 90_000 },
  async () => {
    let server: ServerHandle = await startServer(config(), () => {});
    const port = server.port;
    const url = `http://127.0.0.1:${port}/booster/`;
    const browser = await launchBrowser();
    const { cdp } = browser;
    const extra: SimClient[] = [];

    try {
      const admin = new SimClient(`ws://127.0.0.1:${port}/ws`);
      extra.push(admin);
      await admin.join({ role: "admin", adminKey: "test-key" });
      const screen = new SimClient(`ws://127.0.0.1:${port}/ws`);
      extra.push(screen);
      await screen.join({ role: "screen" });

      // 1. Opening the page assigns a team and shows it -------------------------------------------
      await cdp.send("Page.navigate", { url });
      const team = await cdp.until<string>(`document.body.dataset.team`, "a team to be assigned");
      assert.ok((TEAM_IDS as readonly string[]).includes(team), `team ${team}`);
      assert.equal(await cdp.eval(`document.getElementById("team-name").textContent`), team.toUpperCase());
      await cdp.until(`document.body.dataset.conn === "online"`, "online state");
      const bg = await cdp.eval<string>(`getComputedStyle(document.body).backgroundColor`);
      assert.notEqual(bg, "rgba(0, 0, 0, 0)");
      assert.equal(await cdp.eval(`document.documentElement.scrollHeight <= window.innerHeight`), true, "one screen, no scrolling");
      const state1 = await screen.waitForState((s) => teamOf(s, team).boosters === 1);
      assert.equal(teamOf(state1, team).boosters, 1, "the server counts this phone as a booster on that team");
      await cdp.screenshot("1-lobby");

      // 2. BOOST is disabled until the race is on --------------------------------------------------
      assert.equal(await cdp.eval(`document.getElementById("boost").disabled`), true);
      await cdp.tap("#boost");
      await sleep(150);
      assert.equal(ServerBoostTotal(screen), 0, "tapping while waiting sends nothing");

      // 3. Pressing BOOST updates the RaceEngine ------------------------------------------------------
      admin.send({ type: "CONTROL", action: "START" });
      await screen.waitForState((s) => s.status === "RACING");
      await cdp.until(`!document.getElementById("boost").disabled`, "BOOST enabled while racing");
      await cdp.screenshot("2-racing");
      const mark = screen.mark();
      let peakEnergy = 0;
      let peakRate = 0;
      for (let i = 0; i < 5; i++) {
        await cdp.tap("#boost");
        await sleep(40); // the server has applied the tap; sample the authoritative state
        const t = teamOf(server.engine.snapshot(), team);
        peakEnergy = Math.max(peakEnergy, t.boostEnergy);
        peakRate = Math.max(peakRate, t.boostRate);
        await sleep(70);
      }
      await sleep(200);
      assert.equal(ServerBoostTotal(screen, mark), 5, "exactly 5 BOOST actions reached the server");
      // Note: one phone tapping ~9/s stays below the engine's break-even (gain 0.03 vs decay 0.3/s),
      // so energy is only visible right after a tap. The rate window is the robust evidence.
      assert.ok(peakEnergy > 0, `RaceEngine boost energy rose after a tap: ${peakEnergy}`);
      assert.equal(peakRate, 5, `RaceEngine counted all 5 taps in its 1 s window, saw ${peakRate}`);
      assert.equal(server.engine.snapshot().teams.filter((t) => t.id !== team).every((t) => t.boostEnergy === 0 && t.boostRate === 0), true, "only this team was boosted");
      assert.equal(await cdp.eval(`document.getElementById("stat-you").textContent`), "5");
      await cdp.until(`Number(document.getElementById("stat-rate").textContent) >= 1`, "team boosts/sec on screen");
      await cdp.screenshot("3-boosting");

      // too-fast tapping is throttled on the phone before it can hit the server limit
      const mark2 = screen.mark();
      await cdp.eval(`(() => { const b = document.getElementById("boost"); for (let i = 0; i < 40; i++) b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true })); })()`);
      await sleep(200);
      assert.ok(ServerBoostTotal(screen, mark2) <= 2, `burst of 40 synthetic taps sent ${ServerBoostTotal(screen, mark2)}`);
      assert.equal(screen.errors().length, 0);

      // 4. Refresh keeps the same team and identity (token in localStorage) ------------------------------
      const token = await cdp.eval<string>(`localStorage.getItem("mgp.booster.token")`);
      assert.ok(token && token.length >= 16);
      const youBefore = await cdp.eval<string>(`document.getElementById("stat-you").textContent`);
      await cdp.send("Page.reload");
      await cdp.until(`document.body.dataset.conn === "online"`, "online after reload");
      assert.equal(await cdp.eval(`document.body.dataset.team`), team, "same team after refresh");
      assert.equal(await cdp.eval(`localStorage.getItem("mgp.booster.token")`), token, "same identity after refresh");
      assert.equal(await cdp.eval(`document.getElementById("stat-you").textContent`), youBefore, "own boost count restored from the server");
      await sleep(200);
      const afterReload = await screen.waitForState((s) => teamOf(s, team).boosters === 1);
      assert.equal(afterReload.teams.reduce((n, t) => n + t.boosters, 0), 1, "no duplicate booster after refresh");

      // 5. Same identity opened elsewhere: the old page steps aside, then can take over again ----------------
      const other = new SimClient(`ws://127.0.0.1:${port}/ws`);
      extra.push(other);
      await other.join({ role: "booster", token });
      assert.equal(other.welcome?.team, team);
      await cdp.until(`!document.getElementById("overlay").hidden && document.getElementById("overlay-title").textContent.includes("ELSEWHERE")`, "takeover overlay");
      await cdp.screenshot("4-elsewhere");
      await sleep(1200);
      assert.equal(other.isClosed, false, "the page does not fight back by reconnecting on its own");
      await cdp.tap("#overlay-btn");
      await cdp.until(`document.body.dataset.conn === "online" && document.getElementById("overlay").hidden`, "back online after PLAY HERE");
      assert.equal(await other.waitForClose(), 4001, "the other connection was replaced");
      await cdp.eval(`void 0`);

      // 6. Server restart: the page shows RECONNECTING, then comes back on the SAME team ---------------------
      for (const c of extra) c.drop();
      extra.length = 0;
      await server.close();
      await cdp.until(`document.body.dataset.conn === "reconnecting"`, "reconnecting state", 6000);
      assert.equal(await cdp.eval(`document.getElementById("overlay").hidden`), false);
      assert.match(await cdp.eval<string>(`document.getElementById("overlay-title").textContent`), /RECONNECTING/);
      await cdp.screenshot("5-reconnecting");
      assert.equal(await cdp.eval(`document.getElementById("boost").disabled`), true, "cannot boost while offline");

      server = await startServer(config(port), () => {}); // fresh server, same port, no memory of the token
      await cdp.until(`document.body.dataset.conn === "online" && document.getElementById("overlay").hidden`, "auto-reconnect", 15000);
      assert.equal(await cdp.eval(`document.body.dataset.team`), team, "kept the same team after a server restart");
      const screen2 = new SimClient(`ws://127.0.0.1:${port}/ws`);
      extra.push(screen2);
      await screen2.join({ role: "screen" });
      const st = await screen2.waitForState((s) => teamOf(s, team).boosters === 1);
      assert.equal(teamOf(st, team).boosters, 1);

      // 7. ?team= switches teams explicitly ----------------------------------------------------------------------
      const other2 = TEAM_IDS.find((t) => t !== team)!;
      await cdp.send("Page.navigate", { url: `${url}?team=${other2}` });
      await cdp.until(`document.body.dataset.team === ${JSON.stringify(other2)} && document.body.dataset.conn === "online"`, "explicit team switch");
      await cdp.screenshot("6-switched");
    } finally {
      for (const c of extra) c.drop();
      browser.stop();
      await server.close();
    }
  },
);

function ServerBoostTotal(client: SimClient, from = 0): number {
  return client.ofType("BOOST", from).reduce((n, m) => n + m.amount, 0);
}

test("Lobby page in a real browser: shows the QR + join URL, live team table, and START works only with the right key",
  { skip: browserPath ? false : "no Chrome/Edge found (set BROWSER_PATH)", timeout: 60_000 },
  async () => {
    const server = await startServer(config(), () => {});
    const browser = await launchBrowser();
    const { cdp } = browser;
    const booster = new SimClient(`ws://127.0.0.1:${server.port}/ws`);
    try {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 1000, deviceScaleFactor: 1, mobile: false });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${server.port}/lobby/` });

      // QR + the URL it encodes (the server's LAN address, never loopback unless there is no network)
      const joinUrl = await cdp.until<string>(`document.getElementById("join-url").textContent.startsWith("http") && document.getElementById("join-url").textContent`, "join URL");
      const api = (await (await fetch(`http://127.0.0.1:${server.port}/api/join`)).json()) as { joinUrl: string };
      assert.equal(joinUrl, api.joinUrl);
      assert.ok(joinUrl.endsWith(`:${server.port}/booster/`));
      await cdp.until(`(() => { const i = document.getElementById("qr"); return i.complete && i.naturalWidth > 0; })()`, "QR image loaded");

      // live table: 4 teams, and a booster joining shows up
      await cdp.until(`document.querySelectorAll("#teams tbody tr").length === 4`, "4 team rows");
      await booster.join({ role: "booster", team: "green" });
      await cdp.until(`[...document.querySelectorAll("#teams tbody tr")].find(r => r.textContent.includes("GREEN"))?.children[2].textContent === "1"`, "booster count on the lobby page");
      assert.equal(await cdp.eval(`document.getElementById("race-status").textContent`), "LOBBY");
      assert.equal(await cdp.eval(`document.getElementById("controls").hidden`), true, "START/RESET hidden until unlocked");

      // wrong key: refused, controls stay hidden, page keeps working read-only
      const submit = (key: string) => cdp.eval(`(() => { document.getElementById("admin-key").value = ${JSON.stringify(key)}; document.getElementById("admin-form").requestSubmit(); })()`);
      await submit("wrong-key");
      await cdp.until(`/authorized|invalid|Not/i.test(document.getElementById("admin-msg").textContent)`, "wrong-key message");
      assert.equal(await cdp.eval(`document.getElementById("controls").hidden`), true);
      await cdp.until(`/LOBBY/.test(document.getElementById("race-status").textContent)`, "read-only view is back");
      assert.equal(server.engine.status, "LOBBY");

      // right key: unlocks, START starts the race, RESET stops it
      await submit("test-key");
      await cdp.until(`document.getElementById("controls").hidden === false`, "operator unlocked");
      await cdp.screenshot("7-lobby-unlocked");
      await cdp.tap("#start");
      await cdp.until(`/RACING|COUNTDOWN/.test(document.getElementById("race-status").textContent)`, "race started from the lobby page");
      assert.ok(["COUNTDOWN", "RACING"].includes(server.engine.status), `engine status ${server.engine.status}`);
      await cdp.tap("#reset");
      await cdp.until(`document.getElementById("race-status").textContent === "LOBBY"`, "reset from the lobby page");
      assert.equal(server.engine.status, "LOBBY");
    } finally {
      booster.drop();
      browser.stop();
      await server.close();
    }
  },
);
