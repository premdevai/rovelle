import { currentAnyUser, importsLeftFor, GUEST_IMPORTS } from "@/lib/guest";
import { Shell } from "@/components/shell";
import { Display, Eyebrow } from "@/components/ui";
import { cookbookStats } from "@/lib/recipes";
import { mode } from "@/lib/sarvam";
import { mediaToolsAvailable } from "@/lib/media";
import { getT } from "@/lib/i18n";
import ImportForm from "./import-form";

export const dynamic = "force-dynamic";

/** S1 — Import. On an empty cookbook, this is the home screen. */
export default async function ImportPage() {
  // Open to anyone. A visitor with no cookie yet gets one the moment they
  // submit — POST /api/import mints the guest, so nothing is created by a
  // page view that never turns into an import.
  const user = await currentAnyUser();
  const { t, dict } = await getT();

  const left = user ? importsLeftFor(user) : GUEST_IMPORTS;
  const empty = user ? cookbookStats(user.id).recipes === 0 : true;
  const canWatch = mode("stt") === "live" && (await mediaToolsAvailable());

  return (
    <Shell active="import">
      <div className="animate-fade-up mx-auto max-w-[760px]">
        <Eyebrow rule>{empty ? "First import" : "New recipe"}</Eyebrow>
        <Display size="lg" className="mt-5">
          {empty ? t("import.firstTitle") : t("import.title")}
        </Display>
        <p className="mt-4 max-w-[46ch] text-[17px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {empty ? t("import.firstSub") : t("import.sub")}
        </p>

        <ImportForm
          dict={dict}
          importsLeft={left}
          ocrLive={mode("ocr") === "live"}
          extractLive={mode("extract") === "live"}
          canWatch={canWatch}
        />
      </div>
    </Shell>
  );
}
