# 008AI — Landing Page (008ai.online)

极简落地页：Vibrant Green (`#4ADE80`) + Slate Gray (`#334155`)，Manrope 字体，
Next.js 16 (App Router) + Tailwind CSS v4。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:3000
```

## 生产构建

```bash
npm run build
npm run start
```

## 环境变量（`.env.local`）

```bash
# PayPal 预购（前端 SDK Client ID + 服务端密钥）
NEXT_PUBLIC_PAYPAL_CLIENT_ID=...
PAYPAL_CLIENT_SECRET=...
PAYPAL_API_URL=https://api-m.sandbox.paypal.com

# Hero 演示视频（15s MP4/GIF，可选；不配置显示占位图）
NEXT_PUBLIC_DEMO_VIDEO_URL=/demo.mp4
```

未配置 PayPal 密钥时按钮进入 Demo 模式（显式提示，不伪造真实支付）。

## 部署

Vercel Import 本目录（`vercel.json` 已内置 Next.js framework/build），
绑定域名 `008ai.online` 并配置上述环境变量即可。
