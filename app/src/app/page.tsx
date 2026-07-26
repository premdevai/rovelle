import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { cookbookStats } from "@/lib/recipes";
import { GhostLink, LivePill } from "@/components/ui";
import { getT } from "@/lib/i18n";
import { mode } from "@/lib/sarvam";
import { mediaToolsAvailable } from "@/lib/media";
import ImportForm from "./import/import-form";

export const dynamic = "force-dynamic";

/**
 * The landing hero — and the product.
 *
 * A visitor who has just been sent a reel by a friend can paste it here and
 * watch it become a recipe without ever meeting a sign-in screen. The account
 * is asked for at the only moment it earns the interruption: when they try to
 * keep what they made (see components/save-gate).
 *
 * Signed-in cooks never see this — they go straight to their cookbook, or to
 * the import field if the cookbook is empty. First-run ends in Cook Mode, not
 * a dashboard (PRD R7).
 */
export default async function Home() {
  const user = await currentUser();
  if (user) redirect(cookbookStats(user.id).recipes === 0 ? "/import" : "/cookbook");

  const { dict } = await getT();
  const canWatch = mode("stt") === "live" && (await mediaToolsAvailable());

  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* The warm ember wash behind the type. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-ember)" }}
      />

      <div className="relative mx-auto max-w-[1240px] px-5 py-7 md:px-10 md:py-8">
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="font-display grid h-10 w-10 place-items-center rounded-full text-[16px] text-[hsl(var(--primary-foreground))]"
              style={{ background: "var(--gradient-gold)" }}
            >
              R
            </span>
            <div>
              <div className="font-display text-[20px] leading-none">Rovelle</div>
              <div className="eyebrow-muted mt-1 text-[9px]">· EST</div>
            </div>
          </div>
          {/* Returning cooks only. Nobody needs this to start. */}
          <GhostLink href="/enter" size="md">
            Sign in
          </GhostLink>
        </header>

        <section className="animate-fade-up max-w-[820px] pb-24 pt-12 md:pt-20">
          <LivePill>Now parsing Instagram, TikTok &amp; YouTube</LivePill>

          <h1 className="font-display mt-8 text-[40px] leading-[0.95] sm:text-[46px] md:mt-10 md:text-[72px] lg:text-[84px]">
            From saved reel
            <br />
            to <span className="text-gold italic">lasting</span>
            <br />
            recipe.
          </h1>

          <p className="mt-7 max-w-[52ch] text-[16px] leading-[1.65] text-[hsl(var(--muted-foreground))] md:mt-8 md:text-[18px]">
            Paste a link. We download it, listen to it in whatever language it was filmed in, and
            pull out the ingredients, timings and steps — then guide you through dinner one clear
            move at a time, so you can talk to the recipe while your hands are covered.
          </p>

          <ImportForm
            dict={dict}
            variant="hero"
            // A guest has no quota to count down, so don't invent one.
            importsLeft={null}
            ocrLive={mode("ocr") === "live"}
            extractLive={mode("extract") === "live"}
            canWatch={canWatch}
            note="No account needed. Sign in later to keep it."
          />

          <p className="mt-7 text-[13px] text-[hsl(var(--muted-foreground)/0.75)] md:text-[14px]">
            Free for 5 imports a month. No credit card.
          </p>
        </section>
      </div>
    </main>
  );
}
