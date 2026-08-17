import { NextRequest, NextResponse } from "next/server";
import { isAdminToken } from "./admin-session";

export function requireAdmin(request: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const raw =
    request.headers.get("x-admin-token") ||
    request.headers.get("authorization") ||
    "";
  const token = raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw.trim();
  if (!token || !isAdminToken(token)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "未授权：缺少有效的管理员令牌" }, { status: 401 }),
    };
  }
  return { ok: true };
}
