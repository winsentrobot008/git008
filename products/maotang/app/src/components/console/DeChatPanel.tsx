"use client";

/**
 * DeChat: the ADR-047 decentralized-messaging panel.
 *
 * Two boundaries are deliberate.
 *
 *   - There is no relay in this build. The message list is session memory only, the header says so, and
 *     the panel never calls `fetch`. A later transport can be attached behind the same props without
 *     moving any value-moving logic out of `ConsumerView`.
 *   - A Chat-to-Pay card never authorizes anything. Its one-tap button forwards an English M1 sentence to
 *     `ConsumerView.submit`, which asks the server for a policy preview, opens the confirmation sheet and
 *     only then raises the shared `useBiometricOwner()` assertion. This panel has no signing or
 *     broadcast path of its own.
 */

import { useCallback, useRef, useState } from "react";

import { FingerprintMark } from "@/components/console/BrandMark";
import type { ConsoleBiometricState } from "@/components/console/biometric-view";
import { ClaimCard, type ClaimState } from "@/components/console/ClaimCard";
import { KOLReferralPanel } from "@/components/console/KOLReferralPanel";
import { PaymasterQuota } from "@/components/console/PaymasterQuota";
import { shortHex, type AgentStatus } from "@/lib/agent/client";
import { deriveCommsAlias } from "@/lib/agent/identity";
import type { PaymasterQuotaView } from "@/lib/agent/paymaster-view";
import type { MessageKey } from "@/lib/i18n/dictionary";
import { useLanguage } from "@/lib/i18n/language";
import { trackEvent } from "@/lib/telemetry";

/** The same non-negative decimal grammar the Vault and the M1 translator use. */
const AMOUNT = /^[0-9]+(?:\.[0-9]+)?$/;

/** Coarse buckets only: the funnel needs a shape, not a user's exact transfer value. */
function amountBucket(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "zero";
  if (amount < 0.01) return "under_0.01";
  if (amount < 0.1) return "0.01_0.1";
  if (amount < 1) return "0.1_1";
  return "over_1";
}

type BadgeTone = "verified" | "ready" | "pending" | "unavailable" | "busy";

const BADGE: Readonly<
  Record<BadgeTone, { readonly key: MessageKey; readonly className: string }>
> = {
  verified: {
    key: "dechat.security.verified",
    className: "border-emerald-300/70 bg-emerald-50/85 text-emerald-800",
  },
  ready: {
    key: "dechat.security.ready",
    className: "border-[#ffb6c1]/80 bg-[rgba(255,240,243,0.92)] text-[#8f5568]",
  },
  pending: {
    key: "dechat.security.pending",
    className: "border-amber-300/70 bg-amber-50/85 text-amber-800",
  },
  unavailable: {
    key: "dechat.security.unavailable",
    className: "border-rose-300/70 bg-rose-50/85 text-rose-800",
  },
  busy: {
    key: "dechat.security.busy",
    className: "border-slate-300/70 bg-white/85 text-slate-600",
  },
};

interface DeChatMessage {
  readonly id: string;
  readonly from: "self" | "peer";
  readonly body: string;
  readonly at: number;
}

/**
 * The subset of the shared biometric session the header needs.
 *
 * Re-exported under the old name for compatibility. Passing fields instead of the hook itself keeps
 * this panel presentational and guarantees it cannot enroll, assert or reset a second time behind
 * `ConsumerView`'s back.
 */
export type DeChatBiometricState = ConsoleBiometricState;

export interface DeChatPanelProps {
  /** The live server report, or `null` while the first read is in flight. */
  readonly status: AgentStatus | null;
  /** Why the status read failed, if it did. */
  readonly statusError?: { readonly code: string; readonly reason: string } | null;
  /** True while the shared intent route is answering. */
  readonly busy: boolean;
  /** Derived from the one `useBiometricOwner()` instance in `ConsumerView`. */
  readonly bio: DeChatBiometricState;
  /** Forwards the M1 sentence to `ConsumerView.submit`; never signs or broadcasts here. */
  readonly onPay: (sentence: string) => void;
  /** Absolute `/dechat?ref=<alias>` URL, or `null` until the browser origin is known. */
  readonly shareUrl: string | null;
  /** The `ref` value that brought this visit in, if any. */
  readonly referral: string | null;
  /** The claim request state machine owned by `ConsumerView`. */
  readonly claim: ClaimState;
  /** False while the server-issued claim challenge is still being fetched. */
  readonly claimReady?: boolean;
  /** Forwards the tap; `ConsumerView` raises the one shared Face ID assertion. */
  readonly onClaim: () => void;
  /** The live Paymaster quota read; never a static 100/100. */
  readonly paymasterQuota: PaymasterQuotaView;
  /** Explicit tap that renews the server-sealed personhood record. */
  readonly onRefreshPersonhood?: () => void;
  readonly personhoodRefreshReady?: boolean;
  readonly personhoodRefreshing?: boolean;
}

function badgeTone(bio: DeChatBiometricState): BadgeTone {
  if (bio.busy) {
    return "busy";
  }
  if (bio.userVerified && bio.hardwareBacked) {
    return "verified";
  }
  if (!bio.canAttempt) {
    return "unavailable";
  }
  if (bio.credentialId === null) {
    return "pending";
  }
  return "ready";
}

function PaymentIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 8.5h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="m4 8.5 2.2-3.5h11.6L20 8.5" />
      <path d="M15.5 13.5h4.5" />
      <circle cx="15.5" cy="13.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function DeChatPanel({
  status,
  statusError = null,
  busy,
  bio,
  onPay,
  shareUrl,
  referral,
  claim,
  claimReady = false,
  onClaim,
  paymasterQuota,
  onRefreshPersonhood,
  personhoodRefreshReady = false,
  personhoodRefreshing = false,
}: DeChatPanelProps) {
  const { t } = useLanguage();
  const [messages, setMessages] = useState<readonly DeChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [amount, setAmount] = useState("0.05");
  const sequence = useRef(0);

  const alias = deriveCommsAlias(status?.deployment.owner ?? null);
  const destination = status?.policy.allowedDestinations[0] ?? null;

  const tone = badgeTone(bio);
  const badge = BADGE[tone];
  const canEnroll = tone === "pending" && bio.canAttempt;

  const togglePay = useCallback(() => {
    setPayOpen((open) => {
      if (!open) {
        trackEvent("chat_to_pay_open");
      }
      return !open;
    });
  }, []);

  const trimmedAmount = amount.trim();
  const amountOk = AMOUNT.test(trimmedAmount);
  const payReady = destination !== null && amountOk && !busy;

  const pushMessage = useCallback((from: DeChatMessage["from"], body: string) => {
    sequence.current += 1;
    setMessages((current) => [
      ...current,
      { id: `dechat-${sequence.current}`, from, body, at: Date.now() },
    ]);
  }, []);

  const sendDraft = useCallback(() => {
    const text = draft.trim();
    if (text === "") {
      return;
    }
    pushMessage("self", text);
    setDraft("");
  }, [draft, pushMessage]);

  const handlePay = useCallback(() => {
    if (!payReady || destination === null) {
      return;
    }
    pushMessage(
      "self",
      t("dechat.pay.message", {
        amount: trimmedAmount,
        to: shortHex(destination, 10, 6),
      }),
    );
    setPayOpen(false);
    trackEvent("chat_to_pay_submit", { amount_bucket: amountBucket(trimmedAmount) });
    onPay(`Send ${trimmedAmount} ETH to ${destination}`);
  }, [destination, onPay, payReady, pushMessage, t, trimmedAmount]);

  return (
    <section className="mt-1 rounded-[30px] border border-white/70 bg-[rgba(255,240,243,0.65)] px-4 py-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_2px_6px_rgba(15,23,42,0.06),0_18px_38px_-16px_rgba(15,23,42,0.22),0_44px_80px_-40px_rgba(15,23,42,0.30)] backdrop-blur-2xl">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b06a80]">
            {t("dechat.identityLabel")}
          </p>
          <h1 className="mt-1 break-all font-mono text-[1.15rem] font-semibold leading-tight text-slate-900">
            {alias === null
              ? t("dechat.identityPending")
              : t("dechat.identityValue", { alias })}
          </h1>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-400">
            {t("dechat.identityNote")}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-white/80 bg-white/70 px-2.5 py-1 text-[9.5px] font-medium uppercase tracking-[0.12em] text-[#8f5568]">
          {t("dechat.localOnly")}
        </span>
      </header>

      <PaymasterQuota
        quota={paymasterQuota}
        onRefresh={onRefreshPersonhood}
        refreshReady={personhoodRefreshReady}
        refreshing={personhoodRefreshing}
        className="mt-3"
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canEnroll ? (
          <button
            type="button"
            onClick={bio.onEnroll}
            disabled={bio.busy}
            className={
              "inline-flex min-h-10 touch-manipulation items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium " +
              badge.className
            }
          >
            <FingerprintMark className="h-4 w-4" />
            {t(badge.key)}
          </button>
        ) : (
          <span
            role="status"
            aria-live="polite"
            className={
              "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium " +
              badge.className
            }
          >
            <FingerprintMark className="h-4 w-4" />
            {t(badge.key)}
          </span>
        )}
        <span className="text-[10px] leading-relaxed text-slate-400">
          {t("dechat.security.hint")}
        </span>
      </div>

      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-500">{t("dechat.subtitle")}</p>

      {statusError === null ? null : (
        <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-800">
          <p className="font-medium">
            {t("status.ledgerNotReady")}
            <span className="font-mono">{statusError.code}</span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80">{statusError.reason}</p>
        </div>
      )}

      <ClaimCard
        alias={alias}
        shareUrl={shareUrl}
        referral={referral}
        bio={bio}
        state={claim}
        claimReady={claimReady}
        onClaim={onClaim}
        className="mt-4"
      />

      <KOLReferralPanel alias={alias} className="mt-4" />

      <div className="mt-4 grid gap-2.5" aria-live="polite">
        <article className="rounded-2xl border border-dashed border-[#ffb6c1]/80 bg-[rgba(255,255,255,0.55)] px-3.5 py-3 backdrop-blur-xl">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#b06a80]">
            {t("dechat.preview.badge")}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            {t("dechat.preview.body")}
          </p>
        </article>

        {messages.length === 0 ? (
          <p className="rounded-2xl border border-white/70 bg-white/45 px-4 py-4 text-center text-[11px] text-slate-400">
            {t("dechat.messages.empty")}
          </p>
        ) : null}

        {messages.map((message) => (
          <article
            key={message.id}
            className={
              "max-w-[88%] rounded-2xl px-3.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-xl " +
              (message.from === "self"
                ? "ml-auto border border-[#ffb6c1]/70 bg-[rgba(255,182,193,0.42)] text-slate-800"
                : "mr-auto border border-white/80 bg-white/80 text-slate-700")
            }
          >
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[9.5px] text-slate-400">
              <span>
                {message.from === "self" ? t("dechat.message.you") : t("dechat.message.peer")}
              </span>
              <span className="font-mono">{new Date(message.at).toLocaleTimeString()}</span>
            </p>
            <p className="mt-1 break-words text-[12.5px] leading-relaxed">{message.body}</p>
          </article>
        ))}
      </div>

      {payOpen ? (
        <section className="mt-3 rounded-3xl border border-[#ffb6c1]/80 bg-[rgba(255,240,243,0.88)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_16px_34px_-26px_rgba(224,127,150,0.9)] backdrop-blur-xl">
          <header className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b06a80]">
                {t("dechat.pay.title")}
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">
                {t("dechat.pay.subtitle")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPayOpen(false)}
              className="min-h-10 shrink-0 touch-manipulation rounded-full px-2 text-[10.5px] text-slate-500 transition hover:text-slate-800"
            >
              {t("dechat.pay.close")}
            </button>
          </header>

          <div className="mt-3 rounded-2xl border border-white/80 bg-white/70 px-3 py-2.5">
            <p className="text-[9.5px] uppercase tracking-[0.14em] text-slate-400">
              {t("dechat.pay.to")}
            </p>
            <p className="mt-1 break-all font-mono text-[10.5px] text-slate-700">
              {destination === null ? t("dechat.pay.noDestination") : destination}
            </p>
          </div>

          <label
            htmlFor="dechat-pay-amount"
            className="mt-3 block text-[10.5px] text-slate-500"
          >
            {t("dechat.pay.amount")}
          </label>
          <input
            id="dechat-pay-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            className="mt-1 min-h-12 w-full touch-manipulation rounded-2xl border border-slate-900/10 bg-white/85 px-3.5 font-mono text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900/25"
            placeholder="0.05"
          />
          {trimmedAmount === "" || amountOk ? null : (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-700">
              {t("dechat.pay.amountInvalid")}
            </p>
          )}

          <button
            type="button"
            onClick={handlePay}
            disabled={!payReady}
            className="mt-4 inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/80 bg-slate-900 px-4 text-[13px] font-semibold text-white shadow-[0_10px_26px_-12px_rgba(15,23,42,0.6)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-white/80">
              <FingerprintMark />
            </span>
            {t("dechat.pay.oneTap")}
          </button>
          <p className="mt-2 text-center text-[10px] leading-relaxed text-slate-400">
            {t("dechat.pay.hint")}
          </p>
        </section>
      ) : null}

      <div className="mt-4 rounded-3xl border border-white/80 bg-white/65 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl">
        <label htmlFor="dechat-message" className="sr-only">
          {t("dechat.input.label")}
        </label>
        <div className="flex items-end gap-2">
          <input
            id="dechat-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendDraft();
              }
            }}
            enterKeyHint="send"
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck={false}
            placeholder={t("dechat.input.placeholder")}
            className="min-h-12 min-w-0 flex-1 touch-manipulation rounded-2xl border border-slate-900/10 bg-white/85 px-3.5 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900/25"
          />
          <button
            type="button"
            onClick={togglePay}
            aria-expanded={payOpen}
            aria-label={t("dechat.input.pay")}
            title={t("dechat.input.pay")}
            className="inline-flex min-h-12 min-w-12 touch-manipulation items-center justify-center rounded-2xl border border-[#ffb6c1]/80 bg-[rgba(255,240,243,0.9)] text-[#8f5568] transition hover:bg-[rgba(255,182,193,0.35)] active:scale-[0.95]"
          >
            <PaymentIcon />
          </button>
          <button
            type="button"
            onClick={sendDraft}
            disabled={draft.trim() === ""}
            className="inline-flex min-h-12 touch-manipulation items-center justify-center rounded-2xl border border-white/80 bg-white/90 px-4 text-[12.5px] font-semibold text-slate-900 shadow-[0_8px_20px_-14px_rgba(15,23,42,0.4)] transition hover:bg-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {t("dechat.input.send")}
          </button>
        </div>
      </div>
    </section>
  );
}
