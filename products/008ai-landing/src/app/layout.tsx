import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/**
 * Manrope is vendored in src/app/fonts (see fonts/NOTICE.md), so the build is
 * hermetic: next/font/google fetches from fonts.googleapis.com at build time and
 * hard-fails on an offline or network-restricted machine.
 */
const manrope = localFont({
  src: "./fonts/Manrope.woff2",
  weight: "200 800",
  variable: "--font-manrope",
  display: "swap",
});

/**
 * Canonical origin for metadata. Set NEXT_PUBLIC_SITE_URL per environment in
 * Vercel (Production / Preview); it falls back to the live domain when unset, so
 * default behaviour is unchanged. A missing scheme is filled in rather than
 * letting `new URL()` throw at module scope and break the whole build.
 */
function siteOrigin(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (!raw) return "https://008ai.online";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

export const SITE_ORIGIN = siteOrigin();

export const metadata: Metadata = {
  title: "008AI — Bespoke Loop Route Generator",
  description:
    "Stop running the same route every day. 008AI instantly generates bespoke, signal-free loop routes tailored to your target distance.",
  metadataBase: new URL(SITE_ORIGIN),
  keywords: ["008AI", "loop routes", "running", "GPX", "voice navigation"],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "008AI — Bespoke Loop Route Generator",
    description:
      "Instantly generate bespoke, signal-free loop routes tailored to your target distance.",
    url: SITE_ORIGIN,
    siteName: "008AI",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={manrope.variable}>
      <body className="min-h-screen bg-white font-sans text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
