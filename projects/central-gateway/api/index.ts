import { handle } from "hono/vercel";
import { app } from "../src/app.js";

/**
 * Vercel Serverless 入口：
 * vercel.json 将 /api/(.*) 路由到此函数，统一端点
 * /api/v1/ai/vision、/api/v1/billing/checkout、/api/v1/credits 原样保留。
 */
export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
