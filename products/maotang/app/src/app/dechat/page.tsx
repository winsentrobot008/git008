/**
 * `/dechat` - the DeChat deep link.
 *
 * It renders the same controller and bottom navigation as `/` but opens directly on
 * `DeChatPanel`; the engineer/audit toggle still behaves identically on every route.
 */

import type { Metadata } from "next";

import { ConsoleShell } from "@/components/agent-console/ConsoleShell";

const SITE_URL = "https://maotang.008ai.online";
const ALIAS = /^[a-z0-9]{1,32}$/i;
const ADDRESS = /^0x[a-f0-9]{40}$/i;

function referralFrom(value: string | string[] | undefined): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") {
    return null;
  }
  const normalized = candidate.trim().toLowerCase();
  return ALIAS.test(normalized) || ADDRESS.test(normalized) ? normalized : null;
}

function inviterLabel(referral: string): string {
  return ADDRESS.test(referral)
    ? `${referral.slice(0, 6)}...${referral.slice(-4)}`
    : `${referral}.008ai`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const referral = referralFrom((await searchParams).ref);
  const inviter = referral === null ? null : inviterLabel(referral);
  const title =
    inviter === null
      ? "Human Coin MAOTANG | Face ID Genesis Claim"
      : `${inviter} invites you to claim Human Coin (MAOTANG)`;
  const description =
    "8.3B hard cap. Face ID hardware verification gates the testnet faucet. On-chain txHash and confirmation status come from the claim receipt.";
  const shareUrl = `${SITE_URL}/dechat${referral === null ? "" : `?ref=${encodeURIComponent(referral)}`}`;

  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/dechat` },
    openGraph: {
      type: "website",
      url: shareUrl,
      siteName: "MAOTANG",
      locale: "zh_CN",
      alternateLocale: ["en_US"],
      title,
      description,
      images: [
        {
          url: "/dechat/opengraph-image",
          width: 1200,
          height: 630,
          alt: "MAOTANG Human Coin Genesis claim card",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/dechat/opengraph-image"],
    },
  };
}

export default function DeChatPage() {
  return <ConsoleShell initialView="dechat" />;
}
