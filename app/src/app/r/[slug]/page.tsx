import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentAnyUser } from "@/lib/guest";
import { Shell } from "@/components/shell";
import { getBySlug } from "@/lib/recipes";
import { allSteps, formatDuration, formatQty } from "@/lib/rrf";
import { mode } from "@/lib/sarvam";
import { getT } from "@/lib/i18n";
import {
  Card,
  Display,
  Eyebrow,
  GhostLink,
  GoldLink,
  IconArrow,
  IconClock,
  IconFlame,
  IconServes,
  MetaStat,
} from "@/components/ui";
import Notes from "./notes";
import LanguagePicker from "./language-picker";

export const dynamic = "force-dynamic";

/** S4 — Recipe. The hero card, then ingredients beside the method. */
export default async function RecipePage({ params }: { params: Promise<{ slug: string }> }) {
  // A guest may read and cook what they just made. Keeping it is what
  // needs an account, not using it.
  const user = await currentAnyUser();
  if (!user) redirect("/");
  const { slug } = await params;
  const { t, dict } = await getT();

  const found = getBySlug(user.id, slug);
  if (!found) notFound();
  const r = found.rrf;
  const steps = allSteps(r);
  const groups = [...new Set(r.ingredients.map((i) => i.group))];

  return (
    <Shell active="cookbook" wide>
      <Card ember className="animate-fade-up">
        <div className="grid gap-0 md:grid-cols-[1fr_minmax(280px,42%)]">
        <div className="p-6 md:p-10">
          <Eyebrow rule>
            {r.source.platform === "pasted" || r.source.platform === "manual"
              ? "Added by you"
              : `Sourced from ${r.source.platform}${r.source.handle ? ` · ${r.source.handle}` : ""}`}
          </Eyebrow>

          <Display size="lg" className="mt-6 max-w-[18ch]">
            {r.title}
          </Display>

          {r.summary && (
            <p className="mt-5 max-w-[54ch] text-[16px] leading-[1.65] text-[hsl(var(--muted-foreground))] md:text-[17px]">
              {r.summary}
            </p>
          )}

          <div className="mt-9 flex flex-wrap gap-x-14 gap-y-6">
            <MetaStat label={t("recipe.total")} icon={<IconClock />}>
              {r.time.total_min ? `${r.time.total_min} min` : "—"}
            </MetaStat>
            <MetaStat label={t("recipe.serves")} icon={<IconServes />}>
              {r.servings.amount}
            </MetaStat>
            <MetaStat label={t("recipe.level")} icon={<IconFlame />}>
              <span className="capitalize">{r.difficulty}</span>
            </MetaStat>
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <GoldLink href={`/r/${slug}/cook`}>
              {t("recipe.startCooking")} <IconArrow />
            </GoldLink>
            <GhostLink href={`/r/${slug}/edit`}>{t("recipe.edit")}</GhostLink>
          </div>
        </div>

        {/* The creator's own thumbnail, hotlinked. Absent for a pasted recipe,
            and then the card is simply one column — no grey placeholder box
            pretending a photo exists. */}
        {r.image && (
          <div className="relative min-h-[220px] overflow-hidden md:min-h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={r.image}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(90deg, hsl(var(--card)) 0%, transparent 45%), linear-gradient(0deg, hsl(var(--card)/.5), transparent 40%)",
              }}
            />
          </div>
        )}
        </div>
      </Card>

      <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr] lg:gap-12">
        {/* ——— ingredients ——— */}
        <aside>
          <Card className="p-6">
            <Eyebrow>{t("recipe.ingredients")}</Eyebrow>
            {groups.map((g) => (
              <div key={g} className="mt-5">
                {groups.length > 1 && <div className="eyebrow-muted mb-1">{g}</div>}
                <ul>
                  {r.ingredients
                    .filter((i) => i.group === g)
                    .map((i) => (
                      <li
                        key={i.id}
                        className="flex items-baseline justify-between gap-5 border-b border-[hsl(var(--border)/0.6)] py-3 last:border-b-0"
                      >
                        <span className="text-[15px] leading-[1.45]">
                          {i.name}
                          {i.note && (
                            <span className="text-[hsl(var(--muted-foreground)/0.8)]">
                              {" "}
                              · {i.note}
                            </span>
                          )}
                          {i.optional && (
                            <span className="text-[hsl(var(--muted-foreground)/0.8)]">
                              {" "}
                              · {t("recipe.optional")}
                            </span>
                          )}
                        </span>
                        <span
                          className={`data shrink-0 text-[14px] ${
                            i.qty === null
                              ? "italic text-[hsl(var(--muted-foreground)/0.7)]"
                              : "text-[hsl(var(--primary))]"
                          }`}
                        >
                          {formatQty(i)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </Card>

          {r.tools.length > 0 && (
            <Card className="mt-5 p-6">
              <Eyebrow>{t("recipe.tools")}</Eyebrow>
              <p className="mt-3 text-[15px] leading-[1.7] text-[hsl(var(--muted-foreground))]">
                {r.tools.join(" · ")}
              </p>
            </Card>
          )}

          <Card className="mt-5 p-6">
            <Eyebrow>{t("recipe.source")}</Eyebrow>
            <p className="mt-3 text-[15px] leading-[1.65] text-[hsl(var(--muted-foreground))]">
              {r.source.handle ?? r.source.creator_name ?? "You"}
              <br />
              <span className="data text-[13px] capitalize">{r.source.platform}</span>
              {r.source.url && (
                <>
                  {" · "}
                  <a
                    href={r.source.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-[13px] text-[hsl(var(--primary))] underline underline-offset-4"
                  >
                    {t("recipe.original")}
                  </a>
                </>
              )}
            </p>
            <p className="data mt-4 border-t border-[hsl(var(--border)/0.6)] pt-4 text-[13px] leading-[1.9] text-[hsl(var(--muted-foreground)/0.85)]">
              {r.meta.cooked_count > 0
                ? `${t("recipe.cooked")} ${r.meta.cooked_count}×`
                : "Not cooked yet"}
              {r.meta.last_cooked_at && (
                <>
                  <br />
                  {t("recipe.lastCooked")} {formatDate(r.meta.last_cooked_at)}
                </>
              )}
            </p>
            {/* Export needs an account — a guest clicking these would get a
                raw 401 JSON page, which is the worst kind of dead end. Tell
                them what unlocks it instead of showing a trap. */}
            {user.is_guest === 1 ? (
              <p className="mt-4 border-t border-[hsl(var(--border)/0.6)] pt-4 text-[13px] leading-[1.6] text-[hsl(var(--muted-foreground)/0.85)]">
                Sign in to export this, and to keep it in your cookbook.
              </p>
            ) : (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-[hsl(var(--border)/0.6)] pt-4 text-[13px]">
              <a
                href={`/api/export?slug=${slug}`}
                className="text-[hsl(var(--muted-foreground))] underline underline-offset-4 hover:text-[hsl(var(--primary))]"
              >
                {t("recipe.exportJson")}
              </a>
              <a
                href={`/api/export?slug=${slug}&format=md`}
                className="text-[hsl(var(--muted-foreground))] underline underline-offset-4 hover:text-[hsl(var(--primary))]"
              >
                {t("recipe.exportMd")}
              </a>
            </div>
            )}
          </Card>

          <LanguagePicker
            recipeId={found.row.id}
            live={mode("translate") === "live"}
            label={t("recipe.readIn")}
          />
        </aside>

        {/* ——— method ——— */}
        <article>
          {r.phases.map((phase) => (
            <section key={phase.id} className="mb-10">
              <div className="flex items-baseline justify-between gap-4">
                <Eyebrow>{phase.name}</Eyebrow>
                {phaseMinutes(phase) && (
                  <span className="data text-[12px] text-[hsl(var(--muted-foreground)/0.7)]">
                    {phaseMinutes(phase)}
                  </span>
                )}
              </div>
              <ol className="mt-4">
                {phase.steps.map((s) => {
                  const n = steps.findIndex((x) => x.id === s.id) + 1;
                  const facts = [
                    formatDuration(s.duration_s),
                    s.temperature_c !== null ? `${s.temperature_c} °C` : null,
                    s.heat,
                    s.vessel,
                  ].filter(Boolean);
                  return (
                    <li key={s.id} className="flex gap-5 py-4">
                      <span className="data w-6 shrink-0 pt-1 text-[13px] text-[hsl(var(--primary)/0.8)]">
                        {String(n).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <p className="max-w-[62ch] text-[16px] leading-[1.6] md:text-[17px]">
                          {s.text}
                        </p>
                        {facts.length > 0 && (
                          <p className="data mt-2 text-[12px] text-[hsl(var(--muted-foreground)/0.75)]">
                            {facts.join(" · ")}
                          </p>
                        )}
                        {s.doneness_cue && (
                          <p className="mt-2 text-[14px] italic leading-[1.5] text-[hsl(var(--primary)/0.85)]">
                            {t("cook.doneWhen")}: {s.doneness_cue}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}

          {r.storage && (
            <section className="mb-10">
              <Eyebrow>{t("recipe.storage")}</Eyebrow>
              <p className="mt-3 max-w-[62ch] text-[16px] leading-[1.65] text-[hsl(var(--muted-foreground))]">
                {r.storage}
              </p>
            </section>
          )}

          <Notes recipeId={found.row.id} initial={r.notes} dict={dict} />
        </article>
      </div>

      {/* Always reachable. Full-width on mobile, floating on desktop. */}
      <Link
        href={`/r/${slug}/cook`}
        className="btn-gold fixed inset-x-4 bottom-4 z-40 flex min-h-[60px] items-center justify-center gap-2 text-[17px] md:inset-x-auto md:bottom-8 md:right-8 md:px-9"
      >
        {t("recipe.startCooking")} <IconArrow />
      </Link>
    </Shell>
  );
}

function phaseMinutes(phase: { steps: Array<{ duration_s: number | null }> }) {
  const total = phase.steps.reduce((a, s) => a + (s.duration_s ?? 0), 0);
  return total ? formatDuration(total) : null;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
