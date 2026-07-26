import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { getLocale } from "@/lib/i18n";
import { isRtl } from "@/lib/i18n/locales";
import "./globals.css";

// Fraunces is the display face — variable optical size, so one font covers a
// 14px eyebrow and a 96px hero without a second cut.
// `weight: "variable"` is required to request custom axes; listing static
// weights alongside them is rejected by next/font.
const display = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  style: ["normal", "italic"],
  axes: ["SOFT", "WONK"],
  variable: "--font-fraunces",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

// Quantities and timers only. Devanagari/Tamil digits fall back to Inter.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Rovelle — From saved reel to lasting recipe",
  description:
    "Rovelle turns the cooking videos you save into a structured cookbook you keep for life. Cook mode built for greasy hands.",
};

export const viewport: Viewport = {
  themeColor: "#0f0d0c",
  // Cook Mode lives at arm's length on a propped phone; browser chrome
  // resizing mid-step is the last thing anyone needs.
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The UI ships in thirteen languages and one of them is right-to-left, so
  // neither of these can be a constant. RTL_LOCALES and isRtl existed and were
  // wired to nothing: Urdu rendered right-to-left text inside a left-to-right
  // layout, announced as English.
  const locale = await getLocale();

  return (
    <html
      lang={locale}
      dir={isRtl(locale) ? "rtl" : "ltr"}
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
