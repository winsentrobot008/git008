import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { DEFAULT_LANGUAGE } from "@/lib/i18n/dictionary";
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
 * It no longer reads `Accept-Language`: the console is the global English edition, so the HTML is
 * rendered once and served to everyone, and `中文` is an explicit in-app choice. Dropping the header
 * read also takes these routes out of dynamic rendering, which is what lets `/` and `/agent` open from
 * static HTML inside an Add-to-Home-Screen window.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LANGUAGE}>
      <body className="min-h-screen antialiased">
        <LanguageProvider initialLanguage={DEFAULT_LANGUAGE}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
