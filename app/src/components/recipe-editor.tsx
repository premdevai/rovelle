"use client";

import { useMemo, useState } from "react";
import {
  fieldsNeedingReview,
  formatQty,
  newStep,
  Unit,
  type Ingredient,
  type Recipe,
  type Step,
} from "@/lib/rrf";
import { Card, Eyebrow } from "./ui";

/**
 * The editable recipe. Used by S3 (review a fresh import) and S5 (edit later).
 *
 * Everything is a live field. Click a value, type, done — no modal, no
 * separate edit mode. Low-confidence values carry a `check` mark; missing
 * quantities render blank and never, ever as a fabricated number.
 */

const UNITS = Unit.options;

export default function RecipeEditor({
  value,
  onChange,
}: {
  value: Recipe;
  onChange: (next: Recipe) => void;
}) {
  const flags = useMemo(() => fieldsNeedingReview(value), [value]);
  const flagged = useMemo(
    () => new Set([...flags.ingredients, ...flags.steps]),
    [flags],
  );

  const set = (patch: Partial<Recipe>) => onChange({ ...value, ...patch });

  const setIngredient = (id: string, patch: Partial<Ingredient>) =>
    set({ ingredients: value.ingredients.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  const setStep = (phaseId: string, stepId: string, patch: Partial<Step>) =>
    set({
      phases: value.phases.map((p) =>
        p.id !== phaseId
          ? p
          : { ...p, steps: p.steps.map((s) => (s.id === stepId ? { ...s, ...patch } : s)) },
      ),
    });

  const groups = [...new Set(value.ingredients.map((i) => i.group))];

  return (
    <div>
      {/* ——— headline ——— */}
      <input
        aria-label="Recipe title"
        value={value.title}
        onChange={(e) => set({ title: e.target.value })}
        className="field font-display text-[28px] leading-[1.05] md:text-[40px]"
      />
      <input
        aria-label="One-line description"
        value={value.summary}
        placeholder="One line on what this actually is"
        onChange={(e) => set({ summary: e.target.value })}
        className="field mt-3 text-[16px] leading-[1.5] text-[hsl(var(--muted-foreground))] md:text-[20px]"
      />

      {/* ——— the numbers row ——— */}
      <div className="mt-8 flex flex-wrap gap-x-10 gap-y-5 rounded-[14px] border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/0.4)] p-5">
        <Num
          label="Serves"
          value={value.servings.amount}
          onChange={(n) => set({ servings: { ...value.servings, amount: Math.max(1, n || 1) } })}
        />
        <Num
          label="Prep min"
          value={value.time.prep_min}
          onChange={(n) => set({ time: { ...value.time, prep_min: n } })}
        />
        <Num
          label="Cook min"
          value={value.time.cook_min}
          onChange={(n) => set({ time: { ...value.time, cook_min: n } })}
        />
        <Num
          label="Total min"
          value={value.time.total_min}
          onChange={(n) => set({ time: { ...value.time, total_min: n } })}
        />
        <div>
          <Eyebrow>Level</Eyebrow>
          <select
            aria-label="Difficulty"
            value={value.difficulty}
            onChange={(e) => set({ difficulty: e.target.value as Recipe["difficulty"] })}
            className="field mt-1 text-[16px]"
          >
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="involved">involved</option>
          </select>
        </div>
        <div className="min-w-[10ch]">
          <Eyebrow>Cuisine</Eyebrow>
          <input
            aria-label="Cuisine"
            value={value.cuisine ?? ""}
            placeholder="unstated"
            onChange={(e) => set({ cuisine: e.target.value || null })}
            className="field mt-1 text-[16px]"
          />
        </div>
      </div>

      {/* ——— ingredients ——— */}
      <Card className="mt-10 p-6">
        <Eyebrow>Ingredients</Eyebrow>
        {groups.map((g) => (
          <div key={g} className="mt-6">
            {groups.length > 1 && <Eyebrow>{g}</Eyebrow>}
            <ul className="mt-2">
              {value.ingredients
                .filter((i) => i.group === g)
                .map((i) => (
                  <li
                    key={i.id}
                    className="grid grid-cols-[5.5rem_5.5rem_1fr_auto] items-baseline gap-x-3 gap-y-1 border-b border-[hsl(var(--border))] py-3 md:grid-cols-[5rem_6rem_1fr_auto]"
                  >
                    <input
                      aria-label={`Quantity for ${i.name}`}
                      inputMode="decimal"
                      value={i.qty ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        const n = e.target.value.trim();
                        setIngredient(i.id, { qty: n === "" ? null : Number(n) || null });
                      }}
                      className={`field data text-[15px] ${flagged.has(i.id) ? "needs-check" : ""}`}
                    />
                    <select
                      aria-label={`Unit for ${i.name}`}
                      value={i.unit ?? ""}
                      onChange={(e) =>
                        setIngredient(i.id, { unit: (e.target.value || null) as Ingredient["unit"] })
                      }
                      className="field data text-[15px] text-[hsl(var(--muted-foreground))]"
                    >
                      <option value="">—</option>
                      {UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u === "to_taste" ? "to taste" : u === "as_needed" ? "as needed" : u}
                        </option>
                      ))}
                    </select>
                    <div className="min-w-0">
                      <input
                        aria-label="Ingredient name"
                        value={i.name}
                        onChange={(e) => setIngredient(i.id, { name: e.target.value })}
                        className="field text-[16px]"
                      />
                      <input
                        aria-label={`Note for ${i.name}`}
                        value={i.note ?? ""}
                        placeholder="note"
                        onChange={(e) => setIngredient(i.id, { note: e.target.value || null })}
                        className="field text-[14px] text-[hsl(var(--muted-foreground)/0.7)]"
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      {flagged.has(i.id) && <CheckMark />}
                      <button
                        aria-label={`Remove ${i.name}`}
                        title="Remove"
                        onClick={() =>
                          set({ ingredients: value.ingredients.filter((x) => x.id !== i.id) })
                        }
                        className="min-h-[44px] px-2 text-[hsl(var(--muted-foreground)/0.7)] hover:text-[hsl(var(--destructive))]"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <button
          onClick={() =>
            set({
              ingredients: [
                ...value.ingredients,
                {
                  id: `ing_${Date.now()}`,
                  name: "",
                  qty: null,
                  unit: null,
                  note: null,
                  group: groups[0] ?? "main",
                  optional: false,
                  confidence: 1,
                },
              ],
            })
          }
          className="mt-4 min-h-[44px] text-[15px] text-[hsl(var(--muted-foreground)/0.7)] underline underline-offset-4 hover:text-[hsl(var(--muted-foreground))]"
        >
          Add an ingredient
        </button>
      </Card>

      {/* ——— method ——— */}
      <Card className="mt-6 p-6">
        <Eyebrow>Method</Eyebrow>
        {value.phases.map((phase) => (
          <div key={phase.id} className="mt-8">
            <input
              aria-label="Phase name"
              value={phase.name}
              onChange={(e) =>
                set({
                  phases: value.phases.map((p) =>
                    p.id === phase.id ? { ...p, name: e.target.value } : p,
                  ),
                })
              }
              className="field eyebrow"
            />
            <ol className="mt-3">
              {phase.steps.map((s, n) => (
                <li key={s.id} className="border-b border-[hsl(var(--border))] py-4">
                  <div className="flex gap-4">
                    <span className="data w-6 shrink-0 pt-1 text-[13px] text-[hsl(var(--muted-foreground)/0.7)]">
                      {String(n + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <textarea
                        aria-label={`Step ${n + 1}`}
                        value={s.text}
                        rows={Math.max(1, Math.ceil(s.text.length / 70))}
                        onChange={(e) => setStep(phase.id, s.id, { text: e.target.value })}
                        className={`field resize-none text-[16px] leading-[1.55] ${
                          flagged.has(s.id) ? "needs-check" : ""
                        }`}
                      />
                      {/* The two fields a cook asks about mid-step and no
                          recipe site ever records: what it happens in, and
                          how you know it is ready. */}
                      <div className="mt-2 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                        <input
                          aria-label="Vessel"
                          value={s.vessel ?? ""}
                          placeholder="in what — kadai, oven, blender"
                          onChange={(e) => setStep(phase.id, s.id, { vessel: e.target.value || null })}
                          className="field text-[14px] text-[hsl(var(--muted-foreground))]"
                        />
                        <input
                          aria-label="Doneness cue"
                          value={s.doneness_cue ?? ""}
                          placeholder="ready when — oil separates, edges pull away"
                          onChange={(e) =>
                            setStep(phase.id, s.id, { doneness_cue: e.target.value || null })
                          }
                          className="field text-[14px] italic text-[hsl(var(--primary)/0.85)]"
                        />
                      </div>

                      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
                        <MiniNum
                          label="min"
                          value={s.duration_s === null ? null : Math.round(s.duration_s / 60)}
                          onChange={(n) =>
                            setStep(phase.id, s.id, { duration_s: n === null ? null : n * 60 })
                          }
                        />
                        <MiniNum
                          label="°C"
                          value={s.temperature_c}
                          onChange={(n) => setStep(phase.id, s.id, { temperature_c: n })}
                        />
                        <select
                          aria-label="Heat"
                          value={s.heat ?? ""}
                          onChange={(e) =>
                            setStep(phase.id, s.id, {
                              heat: (e.target.value || null) as Step["heat"],
                            })
                          }
                          className="field data w-auto text-[13px] text-[hsl(var(--muted-foreground))]"
                        >
                          <option value="">heat —</option>
                          {(["low", "medium-low", "medium", "medium-high", "high"] as const).map(
                            (h) => (
                              <option key={h} value={h}>
                                {h}
                              </option>
                            ),
                          )}
                        </select>
                        <label className="flex items-center gap-1.5 text-[13px] text-[hsl(var(--muted-foreground))]">
                          <input
                            type="checkbox"
                            checked={!s.hands_on}
                            onChange={(e) => setStep(phase.id, s.id, { hands_on: !e.target.checked })}
                            className="accent-[hsl(var(--primary))]"
                          />
                          can walk away
                        </label>
                        {flagged.has(s.id) && <CheckMark />}
                        <button
                          onClick={() =>
                            set({
                              phases: value.phases
                                .map((p) =>
                                  p.id === phase.id
                                    ? { ...p, steps: p.steps.filter((x) => x.id !== s.id) }
                                    : p,
                                )
                                .filter((p) => p.steps.length > 0),
                            })
                          }
                          className="ml-auto min-h-[44px] text-[13px] text-[hsl(var(--muted-foreground)/0.7)] hover:text-[hsl(var(--destructive))]"
                        >
                          Remove step
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            <button
              onClick={() =>
                set({
                  phases: value.phases.map((p) =>
                    p.id !== phase.id
                      ? p
                      : {
                          ...p,
                          steps: [
                            ...p.steps,
                            newStep({ id: `st_${Date.now()}`, text: "" }),
                          ],
                        },
                  ),
                })
              }
              className="mt-3 min-h-[44px] text-[15px] text-[hsl(var(--muted-foreground)/0.7)] underline underline-offset-4 hover:text-[hsl(var(--muted-foreground))]"
            >
              Add a step
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            set({
              phases: [
                ...value.phases,
                {
                  id: `ph_${Date.now()}`,
                  name: "New phase",
                  steps: [newStep({ id: `st_${Date.now() + 1}`, text: "" })],
                },
              ],
            })
          }
          className="mt-8 min-h-[44px] text-[15px] text-[hsl(var(--muted-foreground)/0.7)] underline underline-offset-4 hover:text-[hsl(var(--muted-foreground))]"
        >
          Add a phase
        </button>
      </Card>

      {/* ——— storage ——— */}
      <Card className="mt-6 p-6">
        <Eyebrow>Storage</Eyebrow>
        <textarea
          aria-label="Storage"
          rows={2}
          value={value.storage ?? ""}
          placeholder="How long it keeps, and how"
          onChange={(e) => set({ storage: e.target.value || null })}
          className="field mt-3 resize-y text-[16px] leading-[1.55]"
        />
      </Card>

      {/* ——— attribution: visible, never editable (PRD §6.5) ——— */}
      <Card className="mt-6 p-6">
        <Eyebrow>Source</Eyebrow>
        <p className="mt-2 text-[15px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {value.source.handle ?? value.source.creator_name ?? "You"} ·{" "}
          <span className="data">{value.source.platform}</span>
          {value.source.url && (
            <>
              {" · "}
              <a
                href={value.source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-4"
              >
                original
              </a>
            </>
          )}
        </p>
      </Card>
    </div>
  );
}

// ——— bits ——————————————————————————————————————————————————

function CheckMark() {
  return (
    <span
      className="data rounded-full border border-[hsl(var(--destructive)/0.5)] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[hsl(var(--destructive))]"
      title="Taken from speech — worth confirming"
    >
      check
    </span>
  );
}

function Num({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <div className="min-w-[7ch]">
      <Eyebrow>{label}</Eyebrow>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const t = e.target.value.trim();
          onChange(t === "" ? null : Number(t.replace(/\D/g, "")) || null);
        }}
        className="field data mt-1 text-[16px]"
      />
    </div>
  );
}

function MiniNum({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  return (
    <label className="flex items-baseline gap-1.5">
      <input
        aria-label={label}
        inputMode="numeric"
        value={value ?? ""}
        placeholder="—"
        onChange={(e) => {
          const t = e.target.value.trim();
          onChange(t === "" ? null : Number(t.replace(/[^\d.-]/g, "")) || null);
        }}
        className="field data w-[4ch] text-[13px]"
      />
      <span className="data text-[13px] text-[hsl(var(--muted-foreground)/0.7)]">{label}</span>
    </label>
  );
}

export { formatQty };
