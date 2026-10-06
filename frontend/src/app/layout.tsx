import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAOTANG (猫糖) — Meme-first DEX",
  description:
    "Launch memes on a deterministic bonding curve and graduate them into an open market at 100% of the raise target.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}