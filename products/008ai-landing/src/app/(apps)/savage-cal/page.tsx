import type { Metadata } from "next";
import CalauraApp from "@/components/calaura/CalauraApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/calaura/config";

/**
 * /savage-cal - legacy alias of the merged product.
 *
 * The route is kept alive (and returns 200) because the release smoke contract
 * still probes it, but it now opens the unified CALauraAI shell on the Calorie
 * Bestie half. /calaura is the canonical URL.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Calorie Bestie Intake Log | 008AI`,
  description:
    "Calorie Bestie, the intake half of CALauraAI: snap a plate, log it kindly, and see how the day is shaping. 2 free logs, then the 008AI CALauraAI Bundle.",
  metadataBase: new URL("https://008ai.online"),
  keywords: ["CALauraAI", "Calorie Bestie", "AI calorie counter", "photo calorie estimate", "008AI"],
  alternates: { canonical: "/calaura" },
  openGraph: {
    title: `${APP_NAME} - Calorie Bestie`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/calaura",
    siteName: "008AI",
    type: "website",
  },
};

export default function LegacyCalorieAliasPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <CalauraApp initialBestie="calorie" />
    </main>
  );
}
