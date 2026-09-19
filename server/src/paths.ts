// Locates the static asset directories regardless of whether the server runs from
// src or from the compiled dist/ tree.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Walk up from this file to the repo root: the directory holding both `booster/` and `server/public/`. */
export function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "booster")) && existsSync(join(dir, "server", "public"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(process.cwd(), "..");
}

export function defaultBoosterDir(): string {
  return join(findRepoRoot(), "booster");
}

export function defaultLobbyDir(): string {
  return join(findRepoRoot(), "server", "public", "lobby");
}
