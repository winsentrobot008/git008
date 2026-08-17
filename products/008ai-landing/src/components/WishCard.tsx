"use client";

import { useState } from "react";
import { Loader2, Sparkles, CheckCircle2 } from "lucide-react";

/**
 * User Wishlist 卡片：提交「希望 008AI 做哪款 AI 工具」→ POST /api/wish。
 */
export default function WishCard() {
  const [wish, setWish] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const text = wish.trim();
    if (!text) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/wish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wish: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "提交失败，请稍后重试");
      setDone(true);
    } catch (err: any) {
      setError(err?.message || "提交失败，请稍后重试");
    }
    setSubmitting(false);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative flex flex-col rounded-3xl border border-pink-200/50 bg-white/70 p-4 shadow-pink-100/50 backdrop-blur-xl transition hover:-translate-y-1 sm:p-6"
    >
      <span className="absolute right-3 top-3 rounded-full border border-pink-200/70 bg-white/80 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-faint backdrop-blur">
        Wishlist
      </span>
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-100 text-pink-600 sm:h-12 sm:w-12 sm:rounded-2xl">
        <Sparkles className="h-5 w-5 sm:h-6 sm:w-6" />
      </span>
      <h3 className="mt-3 text-base font-bold text-ink sm:text-lg">Submit Your AI Wish</h3>
      <p className="mt-1 text-xs leading-relaxed text-ink-soft sm:text-sm">
        Tell us what AI tool you want next. We build the most requested apps.
      </p>

      <div className="mt-auto pt-4">
        {done ? (
          <div className="flex h-11 items-center justify-center gap-2 rounded-full border border-pink-200/70 bg-pink-50 px-3 text-xs font-bold text-pink-600 sm:text-sm">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Wish Received! Thanks for voting.
          </div>
        ) : (
          <>
            <input
              type="text"
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              placeholder="e.g. AI meal planner…"
              maxLength={500}
              className="h-11 w-full rounded-full border border-pink-200/70 bg-white px-4 text-xs text-ink outline-none transition placeholder:text-ink-faint focus:border-pink-400 focus:ring-2 focus:ring-pink-200 sm:text-sm"
            />
            {error && <p className="mt-1.5 text-[11px] text-rose-500">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !wish.trim()}
              className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-3 text-xs font-bold text-white transition hover:brightness-105 disabled:opacity-50 sm:text-sm"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit Wish"}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
