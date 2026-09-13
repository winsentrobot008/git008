import type { Metadata } from "next";
import SavageCalApp from "@/components/savage-cal/SavageCalApp";
import { APP_NAME, BRAND_TAGLINE } from "@/lib/savage-cal/config";

/**
 * /savage-cal - Savage Cal AI, App 1 of the Savage Bestie Health Series.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. The recognition pipeline is bridged from the CalorieAI
 * product; this route turns a photo into a FoodScanEvent and hands the roast to
 * Savage Fit AI.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} - Savage Calorie Audit | 008AI`,
  description:
    "Savage Cal AI: snap a plate and the bestie audits the damage on the spot, grades it red / amber / green, then hands a flagged meal to Savage Fit AI to burn off. 2 free scans, then the 008AI Total Health Bundle.",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "Savage Cal AI",
    "AI calorie counter",
    "photo calorie estimate",
    "meal audit",
    "008AI",
  ],
  alternates: { canonical: "/savage-cal" },
  openGraph: {
    title: APP_NAME,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/savage-cal",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: APP_NAME,
    description: "Snap the plate and let the bestie audit it. 008ai.online",
  },
};

export default function SavageCalPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <SavageCalApp />
    </main>
  );
}
