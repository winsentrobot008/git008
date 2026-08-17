import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { listEntitlements, upsertEntitlement } from "@/lib/orders-store";

export async function GET(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ entitlements: listEntitlements() });
}

/** 手动切换用户权益（on/off） */
export async function PATCH(request: NextRequest) {
  const auth = requireAdmin(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => ({}));
  const email = (body.email || "").toString().trim();
  if (!email) return NextResponse.json({ error: "缺少 email" }, { status: 400 });
  const active = body.has_lifetime_access === true;
  const record = upsertEntitlement(email, active, "manual");
  return NextResponse.json({ ok: true, entitlement: record });
}
