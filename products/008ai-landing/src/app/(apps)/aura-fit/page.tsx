import type { Metadata } from "next";
import AuraFitApp from "@/components/aura-fit/AuraFitApp";
import { APP_NAME, APP_NAME_ZH, BRAND_TAGLINE } from "@/lib/aura-fit/config";

/**
 * /aura-fit - Aura Fit, the merged dual-bestie product.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. The intake pipeline is bridged from the CalorieAI product and
 * the movement coach from the voice loop; one page now runs the whole cross-loop:
 *
 *   meal photo -> Calorie Bestie log -> hand-off -> Fit Bestie movement -> back.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Dual-Bestie Wellbeing Loop | 008AI`,
  description:
    "Aura Fit pairs a Calorie Bestie and a Fit Bestie in one gentle loop: log a meal with a photo, then let the Fit Bestie shape a short session around it - and back again. Barbie-core calm, no shaming, 2 free logs then the 008AI Aura Fit Bundle.",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "Aura Fit",
    "AI calorie counter",
    "AI fitness coach",
    "dual AI bestie",
    "wellbeing loop",
    "008AI",
  ],
  alternates: { canonical: "/aura-fit" },
  openGraph: {
    title: `${APP_NAME} · ${APP_NAME_ZH}`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/aura-fit",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} - Two besties, one gentle loop`,
    description: "Log a meal, shape the day. 008ai.online",
  },
};

export default function AuraFitPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <AuraFitApp />
    </main>
  );
}
