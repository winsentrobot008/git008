import type { Metadata } from "next";
import SavageFitApp from "@/components/savage-fit/SavageFitApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/savage-fit/config";

/**
 * /savage-fit - Savage Fit AI, App 2 of the Savage Bestie Health Series.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. Entry context (?food=&calories=&from=savage_cal) is parsed in
 * the client from window.location.search, which is what keeps this route
 * statically prerendered while still opening a roast on arrival.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Hands-free Voice Workout Coach | 008AI`,
  description:
    "Savage Fit AI voice coach: pick a bestie persona, talk out loud, burn off what you ate on the spot, and export a 9:16 clip. 3 free voice turns, then the 008ai.online Pass.",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "Savage Fit AI",
    "AI workout coach",
    "voice fitness coach",
    "hands-free workout coach",
    "008AI",
  ],
  alternates: { canonical: "/savage-fit" },
  openGraph: {
    title: APP_NAME,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/savage-fit",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: "Bestie personas, hands-free coaching, 9:16 clip export. 008ai.online",
  },
};

export default function SavageFitPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <SavageFitApp />
    </main>
  );
}
