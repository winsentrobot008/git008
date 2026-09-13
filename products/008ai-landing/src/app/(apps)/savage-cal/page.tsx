import type { Metadata } from "next";
import SavageCalApp from "@/components/savage-cal/SavageCalApp";
import { APP_NAME, APP_NAME_ZH, BRAND_TAGLINE } from "@/lib/savage-cal/config";

/**
 * /savage-cal - Savage Cal AI, App 1 of the Savage Bestie Health Series.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. The recognition pipeline is bridged from the CalorieAI
 * product; this route turns a photo into a FoodScanEvent and hands the roast to
 * Savage Fit AI.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} ${APP_NAME_ZH} - 毒舌卡路里审计 | 008AI`,
  description:
    "毒舌卡路里闺蜜 AI：拍一张照片，她当场审你的热量并给出红黄绿评级；被标红就直接交给毒舌健美闺蜜开练。2 次免费识别，之后解锁 008AI Total Health Bundle。",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "Savage Cal AI",
    "毒舌卡路里闺蜜",
    "AI 热量识别",
    "拍照识别热量",
    "AI calorie counter",
    "008AI",
  ],
  alternates: { canonical: "/savage-cal" },
  openGraph: {
    title: `${APP_NAME} ${APP_NAME_ZH}`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/savage-cal",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} ${APP_NAME_ZH}`,
    description: "拍下这一餐，让毒舌闺蜜审你。008ai.online",
  },
};

export default function SavageCalPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <SavageCalApp />
    </main>
  );
}