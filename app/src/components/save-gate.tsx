"use client";

import { useEffect, useRef, useState } from "react";
import { Display, ErrorLine, Eyebrow, GoldButton, IconArrow } from "@/components/ui";
import { fetchJson, RequestError } from "@/lib/fetch-json";

/**
 * The one interruption in the guest flow.
 *
 * A visitor imports, reviews and edits a recipe without an account. This opens
 * only when they reach for Save — the single moment where an account buys them
 * something they actually want. It signs them in in place, over the work they
 * just did, rather than throwing them at /enter and losing it.
 */
export default function SaveGate({
  open,
  onClose,
  onSignedIn,
  title = "Save this to your cookbook.",
  body = "Your recipe is ready. Sign in and it's yours — plus every recipe you make after this.",
}: {
  open: boolean;
  onClose: () => void;
  onSignedIn: () => void;
  /** The import screen opens the same sheet for a different reason. */
  title?: string;
  body?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    emailInput.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    // The page behind is a long editable recipe — let it stay put.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  async function post(body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/70 px-5 py-10 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="glass animate-fade-up w-full max-w-[440px] p-6 md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <Eyebrow>Keep it</Eyebrow>
        <Display size="md" as="h2" className="mt-4">
          {title}
        </Display>
        <p className="mt-4 text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground))]">{body}</p>

        <form
          className="mt-7"
          onSubmit={async (e) => {
            e.preventDefault();
            if (stage === "email") {
              const json = await post({ email });
              if (json) {
                setStage("code");
                setDevCode(json.devCode ?? null);
              }
            } else if (await post({ email, code })) {
              onSignedIn();
            }
          }}
        >
          <label className="eyebrow block" htmlFor="gate-email">
            Email
          </label>
          <input
            id="gate-email"
            ref={emailInput}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            value={email}
            disabled={stage === "code"}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-3 min-h-[52px] w-full rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 text-[16px] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.6)] focus:border-[hsl(var(--primary))] disabled:opacity-60"
          />

          {stage === "code" && (
            <div className="mt-6">
              <label className="eyebrow block" htmlFor="gate-code">
                Six-digit code
              </label>
              <input
                id="gate-code"
                required
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000"
                className="data mt-3 min-h-[56px] w-full rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 text-center text-[26px] tracking-[0.35em] outline-none transition-colors focus:border-[hsl(var(--primary))]"
              />
              {devCode && (
                <p className="mt-3 text-[13px] text-[hsl(var(--muted-foreground))]">
                  No mail provider is wired yet, so here it is:{" "}
                  <span className="data text-[hsl(var(--primary))]">{devCode}</span>
                </p>
              )}
            </div>
          )}

          <ErrorLine>{error}</ErrorLine>

          <GoldButton className="mt-7 w-full" disabled={busy}>
            {busy ? "One moment" : stage === "email" ? "Send me a code" : "Save it"}
            {!busy && <IconArrow />}
          </GoldButton>
        </form>

        <button
          type="button"
          onClick={onClose}
          className="mt-4 min-h-[44px] w-full text-[13px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 transition-colors hover:text-[hsl(var(--foreground))]"
        >
          Not yet — keep editing
        </button>
      </div>
    </div>
  );
}
