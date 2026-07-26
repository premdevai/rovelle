"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import SaveGate from "@/components/save-gate";
import { ErrorLine, GoldButton, IconArrow, cx } from "@/components/ui";
import { makeT, type Dictionary } from "@/lib/i18n/client";
import { fetchJson, RequestError } from "@/lib/fetch-json";

/**
 * S1 — one input, and two doors beside it.
 *
 * The paste fallback is not an error state. It sits on the page from first
 * render as a normal way in (PRD §5). Same for the photo path: a handwritten
 * card is a legitimate source, not a recovery mechanism.
 *
 * The "hero" variant is the same form standing on the landing page, where a
 * visitor has not agreed to anything yet. There the two side doors fold behind
 * one line — a stranger needs one obvious move, not three — but nothing is
 * removed, only one click further away.
 */
export default function ImportForm({
  dict,
  importsLeft,
  ocrLive,
  extractLive,
  canWatch,
  variant = "page",
  note,
}: {
  dict: Dictionary;
  importsLeft: number | null;
  ocrLive: boolean;
  extractLive: boolean;
  canWatch: boolean;
  variant?: "page" | "hero";
  /** Quiet line under the action — the landing page uses it for the promise. */
  note?: React.ReactNode;
}) {
  const t = makeT(dict);
  const router = useRouter();
  const hero = variant === "hero";
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  // On the landing page the side doors start folded; on S1 they are the page.
  const [showDoors, setShowDoors] = useState(!hero);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The import a guest ran out of allowance for. Holding it is what lets the
  // sign-in read as a pause rather than as work they have to redo.
  const [gated, setGated] = useState<object | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const exhausted = importsLeft === 0;
  const surface = hero ? "glass" : "card";

  async function submit(body: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const json = await fetchJson<{ jobId: string }>("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.push(`/import/${json.jobId}`);
    } catch (e) {
      // Out of guest allowance (contract C1). An account is the way forward,
      // so offer it here instead of leaving a sentence they can't act on.
      if (e instanceof RequestError && e.status === 401 && e.payload.needsAccount) {
        setGated(body);
        setBusy(false);
        return;
      }
      // Everything else already carries a sentence a cook can act on —
      // fetchJson never lets a raw "Failed to fetch" through.
      setError(e instanceof Error ? e.message : t("common.somethingWrong"));
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setError("That file is over 10 MB. A screenshot should be well under it.");
      return;
    }
    void submit({ imageBase64: await toBase64(file), imageName: file.name });
  }

  return (
    <div className={hero ? "mt-9" : "mt-10"}>
      <div className={cx(surface, "p-5 md:p-6")}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit({ url: url.trim() });
          }}
        >
          <label className="sr-only" htmlFor="url">
            {t("import.placeholder")}
          </label>
          <input
            id="url"
            type="url"
            // Not on the hero: stealing focus there scrolls a phone past the
            // headline before the visitor has read a word.
            autoFocus={!hero}
            inputMode="url"
            value={url}
            disabled={busy || exhausted}
            placeholder={t("import.placeholder")}
            onChange={(e) => setUrl(e.target.value)}
            className={cx(
              "w-full rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.6)] focus:border-[hsl(var(--primary))] disabled:opacity-60",
              hero
                ? "min-h-[64px] text-[17px] md:text-[18px]"
                : "min-h-[56px] text-[16px] md:text-[17px]",
            )}
          />

          <div className="mt-4 flex flex-wrap items-center gap-4">
            <GoldButton size={hero ? "xl" : "lg"} disabled={busy || exhausted || !url.trim()}>
              {busy ? t("import.reading") : t("import.action")}
              {!busy && <IconArrow />}
            </GoldButton>
            {importsLeft !== null && (
              <span className="data text-[13px] text-[hsl(var(--muted-foreground))]">
                {importsLeft} / 5 {t("import.left")}
              </span>
            )}
          </div>
        </form>

        <ErrorLine>{error}</ErrorLine>

        {note && (
          <p className="mt-5 text-[13px] leading-[1.5] text-[hsl(var(--muted-foreground))] md:text-[14px]">
            {note}
          </p>
        )}

        <p className="mt-5 flex items-center gap-2 text-[13px] text-[hsl(var(--muted-foreground)/0.85)]">
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              canWatch ? "dot-live bg-[hsl(var(--primary))]" : "bg-[hsl(var(--muted-foreground)/0.5)]"
            }`}
          />
          {canWatch ? t("import.videoLive") : t("import.videoOff")}
        </p>
      </div>

      {hero && !showDoors && (
        <button
          type="button"
          aria-expanded={false}
          aria-controls="import-doors"
          onClick={() => setShowDoors(true)}
          className="mt-5 min-h-[44px] text-left text-[14px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 transition-colors hover:text-[hsl(var(--primary))]"
        >
          Or paste a caption, or a photo of a page
        </button>
      )}

      {showDoors && (
        <div id="import-doors">
          {/* Door two — the Rescue path, present from the start. */}
          <div className="mt-5">
            {!showPaste ? (
              <button
                className="min-h-[44px] text-left text-[15px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 transition-colors hover:text-[hsl(var(--primary))]"
                onClick={() => setShowPaste(true)}
              >
                {t("import.pasteInstead")}
              </button>
            ) : (
              <form
                className={cx(surface, "p-5 md:p-6")}
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit({ rawText: text.trim() });
                }}
              >
                <label className="eyebrow block" htmlFor="raw">
                  {t("import.pasteLabel")}
                </label>
                <textarea
                  id="raw"
                  autoFocus
                  rows={10}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={
                    "Ingredients:\n2 tbsp ghee\n1 tsp cumin seeds\nSalt to taste\n\nMethod:\nHeat the ghee and crackle the cumin for 30 seconds…"
                  }
                  className="mt-3 w-full resize-y rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-4 text-[15px] leading-[1.6] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.55)] focus:border-[hsl(var(--primary))]"
                />
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <GoldButton disabled={busy || exhausted || text.trim().length < 40}>
                    {busy ? t("import.reading") : t("import.build")}
                  </GoldButton>
                  <span className="data text-[13px] text-[hsl(var(--muted-foreground))]">
                    {text.trim().length} {t("import.characters")}
                  </span>
                </div>
              </form>
            )}
          </div>

          {/* Door three — a photo of a page, or a screenshot of a reel. */}
          <div className="mt-4">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button
              disabled={busy || exhausted}
              onClick={() => fileInput.current?.click()}
              className="min-h-[44px] text-left text-[15px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 transition-colors hover:text-[hsl(var(--primary))] disabled:no-underline disabled:opacity-50"
            >
              {t("import.photo")}
            </button>
            {!ocrLive && (
              <p className="mt-1.5 text-[13px] leading-[1.5] text-[hsl(var(--muted-foreground)/0.7)]">
                Reading images needs Sarvam Vision. Set{" "}
                <span className="data text-[hsl(var(--primary)/0.9)]">SARVAM_MODE_OCR=live</span>.
              </p>
            )}
          </div>
        </div>
      )}

      {exhausted && (
        <p className="mt-8 max-w-[52ch] text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {t("import.exhausted")}
        </p>
      )}

      <SaveGate
        open={gated !== null}
        title="One free import, then an account."
        body="You've used the import you get without one. Sign in and we'll read this next link — and everything you've already made comes with you."
        onClose={() => setGated(null)}
        onSignedIn={() => {
          const retry = gated;
          setGated(null);
          if (retry) void submit(retry);
        }}
      />

      {!extractLive && (
        <p className="mt-10 max-w-[60ch] text-[13px] leading-[1.6] text-[hsl(var(--muted-foreground)/0.7)]">
          Running on the local parser. It reads written captions well and never invents a quantity,
          but it won&rsquo;t untangle a spoken reel. Set{" "}
          <span className="data text-[hsl(var(--primary)/0.9)]">SARVAM_MODE_EXTRACT=live</span> for
          that.
        </p>
      )}
    </div>
  );
}

/** FileReader rather than Buffer — this runs in a browser. */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.readAsDataURL(file);
  });
}
