import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/stripe/checkout
 *
 * 008AI Early Bird Lifetime Pass（$19.99 一次性买断）Stripe Checkout 会话。
 * 强制 locale=en 全英文收银台；card 支付（含 Apple Pay / Google Pay 自动识别）。
 */
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const PASS_PRICE_USD = 19.99;

function keysValid(): boolean {
  const s = STRIPE_SECRET_KEY || "";
  const p = STRIPE_PUBLISHABLE_KEY || "";
  return (
    !!s &&
    s !== "YOUR_STRIPE_SECRET_KEY_HERE" &&
    !!p &&
    p !== "YOUR_STRIPE_PUBLISHABLE_KEY_HERE"
  );
}

export async function POST(request: NextRequest) {
  try {
    if (!keysValid()) {
      return NextResponse.json({
        sessionId: `cs_mock_${Date.now()}`,
        url: "/billing/cancel",
        mock: true,
        amount: PASS_PRICE_USD,
        message: "演示模式：未配置 Stripe 密钥，已跳过真实收款",
      });
    }

    const Stripe = (await import("stripe")).default;
    const stripe = new Stripe(STRIPE_SECRET_KEY as string, {
      apiVersion: "2026-06-24.dahlia",
    });
    const body = await request.json().catch(() => ({}));
    const { email } = body;
    const origin =
      request.headers.get("origin") ||
      request.nextUrl.origin ||
      "https://008ai.online";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "en",
      payment_method_types: ["card"],
      payment_method_options: {
        card: { request_three_d_secure: "automatic" },
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "008AI Early Bird Lifetime Pass",
              description: "CalorieAI + Runify + 008AI Suite - one-time $19.99, lifetime access",
            },
            unit_amount: Math.round(PASS_PRICE_USD * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/?payment=success`,
      cancel_url: `${origin}/#pricing`,
      metadata: {
        plan: "early_bird_lifetime",
        amount_usd: String(PASS_PRICE_USD),
        ...(email ? { email } : {}),
      },
      ...(email ? { customer_email: email } : {}),
    });

    if (!session?.url) throw new Error("Stripe 会话创建成功但缺少跳转 URL");
    return NextResponse.json({ sessionId: session.id, url: session.url, amount: PASS_PRICE_USD });
  } catch (error: any) {
    console.error("[008AI Stripe Checkout]", error?.message);
    return NextResponse.json({ error: error?.message || "创建支付会话失败" }, { status: 500 });
  }
}
