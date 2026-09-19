// Minimal, safe static file server for the two front-end directories.
// GET/HEAD only, no directory listings, no dotfiles, no path traversal.

import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
};

export type Mount = {
  /** URL prefix with a leading and trailing slash, e.g. "/booster/". */
  prefix: string;
  /** Directory on disk. */
  dir: string;
};

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "x-content-type-options": "nosniff" });
  res.end(body);
}

/**
 * Serve `urlPath` from `mount`. Returns true if the request was answered
 * (including 404/405 inside the mount), false if the path is not under the mount.
 */
export async function serveMount(req: IncomingMessage, res: ServerResponse, urlPath: string, mount: Mount): Promise<boolean> {
  const bare = mount.prefix.slice(0, -1); // "/booster"
  if (urlPath === bare) {
    // Relative asset URLs (style.css, app.js) need the trailing slash.
    res.writeHead(301, { location: mount.prefix });
    res.end();
    return true;
  }
  if (!urlPath.startsWith(mount.prefix)) return false;

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("allow", "GET, HEAD");
    send(res, 405, "Method not allowed");
    return true;
  }

  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.slice(mount.prefix.length));
  } catch {
    send(res, 400, "Bad request");
    return true;
  }
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel.includes("\0") || rel.split(/[\\/]/).some((seg) => seg.startsWith("."))) {
    send(res, 404, "Not found");
    return true;
  }

  const root = resolve(mount.dir);
  const file = resolve(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) {
    send(res, 404, "Not found");
    return true;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      res.writeHead(301, { location: urlPath + "/" });
      res.end();
      return true;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
      "content-length": body.length,
      "cache-control": "no-cache", // always revalidate: the UI changes during the hackathon
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send(res, 404, "Not found");
  }
  return true;
}
