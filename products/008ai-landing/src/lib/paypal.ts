/**
 * paypal — 008AI 预购订单服务端封装（Sandbox / Live 自动切换）
 *
 * 未配置 PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET 时返回 mock 模式，
 * 前端展示演示按钮，不静默伪造真实支付。
 */

const CLIENT_ID = process.env.PAYPAL_CLIENT_ID || "";
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET || "";
const PAYPAL_API = process.env.PAYPAL_API_URL || "https://api-m.sandbox.paypal.com";

export function paypalConfigured(): boolean {
  return (
    !!CLIENT_ID &&
    CLIENT_ID !== "YOUR_PAYPAL_CLIENT_ID_HERE" &&
    !!CLIENT_SECRET &&
    CLIENT_SECRET !== "YOUR_PAYPAL_CLIENT_SECRET_HERE"
  );
}

async function getAccessToken(): Promise<string> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal auth failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.access_token;
}

export async function createPayPalOrder(amount: number, description: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description,
          amount: {
            currency_code: "USD",
            value: amount.toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal order creation failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export async function capturePayPalOrder(orderId: string): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PayPal capture failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}
