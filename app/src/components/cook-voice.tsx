"use client";

import { useEffect, useRef, useState } from "react";
import type { Recipe } from "@/lib/rrf";
import { LOCALES } from "@/lib/i18n/locales";
import { VOICE_GROUPS, DEFAULT_VOICE, isVoice } from "@/lib/voices";
import { makeT, type Dictionary } from "@/lib/i18n/client";
import { detectWave } from "@/lib/wave";
import { IconMic } from "./ui";

/**
 * Talk live to the recipe.
 *
 * Two ways in, and they end in the same place. Hold the button for one
 * question, or turn hands-free on and hold a conversation.
 *
 * Path: mic → POST /api/ask → Saaras turns whatever language you spoke into
 * English → the answer comes from the recipe document only → Bulbul speaks it
 * back in your language.
 *
 * The response is read as NDJSON, so the transcript lands the moment it is
 * heard and the answer writes itself out word by word rather than appearing
 * whole after four round trips.
 *
 * ponytail: when Sarvam STT is mocked, this falls back to the browser's own
 * SpeechRecognition and posts the transcript instead of the audio. Same
 * endpoint, same grounded answer, zero credits — good enough to build against.
 */

/**
 * The non-streaming reply shape. Still needed: the streaming path is the happy
 * one, but a proxy that buffers SSE falls back to a single JSON response and
 * that path must keep working, silently, in a kitchen.
 */
type AskResponse = {
  question: string;
  answer: string;
  jumpToStep: number | null;
  audio: string | null;
  speakLocally: boolean;
  ttsMode?: string;
};

type AskEvent =
  | { phase: "heard"; question: string; language: string }
  | { phase: "delta"; text: string }
  | { phase: "answer"; answer: string; jumpToStep: number | null }
  | { phase: "audio"; audio: string | null; speakLocally: boolean; ttsMode: string }
  | { phase: "error"; error: string; capability?: string };

/**
 * How long the conversation stays open after the wake word, and after each
 * answer. Long enough to think about what to ask next with your hands in a
 * bowl; short enough that the kitchen isn't being listened to all evening.
 */
const WINDOW_MS = 45_000;

/**
 * How long to record after the wake word. Long enough for "how do I know when
 * the onions are done", short enough to stay inside Sarvam's 30-second sync
 * limit with room to spare.
 */
const SPEAK_WINDOW_MS = 7_000;

const WAKE = /\b(?:chef|rovelle)\b[\s,.:-]*(.*)$/i;
/** Said mid-conversation, these close the window rather than becoming questions. */
const DISMISS = /^(stop|quiet|never ?mind|nothing|cancel|thanks|thank you|that's all)\.?$/i;

export default function CookVoice({
  recipe,
  step,
  dict,
  onJump,
}: {
  recipe: Recipe;
  step: number;
  dict: Dictionary;
  onJump: (index: number) => void;
}) {
  const t = makeT(dict);
  const [state, setState] = useState<"idle" | "listening" | "thinking" | "speaking">("idle");
  const [handsFree, setHandsFree] = useState(false);
  const [open, setOpen] = useState(false);
  const [heard, setHeard] = useState("");
  const [language, setLanguage] = useState("en-IN");
  // The voice is remembered across sessions: whoever is cooking picked it once
  // and should not have to pick it again every time they open a recipe.
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [exchange, setExchange] = useState<{ q: string; a: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const [waveOn, setWaveOn] = useState(false);
  const [waved, setWaved] = useState(false);
  const [camera, setCamera] = useState(true);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const audioEl = useRef<HTMLAudioElement | null>(null);
  const videoEl = useRef<HTMLVideoElement | null>(null);

  // The recogniser and everything its callbacks read. Callbacks outlive the
  // render that created them, so anything they touch lives in a ref — the
  // previous version re-created the recogniser on every step change and lost
  // whatever the cook was saying at the moment the step advanced.
  const rec = useRef<ContinuousRecogniser | null>(null);
  const paused = useRef(false);
  const openUntil = useRef(0);
  const stepRef = useRef(step);
  const langRef = useRef(language);
  const voiceRef = useRef(voice);
  const sendRef = useRef<(audio: Blob | null, question?: string) => Promise<void>>(async () => {});
  const captureRef = useRef<(fallback: string) => Promise<void>>(async () => {});
  stepRef.current = step;
  langRef.current = language;
  voiceRef.current = voice;

  /** Keeps the on-screen chip honest about whether the window is still open. */
  useEffect(() => {
    if (!handsFree) {
      setOpen(false);
      return;
    }
    const tick = setInterval(() => setOpen(Date.now() < openUntil.current), 500);
    return () => clearInterval(tick);
  }, [handsFree]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("rovelle:voice");
      if (saved && isVoice(saved)) setVoice(saved);
    } catch {
      /* private mode — the default voice is a fine default */
    }
  }, []);

  useEffect(() => {
    setSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia &&
        typeof MediaRecorder !== "undefined",
    );
    setCamera(typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia);
  }, []);

  /**
   * Wave to talk.
   *
   * Hands-free still needs a first word said out loud, and a cook with dough
   * on both hands in a loud kitchen may not be heard. A wave is the gesture
   * they already make at the phone, so it becomes the switch.
   *
   * Off by default and the camera is never opened until it is switched on —
   * the frames are differenced on-device and thrown away, but a camera the
   * cook did not ask for is not ours to open.
   */
  useEffect(() => {
    if (!waveOn) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let detector: { stop(): void } | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: 320, height: 240 },
        });
      } catch {
        if (!cancelled) {
          setCamera(false);
          setWaveOn(false);
        }
        return;
      }
      if (cancelled || !videoEl.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      videoEl.current.srcObject = stream;
      await videoEl.current.play().catch(() => {});
      detector = detectWave({
        video: videoEl.current,
        onWave: () => {
          setHandsFree(true);
          setWaved(true);
          // A wave IS the wake word. Making them say "chef" as well would be
          // asking twice for the same permission.
          openUntil.current = Date.now() + WINDOW_MS;
          setOpen(true);
          navigator.vibrate?.(120);
          setTimeout(() => setWaved(false), 4000);
        },
      });
    })();

    // Switching apps must not leave a camera running behind the cook's back.
    const onHidden = () => document.hidden && setWaveOn(false);
    document.addEventListener("visibilitychange", onHidden);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHidden);
      detector?.stop();
      stream?.getTracks().forEach((t) => t.stop());
      if (videoEl.current) videoEl.current.srcObject = null;
    };
  }, [waveOn]);

  /**
   * Hands-free.
   *
   * Push-to-talk assumes a free hand, which is the one thing a cook mid-recipe
   * does not have. So: continuous recognition, gated on the wake word "chef".
   * The gate is the whole design — an extractor fan, a radio and a boiling pan
   * make an always-acting assistant a false-positive machine, and jumping to
   * step 5 because the television said "next" is worse than no assistant.
   *
   * Runs on the browser's own recogniser, not Sarvam: it is free, it is
   * already streaming, and paying per utterance to listen to a kitchen for
   * twenty minutes would be absurd. The spoken question still goes to the
   * grounded answerer exactly as the push-to-talk path does.
   */
  useEffect(() => {
    if (!handsFree) return;
    const r = makeRecogniser(language);
    if (!r) {
      setError("This browser can't listen continuously. Use hold-to-ask.");
      setHandsFree(false);
      return;
    }
    rec.current = r;

    let stopped = false;
    let failures = 0;
    let restart: ReturnType<typeof setTimeout> | undefined;
    r.continuous = true;
    r.interimResults = true;

    r.onresult = (e) => {
      // While the answer is being read back, the mic is hearing us, not them.
      if (paused.current) return;
      const last = e.results[e.results.length - 1];
      const phrase = (last?.[0]?.transcript ?? "").trim();
      if (!phrase) return;
      failures = 0;
      setHeard(phrase.slice(-60));
      if (!last.isFinal) return;
      setHeard("");

      const wake = phrase.match(WAKE);
      const inWindow = Date.now() < openUntil.current;

      // The wake word is the way in. Once inside, follow-ups stand on their
      // own — having to say "chef" before every sentence is not a conversation.
      let question: string;
      if (wake) {
        openUntil.current = Date.now() + WINDOW_MS;
        setOpen(true);
        question = wake[1].trim();
      } else if (inWindow) {
        question = phrase;
      } else {
        return;
      }

      if (DISMISS.test(question)) {
        openUntil.current = 0;
        setOpen(false);
        stopSpeaking();
        return;
      }
      // Just "chef" on its own: the window is open, now wait for the question.
      if (question.length < 3) return;
      // Hand the question to Saaras rather than trusting what the browser
      // heard. `question` is only used as the fallback if the recording fails.
      void captureRef.current(question);
    };

    r.onerror = (e) => {
      const kind = e?.error ?? "";
      if (kind === "not-allowed" || kind === "service-not-allowed") {
        // Restarting into a denied permission is an infinite loop that pins a
        // core and never recovers. Stop, and say why.
        stopped = true;
        setError(t("cook.micDenied"));
        setHandsFree(false);
        return;
      }
      // "no-speech" and "aborted" are the recogniser working as designed.
      if (kind !== "no-speech" && kind !== "aborted") failures++;
    };

    // Recognisers stop themselves after a silence; restart until switched off,
    // backing off so a browser that refuses isn't hammered.
    r.onend = () => {
      if (stopped || paused.current) return;
      restart = setTimeout(
        () => {
          try {
            r.start();
          } catch {
            /* already starting */
          }
        },
        Math.min(2000, 150 * 2 ** failures),
      );
    };

    try {
      r.start();
    } catch {
      /* already running */
    }
    return () => {
      stopped = true;
      paused.current = false;
      if (restart) clearTimeout(restart);
      rec.current = null;
      try {
        r.stop();
      } catch {
        /* nothing to stop */
      }
    };
    // Deliberately not depending on `step`: the recogniser reads it from a ref,
    // and tearing the microphone down every time the cook advances a step drops
    // the sentence they were in the middle of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree, language]);

  async function startListening() {
    setError(null);
    setExchange(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks.current = [];
      // Sarvam's STT accepts WAV, MP3, AAC, FLAC and OGG — not WebM, which is
      // what Chrome's MediaRecorder produces by default and which came back
      // as a bare 400. Ask for something it can read, in preference order,
      // and fall back to the browser default only if none is supported.
      const rec = new MediaRecorder(stream, pickAudioFormat());
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || "audio/ogg";
        void send(new Blob(chunks.current, { type }));
      };
      rec.start();
      recorder.current = rec;
      // Sarvam's sync STT hard-stops at 30 seconds. A held button or an open
      // hands-free window will sail past that and come back as a bare 400, so
      // close the recording ourselves before the API has to refuse it.
      window.setTimeout(() => {
        if (recorder.current === rec && rec.state === "recording") stopListening();
      }, 25_000);
      setState("listening");
    } catch {
      setError("No microphone. Type the question instead.");
      setState("idle");
    }
  }

  function stopListening() {
    recorder.current?.stop();
    recorder.current = null;
    setState("thinking");
  }

  async function send(audio: Blob | null, questionText?: string) {
    // Barge-in: a new question always wins over an answer still being read.
    stopSpeaking();
    setState("thinking");
    setError(null);
    if (questionText) setExchange({ q: questionText, a: "" });

    try {
      const init: RequestInit =
        audio && !questionText
          ? { method: "POST", body: askForm(audio) }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                recipeId: recipe.id,
                step: stepRef.current,
                language: langRef.current,
                voice: voiceRef.current,
                question: questionText ?? "",
              }),
            };
      const res = await fetch("/api/ask", {
        ...init,
        headers: { ...(init.headers ?? {}), Accept: "application/x-ndjson" },
      });
      if (!res.ok || !res.body) throw new Error("I couldn't work that one out.");

      let answerText = "";
      let streamed = "";
      let spoke = false;

      for await (const event of ndjson(res.body)) {
        if (event.phase === "heard") {
          setExchange({ q: event.question, a: "" });
          // Saaras heard a different language than the picker says. Follow it,
          // so the answer comes back in the language actually spoken.
          if (event.language !== langRef.current) setLanguage(event.language);
        } else if (event.phase === "delta") {
          streamed += event.text;
          setExchange((x) => (x ? { ...x, a: streamed } : x));
        } else if (event.phase === "answer") {
          answerText = event.answer;
          setExchange((x) => ({ q: x?.q ?? "", a: answerText }));
          if (event.jumpToStep !== null) onJump(event.jumpToStep);
        } else if (event.phase === "audio") {
          speak(answerText, event.audio);
          spoke = true;
        } else if (event.phase === "error") {
          if (event.capability === "stt" && audio) {
            // Sarvam STT is off. Let the browser do the listening instead.
            const local = await listenLocally(langRef.current);
            if (!local) throw new Error("Speech recognition isn't available here. Type it instead.");
            return void send(null, local);
          }
          throw new Error(event.error);
        }
      }

      // The stream ended without an audio frame — the answer is on screen but
      // nothing said it, and a cook looking at a pan never sees that.
      if (answerText && !spoke) speak(answerText, null);
      if (!answerText) throw new Error("I couldn't work that one out.");
    } catch (e) {
      setState("idle");
      setError(e instanceof Error ? e.message : "I couldn't work that one out.");
      if (handsFree) openUntil.current = Date.now() + WINDOW_MS;
    }
  }

  function askForm(audio: Blob) {
    const form = new FormData();
    form.append("recipeId", recipe.id);
    form.append("step", String(stepRef.current));
    form.append("language", langRef.current);
    form.append("voice", voiceRef.current);
    // The extension has to match the container — Sarvam picks its decoder off
    // the filename, and a .webm name got a bare 400.
    form.append("audio", audio, `question.${extensionFor(audio.type)}`);
    return form;
  }

  /** Stops whatever is being said, whichever voice is saying it. */
  function stopSpeaking() {
    paused.current = false;
    const el = audioEl.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
    }
    try {
      speechSynthesis.cancel();
    } catch {
      /* no speech synthesis here */
    }
  }

  /**
   * Reads the answer back, with the microphone shut for the duration.
   *
   * Without that pause the recogniser hears the assistant, and in an open
   * conversation window the assistant's own answer becomes the next question.
   */
  function speak(text: string, base64: string | null) {
    setState("speaking");
    paused.current = true;
    try {
      rec.current?.stop();
    } catch {
      /* not running */
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(guardTimer);
      paused.current = false;
      setState("idle");
      if (handsFree) {
        // The window reopens on every answer, so a follow-up needs no wake word.
        openUntil.current = Date.now() + WINDOW_MS;
        setOpen(true);
        try {
          rec.current?.start();
        } catch {
          /* onend will bring it back */
        }
      }
    };
    // Some browsers never fire onend for a cancelled utterance. Without this
    // the microphone would stay shut for the rest of the cook.
    const guardTimer = setTimeout(finish, Math.min(45_000, text.length * 90 + 4000));

    if (base64) {
      const el = audioEl.current ?? new Audio();
      audioEl.current = el;
      el.onended = finish;
      el.onerror = finish;
      el.src = `data:audio/wav;base64,${base64}`;
      void el.play().catch(finish);
      return;
    }
    // Bulbul is off — the browser's own voice is free and says the same words.
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = langRef.current;
      u.onend = finish;
      u.onerror = finish;
      speechSynthesis.speak(u);
    } catch {
      finish(); // no speech synthesis — the answer is on screen either way
    }
  }

  sendRef.current = send;

  /**
   * Record the question and let Saaras transcribe it.
   *
   * Called the instant the wake word lands. `fallback` is what the browser
   * thought it heard — used only if the recording itself fails, so a flaky
   * microphone degrades to a worse transcript rather than to silence.
   *
   * SPEAK_WINDOW_MS is a fixed capture rather than silence detection: a
   * kitchen is never silent, so waiting for quiet waits forever.
   */
  captureRef.current = async (fallback: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, pickAudioFormat());
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/ogg" });
        // Too small to contain speech — use what the browser heard instead.
        if (blob.size < 1024) void send(null, fallback);
        else void send(blob);
      };
      setState("listening");
      rec.start();
      window.setTimeout(() => rec.state === "recording" && rec.stop(), SPEAK_WINDOW_MS);
    } catch {
      // No second microphone handle — fall back to the browser's transcript.
      void send(null, fallback);
    }
  };

  return (
    <div className="mt-6 border-t border-[hsl(var(--border)/0.7)] pt-5">
      {exchange && (
        <div className="mb-4 rounded-[14px] bg-[hsl(var(--secondary)/0.5)] p-4" aria-live="polite">
          <p className="text-[14px] text-[hsl(var(--muted-foreground))]">“{exchange.q}”</p>
          <p className="mt-2 text-[18px] leading-[1.45] md:text-[20px]">{exchange.a}</p>
        </div>
      )}

      {error && <p className="mb-3 text-[15px] text-[hsl(var(--primary))]">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={!supported || state === "thinking"}
          onPointerDown={() => void startListening()}
          onPointerUp={stopListening}
          onPointerLeave={() => state === "listening" && stopListening()}
          className={`inline-flex min-h-[56px] flex-1 items-center justify-center gap-3 rounded-full border px-5 text-[16px] transition-colors disabled:opacity-40 ${
            state === "listening"
              ? "border-transparent text-[hsl(var(--primary-foreground))]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] text-[hsl(var(--muted-foreground))] hover:border-[hsl(var(--primary)/0.5)]"
          }`}
          style={state === "listening" ? { background: "var(--gradient-gold)" } : undefined}
        >
          <IconMic />
          {state === "listening"
            ? t("cook.listening")
            : state === "thinking"
              ? t("cook.thinking")
              : state === "speaking"
                ? t("cook.speaking")
                : t("cook.holdToAsk")}
        </button>

        {state === "speaking" && (
          <button
            type="button"
            onClick={() => {
              stopSpeaking();
              setState("idle");
              if (handsFree) {
                openUntil.current = Date.now() + WINDOW_MS;
                try {
                  rec.current?.start();
                } catch {
                  /* already running */
                }
              }
            }}
            className="min-h-[56px] rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] px-5 text-[15px] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/0.5)]"
          >
            {t("cook.stopSpeaking")}
          </button>
        )}

        <button
          onClick={() => {
            setError(null);
            setHandsFree((h) => !h);
          }}
          aria-pressed={handsFree}
          className={`min-h-[56px] rounded-full border px-4 text-[15px] transition-colors ${
            handsFree
              ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]"
              : "border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] text-[hsl(var(--muted-foreground))]"
          }`}
        >
          {handsFree ? t("cook.freeOn") : t("cook.freeOff")}
        </button>

        {camera && (
          <button
            onClick={() => {
              setError(null);
              setWaveOn((w) => !w);
            }}
            aria-pressed={waveOn}
            className={`inline-flex min-h-[56px] items-center gap-2 rounded-full border px-4 text-[15px] transition-colors ${
              waveOn
                ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.14)] text-[hsl(var(--primary))]"
                : "border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] text-[hsl(var(--muted-foreground))]"
            }`}
          >
            <IconCamera />
            {waveOn ? t("cook.waveOn") : t("cook.waveOff")}
          </button>
        )}

        <label className="sr-only" htmlFor="voice-lang">
          Language
        </label>
        <select
          id="voice-lang"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="min-h-[56px] rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] px-4 text-[15px] text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))]"
        >
          {LOCALES.map((l) => (
            <option key={l.sarvam} value={l.sarvam}>
              {l.native}
            </option>
          ))}
        </select>

        {/* The voice, independent of the language. Any speaker reads any
            language, so a Tamil cook can pick a male voice and a Hindi cook
            can pick Priya — coupling them made the voice an accident of the
            language. Grouped by Sarvam's measured pronunciation accuracy,
            because a voice that mangles "haldi" is worse than useless when
            the cook is listening rather than reading. */}
        <label className="sr-only" htmlFor="voice-speaker">
          Voice
        </label>
        <select
          id="voice-speaker"
          value={voice}
          onChange={(e) => {
            setVoice(e.target.value);
            try {
              localStorage.setItem("rovelle:voice", e.target.value);
            } catch {
              /* private mode — it just won't be remembered */
            }
          }}
          className="min-h-[56px] rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.6)] px-4 text-[15px] text-[hsl(var(--muted-foreground))] outline-none focus:border-[hsl(var(--primary))]"
        >
          {VOICE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} · {v.gender === "male" ? "m" : "f"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {handsFree && (
        <p
          className="mt-2 flex items-center gap-2 text-[14px] text-[hsl(var(--muted-foreground))]"
          aria-live="polite"
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              open
                ? "dot-live bg-[hsl(var(--primary))]"
                : "bg-[hsl(var(--muted-foreground)/0.5)]"
            }`}
          />
          {/* Open window means no wake word for the follow-up, and the cook has
              to be able to see which of the two they're in. */}
          {heard ? `${t("cook.heard")}: ${heard}` : open ? t("cook.ready") : t("cook.wake")}
        </p>
      )}

      {waveOn && (
        <>
          {/* Never on screen — the frames exist only to be differenced. */}
          <video ref={videoEl} playsInline muted autoPlay className="sr-only" />
          <p className="mt-2 text-[14px] text-[hsl(var(--muted-foreground))]" aria-live="polite">
            {waved ? t("cook.waved") : t("cook.waveHint")}
          </p>
          <p className="mt-1 text-[13px] text-[hsl(var(--muted-foreground))]">
            {t("cook.wavePrivacy")}
          </p>
        </>
      )}

      {!camera && (
        <p className="mt-2 text-[14px] text-[hsl(var(--muted-foreground))]">{t("cook.noCamera")}</p>
      )}

      {!supported && (
        <p className="mt-2 text-[14px] text-[hsl(var(--muted-foreground))]">
          This browser has no microphone access. Everything else still works.
        </p>
      )}
    </div>
  );
}

function IconCamera() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 8h3l1.5-2h7L17 8h3v11H4V8Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** One JSON object per line, yielded as each line completes. */
async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<AskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (let nl = buffer.indexOf("\n"); nl !== -1; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as AskEvent;
    }
  }
  const tail = buffer.trim();
  if (tail) yield JSON.parse(tail) as AskEvent;
}

// ——— browser fallback ————————————————————————————————————

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type RecogniserResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type RecogniserEvent = { results: ArrayLike<RecogniserResult> };

/**
 * The continuous recogniser, typed on its own rather than as an extension of
 * the one-shot shape — the two disagree about `onresult`, and intersecting
 * them loses `isFinal`.
 */
type ContinuousRecogniser = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  onresult: ((e: RecogniserEvent) => void) | null;
  /** `error` distinguishes a denied microphone from an ordinary silence. */
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function makeRecogniser(lang: string): ContinuousRecogniser | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => ContinuousRecogniser;
    webkitSpeechRecognition?: new () => ContinuousRecogniser;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = lang;
  rec.maxAlternatives = 1;
  return rec;
}

/** One utterance via the Web Speech API. Resolves null when unavailable. */
function listenLocally(lang: string): Promise<string | null> {
  const Ctor = (
    window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    }
  ).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .webkitSpeechRecognition;
  if (!Ctor) return Promise.resolve(null);

  return new Promise((resolve) => {
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    rec.onresult = (e) => done(e.results[0]?.[0]?.transcript ?? null);
    rec.onerror = () => done(null);
    rec.onend = () => done(null);
    rec.start();
    setTimeout(() => {
      rec.stop();
      done(null);
    }, 8000);
  });
}

/**
 * The recording container, chosen for what Sarvam can decode rather than what
 * the browser prefers. Chrome's MediaRecorder default is WebM/Opus, which
 * Sarvam's STT refuses with a bare 400. OGG/Opus is small and accepted;
 * MP4/AAC covers Safari, which cannot produce OGG.
 */
function pickAudioFormat(): MediaRecorderOptions | undefined {
  for (const mimeType of ["audio/ogg;codecs=opus", "audio/ogg", "audio/mp4", "audio/mpeg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return { mimeType };
    }
  }
  return undefined;
}

/** Sarvam picks its decoder off the filename, so it must match the container. */
function extensionFor(mimeType: string): string {
  const t = (mimeType || "").toLowerCase();
  if (t.includes("ogg")) return "ogg";
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "m4a";
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("flac")) return "flac";
  return "ogg";
}
