import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAOS_MEME_ID,
  CHAOS_SPEED_MULT,
  DEFAULT_MEMES,
  SPEED_MAX,
  memeSpeedMultiplier,
  memeThreshold,
} from "../index.js";

test("effect ids map to multipliers", () => {
  assert.equal(memeSpeedMultiplier("NONE"), 1);
  assert.equal(memeSpeedMultiplier("CHAOS"), CHAOS_SPEED_MULT);
  assert.equal(memeSpeedMultiplier("SPEED_MULT_1.25"), 1.25);
  assert.equal(memeSpeedMultiplier("SPEED_MULT_2"), CHAOS_SPEED_MULT, "capped at SPEED_MAX");
});

test("unknown or malformed effect ids are harmless", () => {
  for (const e of ["", "speed_mult_2", "SPEED_MULT_", "SPEED_MULT_-1", "SPEED_MULT_0", "BOOM", "SPEED_MULT_1e9"]) {
    assert.equal(memeSpeedMultiplier(e), 1, e);
  }
});

test("default memes are sane", () => {
  const ids = DEFAULT_MEMES.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, "unique ids");
  const thresholds = DEFAULT_MEMES.map((m) => m.threshold);
  assert.deepEqual([...thresholds].sort((a, b) => a - b), thresholds, "ascending thresholds");
  for (const m of DEFAULT_MEMES) {
    assert.ok(m.threshold > 0 && m.duration > 0, m.id);
    assert.ok(memeSpeedMultiplier(m.effect) <= SPEED_MAX);
  }
  assert.equal(DEFAULT_MEMES.filter((m) => m.id === CHAOS_MEME_ID).length, 1);
});

test("per-team threshold override", () => {
  const meme = DEFAULT_MEMES[1]!;
  const cfg = { memes: DEFAULT_MEMES, teamThresholds: { red: { [meme.id]: 7 } } };
  assert.equal(memeThreshold(cfg, "red", meme), 7);
  assert.equal(memeThreshold(cfg, "blue", meme), meme.threshold);
});
