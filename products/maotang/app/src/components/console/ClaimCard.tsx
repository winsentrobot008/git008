"use client";

/**
 * The cold-start social card: identity, QR/deep link and a Face ID-gated claim request.
 *
 * The card never calls the biometric hook and never mints anything. `ConsumerView` owns the one
 * shared session, asks the device for a server-issued assertion and posts the resulting WebAuthn
 * response to `/api/agent/claim`; the route verifies it and submits the on-chain faucet claim.
 *
 * The state shown below is therefore a real transaction: `txHash` comes from the faucet broadcast and
 * the pending/confirmed/failed transition comes from `/api/agent/claim/status` polling. A missing or
 * unconfigured faucet is an error code, never a fabricated balance or a pending ticket. The X and
 * Telegram buttons seal a server receipt for the bonus; that receipt records share intent and does
 * not assert that a platform published the post.
 */

import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import type { ConsoleBiometricState } from "@/components/console/biometric-view";
import { FingerprintMark } from "@/components/console/BrandMark";
import {
  readShareUnlock,
  sealShareIntent,
  type ShareUnlockState,
} from "@/lib/growth/client";
import {
  SHARE_BOOST_BPS,
  multiplierLabel,
  previewRewardLabel,
  shareComposerUrl,
  type SharePlatform,
} from "@/lib/growth/rules";
import { useLanguage } from "@/lib/i18n/language";

export type ClaimChainStatus = "pending" | "confirmed" | "failed";

/** The claim state machine owned by `ConsumerView`. */
export type ClaimState =
  | { readonly phase: "idle" }
  | { readonly phase: "authorizing" }
  | { readonly phase: "settling" }
  | {
      readonly phase: "onchain";
      readonly txHash: string;
      readonly chainStatus: ClaimChainStatus;
      readonly explorerUrl: string | null;
      readonly reward: string;
      readonly symbol: string;
      readonly chainId: number | null;
      readonly blockNumber: number | null;
    }
  | { readonly phase: "error"; readonly code: string };

export interface ClaimCardProps {
  /** The manifest-derived comms alias, without the `.008ai` suffix. */
  readonly alias: string | null;
  /** Absolute `/dechat?ref=<alias>` URL. `null` until the browser origin and identity are known. */
  readonly shareUrl: string | null;
  /** The `ref` value from the deep link, if this visit arrived through a shared card. */
  readonly referral: string | null;
  /** The shared biometric session fields, passed down from `ConsumerView`. */
  readonly bio: ConsoleBiometricState;
  readonly state: ClaimState;
  /** False while the server-issued claim challenge is still being fetched. */
  readonly claimReady?: boolean;
  /** Forwards the tap to `ConsumerView`, which calls `session.authorize` without an intervening await. */
  readonly onClaim: () => void;
  readonly className?: string;
}

function QrGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
      <path d="M14.5 14.5h2.5v2.5h-2.5zM19.5 14.5H21v2.5M14.5 19.5H21" />
    </svg>
  );
}

export function ClaimCard({
  alias,
  shareUrl,
  referral,
  bio,
  state,
  claimReady = false,
  onClaim,
  className = "",
}: ClaimCardProps) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [sharePhase, setSharePhase] = useState<
    "loading" | "locked" | "sealing" | "unlocked" | "error"
  >("loading");
  const [shareUnlock, setShareUnlock] = useState<ShareUnlockState | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharePlatform, setSharePlatform] = useState<SharePlatform | null>(null);

  const identity = alias === null ? null : `${alias}.008ai`;
  const onchain = state.phase === "onchain" ? state : null;
  const busy = state.phase === "authorizing" || state.phase === "settling" || bio.busy;
  const canEnroll = alias !== null && bio.platformAuthenticator && bio.credentialId === null;
  const canClaim = alias !== null && bio.platformAuthenticator && bio.credentialId !== null;
  const canRetry = onchain === null || onchain.chainStatus === "failed";
  const canShare =
    shareUrl !== null && identity !== null && bio.credentialId !== null && onchain === null && !busy;
  const boostLabel = multiplierLabel(SHARE_BOOST_BPS);
  const bonusPreview = shareUnlock?.bonusReward ?? previewRewardLabel(SHARE_BOOST_BPS);
  const shareMinutes = Math.max(1, Math.ceil((shareUnlock?.receiptTtlSeconds ?? 0) / 60));

  useEffect(() => {
    if (bio.credentialId === null) {
      setSharePhase("locked");
      return;
    }
    const controller = new AbortController();
    void readShareUnlock(controller.signal).then((next) => {
      if (controller.signal.aborted) {
        return;
      }
      if (next?.unlocked === true) {
        setShareUnlock(next);
        setSharePhase("unlocked");
        return;
      }
      setShareUnlock(null);
      setSharePhase("locked");
    });
    return () => controller.abort();
  }, [bio.credentialId]);

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = useCallback(async () => {
    if (shareUrl === null || typeof navigator === "undefined" || navigator.clipboard === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [shareUrl]);

  const beginShare = useCallback((platform: SharePlatform) => {
    if (!canShare) {
      return;
    }
    setSharePlatform(platform);
    setShareError(null);
    setSharePhase("sealing");
    void sealShareIntent(platform)
      .then((next) => {
        setShareUnlock(next);
        setSharePhase("unlocked");
      })
      .catch((error: unknown) => {
        setShareError(error instanceof Error ? error.message : "SHARE_RECEIPT_UNREACHABLE");
        setSharePhase("error");
      });
  }, [canShare]);

  const xText =
    identity === null ? "" : t("claim.shareXText", { alias: identity, multiplier: boostLabel });
  const telegramText =
    identity === null
      ? ""
      : t("claim.shareTelegramText", { alias: identity, multiplier: boostLabel });
  const xComposer = shareUrl === null ? null : shareComposerUrl("x", xText, shareUrl);
  const telegramComposer =
    shareUrl === null ? null : shareComposerUrl("telegram", telegramText, shareUrl);

  const statusText =
    state.phase === "authorizing"
      ? t("claim.authorizing")
      : state.phase === "settling"
        ? t("claim.settling")
        : claimReady
          ? t("claim.claim")
          : t("claim.preparing");

  const chainLabel =
    onchain === null
      ? null
      : onchain.chainStatus === "confirmed"
        ? t("claim.chain.confirmed")
        : onchain.chainStatus === "failed"
          ? t("claim.chain.failed")
          : t("claim.chain.pending");

  return (
    <section className={"rounded-3xl border border-white/80 bg-[rgba(255,255,255,0.58)] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_14px_30px_-22px_rgba(224,127,150,0.9)] backdrop-blur-xl " + className}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#b06a80]">
            {t("claim.badge")}
          </p>
          <h2 className="mt-1 text-[1.05rem] font-semibold leading-tight text-slate-900">
            {t("claim.title")}
          </h2>
          <p className="mt-1 text-[10.5px] leading-relaxed text-slate-500">{t("claim.subtitle")}</p>
        </div>
        <span className="shrink-0 rounded-full border border-[#ffb6c1]/80 bg-[rgba(255,240,243,0.9)] px-2.5 py-1 font-mono text-[10px] font-semibold text-[#8f5568]">
          {t("claim.amount")}
        </span>
      </header>

      <p className="mt-2.5 rounded-xl border border-[#ffb6c1]/60 bg-white/55 px-3 py-2 text-[10px] font-medium leading-relaxed text-[#8f5568]">
        {t("claim.supplyCap")}
      </p>

      {referral === null ? null : (
        <p className="mt-2.5 rounded-xl border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.82)] px-3 py-2 text-[10.5px] leading-relaxed text-[#8f5568]">
          {t("claim.referral", { ref: referral })}
        </p>
      )}

      <div className="mt-3.5 flex items-center gap-3">
        <div className="shrink-0">
          {shareUrl === null ? (
            <div className="flex h-[124px] w-[124px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#ffb6c1]/80 bg-white/55 px-2 text-center text-[9px] leading-relaxed text-slate-400">
              <span className="text-[#b06a80]">
                <QrGlyph />
              </span>
              <span className="mt-1">{t("claim.qrPending")}</span>
            </div>
          ) : (
            <div
              role="img"
              aria-label={t("claim.qrLabel")}
              className="rounded-2xl border border-white/90 bg-[#fffafb] p-2 shadow-[0_8px_18px_-14px_rgba(107,63,77,0.55)]"
            >
              <QRCodeSVG
                value={shareUrl}
                size={108}
                level="M"
                bgColor="#fffafb"
                fgColor="#6b3f4d"
                marginSize={2}
              />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            {t("claim.identityLabel")}
          </p>
          <p
            className={
              "mt-1 font-mono text-[11.5px] font-semibold text-slate-800 " +
              (identity === null ? "break-words" : "break-all")
            }
          >
            {identity ?? t("claim.identityPending")}
          </p>
          <p className="mt-1 text-[9.5px] leading-relaxed text-slate-400">{t("claim.identityNote")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => void copy()}
              disabled={shareUrl === null}
              className="inline-flex min-h-10 touch-manipulation items-center justify-center rounded-full border border-[#ffb6c1]/70 bg-white/80 px-2.5 text-[10px] font-medium text-[#8f5568] transition hover:bg-white active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {copied ? t("claim.copied") : t("claim.copy")}
            </button>
            <a
              href={xComposer ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!canShare}
              onClick={() => beginShare("x")}
              className={
                "inline-flex min-h-10 touch-manipulation items-center justify-center rounded-full border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.85)] px-2.5 text-[10px] font-medium text-[#8f5568] transition hover:bg-[rgba(255,182,193,0.35)] active:scale-[0.97] " +
                (canShare ? "" : "pointer-events-none opacity-45")
              }
            >
              {t("claim.shareX")}
            </a>
            <a
              href={telegramComposer ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              aria-disabled={!canShare}
              onClick={() => beginShare("telegram")}
              className={
                "inline-flex min-h-10 touch-manipulation items-center justify-center rounded-full border border-[#ffb6c1]/70 bg-white/80 px-2.5 text-[10px] font-medium text-[#8f5568] transition hover:bg-white active:scale-[0.97] " +
                (canShare ? "" : "pointer-events-none opacity-45")
              }
            >
              {t("claim.shareTelegram")}
            </a>
          </div>
        </div>
      </div>

      <div
        className={
          "mt-3 rounded-2xl border px-3 py-2.5 " +
          (sharePhase === "unlocked"
            ? "border-emerald-300/75 bg-emerald-50/75"
            : sharePhase === "error"
              ? "border-rose-300/70 bg-rose-50/70"
              : "border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.72)]")
        }
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-semibold text-[#6b3f4d]">
            {sharePhase === "unlocked"
              ? t("claim.boostUnlockedLabel", { multiplier: boostLabel })
              : t("claim.boostLockedLabel", { multiplier: boostLabel })}
          </p>
          <span className="shrink-0 font-mono text-[10px] text-[#8f5568]">
            {sharePhase === "unlocked"
              ? t("claim.boostAmount", { reward: bonusPreview })
              : t("claim.amount")}
          </span>
        </div>
        <p className="mt-1 text-[9.5px] leading-relaxed text-slate-500">
          {sharePhase === "loading"
            ? t("claim.shareChecking")
            : sharePhase === "sealing"
              ? t("claim.shareSealing", {
                  platform: sharePlatform === "telegram" ? "Telegram" : "X",
                })
              : sharePhase === "unlocked"
                ? t("claim.shareUnlocked", { minutes: shareMinutes })
                : sharePhase === "error"
                  ? t("claim.shareFailed", { code: shareError ?? "SHARE_RECEIPT_UNREACHABLE" })
                  : t("claim.shareRequired", { multiplier: boostLabel })}
        </p>
        <p className="mt-1 text-[8.5px] leading-relaxed text-slate-400">
          {t("claim.shareProofNote")}
        </p>
      </div>

      <div className="mt-3.5 flex items-center justify-between gap-3 rounded-2xl border border-white/85 bg-white/65 px-3.5 py-3">
        <div>
          <p className="text-[9px] uppercase tracking-[0.14em] text-slate-400">
            {t("claim.rewardLabel")}
          </p>
          <p className="mt-0.5 font-mono text-[1.3rem] font-semibold leading-none text-[#6b3f4d]">
            {onchain === null
              ? sharePhase === "unlocked"
                ? t("claim.boostAmount", { reward: bonusPreview })
                : t("claim.amount")
              : `${onchain.reward} ${onchain.symbol}`}
          </p>
        </div>
        <span className="max-w-[52%] text-right text-[9px] leading-relaxed text-slate-400">
          {onchain === null ? t("claim.previewNote") : t("claim.chainNote")}
        </span>
      </div>

      {state.phase === "error" ? (
        <p className="mt-2.5 rounded-xl border border-rose-300/70 bg-rose-50/80 px-3 py-2 text-[10px] leading-relaxed text-rose-800">
          {t("claim.error", { code: state.code })}
        </p>
      ) : null}

      {onchain === null ? null : (
        <div
          role="status"
          aria-live="polite"
          className={
            "mt-3 rounded-2xl border px-3.5 py-3 " +
            (onchain.chainStatus === "confirmed"
              ? "border-emerald-300/70 bg-emerald-50/80"
              : onchain.chainStatus === "failed"
                ? "border-rose-300/70 bg-rose-50/80"
                : "border-amber-300/70 bg-amber-50/80")
          }
        >
          <p
            className={
              "text-[11px] font-semibold " +
              (onchain.chainStatus === "confirmed"
                ? "text-emerald-800"
                : onchain.chainStatus === "failed"
                  ? "text-rose-800"
                  : "text-amber-800")
            }
          >
            {chainLabel}
          </p>
          <p className="mt-1 break-all font-mono text-[9.5px] text-slate-600">
            {t("claim.txHash")} {onchain.txHash}
          </p>
          {onchain.chainStatus === "confirmed" ? (
            <p className="mt-1 text-[9.5px] leading-relaxed text-emerald-700/90">
              {t("claim.rewardSettled", { reward: onchain.reward, symbol: onchain.symbol })}
            </p>
          ) : null}
          {onchain.explorerUrl === null ? null : (
            <a
              href={onchain.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-block text-[10px] font-medium text-[#8f5568] underline decoration-[#ffb6c1] underline-offset-2"
            >
              {t("claim.viewExplorer")}
            </a>
          )}
        </div>
      )}

      {bio.platformAuthenticator ? (
        canEnroll ? (
          <button
            type="button"
            onClick={bio.onEnroll}
            disabled={busy || alias === null}
            className="mt-3 inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/80 bg-[rgba(255,240,243,0.95)] px-4 text-[12.5px] font-semibold text-[#8f5568] shadow-[0_10px_24px_-18px_rgba(224,127,150,0.9)] transition hover:bg-[rgba(255,182,193,0.45)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FingerprintMark />
            {t("claim.enroll")}
          </button>
        ) : canRetry ? (
          <button
            type="button"
            onClick={onClaim}
            disabled={busy || !canClaim || !claimReady}
            className="mt-3 inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-full border border-white/80 bg-slate-900 px-4 text-[12.5px] font-semibold text-white shadow-[0_10px_26px_-12px_rgba(15,23,42,0.6)] transition hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-white/80">
              <FingerprintMark />
            </span>
            {statusText}
          </button>
        ) : null
      ) : (
        <p className="mt-3 rounded-xl border border-amber-300/70 bg-amber-50/75 px-3 py-2 text-[10px] leading-relaxed text-amber-800">
          {bio.busy ? t("claim.checking") : t("claim.noPlatform")}
        </p>
      )}
    </section>
  );
}
