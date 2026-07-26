/**
 * Wave to talk.
 *
 * A cook with dough on both hands cannot tap a button and will not shout over
 * an extractor fan. Waving is the gesture they already make at a phone, so it
 * is the one we detect — with frame differencing on a 32×24 grey thumbnail.
 *
 * No model, no dependency, nothing leaves the device: the pixels never leave
 * the canvas, only two numbers per frame do.
 *
 * The whole design is the ALTERNATION test in `isWaveSignature`. Steam rises,
 * someone walks past, an arm reaches for the cumin — all of that is plenty of
 * motion, and a "lots of motion" threshold fires on every one of them. Only a
 * wave makes the motion swing left, right, left across the frame. That swing
 * is what we look for; raw energy only decides whether to look at all.
 */

export type WaveSample = { t: number; left: number; right: number };

/** Mean absolute frame difference per half, normalised to 0–1. */
const WINDOW_MS = 1500;
const NOISE = 0.02; // below this the kitchen is still; nothing to read
const DOMINANCE = 0.25; // one half must carry 25% more motion to count as a side
const CROSSINGS = 2; // left→right→left. One crossing is a reach, not a wave.
const MIN_SAMPLES = 6;
const DEBOUNCE_MS = 5000;

/**
 * PURE. Given a rolling window of per-half motion, was that a wave?
 *
 * Tested with synthetic samples in wave-check.ts — no camera required, which
 * is the point of keeping it separate from the capture loop.
 */
export function isWaveSignature(samples: WaveSample[]): boolean {
  if (samples.length < MIN_SAMPLES) return false;

  const end = samples[samples.length - 1].t;
  const win = samples.filter((s) => end - s.t <= WINDOW_MS);
  if (win.length < MIN_SAMPLES) return false;

  const energy = win.reduce((sum, s) => sum + s.left + s.right, 0) / win.length;
  if (energy < NOISE) return false;

  let side = 0;
  let crossings = 0;
  for (const s of win) {
    const total = s.left + s.right;
    if (total < NOISE) continue; // a still frame breaks nothing, it just says nothing
    const bias = (s.left - s.right) / total;
    const now = bias > DOMINANCE ? 1 : bias < -DOMINANCE ? -1 : 0;
    if (now === 0) continue; // both halves busy: a walk-past, not a wave
    if (side !== 0 && now !== side) crossings++;
    side = now;
  }
  return crossings >= CROSSINGS;
}

/**
 * Watch a <video> for waves. Returns a stop() that must be called — a camera
 * left running in the background is not acceptable.
 */
export function detectWave(opts: {
  video: HTMLVideoElement;
  onWave: () => void;
  fps?: number;
  onEnergy?: (sample: WaveSample) => void;
}): { stop(): void } {
  const { video, onWave, fps = 12, onEnergy } = opts;
  const W = 32;
  const H = 24;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  let prev: Float32Array | null = null;
  let samples: WaveSample[] = [];
  let lastFired = 0;
  let stopped = false;

  const half = (W / 2) * H * 255;

  const timer = setInterval(() => {
    if (stopped || !ctx || video.readyState < 2) return;

    ctx.drawImage(video, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    const grey = new Float32Array(W * H);
    for (let i = 0; i < grey.length; i++) {
      const p = i * 4;
      grey[i] = (data[p] + data[p + 1] + data[p + 2]) / 3;
    }

    if (prev) {
      let left = 0;
      let right = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const d = Math.abs(grey[i] - prev[i]);
          if (x < W / 2) left += d;
          else right += d;
        }
      }
      const sample: WaveSample = {
        t: performance.now(),
        left: left / half,
        right: right / half,
      };
      onEnergy?.(sample);
      samples.push(sample);
      samples = samples.filter((s) => sample.t - s.t <= WINDOW_MS);

      if (sample.t - lastFired > DEBOUNCE_MS && isWaveSignature(samples)) {
        lastFired = sample.t;
        samples = []; // don't re-read the same wave on the next frame
        onWave();
      }
    }
    prev = grey;
  }, 1000 / fps);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      prev = null;
      samples = [];
    },
  };
}
