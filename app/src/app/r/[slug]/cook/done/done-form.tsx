"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Display, GoldButton, IconCheck } from "@/components/ui";
import { makeT, type Dictionary } from "@/lib/i18n/client";

/**
 * S7 — the highest-leverage retention moment in the app.
 *
 * The note is what makes a recipe unreplaceable, so it is asked for exactly
 * once, right here, while the pan is still warm. Skipping is one tap and
 * carries no friction and no guilt.
 */
export default function DoneForm({
  slug,
  recipeId,
  title,
  minutes,
  cookedCount,
  dict,
}: {
  slug: string;
  recipeId: string;
  title: string;
  minutes: number | null;
  cookedCount: number;
  dict: Dictionary;
}) {
  const t = makeT(dict);
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    if (body.trim()) {
      await fetch(`/api/recipes/${recipeId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, author: null }),
      }).catch(() => {});
    }
    router.replace(`/r/${slug}`);
  }

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-14">
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "var(--gradient-ember)" }} />
      <div className="animate-fade-up relative w-full max-w-[620px]">
        <span
          aria-hidden
          className="grid h-14 w-14 place-items-center rounded-full text-[22px] text-[hsl(var(--primary-foreground))]"
          style={{ background: "var(--gradient-gold)" }}
        >
          <IconCheck />
        </span>

        <Display size="xl" className="mt-8">
          {t("done.title")}
        </Display>
        <p className="data mt-4 text-[15px] text-[hsl(var(--muted-foreground))]">
          {title}
          {minutes ? ` · ${minutes} min` : ""}
          {cookedCount > 1 ? ` · ${cookedCount}× now` : ""}
        </p>

        <div className="card mt-10 p-6">
          <label className="eyebrow block" htmlFor="note">
            {t("done.howWasIt")}
          </label>
          <textarea
            id="note"
            autoFocus
            rows={4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("done.notePlaceholder")}
            className="mt-3 w-full resize-none rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-4 text-[17px] leading-[1.55] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.55)] focus:border-[hsl(var(--primary))]"
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <GoldButton size="xl" className="flex-1" disabled={busy} onClick={() => void save()}>
              {t("recipe.saveNote")}
            </GoldButton>
            <button
              disabled={busy}
              onClick={() => router.replace(`/r/${slug}`)}
              className="min-h-[64px] px-8 text-[16px] text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
            >
              {t("done.skip")}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
