import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
import { cookbookStats } from "@/lib/recipes";
import { importsLeft } from "@/lib/jobs";
import { mode } from "@/lib/sarvam";
import { mediaToolsAvailable } from "@/lib/media";
import { getT } from "@/lib/i18n";
import { Card, Display, Eyebrow, Stat } from "@/components/ui";
import SignOut from "./sign-out";

export const dynamic = "force-dynamic";

const CAPABILITIES = [
  ["extract", "Turning a video into a recipe", "Sarvam-105B"],
  ["stt", "Hearing the voiceover, in any language", "Saaras v3"],
  ["tts", "Speaking answers back while you cook", "Bulbul v3"],
  ["ocr", "Reading text off a photo", "Sarvam Vision"],
  ["translate", "Rendering a recipe in another language", "Sarvam Translate"],
] as const;

/** S9 — Settings and export. */
export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect("/enter");
  const { t } = await getT();

  const stats = cookbookStats(user.id);
  const left = importsLeft(user);
  const canWatch = await mediaToolsAvailable();

  return (
    <Shell active="settings">
      <div className="animate-fade-up max-w-[760px]">
        <Eyebrow rule>You</Eyebrow>
        <Display size="lg" className="mt-5">
          {t("settings.title")}
        </Display>

        <Card className="mt-9 p-6">
          <Eyebrow>{t("settings.account")}</Eyebrow>
          <p className="mt-3 text-[17px] leading-[1.6]">{user.email}</p>
          <p className="data mt-1 text-[14px] text-[hsl(var(--muted-foreground))]">
            {user.plan === "pro" ? "Pro" : "Free"} ·{" "}
            {left === null ? t("settings.unlimited") : `${left} / 5 ${t("import.left")}`}
          </p>
          <SignOut />
        </Card>

        <Card className="mt-5 grid grid-cols-3 divide-x divide-[hsl(var(--border))] p-6">
          <Stat value={stats.recipes} label={t("book.recipes")} />
          <Stat value={stats.cooked} label={t("settings.cooksLogged")} />
          <Stat value={stats.notes} label={t("book.notes")} />
        </Card>

        <Card className="mt-5 p-6">
          <Eyebrow>{t("settings.export")}</Eyebrow>
          <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.65] text-[hsl(var(--muted-foreground))]">
            {t("settings.exportBlurb")}
          </p>
          <a
            href="/api/export"
            className="btn-gold mt-5 inline-flex min-h-[48px] items-center px-6 text-[15px]"
          >
            {t("settings.download")}
          </a>
        </Card>

        <Card className="mt-5 p-6">
          <Eyebrow>{t("settings.capabilities")}</Eyebrow>
          <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.65] text-[hsl(var(--muted-foreground))]">
            Each capability runs against Sarvam or against a local stand-in. The stand-ins do real
            work on real input — they never invent content they don&rsquo;t have.
          </p>
          <ul className="mt-5">
            {CAPABILITIES.map(([key, label, model]) => {
              const live = mode(key) === "live";
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-[hsl(var(--border)/0.6)] py-3 last:border-b-0"
                >
                  <span className="text-[15px]">{label}</span>
                  <span className="data text-[13px]">
                    <span
                      className={
                        live
                          ? "text-[hsl(var(--primary))]"
                          : "text-[hsl(var(--muted-foreground)/0.7)]"
                      }
                    >
                      {live ? t("settings.live") : t("settings.local")}
                    </span>
                    <span className="text-[hsl(var(--muted-foreground)/0.6)]"> · {model}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-4 border-t border-[hsl(var(--border)/0.6)] pt-4 text-[13px] leading-[1.7] text-[hsl(var(--muted-foreground)/0.75)]">
            Downloading videos needs <span className="data">yt-dlp</span> and{" "}
            <span className="data">ffmpeg</span> on the server —{" "}
            <span className={canWatch ? "text-[hsl(var(--primary))]" : "text-[hsl(var(--destructive))]"}>
              {canWatch ? "both present" : "not found"}
            </span>
            . Switch a capability on with{" "}
            <span className="data text-[hsl(var(--primary)/0.9)]">SARVAM_MODE_EXTRACT=live</span> in{" "}
            <span className="data">.env.local</span>, or all with{" "}
            <span className="data text-[hsl(var(--primary)/0.9)]">SARVAM_MODE=live</span>. Credits
            are finite, so there is a per-process ceiling in{" "}
            <span className="data">SARVAM_LIVE_BUDGET</span>.
          </p>
        </Card>

        <Card className="mt-5 p-6">
          <Eyebrow>{t("settings.plan")}</Eyebrow>
          <p className="mt-3 max-w-[54ch] text-[15px] leading-[1.65] text-[hsl(var(--muted-foreground))]">
            {t("settings.planBlurb")} Gating the one action that proves the product works would be
            optimising against the only metric that matters.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
