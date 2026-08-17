/**
 * admin-session — 008AI 控制面板服务端会话令牌（文件回退）
 *
 * 登录成功签发随机令牌，/api/admin/* 数据路由必须携带 x-admin-token。
 */

import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

export interface AdminSession {
  token: string;
  created_at: string;
}

const DATA_DIR = path.join(os.tmpdir(), "008ai-data");
const DATA_FILE = path.join(DATA_DIR, "admin-sessions.json");
const TTL_MS = 24 * 60 * 60 * 1000;

function ensureDir(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}

function readStore(): Record<string, AdminSession> {
  ensureDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      return data.sessions || {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

function writeStore(sessions: Record<string, AdminSession>): void {
  ensureDir();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions }, null, 2), "utf-8");
  } catch {
    /* ignore */
  }
}

export function createAdminSession(): AdminSession {
  const session: AdminSession = {
    token: crypto.randomBytes(24).toString("hex"),
    created_at: new Date().toISOString(),
  };
  const sessions = readStore();
  sessions[session.token] = session;
  writeStore(sessions);
  return session;
}

export function isAdminToken(token: string): boolean {
  if (!token) return false;
  const sessions = readStore();
  const session = sessions[token];
  if (!session) return false;
  const age = Date.now() - new Date(session.created_at).getTime();
  if (!Number.isFinite(age) || age > TTL_MS) {
    delete sessions[token];
    writeStore(sessions);
    return false;
  }
  return true;
}
