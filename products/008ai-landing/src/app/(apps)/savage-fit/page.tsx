import type { Metadata } from "next";
import CalauraApp from "@/components/calaura/CalauraApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/calaura/config";

/**
 * /savage-fit - legacy alias of the merged product.
 *
 * Kept alive (and returning 200) for the release smoke contract; it opens the
 * unified CALauraAI shell on the Fit Bestie half and still reads the cross-loop
 * query string (?bestie=&food=&calories=&from=). /calaura is canonical.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Fit Bestie Voice Coach | 008AI`,
  description:
    "Fit Bestie, the movement half of CALauraAI: talk out loud, let a short graceful session shape the day, and log the burn for the Calorie Bestie. 3 free voice turns, then the 008ai.online Pass.",
  metadataBase: new URL("https://008ai.online"),
  keywords: ["CALauraAI", "Fit Bestie", "AI workout coach", "voice fitness coach", "008AI"],
  alternates: { canonical: "/calaura" },
  openGraph: {
    title: `${APP_NAME} - Fit Bestie`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/calaura",
    siteName: "008AI",
    type: "website",
  },
};

export default function LegacyFitAliasPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <CalauraApp initialBestie="fit" />
    </main>
  );
}
