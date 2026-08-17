import { NextRequest, NextResponse } from "next/server";
import { createAdminSession } from "@/lib/admin-session";

const ADMIN_KEY = process.env.ADMIN_KEY || "008ai-admin";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const key = (body.key || "").toString();
  if (key !== ADMIN_KEY) {
    return NextResponse.json({ error: "管理员密钥错误" }, { status: 401 });
  }
  const session = createAdminSession();
  return NextResponse.json({ ok: true, token: session.token });
}
