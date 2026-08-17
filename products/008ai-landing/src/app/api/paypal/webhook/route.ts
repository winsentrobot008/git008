import { NextRequest, NextResponse } from "next/server";
import { recordOrder, upsertEntitlement } from "@/lib/orders-store";

/**
 * POST /api/paypal/webhook
 *
 * PayPal 捕获完成事件（PAYMENT.CAPTURE.COMPLETED）→ 落库订单 + 激活终身权益。
 * 幂等：recordOrder 按 orderId 去重，重复事件不会重复入账。
 *
 * 生产建议：启用 PayPal Webhook 签名校验（PAYPAL_WEBHOOK_ID + 证书验证）。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.event_type !== "PAYMENT.CAPTURE.COMPLETED") {
      return NextResponse.json({ received: true, skipped: true });
    }

    const resource = body.resource || {};
    const orderId = resource.id || "";
    if (!orderId) return NextResponse.json({ error: "缺少 capture id" }, { status: 400 });

    const email =
      resource.payment_source?.paypal?.email_address ||
      resource.payer?.email_address ||
      "";
    const amount = Number(resource.amount?.value || 19.99);

    recordOrder({ orderId, email, source: "paypal", amount });
    if (email) upsertEntitlement(email, true, "paypal");

    return NextResponse.json({ received: true });
  } catch (error: any) {
    console.error("[008AI PayPal Webhook]", error?.message);
    return NextResponse.json({ error: error?.message || "webhook 处理失败" }, { status: 500 });
  }
}
