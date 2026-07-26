import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isLocale } from "@/lib/i18n/locales";

/** Sets the UI language cookie. A recipe's own language is a separate setting. */
export async function POST(req: Request) {
  const { locale } = (await req.json()) as { locale: string };
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "We don't speak that one yet." }, { status: 400 });
  }
  (await cookies()).set("rovelle_locale", locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true });
}
