"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import RecipeEditor from "@/components/recipe-editor";
import SaveGate from "@/components/save-gate";
import { ErrorLine, GhostButton, GoldButton, Display, Eyebrow } from "@/components/ui";
import { fieldsNeedingReview, type Recipe } from "@/lib/rrf";
import { fetchJson, RequestError } from "@/lib/fetch-json";

type Destination = "cookbook" | "cook";

export default function ReviewForm({
  recipeId,
  slug,
  initial,
  cookFirst,
}: {
  recipeId: string;
  slug: string;
  initial: Recipe;
  cookFirst: boolean;
}) {
  const router = useRouter();
  const [recipe, setRecipe] = useState<Recipe>(initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set to where the guest was heading when the API asked for an account. It
  // doubles as "the gate is open" and as the retry's destination.
  const [gateThen, setGateThen] = useState<Destination | null>(null);

  const flags = useMemo(() => fieldsNeedingReview(recipe), [recipe]);
  const flagCount = flags.ingredients.length + flags.steps.length;
  const missingQty = recipe.ingredients.filter(
    (i) => i.qty === null && i.unit !== "to_taste" && i.unit !== "as_needed",
  ).length;

  async function save(then: Destination) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recipes/${recipeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rrf: recipe, status: "saved", userEdited: touched }),
      });
      const json: { error?: string; slug?: string; needsAccount?: boolean } = await res.json();
      // A guest reaching for Save is not an error — it's the moment the account
      // is worth asking for. The gate signs them in and calls this again.
      if (res.status === 401 && json.needsAccount) {
        setGateThen(then);
        setBusy(false);
        return;
      }
      if (!res.ok) throw new Error(json.error ?? "Couldn't save that.");
      const finalSlug = json.slug ?? slug;
      router.push(then === "cook" ? `/r/${finalSlug}/cook` : `/r/${finalSlug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that.");
      setBusy(false);
    }
  }

  return (
    <div>
      <Eyebrow rule>Review</Eyebrow>
      <Display size="md" className="mt-4">
        Check it over.
      </Display>

      {(flagCount > 0 || missingQty > 0) && (
        <p className="mt-3 max-w-[52ch] text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {flagCount > 0 && (
            <>
              <span className="data text-[hsl(var(--destructive))]">{flagCount}</span>{" "}
              {flagCount === 1 ? "value came" : "values came"} from speech rather than written text.
              They&rsquo;re marked <span className="data text-[hsl(var(--destructive))]">check</span>.{" "}
            </>
          )}
          {missingQty > 0 && (
            <>
              <span className="data">{missingQty}</span>{" "}
              {missingQty === 1 ? "ingredient has" : "ingredients have"} no stated amount. We left
              them blank rather than guess — fill them in as you cook.
            </>
          )}
        </p>
      )}

      <div className="mt-8">
        <RecipeEditor
          value={recipe}
          onChange={(next) => {
            setRecipe(next);
            setTouched(true);
          }}
        />
      </div>

      <ErrorLine>{error}</ErrorLine>

      {/* Sticky on mobile: the confirm action must never be a scroll away. */}
      <div className="sticky bottom-0 -mx-5 mt-12 flex flex-col gap-3 border-t border-[hsl(var(--border))] bg-[hsl(var(--background)/0.9)] px-5 py-4 backdrop-blur-xl sm:flex-row sm:items-center md:-mx-8 md:px-8">
        {cookFirst ? (
          <>
            <GoldButton disabled={busy} onClick={() => void save("cook")}>
              Save and cook now
            </GoldButton>
            <GhostButton disabled={busy} onClick={() => void save("cookbook")}>
              Just save it
            </GhostButton>
          </>
        ) : (
          <>
            <GoldButton disabled={busy} onClick={() => void save("cookbook")}>
              Save to cookbook
            </GoldButton>
            <GhostButton disabled={busy} onClick={() => void save("cook")}>
              Save and cook now
            </GhostButton>
          </>
        )}
        <span className="data text-[13px] text-[hsl(var(--muted-foreground)/0.7)] sm:ml-auto">
          {touched ? "edited — your version wins" : "unedited draft"}
        </span>
      </div>

      <SaveGate
        open={gateThen !== null}
        onClose={() => setGateThen(null)}
        onSignedIn={() => {
          const then = gateThen ?? "cookbook";
          setGateThen(null);
          // Same save, same destination — the sign-in should read as a pause,
          // not as a step they have to redo.
          void save(then);
        }}
      />
    </div>
  );
}
