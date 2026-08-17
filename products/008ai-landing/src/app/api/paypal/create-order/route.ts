import { NextRequest, NextResponse } from "next/server";
import { createPayPalOrder, paypalConfigured } from "@/lib/paypal";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const amount = Number(body.amount) > 0 ? Number(body.amount) : 19.99;
  const description =
    (body.description as string) || "008AI Early Bird Lifetime Access";

  // 演示模式：未配置 PayPal 密钥时返回确定性 mock（前端展示演示按钮）
  if (!paypalConfigured()) {
    return NextResponse.json({
      id: `order_demo_${Date.now()}`,
      mock: true,
      amount,
      description,
    });
  }

  try {
    const order = await createPayPalOrder(amount, description);
    return NextResponse.json({ id: order.id, amount, description });
  } catch (error: any) {
    console.error("[008AI PayPal] create-order failed:", error?.message);
    return NextResponse.json({ error: error?.message || "创建订单失败" }, { status: 500 });
  }
}
