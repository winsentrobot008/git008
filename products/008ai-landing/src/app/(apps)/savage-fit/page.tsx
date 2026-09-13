import type { Metadata } from "next";
import SavageFitApp from "@/components/savage-fit/SavageFitApp";
import { APP_NAME, APP_NAME_ZH, BRAND_TAGLINE } from "@/lib/savage-fit/config";

/**
 * /savage-fit - Savage Fit AI, App 2 of the Savage Bestie Health Series.
 *
 * Server component: metadata plus the client shell, so nothing browser-specific
 * runs during SSR. Entry context (?food=&calories=&from=savage_cal) is parsed in
 * the client from window.location.search, which is what keeps this route
 * statically prerendered while still opening a roast on arrival.
 */

export const metadata: Metadata = {
  title: `${APP_NAME} ${APP_NAME_ZH} - 毒舌健身闺蜜语音教练 | 008AI`,
  description:
    "毒舌健美闺蜜 AI 语音教练：选闺蜜人格、开口说话，把偷吃的账当场练回来，并导出 9:16 竖屏短片。3 轮免费语音，之后解锁 008ai.online Pass。",
  metadataBase: new URL("https://008ai.online"),
  keywords: [
    "Savage Fit AI",
    "毒舌健美闺蜜",
    "AI 健身教练",
    "语音健身教练",
    "hands-free workout coach",
    "008AI",
  ],
  alternates: { canonical: "/savage-fit" },
  openGraph: {
    title: `${APP_NAME} ${APP_NAME_ZH}`,
    description: BRAND_TAGLINE,
    url: "https://008ai.online/savage-fit",
    siteName: "008AI",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${APP_NAME} ${APP_NAME_ZH}`,
    description: "毒舌健美闺蜜，3 种人格，9:16 短片导出。008ai.online",
  },
};

export default function SavageFitPage() {
  return (
    <main className="min-h-[100dvh] w-full">
      <SavageFitApp />
    </main>
  );
}