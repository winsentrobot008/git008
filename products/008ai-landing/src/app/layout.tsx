import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

export const metadata: Metadata = {
  title: "008AI — Bespoke Loop Route Generator",
  description:
    "Stop running the same route every day. 008AI instantly generates bespoke, signal-free loop routes tailored to your target distance.",
  metadataBase: new URL("https://008ai.online"),
  keywords: ["008AI", "loop routes", "running", "GPX", "voice navigation"],
  icons: {
    icon: "/favicon.ico",
  },
  openGraph: {
    title: "008AI — Bespoke Loop Route Generator",
    description:
      "Instantly generate bespoke, signal-free loop routes tailored to your target distance.",
    url: "https://008ai.online",
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
