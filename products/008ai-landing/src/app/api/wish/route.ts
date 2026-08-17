import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * POST /api/wish
 *
 * 用户许愿池：接收「希望 008AI 做哪款 AI 工具」的提交，
 * 落盘到 os.tmpdir/008ai-data/wishes.json 并输出日志（生产可替换为数据库/KV）。
 */

const DATA_DIR = path.join(os.tmpdir(), "008ai-data");
const DATA_FILE = path.join(DATA_DIR, "wishes.json");

function appendWish(wish: string): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let list: { wish: string; ts: string }[] = [];
    if (fs.existsSync(DATA_FILE)) {
      try {
        list = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      } catch {
        list = [];
      }
    }
    list.push({ wish, ts: new Date().toISOString() });
    if (list.length > 5000) list = list.slice(-5000);
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    console.error("[008AI Wish] 写入失败:", err);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const wish = (body.wish || "").toString().trim();
  if (!wish) {
    return NextResponse.json({ error: "请输入你想看到的 AI 工具" }, { status: 400 });
  }
  if (wish.length > 500) {
    return NextResponse.json({ error: "愿望描述请控制在 500 字以内" }, { status: 400 });
  }

  appendWish(wish);
  console.log(`[008AI Wish] 收到用户愿望: ${wish}`);

  return NextResponse.json({
    ok: true,
    message: "Wish Received! Thanks for voting.",
  });
}
