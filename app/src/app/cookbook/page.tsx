import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { cookbookStats, listRecipes } from "@/lib/recipes";
import { getT } from "@/lib/i18n";
import { Card, Display, Eyebrow, Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

/** S8 — Cookbook. Default sort is last cooked: how you cook, not how you hoard. */
export default async function CookbookPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/enter");
  const { q, sort } = await searchParams;
  const { t } = await getT();

  const stats = cookbookStats(user.id);
  if (stats.recipes === 0) redirect("/import");

  const recipes = listRecipes(user.id, {
    q,
    sort: sort === "added" || sort === "title" ? sort : "cooked",
  });

  return (
    <Shell active="cookbook" wide>
      <div className="animate-fade-up">
        <Eyebrow rule>The archive</Eyebrow>
        <Display size="lg" className="mt-5 max-w-[16ch]">
          Build the cookbook you&rsquo;ll <span className="text-gold italic">keep</span> for life.
        </Display>

        <Card className="mt-10 grid grid-cols-3 divide-x divide-[hsl(var(--border))] p-7 md:p-9">
          <Stat value={stats.recipes} label={t("book.recipes")} />
          <Stat value={stats.cooked} label="times cooked" />
          <Stat value={stats.notes} label={t("book.notes")} />
        </Card>

        <form className="mt-8 flex flex-wrap items-center gap-3">
          <input
            name="q"
            type="search"
            defaultValue={q ?? ""}
            placeholder={t("book.search")}
            className="min-h-[48px] min-w-[16ch] flex-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--input))] px-5 text-[15px] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground)/0.6)] focus:border-[hsl(var(--primary))]"
          />
          <label className="flex items-center gap-2 text-[14px] text-[hsl(var(--muted-foreground))]">
            <span className="sr-only sm:not-sr-only">{t("book.sort")}</span>
            <select
              name="sort"
              defaultValue={sort ?? "cooked"}
              className="min-h-[48px] rounded-full border border-[hsl(var(--border))] bg-transparent px-4 text-[14px] outline-none focus:border-[hsl(var(--primary))]"
            >
              <option value="cooked">{t("book.sortCooked")}</option>
              <option value="added">{t("book.sortAdded")}</option>
              <option value="title">{t("book.sortTitle")}</option>
            </select>
          </label>
          <button className="btn-ghost min-h-[48px] px-6 text-[14px]">{t("book.apply")}</button>
        </form>

        {recipes.length === 0 ? (
          <p className="mt-12 text-[16px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
            {t("book.noMatch")} &ldquo;{q}&rdquo;.{" "}
            <Link href="/cookbook" className="text-[hsl(var(--primary))] underline underline-offset-4">
              {t("book.clear")}
            </Link>
          </p>
        ) : (
          <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recipes.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/r/${r.slug}`}
                  className="card group flex h-full flex-col overflow-hidden transition-transform duration-300 hover:-translate-y-0.5 hover:border-[hsl(var(--primary)/0.35)]"
                >
                  {r.thumbnail && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnail}
                      alt=""
                      loading="lazy"
                      className="h-36 w-full object-cover"
                    />
                  )}
                  <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-[19px] leading-[1.25] transition-colors group-hover:text-[hsl(var(--primary))]">
                      {r.title}
                    </h2>
                    {r.status === "draft" && (
                      <span className="eyebrow-muted shrink-0 rounded-full border border-[hsl(var(--destructive)/0.4)] px-2 py-0.5 text-[9px] text-[hsl(var(--destructive))]">
                        {t("book.draft")}
                      </span>
                    )}
                  </div>
                  <p className="data mt-auto pt-5 text-[12px] leading-[1.7] text-[hsl(var(--muted-foreground)/0.85)]">
                    {r.cookedCount > 0 ? `Cooked ${r.cookedCount}×` : t("book.notCooked")}
                    {r.totalMin ? ` · ${r.totalMin} min` : ""}
                    {r.noteCount > 0 ? ` · ${r.noteCount} ${t("book.notes")}` : ""}
                    {r.lastCookedAt
                      ? ` · ${new Date(r.lastCookedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                      : ""}
                  </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
