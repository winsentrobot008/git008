import { NextRequest, NextResponse } from "next/server";
import { capturePayPalOrder, paypalConfigured } from "@/lib/paypal";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const orderId = (body.orderId || "").toString();
  if (!orderId) {
    return NextResponse.json({ error: "缺少 orderId" }, { status: 400 });
  }

  if (!paypalConfigured()) {
    return NextResponse.json({
      status: "COMPLETED",
      id: orderId,
      mock: true,
    });
  }

  try {
    const capture = await capturePayPalOrder(orderId);
    return NextResponse.json({
      status: capture.status,
      id: capture.id,
      payer_email: capture.payer?.email_address,
      amount: capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount,
    });
  } catch (error: any) {
    console.error("[008AI PayPal] capture-order failed:", error?.message);
    return NextResponse.json({ error: error?.message || "捕获订单失败" }, { status: 500 });
  }
}
