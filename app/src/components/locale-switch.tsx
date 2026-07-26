"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { fetchJson, RequestError } from "@/lib/fetch-json";

/**
 * The app's own language. Each option is written in its own script — someone
 * looking for Tamil is looking for "தமிழ்", not for the word "Tamil".
 *
 * Separate from a recipe's language, deliberately: a Tamil speaker cooking an
 * Italian dish wants Tamil buttons and may want the recipe left in English.
 */
export default function LocaleSwitch({ current }: { current: Locale }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <label className="relative">
      <span className="sr-only">Language</span>
      <select
        value={current}
        disabled={pending}
        onChange={(e) => {
          const locale = e.target.value;
          start(async () => {
            await fetch("/api/locale", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ locale }),
            });
            router.refresh();
          });
        }}
        className="min-h-[40px] cursor-pointer rounded-full border border-[hsl(var(--border))] bg-transparent py-0 pl-3.5 pr-8 text-[14px] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/0.5)] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.native}
          </option>
        ))}
      </select>
    </label>
  );
}
