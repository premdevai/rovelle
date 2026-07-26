"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import RecipeEditor from "@/components/recipe-editor";
import { ErrorLine, GhostButton, GoldButton } from "@/components/ui";
import type { Recipe } from "@/lib/rrf";
import { fetchJson, RequestError } from "@/lib/fetch-json";

export default function EditForm({
  recipeId,
  slug,
  initial,
}: {
  recipeId: string;
  slug: string;
  initial: Recipe;
}) {
  const router = useRouter();
  const [recipe, setRecipe] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // userEdited latches on here and never unlatches: from this point no
        // automated process may rewrite this document (TECH-SPEC §3).
        body: JSON.stringify({ rrf: recipe, userEdited: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't save that.");
      router.push(`/r/${json.slug ?? slug}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
      setBusy(false);
    }
  }

  async function destroy() {
    if (!confirm(`Delete "${recipe.title}"? Export it first if you want to keep it.`)) return;
    await fetch(`/api/recipes/${recipeId}`, { method: "DELETE" });
    router.push("/cookbook");
    router.refresh();
  }

  return (
    <div className="mt-6">
      <RecipeEditor
        value={recipe}
        onChange={(next) => {
          setRecipe(next);
          setDirty(true);
        }}
      />

      <ErrorLine>{error}</ErrorLine>

      <div className="sticky bottom-0 -mx-5 mt-12 flex flex-col gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--background)/0.9)] px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center md:-mx-8 md:px-8">
        <GoldButton disabled={busy || !dirty} onClick={() => void save()}>
          {dirty ? "Save changes" : "Nothing changed"}
        </GoldButton>
        <GhostButton disabled={busy} onClick={() => router.push(`/r/${slug}`)}>
          Back to recipe
        </GhostButton>
        <button
          onClick={() => void destroy()}
          className="min-h-[48px] text-left text-[14px] text-[hsl(var(--muted-foreground)/0.7)] underline underline-offset-4 hover:text-[hsl(var(--destructive))] sm:ml-auto"
        >
          Delete recipe
        </button>
      </div>
    </div>
  );
}
