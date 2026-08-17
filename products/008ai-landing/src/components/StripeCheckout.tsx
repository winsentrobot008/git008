"use client";

import { useState } from "react";
import { CreditCard, Loader2 } from "lucide-react";

/**
 * Stripe Checkout 按钮（$19.99 Early Bird Lifetime Pass）
 * - 配置 STRIPE_SECRET_KEY 后创建真实 Checkout 会话并跳转（全英文收银台）；
 * - 未配置时进入演示模式，显式提示不伪造支付。
 */
export default function StripeCheckout({
  amount = 19.99,
  label = "Pay with Card (Stripe)",
}: {
  amount?: number;
  label?: string;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handlePay = async () => {
    if (loading) return;
    setLoading(true);
    setMessage("");
    try {
      const email =
        typeof window !== "undefined"
          ? window.localStorage.getItem("008ai_email") || ""
          : "";
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "支付会话创建失败");
      if (data.mock) {
        setMessage(data.message || "演示模式：未配置 Stripe 密钥");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch (err: any) {
      setMessage(err?.message || "支付失败，请稍后重试");
      setLoading(false);
    }
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={handlePay}
        disabled={loading}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-sm font-bold text-white transition hover:brightness-105 disabled:opacity-60"
      >
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <CreditCard className="h-5 w-5" />}
        {loading ? "Processing…" : label}
      </button>
      {message && <p className="mt-2 text-center text-xs text-ink-soft">{message}</p>}
    </div>
  );
}
