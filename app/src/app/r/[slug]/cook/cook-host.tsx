"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CookMode from "@/components/cook-mode";
import { Display, GhostButton, GoldButton } from "@/components/ui";
import type { Recipe } from "@/lib/rrf";
import { makeT, type Dictionary } from "@/lib/i18n/client";

const RESUME_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * Owns the cook session: the resume prompt, server-side step persistence, and
 * the hand-off to S7 on completion.
 */
export default function CookHost({
  slug,
  recipe,
  dict,
}: {
  slug: string;
  recipe: Recipe;
  dict: Dictionary;
}) {
  const t = makeT(dict);
  const router = useRouter();
  const [resume, setResume] = useState<number | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const sessionId = useRef<string | null>(null);

  // C9 — reopening within six hours offers to pick up where you left off.
  useEffect(() => {
    let saved: { index: number; at: number } | null = null;
    try {
      const raw = localStorage.getItem(`rovelle:cook:${recipe.id}`);
      saved = raw ? JSON.parse(raw) : null;
    } catch {
      saved = null;
    }
    if (saved && saved.index > 0 && Date.now() - saved.at < RESUME_WINDOW_MS) setResume(saved.index);
    else setStart(0);
  }, [recipe.id]);

  useEffect(() => {
    if (start === null) return;
    void fetch(`/api/recipes/${recipe.id}/cook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", step: start }),
    })
      .then((r) => r.json())
      .then((j) => (sessionId.current = j.sessionId ?? null))
      .catch(() => {});
  }, [start, recipe.id]);

  if (resume !== null) {
    return (
      <div className="fixed inset-0 z-50 grid place-items-center bg-[hsl(var(--background))] px-5">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "var(--gradient-warm)" }}
        />
        <div className="animate-fade-up glass relative w-full max-w-[560px] p-7 md:p-9">
          <div className="eyebrow">{recipe.title}</div>
          <Display size="md" className="mt-4">
            {t("cook.resume")} {resume + 1}?
          </Display>
          <GoldButton
            size="xl"
            className="mt-8 w-full"
            onClick={() => {
              setStart(resume);
              setResume(null);
            }}
          >
            {t("cook.resume")} {resume + 1}
          </GoldButton>
          <GhostButton
            size="lg"
            className="mt-3 w-full"
            onClick={() => {
              setStart(0);
              setResume(null);
            }}
          >
            {t("cook.startOver")}
          </GhostButton>
        </div>
      </div>
    );
  }

  if (start === null) return <div className="fixed inset-0 bg-[hsl(var(--background))]" />;

  return (
    <CookMode
      recipe={recipe}
      dict={dict}
      initialStep={start}
      onStepChange={(index) => {
        if (!sessionId.current) return;
        void fetch(`/api/recipes/${recipe.id}/cook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "step", sessionId: sessionId.current, step: index }),
        }).catch(() => {});
      }}
      onComplete={async (elapsedMs) => {
        await fetch(`/api/recipes/${recipe.id}/cook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete", sessionId: sessionId.current }),
        }).catch(() => {});
        router.replace(`/r/${slug}/cook/done?min=${Math.round(elapsedMs / 60000)}`);
      }}
      onExit={() => router.push(`/r/${slug}`)}
    />
  );
}
