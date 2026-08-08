import type { Context, MiddlewareHandler } from "hono";
import { env, isRegisteredApp, isOriginAllowed } from "../env.js";

export type Variables = {
  appId: string;
};

/**
 * 安全中间件：
 *   1. CORS 动态白名单校验（支持精确地址与 *. 通配）——仅允许已注册套娃前端 Origin；
 *   2. App-Token 校验——Authorization: Bearer <token> 或 x-app-token / x-app-key 头；
 *      根据 token 反查 app_id，并与 x-app-id 头比对（可选强校验）。
 */
export const securityMiddleware: MiddlewareHandler = async (c: Context<{ Variables: Variables }>, next) => {
  const origin = c.req.header("origin") || "";

  // 非浏览器调用（无 Origin）也允许，但必须通过 App-Token 鉴权；
  // 浏览器调用必须命中动态白名单（精确地址或通配符）。
  if (origin && !isOriginAllowed(origin)) {
    return c.json({ error: "ORIGIN_NOT_ALLOWED", detail: "跨域调用来源不在白名单内" }, 403);
  }

  const bearer = c.req.header("authorization") || "";
  const appToken = bearer.startsWith("Bearer ")
    ? bearer.slice(7).trim()
    : c.req.header("x-app-token") || c.req.header("x-app-key") || "";
  if (!appToken) {
    return c.json({ error: "UNAUTHORIZED", detail: "缺少 App-Token / Bearer Token" }, 401);
  }

  // 根据 App-Token 反查 app_id
  const matched = Object.entries(env.appRegistry).find(([, token]) => token === appToken);
  if (!matched) {
    return c.json({ error: "INVALID_APP_TOKEN", detail: "App-Token 无效" }, 401);
  }

  const appIdFromToken = matched[0];
  const declaredAppId = c.req.header("x-app-id") || "";
  if (declaredAppId && declaredAppId !== appIdFromToken) {
    return c.json({ error: "APP_ID_MISMATCH", detail: "x-app-id 与 App-Token 不匹配" }, 403);
  }
  if (!isRegisteredApp(appIdFromToken)) {
    return c.json({ error: "APP_NOT_REGISTERED", detail: `应用 ${appIdFromToken} 未注册` }, 403);
  }

  c.set("appId", appIdFromToken);
  await next();
};
