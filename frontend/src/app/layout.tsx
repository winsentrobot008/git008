import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { parseAcceptLanguage } from "@/lib/i18n/dictionary";
import { LanguageProvider } from "@/lib/i18n/language";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAOTANG PERSONAL AI NODE",
  description:
    "Speak your intent. Locally vetted. Biometrically confirmed. A non-custodial edge node protocol: zero-knowledge node verification, in-situ hardware enclave isolation, and a lazy-loaded WebGPU SLM core.",
  applicationName: "MAOTANG",
  // Home Screen (Add to Home Screen) metadata: `capable` is what makes iOS open the console in a
  // standalone window instead of a Safari tab, and the status-bar style keeps the light surface flush
  // with the system chrome rather than dropping a dark bar onto it.
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MAOTANG" },
  formatDetection: { telephone: false, email: false, address: false },
};

/**
 * `viewport-fit=cover` is what makes `env(safe-area-inset-*)` resolve to a real value on iOS; without
 * it the bottom-docked action bar would sit under the home indicator. `themeColor` tints the Safari /
 * Chrome address bar - and, in a Home Screen window, the system status bar - to the light surface the
 * console is drawn on, so the chrome does not cut a dark band across a white page.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eef1f5",
};

/**
 * The root layout.
 *
 * It resolves the first paint's language from `Accept-Language` and hands it to the client provider,
 * which re-resolves from `navigator.language` and any stored choice once running. Doing it here rather
 * than only in an effect is what stops the page from flashing the wrong language at a visitor: the HTML
 * that arrives is already in the language they asked for. Reading a request header opts these routes into
 * dynamic rendering, which is the documented cost of a correct first paint.
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
