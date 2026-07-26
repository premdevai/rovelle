/**
 * The one check that matters for wave-to-talk: a kitchen is full of motion,
 * and only one kind of it is a wave.
 *
 *   npx tsx src/lib/wave-check.ts
 */

import assert from "node:assert/strict";
import { isWaveSignature, type WaveSample } from "./wave";

/** 12fps worth of samples, `shape(i)` giving [left, right] per frame. */
function frames(n: number, shape: (i: number) => [number, number]): WaveSample[] {
  return Array.from({ length: n }, (_, i) => {
    const [left, right] = shape(i);
    return { t: i * 83, left, right };
  });
}

async function main() {
  let checks = 0;
  const ok = (label: string, fn: () => void) => {
    fn();
    checks++;
    console.log(`  ✓ ${label}`);
  };

  console.log("\nwave signature");

  ok("a wave alternates left and right", () => {
    // Four half-cycles across ~1.2s: left, right, left, right.
    const wave = frames(16, (i) => (Math.floor(i / 4) % 2 === 0 ? [0.09, 0.01] : [0.01, 0.09]));
    assert.equal(isWaveSignature(wave), true);
  });

  ok("someone walking past is not a wave", () => {
    // Loud in both halves at once, and steady — the case a plain energy
    // threshold gets wrong every single time.
    const walk = frames(16, () => [0.08, 0.08]);
    assert.equal(isWaveSignature(walk), false);
  });

  ok("reaching for the spice jar is not a wave", () => {
    const reach = frames(16, () => [0.1, 0.01]);
    assert.equal(isWaveSignature(reach), false);
  });

  ok("a quiet kitchen is not a wave", () => {
    // Alternating, but far below the noise floor: sensor grain, not an arm.
    const grain = frames(16, (i) => (i % 4 < 2 ? [0.004, 0.001] : [0.001, 0.004]));
    assert.equal(isWaveSignature(grain), false);
  });

  ok("one crossing is not a wave", () => {
    // Motion moves left→right once and stops there. An arm put down.
    const once = frames(16, (i) => (i < 8 ? [0.09, 0.01] : [0.01, 0.09]));
    assert.equal(isWaveSignature(once), false);
  });

  ok("too few frames decide nothing", () => {
    assert.equal(isWaveSignature(frames(3, (i) => (i % 2 ? [0.09, 0.01] : [0.01, 0.09]))), false);
  });

  console.log(`\n${checks} checks passed.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
