"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorLine, GoldButton, IconArrow } from "@/components/ui";
import { makeT, type Dictionary } from "@/lib/i18n/client";
import { fetchJson, RequestError } from "@/lib/fetch-json";

export default function EnterForm({ dict }: { dict: Dictionary }) {
  const t = makeT(dict);
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (!res.ok) throw new Error(json.error ?? t("common.somethingWrong"));
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWrong"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (stage === "email") {
          const json = await post({ email });
          if (json) {
            setStage("code");
            setDevCode(json.devCode ?? null);
          }
        } else if (await post({ email, code })) {
          router.replace("/");
        }
      }}
    >
      <label className="eyebrow block" htmlFor="email">
        {t("auth.email")}
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus
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
          <label className="eyebrow block" htmlFor="code">
            {t("auth.code")}
          </label>
          <input
            id="code"
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
              {t("auth.codeHint")}:{" "}
              <span className="data text-[hsl(var(--primary))]">{devCode}</span>
            </p>
          )}
        </div>
      )}

      <ErrorLine>{error}</ErrorLine>

      <GoldButton className="mt-7 w-full" disabled={busy}>
        {busy ? t("auth.working") : stage === "email" ? t("auth.sendCode") : t("auth.enter")}
        {!busy && <IconArrow />}
      </GoldButton>

      {stage === "code" && (
        <button
          type="button"
          className="mt-4 min-h-[44px] w-full text-[13px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 hover:text-[hsl(var(--foreground))]"
          onClick={() => {
            setStage("email");
            setCode("");
            setDevCode(null);
          }}
        >
          {t("auth.otherEmail")}
        </button>
      )}
    </form>
  );
}
