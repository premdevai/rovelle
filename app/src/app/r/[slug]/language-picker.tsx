"use client";

import { useState } from "react";
import { LOCALES } from "@/lib/i18n/locales";
import { Card, Eyebrow } from "@/components/ui";
import { formatQty, type Recipe } from "@/lib/rrf";
import { fetchJson, RequestError } from "@/lib/fetch-json";

/**
 * The creator filmed this in one language. The cook reads it in another.
 *
 * Paid for once per (recipe, language) and cached server-side, so switching
 * back and forth is free after the first time.
 */
export default function LanguagePicker({
  recipeId,
  live,
  label,
}: {
  recipeId: string;
  live: boolean;
  label: string;
}) {
  const [language, setLanguage] = useState("en-IN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [translated, setTranslated] = useState<Recipe | null>(null);

  async function pick(code: string) {
    setLanguage(code);
    setError(null);
    if (code === "en-IN") {
      setTranslated(null);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: code }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't translate that.");
      setTranslated(json.rrf as Recipe);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't translate that.");
      setLanguage("en-IN");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-5 p-6">
      <Eyebrow>{label}</Eyebrow>
      <select
        aria-label={label}
        value={language}
        disabled={busy}
        onChange={(e) => void pick(e.target.value)}
        className="mt-3 min-h-[44px] w-full rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 text-[15px] outline-none focus:border-[hsl(var(--primary))] disabled:opacity-60"
      >
        {LOCALES.map((l) => (
          <option key={l.sarvam} value={l.sarvam}>
            {l.native}
          </option>
        ))}
      </select>

      {!live && (
        <p className="mt-2.5 text-[13px] leading-[1.5] text-[hsl(var(--muted-foreground)/0.7)]">
          Needs <span className="data text-[hsl(var(--primary)/0.9)]">SARVAM_MODE_TRANSLATE=live</span>.
        </p>
      )}
      {busy && <p className="mt-2.5 text-[13px] text-[hsl(var(--muted-foreground))]">Translating…</p>}
      {error && (
        <p className="mt-2.5 text-[13px] leading-[1.5] text-[hsl(var(--destructive))]">{error}</p>
      )}

      {translated && (
        <div className="mt-5 border-t border-[hsl(var(--border)/0.6)] pt-4">
          <h3 className="font-display text-[18px] leading-[1.25]">{translated.title}</h3>
          <ul className="mt-3">
            {translated.ingredients.map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-1 text-[14px] leading-[1.5]">
                <span>{i.name}</span>
                {/* Quantities are data, not prose — never translated. Rendered
                    through formatQty like everywhere else: hand-rolling it here
                    printed "0.5" instead of "½" and leaked the raw enum
                    "as_needed" onto the page. */}
                <span className="data shrink-0 text-[hsl(var(--primary)/0.85)]">
                  {formatQty(i)}
                </span>
              </li>
            ))}
          </ul>
          <ol className="mt-4 space-y-2">
            {translated.phases
              .flatMap((p) => p.steps)
              .map((s, n) => (
                <li key={s.id} className="text-[14px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
                  <span className="data text-[hsl(var(--primary)/0.7)]">{n + 1}.</span> {s.text}
                </li>
              ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
