import { Hono } from "hono";
import type { Context } from "hono";
import { rateLimit } from "../middleware/rate-limit.js";
import type { Variables } from "../middleware/security.js";
import { env } from "../env.js";
import { getCreditPack, resolvePack } from "@git008/commercial-engine/middleware/credit-packs.js";
import { getLocalizedPaymentItem } from "@git008/commercial-engine/middleware/stripe-i18n.js";
import {
  isPlaceholderKey,
  resolvePaymentMethodTypes,
} from "@git008/commercial-engine/middleware/payment-keys.js";

/**
 * POST /api/v1/billing/checkout
 *
 * 统一支付发起端点：Stripe Checkout Session 或 PayPal Order，并透传 app_id。
 * 商业化模式：Credits Top-up（积分充值/按次付费）一次性付款，无订阅、无自动续费。
 *
 * Body: { pack_id: "pack_starter" | "pack_booster" | "pack_power",
 *         plan?: "monthly" | "yearly" | "permanent"（旧字段，自动回退默认包）,
 *         provider: "stripe" | "paypal", payment_method?, user_id?, email?,
 *         locale?, current_lang?, credits?, success_url?, cancel_url? }
 *
 * 价格 / 商品名 / 密钥校验全部来自 @git008/commercial-engine（唯一权威实现）。
 */
const billing = new Hono<{ Variables: Variables }>();

async function createStripeSession(input: {
  appId: string;
  pack: { id: string; credits: number; priceUsd: number };
  paymentMethod?: string;
  userId?: string;
  email?: string;
  credits?: number;
  successUrl?: string;
  cancelUrl?: string;
  locale?: string;
}): Promise<{ sessionId: string; url: string }> {
  if (isPlaceholderKey(env.stripeSecretKey) || isPlaceholderKey(env.stripePublishableKey)) {
    throw new Error("STRIPE_NOT_CONFIGURED");
  }

  const item = getLocalizedPaymentItem(input.pack.id, input.locale || "en");
  const params = new URLSearchParams();
  params.set("mode", "payment"); // Credits Top-up 一次性付款（无订阅）
  params.set("locale", "en");
  params.set(
    "success_url",
    input.successUrl ||
      "https://calorie-ai-seven.vercel.app/billing/success?pack_id=" +
        input.pack.id +
        "&session_id={CHECKOUT_SESSION_ID}"
  );
  params.set("cancel_url", input.cancelUrl || "https://calorie-ai-seven.vercel.app/billing/cancel");
  params.set("line_items[0][quantity]", "1");
  params.set("line_items[0][price_data][currency]", "usd");
  params.set(
    "line_items[0][price_data][unit_amount]",
    String(Math.round(input.pack.priceUsd * 100))
  );
  params.set("line_items[0][price_data][product_data][name]", item.name);
  params.set("line_items[0][price_data][product_data][description]", item.description);
  params.set("metadata[app_id]", input.appId);
  params.set("metadata[pack_id]", input.pack.id);
  params.set("metadata[credits]", String(input.credits ?? input.pack.credits));
  params.set("metadata[amount_usd]", String(input.pack.priceUsd));
  if (input.userId) params.set("metadata[user_id]", input.userId);
  if (input.email) {
    params.set("customer_email", input.email);
    params.set("metadata[email]", input.email);
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(`Stripe API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { id?: string; url?: string };
  if (!data.id || !data.url) throw new Error("Stripe session 创建失败");
  return { sessionId: data.id, url: data.url };
}

async function createPayPalOrder(input: {
  pack: { id: string; credits: number; priceUsd: number };
  locale?: string;
}): Promise<{ orderId: string }> {
  if (isPlaceholderKey(env.paypalClientId) || isPlaceholderKey(env.paypalClientSecret)) {
    throw new Error("PAYPAL_NOT_CONFIGURED");
  }
  const item = getLocalizedPaymentItem(input.pack.id, input.locale || "en");
  const basicAuth = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString("base64");
  const tokenRes = await fetch(`${env.paypalApi}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!tokenRes.ok) throw new Error(`PayPal auth failed: ${tokenRes.status}`);
  const tokenData = (await tokenRes.json()) as { access_token: string };

  const orderRes = await fetch(`${env.paypalApi}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: input.pack.id,
          description: item.description,
          amount: {
            currency_code: "USD",
            value: input.pack.priceUsd.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "USD",
                value: input.pack.priceUsd.toFixed(2),
              },
            },
          },
          items: [
            {
              name: item.name,
              description: item.description,
              unit_amount: {
                currency_code: "USD",
                value: input.pack.priceUsd.toFixed(2),
              },
              quantity: "1",
              category: "DIGITAL_GOODS",
            },
          ],
        },
      ],
      application_context: {
        brand_name: "CalorieAI",
        shipping_preference: "NO_SHIPPING",
        user_action: "PAY_NOW",
      },
    }),
  });
  if (!orderRes.ok) throw new Error(`PayPal order failed: ${orderRes.status}`);
  const order = (await orderRes.json()) as { id: string };
  return { orderId: order.id };
}

billing.post("/checkout", rateLimit(20), async (c: Context<{ Variables: Variables }>) => {
  const appId = c.get("appId");
  const body = await c.req.json().catch(() => ({}));
  const pack = body.pack_id ? getCreditPack(body.pack_id) : resolvePack(body.plan);
  if (!pack) {
    return c.json({ error: "INVALID_PACK", detail: `未知积分包: ${body.pack_id}` }, 400);
  }
  const provider = body.provider || "stripe";
  const locale = body.locale || body.current_lang || "en";

  try {
    if (provider === "paypal") {
      const { orderId } = await createPayPalOrder({ pack, locale });
      return c.json({
        provider: "paypal",
        app_id: appId,
        pack_id: pack.id,
        plan: body.plan || "monthly",
        credits: pack.credits,
        amount: pack.priceUsd,
        orderId,
      });
    }

    const session = await createStripeSession({
      appId,
      pack,
      paymentMethod: body.payment_method,
      userId: body.user_id,
      email: body.email,
      credits: body.credits,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
      locale,
    });
    return c.json({
      provider: "stripe",
      app_id: appId,
      pack_id: pack.id,
      plan: body.plan || "monthly",
      credits: pack.credits,
      amount: pack.priceUsd,
      sessionId: session.sessionId,
      url: session.url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("NOT_CONFIGURED")) {
      return c.json({ error: message, detail: "网关未配置对应支付密钥" }, 503);
    }
    return c.json({ error: "CHECKOUT_FAILED", detail: message.slice(0, 200) }, 502);
  }
});

export default billing;
