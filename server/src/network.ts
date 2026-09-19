// Finds the address phones should use to reach this server, so the QR code works
// on the venue Wi-Fi instead of pointing at "localhost".

import os from "node:os";

type Interfaces = ReturnType<typeof os.networkInterfaces>;

export type LanAddress = {
  name: string; // network interface name
  address: string; // IPv4
  virtual: boolean; // looks like a VM / container / VPN adapter (ranked last)
};

const VIRTUAL_NAME = /(vethernet|virtualbox|vmware|vmnet|hyper-v|wsl|docker|veth|^br-|loopback|bluetooth|tailscale|zerotier|hamachi|utun|^tun|^tap)/i;

/** Higher is better: typical home/venue Wi-Fi ranges first. */
function rank(address: string, virtual: boolean): number {
  const [a = 0, b = 0] = address.split(".").map(Number);
  let score: number;
  if (a === 192 && b === 168) score = 30;
  else if (a === 10) score = 20;
  else if (a === 172 && b >= 16 && b <= 31) score = 20;
  else if (a === 100 && b >= 64 && b <= 127) score = 5; // carrier-grade NAT
  else score = 10; // other (e.g. public) addresses
  return virtual ? score - 100 : score;
}

/** Non-loopback, non-link-local IPv4 addresses, best candidate first. */
export function lanAddresses(interfaces: Interfaces = os.networkInterfaces()): LanAddress[] {
  const found: LanAddress[] = [];
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.family !== "IPv4" || info.internal) continue;
      if (info.address.startsWith("169.254.")) continue; // link-local: no DHCP lease
      found.push({ name, address: info.address, virtual: VIRTUAL_NAME.test(name) });
    }
  }
  return found.sort((x, y) => rank(y.address, y.virtual) - rank(x.address, x.virtual));
}

export type JoinCandidate = { name: string; address: string; url: string };

export type JoinInfo = {
  /** URL to encode in the QR code (best candidate). */
  joinUrl: string;
  source: "PUBLIC_URL" | "LAN" | "LOCALHOST";
  candidates: JoinCandidate[];
};

const withPort = (address: string, port: number) =>
  port === 80 ? `http://${address}` : `http://${address}:${port}`;

/**
 * Where phones should open the Booster page.
 *  - PUBLIC_URL (a tunnel or deployment) wins if configured.
 *  - Otherwise this machine's LAN address, best interface first.
 *  - Falls back to localhost, which only works on this machine (the lobby warns about it).
 */
export function joinInfo(opts: {
  publicUrl?: string;
  port: number;
  boosterPath: string;
  interfaces?: Interfaces;
}): JoinInfo {
  if (opts.publicUrl) {
    const base = opts.publicUrl.replace(/\/+$/, "");
    const url = base + opts.boosterPath;
    return { joinUrl: url, source: "PUBLIC_URL", candidates: [{ name: "PUBLIC_URL", address: base, url }] };
  }
  const lan = lanAddresses(opts.interfaces);
  if (lan.length === 0) {
    const url = withPort("localhost", opts.port) + opts.boosterPath;
    return { joinUrl: url, source: "LOCALHOST", candidates: [{ name: "localhost", address: "localhost", url }] };
  }
  const candidates = lan.map((l) => ({
    name: l.name,
    address: l.address,
    url: withPort(l.address, opts.port) + opts.boosterPath,
  }));
  return { joinUrl: candidates[0]!.url, source: "LAN", candidates };
}
