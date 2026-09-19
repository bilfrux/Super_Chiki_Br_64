import { test } from "node:test";
import assert from "node:assert/strict";
import { Limiter } from "../src/rateLimit.js";

test("allows a burst, then limits to the sustained rate", () => {
  const l = new Limiter(10, 20, 10);
  let ok = 0;
  for (let i = 0; i < 100; i++) if (l.take(0) === "ok") ok++;
  assert.equal(ok, 20, "burst size");
  // one second later the bucket has refilled by `rate` tokens
  ok = 0;
  for (let i = 0; i < 100; i++) if (l.take(1000) === "ok") ok++;
  assert.equal(ok, 10);
});

test("a steady sender at the sustained rate is never limited", () => {
  const l = new Limiter(15, 20, 10);
  for (let t = 0; t < 10_000; t += 1000 / 15) assert.equal(l.take(t), "ok");
});

test("reports abuse only when the drop count in a second exceeds rate × factor", () => {
  const l = new Limiter(10, 10, 10); // abuse above 100 drops/sec
  for (let i = 0; i < 10; i++) l.take(0); // drain burst
  let limited = 0;
  let abuse = 0;
  for (let i = 0; i < 300; i++) {
    const r = l.take(1);
    if (r === "limited") limited++;
    if (r === "abuse") abuse++;
  }
  assert.equal(limited, 100);
  assert.equal(abuse, 200);
});

test("drop counter resets each second", () => {
  const l = new Limiter(10, 10, 10);
  for (let i = 0; i < 10; i++) l.take(0);
  for (let i = 0; i < 90; i++) assert.equal(l.take(1), "limited");
  // a second later: refilled and counter reset
  for (let i = 0; i < 10; i++) assert.equal(l.take(1500), "ok");
  assert.equal(l.take(1500), "limited");
});
