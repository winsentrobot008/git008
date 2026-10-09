import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAOTANG (猫糖) — Meme-first DEX",
  description:
    "Launch memes on a deterministic bonding curve and graduate them into an open market at 100% of the raise target.",
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}