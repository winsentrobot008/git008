import { Hono } from "hono";
import { cors } from "hono/cors";
import { env, isOriginAllowed } from "./env.js";
import { securityMiddleware, type Variables } from "./middleware/security.js";
import vision from "./routes/vision.js";
import billing from "./routes/checkout.js";
import credits from "./routes/credits.js";

/**
 * 中央网关 Hono 应用（自托管 Node server 与 Vercel serverless 共用同一实例）。
 */
export const app = new Hono<{ Variables: Variables }>();

// 全局 CORS：动态白名单（精确地址 + *. 通配符，含 GATEWAY_APP_ORIGINS 按应用追加）
app.use(
  "*",
  cors({
    origin: (origin) => (origin && isOriginAllowed(origin) ? origin : ""),
    allowHeaders: ["Content-Type", "Authorization", "x-app-id", "x-app-token", "x-app-key"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);

// /api 下所有端点强制 App-Token 鉴权 + CORS 白名单校验
app.use("/api/*", securityMiddleware);

app.get("/health", (c) =>
  c.json({ status: "ok", service: env.serviceName, version: env.version, apps: Object.keys(env.appRegistry) })
);

// ── 统一标准端点 ──
app.route("/api/v1/ai", vision);        // POST /api/v1/ai/vision
app.route("/api/v1/billing", billing);  // POST /api/v1/billing/checkout
app.route("/api/v1", credits);          // GET/POST /api/v1/credits

app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
