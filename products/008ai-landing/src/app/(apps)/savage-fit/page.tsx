import type { Metadata } from "next";
import AuraFitApp from "@/components/aura-fit/AuraFitApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/aura-fit/config";

/**
 * /savage-fit - legacy alias of the merged product.
 *
 * Kept alive (and returning 200) for the release smoke contract; it opens the
 * unified Aura Fit shell on the Fit Bestie half and still reads the cross-loop
 * query string (?bestie=&food=&calories=&from=). /aura-fit is canonical.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Fit Bestie Voice Coach | 008AI`,
  description:
    "Fit Bestie, the movement half of Aura Fit: talk out loud, let a short graceful session shape the day, and log the burn for the Calorie Bestie. 3 free voice turns, then the 008ai.online Pass.",
  metadataBase: new URL("https://008ai.online"),
  keywords: ["Aura Fit", "Fit Bestie", "AI workout coach", "voice fitness coach", "008AI"],
  alternates: { canonical: "/aura-fit" },
  openGraph: {
    title: `${APP_NAME} - Fit Bestie`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/aura-fit",
    siteName: "008AI",
    type: "website",
  },
};

export default function SavageFitAliasPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <AuraFitApp initialBestie="fit" />
    </main>
  );
}
