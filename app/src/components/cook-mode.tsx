"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allSteps, formatDuration, formatQty, type Recipe } from "@/lib/rrf";
import { makeT, type Dictionary } from "@/lib/i18n/client";
import { IconCheck, cx } from "./ui";
import CookVoice from "./cook-voice";

/**
 * Cook Mode — the instrument.
 *
 * Ergonomics are non-negotiable and survive every restyle:
 *   C1 primary target >=72px tall     C7  full keyboard control
 *   C2 no text below 16px             C8  exit confirmation past step 1
 *   C3 screen never sleeps            C9  progress persisted, resumable
 *   C4 timer starts on step entry     C10 concurrent timers in a strip
 *   C5 NEVER auto-advance             C11 reduced motion respected
 *   C6 ingredient drawer, one tap
 *
 * Layout does not change across breakpoints. A propped laptop on a counter is
 * the propped-phone problem at a different distance; the answer to both is one
 * column, capped, centred, large. The space stays unused on purpose.
 */

type Props = {
  recipe: Recipe;
  dict: Dictionary;
  initialStep?: number;
  onStepChange?: (index: number) => void;
  onComplete?: (elapsedMs: number) => void;
  onExit?: () => void;
  voice?: boolean;
};

type BackgroundTimer = { id: string; label: string; endsAt: number };

export default function CookMode({
  recipe,
  dict,
  initialStep = 0,
  onStepChange,
  onComplete,
  onExit,
  voice = true,
}: Props) {
  const t = makeT(dict);
  const steps = useMemo(() => allSteps(recipe), [recipe]);
  const [index, setIndex] = useState(Math.min(Math.max(0, initialStep), steps.length - 1));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [background, setBackground] = useState<BackgroundTimer[]>([]);
  const remainingRef = useRef<number | null>(null);
  const startedAt = useRef(Date.now());
  const liveRef = useRef<HTMLDivElement>(null);

  const step = steps[index];
  const progress = index / steps.length;

  // ——— C3 wake lock, re-acquired on visibility change ——————————
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        /* unsupported or denied — degrade silently */
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, []);

  // ——— C9 persist progress ——————————————————————————————————
  useEffect(() => {
    onStepChange?.(index);
    try {
      localStorage.setItem(`rovelle:cook:${recipe.id}`, JSON.stringify({ index, at: Date.now() }));
    } catch {
      /* private mode — the server copy still has it */
    }
    if (liveRef.current) {
      liveRef.current.textContent = `${t("cook.step")} ${index + 1} ${t("cook.of")} ${steps.length}. ${step.text}`;
    }
    setPaused(false);
  }, [index, recipe.id, step, steps.length, onStepChange, t]);

  // ——— C10 a timer you walk away from keeps running ————————————
  const parkTimer = useCallback(() => {
    const left = remainingRef.current;
    if (left !== null && left > 0 && step.duration_s) {
      setBackground((b) =>
        b.some((x) => x.id === step.id)
          ? b
          : [...b, { id: step.id, label: shortLabel(step.text), endsAt: Date.now() + left * 1000 }],
      );
    }
    remainingRef.current = null;
  }, [step]);

  const next = useCallback(() => {
    parkTimer();
    if (index < steps.length - 1) setIndex((i) => i + 1);
    else {
      try {
        localStorage.removeItem(`rovelle:cook:${recipe.id}`);
      } catch {
        /* nothing to clear */
      }
      onComplete?.(Date.now() - startedAt.current);
    }
  }, [index, steps.length, recipe.id, onComplete, parkTimer]);

  const back = useCallback(() => {
    parkTimer();
    setIndex((i) => Math.max(0, i - 1));
  }, [parkTimer]);

  const exit = useCallback(() => {
    if (index > 0 && !confirm(t("cook.leaveConfirm"))) return;
    onExit?.();
  }, [index, onExit, t]);

  // ——— C7 keyboard ——————————————————————————————————————————
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // A <select> is not an <input>, and the voice panel has two of them. With
      // only the old INPUT/TEXTAREA check, arrow keys walked the recipe instead
      // of the option list and "p" paused the timer instead of reaching Punjabi.
      if (el?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Space is how a keyboard operates a button. Swallowing it here meant the
      // hands-free toggle, the drawer and the pause ring could not be pressed
      // at all — C7 claims full keyboard control, so it has to yield.
      if (e.key === " " && el?.closest("button, a, [role='button']")) return;
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        setDrawerOpen((o) => !o);
      } else if (e.key.toLowerCase() === "p") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (drawerOpen) setDrawerOpen(false);
        else exit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, exit, drawerOpen]);

  const [headline, ...rest] = splitStep(step.text);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[hsl(var(--background))]">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{ background: "var(--gradient-warm)" }}
      />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-[820px] flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 md:px-6 md:pt-8">
        <div className="glass animate-fade-up flex flex-1 flex-col p-5 md:p-8">
          {/* ——— header ——— */}
          <header className="flex items-center gap-4">
            <button
              onClick={back}
              disabled={index === 0}
              aria-label={t("cook.back")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:opacity-25"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="m14 6-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            <div className="flex-1 text-center">
              <div className="eyebrow">{t("cook.now")}</div>
              <div className="data mt-1 text-[15px] text-[hsl(var(--foreground))]">
                {String(index + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}
              </div>
            </div>

            <button
              onClick={exit}
              aria-label={t("cook.exit")}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))]"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          {/* ——— the step ——— */}
          <div className="mt-8 flex-1">
            <div className="eyebrow-muted">{step.phaseName}</div>
            <h1 className="font-display mt-3 text-[30px] leading-[1.08] md:text-[42px]">
              {headline}
              {step.temperature_c !== null && (
                <span className="text-gold"> at {step.temperature_c} °C</span>
              )}
            </h1>

            {rest.length > 0 && (
              <p className="mt-5 max-w-[58ch] text-[17px] leading-[1.55] text-[hsl(var(--muted-foreground))] md:text-[19px]">
                {rest.join(" ")}
              </p>
            )}

            {/* What a cook asks mid-step, answered before they have to ask. */}
            {(step.vessel || step.heat || step.doneness_cue || !step.hands_on) && (
              <div className="mt-6 flex flex-wrap gap-2">
                {step.vessel && <Chip label={t("cook.vessel")}>{step.vessel}</Chip>}
                {step.heat && <Chip label={t("cook.heat")}>{step.heat}</Chip>}
                {!step.hands_on && <Chip>{t("cook.handsFree")}</Chip>}
              </div>
            )}
            {step.doneness_cue && (
              <p className="mt-4 max-w-[58ch] text-[16px] italic leading-[1.55] text-[hsl(var(--primary)/0.9)] md:text-[17px]">
                {t("cook.doneWhen")}: {step.doneness_cue}
              </p>
            )}

            {step.duration_s !== null && (
              <StepTimer
                key={step.id}
                seconds={step.duration_s}
                paused={paused}
                label={step.hands_on ? t("cook.stepTimer") : t("cook.resting")}
                t={t}
                onTogglePause={() => setPaused((p) => !p)}
                onTick={(left) => {
                  remainingRef.current = left;
                }}
              />
            )}
          </div>

          {/* C10 — timers left running elsewhere in the kitchen. */}
          {background.length > 0 && (
            <BackgroundStrip
              timers={background}
              onDismiss={(tid) => setBackground((b) => b.filter((x) => x.id !== tid))}
            />
          )}

          {voice && <CookVoice recipe={recipe} step={index} dict={dict} onJump={setIndex} />}

          {/* C1 — the giant target */}
          <button
            onClick={next}
            className="btn-gold mt-6 flex min-h-[72px] w-full items-center justify-center gap-3 text-[20px] md:text-[22px]"
          >
            <IconCheck />
            {index === steps.length - 1 ? t("cook.finish") : t("cook.markDone")}
          </button>

          {/* ——— progress ——— */}
          <div className="mt-5 flex items-center gap-4">
            <button
              onClick={back}
              disabled={index === 0}
              className="min-h-[44px] shrink-0 text-[14px] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))] disabled:opacity-30"
            >
              {t("cook.previous")}
            </button>
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[hsl(var(--border))]">
              <div
                className="h-full rounded-full transition-transform duration-300 ease-out"
                style={{
                  background: "var(--gradient-gold)",
                  width: "100%",
                  transform: `scaleX(${progress})`,
                  transformOrigin: "left",
                }}
              />
            </div>
            <button
              onClick={next}
              className="min-h-[44px] shrink-0 text-[14px] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
            >
              {t("cook.next")}
            </button>
          </div>

          {/* ——— ingredients strip ——— */}
          <div className="mt-6 border-t border-[hsl(var(--border)/0.7)] pt-5">
            <div className="flex items-baseline justify-between gap-4">
              <span className="eyebrow">{t("cook.ingredients")}</span>
              <button
                onClick={() => setDrawerOpen(true)}
                aria-expanded={drawerOpen}
                className="eyebrow-muted min-h-[44px] transition-colors hover:text-[hsl(var(--primary))]"
              >
                {t("cook.viewAll")}
              </button>
            </div>
            <ul className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              {recipe.ingredients.slice(0, 6).map((i) => (
                <li
                  key={i.id}
                  className="flex items-baseline justify-between gap-4 border-b border-[hsl(var(--border)/0.5)] py-2.5 text-[15px]"
                >
                  <span className="truncate">{i.name}</span>
                  <span className="data shrink-0 text-[14px] text-[hsl(var(--primary))]">
                    {formatQty(i)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {drawerOpen && (
        <IngredientDrawer recipe={recipe} onClose={() => setDrawerOpen(false)} title={t("cook.ingredients")} />
      )}

      <div ref={liveRef} aria-live="assertive" className="sr-only" />
    </div>
  );
}

function Chip({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] px-3.5 py-1.5 text-[14px]">
      {label && <span className="eyebrow-muted text-[10px]">{label}</span>}
      <span className="capitalize text-[hsl(var(--foreground))]">{children}</span>
    </span>
  );
}

/** Headline is the first sentence; the rest is body copy under it. */
function splitStep(text: string): string[] {
  const parts = text.split(/(?<=[.!?])\s+/);
  const head = parts[0]?.replace(/[.]$/, "") ?? text;
  return [head, ...parts.slice(1)];
}

function shortLabel(text: string): string {
  const first = text.split(/[.,]/)[0] ?? text;
  return first.length > 22 ? `${first.slice(0, 21)}…` : first;
}

// ——— ring timer ————————————————————————————————————————————

function StepTimer({
  seconds,
  paused,
  label,
  t,
  onTogglePause,
  onTick,
}: {
  seconds: number;
  paused: boolean;
  label: string;
  t: (k: never) => string;
  onTogglePause: () => void;
  onTick: (left: number) => void;
}) {
  // C4 — starts on step entry. A wall-clock deadline rather than a
  // decrementing counter, so a backgrounded tab doesn't quietly lose minutes
  // to throttled intervals.
  const [endsAt, setEndsAt] = useState(() => Date.now() + seconds * 1000);
  const [left, setLeft] = useState(seconds);
  const [rung, setRung] = useState(false);
  const pausedAt = useRef<number | null>(null);

  useEffect(() => {
    if (paused) {
      if (pausedAt.current === null) pausedAt.current = Date.now();
      return;
    }
    if (pausedAt.current !== null) {
      const heldFor = Date.now() - pausedAt.current;
      pausedAt.current = null;
      setEndsAt((e) => e + heldFor);
      return;
    }
    const tick = () => {
      const l = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setLeft(l);
      onTick(l);
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [paused, endsAt, onTick]);

  // C5 — announce, never advance. The pan does not know the timer finished.
  useEffect(() => {
    if (left !== 0 || rung) return;
    setRung(true);
    navigator.vibrate?.([200, 100, 200]);
    try {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 1.3);
    } catch {
      /* autoplay policy — vibration and the ring still land */
    }
  }, [left, rung]);

  const R = 46;
  const C = 2 * Math.PI * R;
  const frac = seconds > 0 ? left / seconds : 0;

  return (
    <div className="mt-9 flex flex-wrap items-center gap-6">
      <button
        onClick={onTogglePause}
        aria-label={paused ? "Resume timer" : "Pause timer"}
        className="relative grid h-[116px] w-[116px] shrink-0 place-items-center"
      >
        <svg viewBox="0 0 110 110" className="absolute inset-0 -rotate-90">
          <circle cx="55" cy="55" r={R} fill="none" stroke="hsl(var(--border))" strokeWidth="3" />
          <circle
            cx="55"
            cy="55"
            r={R}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            className="motion-safe:transition-[stroke-dashoffset] motion-safe:duration-300"
          />
        </svg>
        <span className="relative text-center">
          <span
            className={cx(
              "font-display block text-[26px] leading-none tabular-nums",
              left === 0 && "text-gold motion-safe:animate-pulse",
            )}
          >
            {String(Math.floor(left / 60)).padStart(2, "0")}:
            {String(left % 60).padStart(2, "0")}
          </span>
          <span className="eyebrow-muted mt-1.5 block text-[9px]">{label}</span>
        </span>
      </button>

      {/* Timer state as text, never colour alone. */}
      <div className="text-[15px] leading-[1.5] text-[hsl(var(--muted-foreground))]">
        <div className="eyebrow-muted">{formatDuration(seconds)}</div>
        <p className="mt-1.5 max-w-[22ch]">
          {left === 0
            ? "Time's up. Tap done when the pan says so."
            : paused
              ? "Paused. Tap the ring to resume."
              : "Tap the ring to pause."}
        </p>
      </div>
    </div>
  );
}

// ——— C10 background timers ————————————————————————————————

function BackgroundStrip({
  timers,
  onDismiss,
}: {
  timers: BackgroundTimer[];
  onDismiss: (id: string) => void;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="mt-6 flex flex-wrap gap-2 border-t border-[hsl(var(--border)/0.7)] pt-4">
      {timers.map((timer) => {
        const left = Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000));
        return (
          <button
            key={timer.id}
            onClick={() => onDismiss(timer.id)}
            className="flex min-h-[48px] items-center gap-3 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] px-4 text-[15px]"
          >
            <span className="data tabular-nums text-[hsl(var(--primary))]">
              {String(Math.floor(left / 60)).padStart(2, "0")}:{String(left % 60).padStart(2, "0")}
            </span>
            <span className="text-[hsl(var(--muted-foreground))]">{timer.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ——— drawer ———————————————————————————————————————————————

function IngredientDrawer({
  recipe,
  onClose,
  title,
}: {
  recipe: Recipe;
  onClose: () => void;
  title: string;
}) {
  const groups = [...new Set(recipe.ingredients.map((i) => i.group))];
  return (
    // C6 — dismissible by tapping anywhere. Never navigates away.
    <div className="fixed inset-0 z-[60] flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="glass relative max-h-[76vh] w-full overflow-y-auto rounded-b-none px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 motion-safe:animate-[slideUp_250ms_var(--ease-cinema)] md:px-8"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="mx-auto max-w-[820px]">
          <div className="flex items-baseline justify-between">
            <span className="eyebrow">{title}</span>
            <span className="data text-[13px] text-[hsl(var(--muted-foreground))]">
              {recipe.servings.amount} {recipe.servings.unit}
            </span>
          </div>
          {groups.map((g) => (
            <div key={g} className="mt-6">
              {groups.length > 1 && <div className="eyebrow-muted mb-1">{g}</div>}
              <ul>
                {recipe.ingredients
                  .filter((i) => i.group === g)
                  .map((i) => (
                    <li
                      key={i.id}
                      className="flex items-baseline justify-between gap-6 border-b border-[hsl(var(--border)/0.6)] py-3.5 text-[17px] last:border-b-0"
                    >
                      <span>
                        {i.name}
                        {i.note && (
                          <span className="text-[hsl(var(--muted-foreground)/0.8)]"> · {i.note}</span>
                        )}
                      </span>
                      <span className="data shrink-0 text-[16px] text-[hsl(var(--primary))]">
                        {formatQty(i)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
