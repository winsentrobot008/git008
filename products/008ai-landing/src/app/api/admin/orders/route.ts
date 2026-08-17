import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listOrders } from "@/lib/orders-store";

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ orders: listOrders() });
}
