"use client";

/**
 * PaywallModal - the unified 008AI Total Health Bundle modal.
 *
 * Shared by both gates of the loop: the Savage Fit AI voice tier (3 free turns -
 * fired the moment the last free turn finishes speaking, playback halts) and
 * the CalorieAI photo tier (2 free scans). `gate` only swaps the wording, so the
 * product keeps exactly one subscription surface. The headline offer is the 008AI Total Health Bundle
 * ($19.99/mo | $149.99/yr, see TOTAL_HEALTH_BUNDLE), with the one-time
 * 008ai.online Pass kept as the terminal option because that is what 008ai.online
 * actually sells today - pass holders restore access with their purchase email,
 * verified against the entitlement store.
 */

import { useEffect, useState } from "react";
import { BadgeCheck, Check, Loader2, Lock, Sparkles, X } from "lucide-react";
import { HEALTH_LIMITS, TOTAL_HEALTH_BUNDLE } from "@/lib/shared/health-bus";
import { BRAND_PASS_LABEL } from "@/lib/savage-fit/config";
import type { Persona } from "@/lib/savage-fit/personas";

interface PlanOption {
  id: string;
  label: string;
  price: string;
  cadence: string;
  note: string;
  badge?: string;
}

const BUNDLE = TOTAL_HEALTH_BUNDLE;

/** Price actually charged by the landing page checkout today (one-time). */
const PASS_PRICE = "$19.99";

const PLANS: PlanOption[] = [
  {
    id: "monthly",
    label: `${BUNDLE.label} · Monthly`,
    price: `$${BUNDLE.monthly.toFixed(2)}`,
    cadence: "/ month",
    note: "The whole loop: food audit, voice coach, reel exporter",
  },
  {
    id: "annual",
    label: `${BUNDLE.label} · Annual`,
    price: `$${BUNDLE.annual.toFixed(2)}`,
    cadence: "/ year",
    note: "Two months on us versus monthly",
    badge: BUNDLE.annualBadge,
  },
  {
    id: "pass",
    label: BRAND_PASS_LABEL,
    price: PASS_PRICE,
    cadence: "one-time",
    note: "Live now - one payment, every 008AI app",
  },
];

export interface PaywallModalProps {
  open: boolean;
  onClose: () => void;
  persona: Persona;
  /** Which free tier ran out - drives the badge and headline wording. */
  gate?: "voiceTurns" | "foodScans";
  used: number;
  limit: number;
  /** Called after the entitlement store confirms an active pass. */
  onUnlocked: () => void;
}

export default function PaywallModal({
  open,
  onClose,
  persona,
  gate = "voiceTurns",
  used,
  limit,
  onUnlocked,
}: PaywallModalProps) {
  const [plan, setPlan] = useState("annual");
  const [email, setEmail] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, open]);

  if (!open) return null;

  const selected = PLANS.find((item) => item.id === plan) ?? PLANS[1];
  const gateLabel = gate === "foodScans" ? "food scans" : "voice interactions";
  const heading =
    gate === "foodScans" ? "Unlock unlimited food scans" : `Keep ${persona.name} in your ear`;

  async function restore() {
    const target = email.trim();
    if (!target) {
      setRestoreError("Enter the email you used at checkout.");
      return;
    }
    setRestoring(true);
    setRestoreError(null);
    try {
      const response = await fetch(
        `/api/savage-fit/entitlement?email=${encodeURIComponent(target)}`,
        { headers: { accept: "application/json" } }
      );
      const data = (await response.json()) as { entitled?: boolean; detail?: string };
      if (!response.ok) {
        setRestoreError(data.detail || "Could not verify that email.");
        return;
      }
      if (!data.entitled) {
        setRestoreError("No active pass for that email yet.");
        return;
      }
      setRestored(true);
      onUnlocked();
    } catch {
      setRestoreError("Network error - try again in a moment.");
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-md sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Unlock Savage Fit AI"
    >
      <div className="relative max-h-[100dvh] w-full max-w-[420px] overflow-y-auto rounded-t-[28px] border border-white/70 bg-white/85 shadow-[0_-10px_60px_rgba(236,72,153,0.35)] backdrop-blur-2xl sm:rounded-[28px]">
        <div className={`relative bg-gradient-to-br ${persona.accent.from} ${persona.accent.to} px-6 pb-6 pt-7 text-white`}>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/25 text-white transition hover:bg-white/40"
          >
            <X className="h-4 w-4" />
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/25 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wider">
            <Lock className="h-3 w-3" /> Free {gateLabel} used {used}/{limit}
          </span>
          <h2 className="mt-3 text-2xl font-black leading-tight">{heading}</h2>
          <p className="mt-1.5 text-xs font-medium leading-relaxed text-white/90">
            You used all {limit} free {gateLabel} in this session. The {BUNDLE.label} unlocks the
            whole loop: audit the meal, take the roast, work it off, post the clip.
          </p>
          <p className="mt-2 text-[10px] font-semibold text-white/75">
            Free tier: {HEALTH_LIMITS.voiceTurns} voice turns + {HEALTH_LIMITS.foodScans} photo
            scans per session.
          </p>
        </div>

        <div className="space-y-3 px-5 pb-6 pt-5">
          <ul className="grid gap-1.5 rounded-2xl border border-slate-200/80 bg-white/70 p-3">
            {BUNDLE.includes.map((item) => (
              <li key={item} className="flex items-start gap-1.5 text-[11px] font-semibold text-slate-600">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                {item}
              </li>
            ))}
          </ul>

          <div className="space-y-2">
            {PLANS.map((item) => {
              const active = item.id === plan;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setPlan(item.id)}
                  className={[
                    "flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition",
                    active
                      ? "border-pink-400 bg-pink-50/80 shadow-[inset_0_1px_2px_rgba(255,255,255,0.9)]"
                      : "border-slate-200/80 bg-white/70 hover:border-pink-200",
                  ].join(" ")}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-extrabold text-slate-900">
                      {item.label}
                      {item.badge && (
                        <span className="rounded-full bg-gradient-to-r from-pink-500 to-rose-500 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white">
                          {item.badge}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-slate-500">{item.note}</span>
                  </span>
                  <span className="ml-3 shrink-0 text-right">
                    <span className="block text-lg font-black text-slate-900">{item.price}</span>
                    <span className="block text-[10px] font-semibold text-slate-500">{item.cadence}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <a
            href="/#pricing"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-500 to-rose-500 text-sm font-extrabold text-white shadow-lg shadow-pink-500/30 transition hover:brightness-105"
          >
            <Sparkles className="h-4 w-4" />
            {selected.id === "pass" ? `Get the ${BRAND_PASS_LABEL}` : `Unlock the ${BUNDLE.label}`}
            <span className="text-white/80">
              · {selected.price} {selected.cadence}
            </span>
          </a>

          <p className="text-center text-[10px] leading-relaxed text-slate-500">
            Checkout runs securely on 008ai.online. Subscription billing opens with the wearables
            tier - until then the one-time {BRAND_PASS_LABEL} unlocks the live apps today.
          </p>

          <div className="rounded-2xl border border-slate-200/80 bg-white/70 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700">
              <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" /> Already have a pass?
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@email.com"
                className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-pink-400"
              />
              <button
                type="button"
                onClick={() => void restore()}
                disabled={restoring || restored}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-pink-400 hover:text-pink-600 disabled:opacity-60"
              >
                {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {restored ? "Unlocked" : "Restore"}
              </button>
            </div>
            {restoreError && (
              <p className="mt-2 text-[10px] font-semibold text-rose-500">{restoreError}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full py-1 text-center text-[11px] font-semibold text-slate-500 transition hover:text-slate-700"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}