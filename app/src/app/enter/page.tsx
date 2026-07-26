import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { Display } from "@/components/ui";
import EnterForm from "./enter-form";

export const dynamic = "force-dynamic";

/** S10 — Auth. Email OTP, no password. */
export default async function EnterPage() {
  if (await currentUser()) redirect("/");
  const { t, dict } = await getT();

  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-5 py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-ember)" }}
      />
      <div className="animate-fade-up relative w-full max-w-[460px]">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="font-display grid h-11 w-11 place-items-center rounded-full text-[17px] text-[hsl(var(--primary-foreground))]"
            style={{ background: "var(--gradient-gold)" }}
          >
            R
          </span>
          <Display size="md" as="h1">
            Rovelle
          </Display>
        </div>

        <p className="mt-6 text-[16px] leading-[1.6] text-[hsl(var(--muted-foreground))]">
          {t("auth.tagline")}
        </p>

        <div className="card mt-10 p-6 md:p-8">
          <EnterForm dict={dict} />
        </div>

        <p className="mt-6 text-center text-[13px] text-[hsl(var(--muted-foreground)/0.75)]">
          {t("auth.noPassword")}
        </p>
      </div>
    </main>
  );
}
