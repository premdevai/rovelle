"use client";

import { useState } from "react";
import type { Note } from "@/lib/rrf";
import { ErrorLine, Eyebrow, GhostButton, GoldButton } from "@/components/ui";
import { makeT, type Dictionary } from "@/lib/i18n/client";
import { fetchJson, RequestError } from "@/lib/fetch-json";

/**
 * The emotional payload of the product. A note is what a competitor's import
 * can't copy even with a perfect export — so it gets room, and gold, and a name.
 */
export default function Notes({
  recipeId,
  initial,
  dict,
}: {
  recipeId: string;
  initial: Note[];
  dict: Dictionary;
}) {
  const t = makeT(dict);
  const [notes, setNotes] = useState(initial);
  const [body, setBody] = useState("");
  const [author, setAuthor] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!body.trim()) return;
    setError(null);
    const res = await fetch(`/api/recipes/${recipeId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, author: author || null }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? t("common.somethingWrong"));
      return;
    }
    setNotes(json.rrf.notes as Note[]);
    setBody("");
    setOpen(false);
  }

  async function remove(noteId: string) {
    setNotes((n) => n.filter((x) => x.id !== noteId));
    await fetch(`/api/recipes/${recipeId}/notes?noteId=${noteId}`, { method: "DELETE" });
  }

  return (
    <section className="mb-10">
      <Eyebrow>{t("recipe.notes")}</Eyebrow>

      {notes.length === 0 && !open && (
        <p className="mt-3 max-w-[48ch] text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground)/0.8)]">
          {t("recipe.notePrompt")}
        </p>
      )}

      <ul className="mt-4 space-y-3">
        {notes.map((n) => (
          <li
            key={n.id}
            className="rounded-[14px] border-l-2 border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.07)] py-4 pl-5 pr-4"
          >
            <p className="max-w-[54ch] whitespace-pre-wrap text-[16px] leading-[1.6]">{n.body}</p>
            <div className="mt-2.5 flex items-baseline gap-4">
              <span className="text-[14px] text-[hsl(var(--primary)/0.9)]">
                {n.author ? `— ${n.author}` : "—"}
              </span>
              <span className="data text-[12px] text-[hsl(var(--muted-foreground)/0.7)]">
                {new Date(n.created_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <button
                onClick={() => void remove(n.id)}
                className="ml-auto min-h-[44px] text-[13px] text-[hsl(var(--muted-foreground)/0.7)] hover:text-[hsl(var(--destructive))]"
              >
                {t("recipe.remove")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {open ? (
        <div className="mt-5">
          <textarea
            autoFocus
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Used jaggery instead of sugar. Better."
            className="w-full resize-y rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--input))] p-4 text-[16px] leading-[1.6] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.55)] focus:border-[hsl(var(--primary))]"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder={t("recipe.noteWho")}
              className="min-h-[44px] max-w-[26ch] flex-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-4 text-[14px] outline-none focus:border-[hsl(var(--primary))]"
            />
            <GoldButton size="md" onClick={() => void add()}>
              {t("recipe.saveNote")}
            </GoldButton>
            <GhostButton size="md" onClick={() => setOpen(false)}>
              {t("recipe.cancel")}
            </GhostButton>
          </div>
          <ErrorLine>{error}</ErrorLine>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-5 min-h-[44px] text-[15px] text-[hsl(var(--muted-foreground))] underline underline-offset-4 transition-colors hover:text-[hsl(var(--primary))]"
        >
          {t("recipe.addNote")}
        </button>
      )}
    </section>
  );
}
