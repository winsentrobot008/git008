import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { parseAcceptLanguage } from "@/lib/i18n/dictionary";
import { LanguageProvider } from "@/lib/i18n/language";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAOTANG (猫糖) - Decentralized Mobile AI Agent OS",
  description:
    "A non-custodial edge node protocol: zero-knowledge node verification, in-situ hardware enclave isolation, and a lazy-loaded WebGPU SLM core.",
};

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to a real value on iOS; without
 * it the bottom-docked chat bar would sit under the home indicator. `themeColor` tints the Safari /
 * Chrome address bar to the console's ink so the docked bar reads as part of the page.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a12",
};

/**
 * The root layout resolves the first paint's language from `Accept-Language` and hands it to the client
 * provider, which re-resolves from `navigator.language` and any stored choice once running. Doing it here
 * rather than only in an effect is what stops the page from flashing Chinese at an English visitor (and
 * the reverse): the HTML that arrives is already in the right language. Reading a request header opts
 * these routes into dynamic rendering, which is the documented cost of a correct first paint.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const requested = (await headers()).get("accept-language");
  const language = parseAcceptLanguage(requested);

  return (
    <html lang={language === "zh" ? "zh-CN" : "en"}>
      <body className="min-h-screen antialiased">
        <LanguageProvider initialLanguage={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}