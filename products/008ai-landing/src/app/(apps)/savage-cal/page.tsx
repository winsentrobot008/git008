import type { Metadata } from "next";
import AuraFitApp from "@/components/aura-fit/AuraFitApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/aura-fit/config";

/**
 * /savage-cal - legacy alias of the merged product.
 *
 * The route is kept alive (and returns 200) because the release smoke contract
 * still probes it, but it now opens the unified Aura Fit shell on the Calorie
 * Bestie half. /aura-fit is the canonical URL.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Calorie Bestie Intake Log | 008AI`,
  description:
    "Calorie Bestie, the intake half of Aura Fit: snap a plate, log it kindly, and see how the day is shaping. 2 free logs, then the 008AI Aura Fit Bundle.",
  metadataBase: new URL("https://008ai.online"),
  keywords: ["Aura Fit", "Calorie Bestie", "AI calorie counter", "photo calorie estimate", "008AI"],
  alternates: { canonical: "/aura-fit" },
  openGraph: {
    title: `${APP_NAME} - Calorie Bestie`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/aura-fit",
    siteName: "008AI",
    type: "website",
  },
};

export default function SavageCalAliasPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <AuraFitApp initialBestie="calorie" />
    </main>
  );
}
