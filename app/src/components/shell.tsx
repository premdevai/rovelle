import Link from "next/link";
import { getT } from "@/lib/i18n";
import { currentUser } from "@/lib/auth";
import LocaleSwitch from "./locale-switch";
import { cx } from "./ui";

/**
 * App chrome. A monogram, a thin nav, a language switch.
 *
 * The whole surface is dark and warm — there is no light mode. The ambient
 * gradient lives on <body> so it stays put while pages scroll under it.
 */
export async function Shell({
  children,
  active,
  wide,
}: {
  children: React.ReactNode;
  active?: "cookbook" | "import" | "settings";
  wide?: boolean;
}) {
  const { t, locale } = await getT();
  const user = await currentUser();

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-40 border-b border-[hsl(var(--border)/0.6)] bg-[hsl(var(--background)/0.72)] backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-3.5 md:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span
              aria-hidden
              className="font-display grid h-9 w-9 place-items-center rounded-full text-[15px] text-[hsl(var(--primary-foreground))]"
              style={{ background: "var(--gradient-gold)" }}
            >
              R
            </span>
            <span className="font-display text-[19px] leading-none">Rovelle</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex">
            <Tab href="/cookbook" on={active === "cookbook"}>
              {t("nav.cookbook")}
            </Tab>
            <Tab href="/import" on={active === "import"}>
              {t("nav.import")}
            </Tab>
            <Tab href="/settings" on={active === "settings"}>
              {t("nav.settings")}
            </Tab>
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitch current={locale} />
            {!user && (
              <Link
                href="/enter"
                className="btn-gold inline-flex min-h-[40px] items-center px-5 text-[14px]"
              >
                {t("nav.signIn")}
              </Link>
            )}
          </div>
        </div>

        {/* Mobile nav — the desktop row would wrap and look broken at 360. */}
        <nav className="flex items-center gap-1 border-t border-[hsl(var(--border)/0.5)] px-4 py-1.5 md:hidden">
          <Tab href="/cookbook" on={active === "cookbook"}>
            {t("nav.cookbook")}
          </Tab>
          <Tab href="/import" on={active === "import"}>
            {t("nav.import")}
          </Tab>
          <Tab href="/settings" on={active === "settings"}>
            {t("nav.settings")}
          </Tab>
        </nav>
      </header>

      <main
        className={cx(
          "mx-auto px-5 pb-28 pt-8 md:px-8 md:pt-14",
          wide ? "max-w-[1240px]" : "max-w-[1100px]",
        )}
      >
        {children}
      </main>
    </div>
  );
}

function Tab({ href, on, children }: { href: string; on?: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={cx(
        "rounded-full px-3.5 py-2 text-[14px] transition-colors",
        on
          ? "bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
          : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * The asymmetric split from the prototype: content left-weighted, meta right.
 * One column below 768 — on a phone the rail becomes a section, not a sliver.
 */
export function TwoColumn({
  children,
  rail,
}: {
  children: React.ReactNode;
  rail: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-10 md:grid-cols-[1fr_340px] md:gap-14">
      <div className="min-w-0">{children}</div>
      <aside className="min-w-0">{rail}</aside>
    </div>
  );
}

export { Eyebrow } from "./ui";
