import { serve } from "@hono/node-server";
import { env } from "./env.js";
import { app } from "./app.js";

/**
 * 自托管入口（Node server）。
 * Vercel serverless 入口见 api/index.ts。
 */
const server = serve(
  { fetch: app.fetch, port: env.port },
  (info) => {
    console.log(
      `[Central Gateway] listening on http://127.0.0.1:${info.port} (apps: ${Object.keys(env.appRegistry).join(", ")})`
    );
  }
);

export { app, server };
