"use client";

/**
 * The Bitcoin.com-shaped default home: one valuation, one spend-window line, three actions, four assets.
 *
 * The panel is presentational by design. It receives the server's status report and the independent ETH
 * balance read from `ConsumerView`, and hands every user intent back through `onIntent`; it never fetches,
 * signs, broadcasts or manufactures a quote. A missing valuation stays visibly unavailable, and a USDT
 * balance source that this build does not have is labelled "not connected" rather than painted as zero.
 *
 * The Send / Receive / Swap sheets intentionally reuse the grammar and copy already shipped by the old
 * `WalletPanel`: Send is validated locally before the button enables, Receive exposes only the manifest
 * owner, and Swap reports the adapter's `supported: false` instead of inventing a quote.
 */

import { useCallback, useState } from "react";

import { BrandMark } from "@/components/console/BrandMark";
import { formatWeiAsEth, shortHex, type AgentStatus } from "@/lib/agent/client";
import { formatQuotaUnits, denominate } from "@/lib/agent/quota-view";
import { remainingWindowWei, windowLabel } from "@/lib/agent/spend-view";
import { useLanguage } from "@/lib/i18n/language";

/** Rendered when a value has not landed yet. Never a fabricated zero. */
const NO_VALUE = "\u2014";

type WalletAction = "send" | "receive" | "swap";

const SEND_SENTENCE = /^(?:transfer|send|pay)\s+[0-9]+(?:\.[0-9]+)?\s*eth\s+to\s+0x[0-9a-fA-F]{40}$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const AMOUNT = /^[0-9]+(?:\.[0-9]+)?$/;
const SWAP_EXAMPLE = "swap 100 usdt for eth";

const ACTIONS: readonly WalletAction[] = ["send", "receive", "swap"];

const ACTION_LABEL = {
  send: "wallet.action.send",
  receive: "wallet.action.receive",
  swap: "wallet.action.swap",
} as const;

const ACTION_HINT = {
  send: "wallet.action.sendHint",
  receive: "wallet.action.receiveHint",
  swap: "wallet.action.swapHint",
} as const;

function ActionGlyph({ action }: { readonly action: WalletAction }) {
  const common = {
    viewBox: "0 0 24 24",
    "aria-hidden": true,
    className: "h-5 w-5",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (action === "send") {
    return (
      <svg {...common}>
        <path d="M12 19V5" />
        <path d="m6 11 6-6 6 6" />
      </svg>
    );
  }
  if (action === "receive") {
    return (
      <svg {...common}>
        <path d="M12 5v14" />
        <path d="m6 13 6 6 6-6" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 8h13" />
      <path d="m14 5 3 3-3 3" />
      <path d="M20 16H7" />
      <path d="m10 13-3 3 3 3" />
    </svg>
  );
}

export interface VaultPanelProps {
  /** The live server report, or `null` while the first read is in flight. */
  readonly status: AgentStatus | null;
  /** Why the status read failed, if it did. The Vault describes it without hiding the rest of the page. */
  readonly statusError?: { readonly code: string; readonly reason: string } | null;
  /** The owner account's native balance, formatted in ETH, or `null` when the read failed. */
  readonly balance: string | null;
  /** The account the panel is for - the manifest owner, never a literal. */
  readonly owner: string | null;
  /** Local clock time of the last completed status read. `null` before the first answer. */
  readonly updatedAt?: number | null;
  /** Hands one sentence to the real M1/M2 pipeline (the controller's `submit`). */
  readonly onIntent: (text: string) => void;
  /** Opens the secondary AI Node surface. */
  readonly onOpenAgent?: (() => void) | null;
}

interface AssetRowProps {
  readonly symbol: string;
  readonly name: string;
  readonly balance: string;
  readonly value: string;
  readonly note?: string;
}

function AssetRow({ symbol, name, balance, value, note }: AssetRowProps) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/80 bg-white/80 font-mono text-[11px] font-semibold text-[#6b3f4d] shadow-[inset_0_1px_0_rgba(255,255,255,1)]">
        {symbol}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-slate-800">{name}</span>
        {note === undefined ? null : (
          <span className="mt-0.5 block truncate text-[10px] text-slate-400">{note}</span>
        )}
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-mono text-[12.5px] text-slate-800">{balance}</span>
        <span className="mt-0.5 block text-[10px] text-slate-400">{value}</span>
      </span>
    </div>
  );
}

export function VaultPanel({
  status,
  statusError = null,
  balance,
  owner,
  updatedAt = null,
  onIntent,
  onOpenAgent = null,
}: VaultPanelProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState<WalletAction | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);

  const close = useCallback(() => {
    setOpen(null);
    setCopied(false);
  }, []);

  const copyAddress = useCallback(async () => {
    if (owner === null || typeof navigator === "undefined" || navigator.clipboard === undefined) {
      return;
    }
    try {
      await navigator.clipboard.writeText(owner);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [owner]);

  const quota = status?.quota ?? null;
  const windowText = status === null ? NO_VALUE : windowLabel(status.policy.windowSeconds);
  const leftWei =
    status === null
      ? null
      : remainingWindowWei(status.policy.maxValueWeiPerWindow, status.spend.spentWei);
  const availableUnits = quota === null ? null : denominate(quota.availableYuanYuan);
  const nominalUnits = quota === null ? null : denominate(quota.nominalYuanYuan);

  const trimmedTo = to.trim();
  const trimmedAmount = amount.trim();
  const sendSentence = `Send ${trimmedAmount} ETH to ${trimmedTo}`;
  const addressOk = ADDRESS.test(trimmedTo);
  const amountOk = AMOUNT.test(trimmedAmount);
  const sentenceOk = SEND_SENTENCE.test(sendSentence);

  const reviewSend = useCallback(() => {
    if (!sentenceOk) {
      return;
    }
    close();
    onIntent(sendSentence);
  }, [close, onIntent, sendSentence, sentenceOk]);

  const previewSwap = useCallback(() => {
    close();
    onIntent(SWAP_EXAMPLE);
  }, [close, onIntent]);

  const actionButton = (action: WalletAction) => (
    <button
      key={action}
      type="button"
      onClick={() => setOpen(action)}
      title={t(ACTION_HINT[action])}
      className="flex min-h-12 touch-manipulation flex-col items-center gap-1.5 rounded-2xl px-1 py-1 text-[11px] font-medium text-[#6b3f4d] transition hover:text-[#b06a80]"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-white/80 bg-white/85 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.06),0_10px_24px_-14px_rgba(15,23,42,0.35)] backdrop-blur">
        <ActionGlyph action={action} />
      </span>
      <span>{t(ACTION_LABEL[action])}</span>
    </button>
  );

  return (
    <section className="mt-1 rounded-[30px] border border-white/70 bg-[rgba(255,240,243,0.65)] px-5 py-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_2px_6px_rgba(15,23,42,0.06),0_18px_38px_-16px_rgba(15,23,42,0.22),0_44px_80px_-40px_rgba(15,23,42,0.30)] backdrop-blur-2xl">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/80 bg-white/70 text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,1)]">
            <BrandMark />
          </span>
          <div>
            <h1 className="text-[1.35rem] font-semibold leading-tight tracking-[-0.01em] text-slate-900">
              {t("vault.title")}
            </h1>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{t("vault.subtitle")}</p>
          </div>
        </div>
        <p className="shrink-0 font-mono text-[10px] text-slate-400">
          {status === null ? NO_VALUE : `${t("sheet.chain")} ${status.deployment.chainId ?? NO_VALUE}`}
        </p>
      </header>

      <div className="mt-5 rounded-[24px] border border-white/80 bg-white/55 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] text-slate-400">{t("vault.total")}</p>
            <p className="mt-1 flex items-baseline gap-1.5">
              <span className="font-mono text-[2.15rem] leading-none text-slate-900">{NO_VALUE}</span>
              <span className="text-[12px] text-slate-400">USD</span>
            </p>
          </div>
          <span className="rounded-full border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.8)] px-2.5 py-1 text-[10px] font-medium text-[#b06a80]">
            {t("vault.totalUnavailable")}
          </span>
        </div>
        <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">{t("vault.totalSource")}</p>
        <p className="mt-1.5 font-mono text-[10px] text-slate-400">
          {updatedAt === null
            ? t("vault.updatedPending")
            : t("vault.updated", { time: new Date(updatedAt).toLocaleTimeString() })}
        </p>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#ffb6c1]/55 bg-[rgba(255,240,243,0.72)] px-3 py-2.5">
          <span className="text-[10.5px] text-[#8f5568]">
            {t("vault.spendWindow", { window: windowText })}
          </span>
          <span className="font-mono text-[12px] text-emerald-700">
            {leftWei === null ? NO_VALUE : `${formatWeiAsEth(leftWei.toString())} ETH`}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1.5">
        {ACTIONS.map((action) => actionButton(action))}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b06a80]">
            {t("vault.assets")}
          </h2>
          <p className="font-mono text-[9.5px] text-slate-400">
            {t("vault.column.asset")} / {t("vault.column.balance")} / {t("vault.column.value")}
          </p>
        </div>
        <div className="mt-2 divide-y divide-white/70 rounded-2xl border border-white/70 bg-white/45 px-3 backdrop-blur-xl">
          <AssetRow
            symbol="USDT"
            name={t("vault.asset.usdt")}
            balance={t("vault.asset.notConnected")}
            value={t("vault.asset.valueUnavailable")}
          />
          <AssetRow
            symbol="ETH"
            name={t("vault.asset.eth")}
            balance={balance === null ? NO_VALUE : `${balance} ETH`}
            value={t("vault.asset.valueUnavailable")}
            note={owner === null ? t("wallet.receive.unavailable") : shortHex(owner, 8, 6)}
          />
          <AssetRow
            symbol="YY"
            name={t("vault.asset.yuanYuan")}
            balance={availableUnits === null ? t("vault.asset.notConnected") : formatQuotaUnits(availableUnits.yuanYuan)}
            value={t("vault.asset.quotaValue")}
            note={
              nominalUnits === null
                ? t("vault.asset.genesis")
                : `${t("vault.asset.genesis")} · ${t("compute.vault.nominal")} ${formatQuotaUnits(nominalUnits.yuanYuan)}`
            }
          />
          <AssetRow
            symbol="MM"
            name={t("vault.asset.maoMao")}
            balance={availableUnits === null ? t("vault.asset.notConnected") : formatQuotaUnits(availableUnits.maoMao)}
            value={t("vault.asset.quotaValue")}
            note={`${t("vault.asset.quota")} · ${t("vault.asset.tokenPending")}`}
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-white/60 bg-[rgba(255,240,243,0.55)] px-3 py-2.5 text-[10px] text-slate-400">
        <span>{t("pill.walletAlias")}</span>
        <span className="font-mono text-slate-600">{status === null ? NO_VALUE : status.enclave.keyAlias}</span>
        <span className="text-slate-300">|</span>
        <span>{t("pill.account")}</span>
        <span className="font-mono text-slate-600" title={owner ?? undefined}>
          {owner === null ? NO_VALUE : shortHex(owner, 6, 4)}
        </span>
      </div>

      {statusError === null ? null : (
        <div className="mt-3 rounded-2xl border border-amber-300/70 bg-amber-50/70 px-4 py-3 text-xs text-amber-800 backdrop-blur-xl">
          <p className="font-medium">
            {t("status.ledgerNotReady")}
            <span className="font-mono">{statusError.code}</span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-amber-700/80">{statusError.reason}</p>
        </div>
      )}

      {onOpenAgent === null ? null : (
        <button
          type="button"
          onClick={onOpenAgent}
          className="mt-4 flex min-h-12 w-full touch-manipulation items-center justify-between gap-3 rounded-2xl border border-[#ffb6c1]/70 bg-[rgba(255,240,243,0.75)] px-4 py-3 text-left transition hover:bg-[rgba(255,240,243,0.95)]"
        >
          <span>
            <span className="block text-[12.5px] font-semibold text-[#6b3f4d]">{t("vault.openAgent")}</span>
            <span className="mt-0.5 block text-[10px] leading-relaxed text-slate-500">
              {t("vault.openAgentHint")}
            </span>
          </span>
          <span aria-hidden="true" className="text-[#e07f96]">
            &#8594;
          </span>
        </button>
      )}

      <p className="mt-3 pb-safe-bottom text-center text-[10px] leading-relaxed text-slate-400">
        {t("footer.biometrics")} <span className="font-medium text-slate-600">{t("footer.biometricsNever")}</span>
      </p>

      {open === null ? null : (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/25 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={close}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t(ACTION_LABEL[open])}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[32rem] rounded-t-[28px] border border-white/80 bg-[rgba(255,247,249,0.94)] px-5 pb-safe-bottom pt-5 shadow-[0_-18px_40px_-24px_rgba(15,23,42,0.35)] backdrop-blur-2xl sm:rounded-[28px] sm:pb-5"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-slate-900/15 sm:hidden" />
            <h2 className="text-base font-semibold text-slate-900">{t(ACTION_LABEL[open])}</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">{t(ACTION_HINT[open])}</p>

            {open === "send" ? (
              <>
                <label className="mt-4 block text-[11px] text-slate-500" htmlFor="wallet-send-to">
                  {t("wallet.send.to")}
                </label>
                <input
                  id="wallet-send-to"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="text"
                  className="mt-1.5 min-h-12 w-full touch-manipulation rounded-2xl border border-slate-900/10 bg-white/80 px-3.5 font-mono text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900/25"
                  placeholder="0x..."
                />
                <label className="mt-3 block text-[11px] text-slate-500" htmlFor="wallet-send-amount">
                  {t("wallet.send.amount")}
                </label>
                <input
                  id="wallet-send-amount"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  inputMode="decimal"
                  className="mt-1.5 min-h-12 w-full touch-manipulation rounded-2xl border border-slate-900/10 bg-white/80 px-3.5 font-mono text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-slate-900/25"
                  placeholder="0.05"
                />
                {trimmedTo === "" || addressOk ? null : (
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-700">
                    {t("wallet.send.invalidTo")}
                  </p>
                )}
                {trimmedAmount === "" || amountOk ? null : (
                  <p className="mt-1.5 text-[10.5px] leading-relaxed text-amber-700">
                    {t("wallet.send.invalidAmount")}
                  </p>
                )}
                <p className="mt-3 break-all rounded-xl border border-white/70 bg-white/60 px-3 py-2 text-[10.5px] text-slate-500">
                  {t("wallet.send.grammar", { sentence: sendSentence })}
                </p>
                <button
                  type="button"
                  onClick={reviewSend}
                  disabled={!sentenceOk}
                  className="mt-4 inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full border border-white/80 bg-white/85 px-5 text-[13.5px] font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.06),0_10px_24px_-12px_rgba(15,23,42,0.35)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("wallet.send.review")}
                </button>
              </>
            ) : null}

            {open === "receive" ? (
              <>
                <p className="mt-4 text-[11px] text-slate-500">{t("wallet.receive.address")}</p>
                <p className="mt-1.5 break-all rounded-2xl border border-white/70 bg-white/70 px-3.5 py-3 font-mono text-[12.5px] text-slate-800">
                  {owner === null ? t("wallet.receive.unavailable") : owner}
                </p>
                <button
                  type="button"
                  onClick={() => void copyAddress()}
                  disabled={owner === null}
                  className="mt-3 inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full border border-white/80 bg-white/85 px-5 text-[13.5px] font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.06),0_10px_24px_-12px_rgba(15,23,42,0.35)] backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {copied ? t("wallet.receive.copied") : t("wallet.receive.copy")}
                </button>
                <p className="mt-3 text-[10.5px] leading-relaxed text-slate-400">{t("wallet.receive.note")}</p>
              </>
            ) : null}

            {open === "swap" ? (
              <>
                <p className="mt-4 text-[10px] uppercase tracking-[0.16em] text-[#b06a80]">
                  {t("adapter.title")}
                </p>
                <ul className="mt-1.5 grid gap-1 text-[11px] text-[#6b3f4d]">
                  <li>{t("adapter.uniswap")}</li>
                  <li>{t("adapter.tron")}</li>
                </ul>
                <p className="mt-2 text-[10.5px] leading-relaxed text-slate-500">{t("adapter.unsupported")}</p>
                <p className="mt-2 break-all rounded-xl border border-white/70 bg-white/60 px-3 py-2 font-mono text-[10.5px] text-slate-500">
                  {t("wallet.swap.example", { sentence: SWAP_EXAMPLE })}
                </p>
                <button
                  type="button"
                  onClick={previewSwap}
                  className="mt-4 inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full border border-white/80 bg-white/85 px-5 text-[13.5px] font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_1px_2px_rgba(15,23,42,0.06),0_10px_24px_-12px_rgba(15,23,42,0.35)] backdrop-blur transition hover:bg-white"
                >
                  {t("wallet.swap.preview")}
                </button>
                <p className="mt-3 text-[10.5px] leading-relaxed text-slate-400">{t("wallet.swap.note")}</p>
              </>
            ) : null}

            <button
              type="button"
              onClick={close}
              className="mt-3 inline-flex min-h-12 w-full touch-manipulation items-center justify-center rounded-full border border-slate-900/10 bg-white/60 px-5 text-[13px] font-medium text-slate-600 transition hover:bg-white/80"
            >
              {t("wallet.close")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
