import type { Metadata } from "next";
import CalauraApp from "@/components/calaura/CalauraApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/calaura/config";

/**
 * /calaura - CALauraAI, the immersive dual-bestie product.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. The intake pipeline is bridged from the CalorieAI product and
 * the movement coach from the voice loop; one page now runs the whole cross-loop:
 *
 *   meal photo -> Calorie Bestie log -> hand-off -> Fit Bestie movement -> back
 *
 * The surface is one animated avatar plus a glass composer; the two besties are
 * moods she switches between, and the cross-loop never shows as a form.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Your AI Bestie for Intake and Movement | 008AI`,
  description:
    "CALauraAI is one AI bestie with a Calorie Bestie and a Fit Bestie inside her: talk, type or send a photo, and she logs the meal, shapes the movement and keeps both halves of the loop in step. Barbie-dream aesthetic, Morandi pink, zero shaming - 2 free photo logs, then the 008AI CALauraAI Bundle.",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "CALauraAI",
    "AI calorie counter",
    "AI fitness coach",
    "dual AI bestie",
    "wellbeing loop",
    "008AI",
  ],
  alternates: { canonical: "/calaura" },
  openGraph: {
    title: `${APP_NAME} · ${BRAND_TAGLINE}`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/calaura",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} - Two besties, one gentle loop`,
    description: "Log a meal, shape the day. 008ai.online",
  },
};

export default function CalauraPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <CalauraApp />
    </main>
  );
}
