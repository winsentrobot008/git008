"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "";
const IS_DEMO =
  !CLIENT_ID || CLIENT_ID === "YOUR_PAYPAL_CLIENT_ID_HERE" || CLIENT_ID === "demo";

interface PayPalCheckoutProps {
  amount?: number;
  description?: string;
  buttonLabel?: string;
  compact?: boolean;
}

/**
 * PayPal 预购按钮（008AI Early Bird $19.99 一次性买断）
 * - 配置 NEXT_PUBLIC_PAYPAL_CLIENT_ID 后渲染真实 PayPal 按钮（create/capture 走服务端 API）；
 * - 未配置时渲染演示按钮 + 提示，不静默伪造支付。
 */
export default function PayPalCheckout({
  amount = 19.99,
  description = "008AI Early Bird Lifetime Access",
  buttonLabel = "Buy with PayPal",
  compact = false,
}: PayPalCheckoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    if (IS_DEMO) return;
    let cancelled = false;
    const scriptId = "paypal-sdk-008ai";

    const renderButton = () => {
      if (cancelled || !containerRef.current || typeof window === "undefined") return;
      const paypal = (window as any).paypal;
      if (!paypal) return;

      paypal
        .Buttons({
          style: {
            layout: "vertical",
            color: "gold",
            shape: "rect",
            label: "pay",
            height: 48,
          },
          createOrder: async () => {
            setStatus("loading");
            setMessage("");
            const res = await fetch("/api/paypal/create-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ amount, description }),
            });
            const data = await res.json();
            if (!res.ok || !data.id) throw new Error(data.error || "Failed to create order");
            return data.id;
          },
          onApprove: async (data: { orderID: string }) => {
            const res = await fetch("/api/paypal/capture-order", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId: data.orderID }),
            });
            const cap = await res.json();
            if (!res.ok) throw new Error(cap.error || "Payment capture failed");
            if (cap.status !== "COMPLETED") throw new Error(`Unexpected payment status: ${cap.status}`);
            setStatus("success");
            setMessage("Payment successful — welcome to 008AI! 🎉");
          },
          onError: (err: any) => {
            setStatus("error");
            setMessage(err?.message || "Payment failed, please try again.");
          },
        })
        .render(containerRef.current);
    };

    if (document.getElementById(scriptId)) {
      renderButton();
      return () => {
        cancelled = true;
      };
    }

    const script = document.createElement("script");
    script.id = scriptId;
    // 显式 locale=en_US：英文站点下 PayPal 按钮文案 100% 英文，
    // 避免浏览器语言导致“用 PayPal 付款”等本地化默认字样。
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(
      CLIENT_ID
    )}&currency=USD&intent=capture&components=buttons&locale=en_US`;
    script.async = true;
    script.onload = renderButton;
    document.body.appendChild(script);

    return () => {
      cancelled = true;
    };
  }, [amount, description]);

  if (status === "success") {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-brand-deep/30 bg-brand-soft px-4 py-4 text-sm font-semibold text-brand-deep">
        <CheckCircle2 className="h-5 w-5 shrink-0" />
        {message}
      </div>
    );
  }

  return (
    <div className={compact ? "mx-auto w-full max-w-sm" : "w-full"}>
      {IS_DEMO ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setDemoOpen((v) => !v)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ffc439] px-6 text-[15px] font-bold text-[#111418] transition hover:brightness-95"
          >
            {status === "loading" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              buttonLabel
            )}
          </button>
          {demoOpen && (
            <p className="rounded-xl bg-ink-soft/10 px-4 py-3 text-xs leading-relaxed text-ink-soft">
              Demo mode: connect <code className="font-mono">NEXT_PUBLIC_PAYPAL_CLIENT_ID</code>{" "}
              to enable live PayPal checkout. Early Bird pre-orders open soon.
            </p>
          )}
        </div>
      ) : (
        <div ref={containerRef} className="min-h-[48px] w-full" />
      )}
      {status === "loading" && (
        <p className="mt-2 flex items-center justify-center gap-2 text-xs text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" /> Processing payment…
        </p>
      )}
      {status === "error" && (
        <p className="mt-2 flex items-center justify-center gap-2 text-xs text-red-500">
          <XCircle className="h-4 w-4 shrink-0" /> {message}
        </p>
      )}
    </div>
  );
}
