"use client";

/**
 * C-end consumer view - the 猫糖 AI 个人助理.
 *
 * This is the face `/` and `/agent` open with. It is the same M1-M5 pipeline the engineer console
 * renders, just presented for a person instead of an operator: one chat box, a status pill, and a
 * confirmation sheet whose only action is a biometric one.
 *
 * What this component deliberately does **not** do:
 *
 *   - it does not translate a sentence, decide a policy, or compute a digest. The prompt goes to
 *     `/api/agent/intent`, where the real M1 translator and the real M2 `AutonomousWallet.preview` run,
 *     and the view renders whatever they answered. A refusal is a value here, not an exception: the
 *     owner sees the pillar and the module's own code (`UNSUPPORTED_REQUEST`, `DESTINATION_NOT_ALLOWED`,
 *     ...) instead of a blank card.
 *   - it does not fabricate a number. The balance is the manifest owner's live `eth_getBalance`; the
 *     "today's remaining allowance" is `maxValueWeiPerWindow - spentWei` from the server ledger; the
 *     window label is derived from `windowSeconds`, so a shortened test deployment is never described
 *     as "24h".
 *   - it does not claim a signature happened. The web host has no secure-enclave bridge, so
 *     `attemptSign` comes back refused - and this sheet shows that refusal rather than a green tick
 *     nobody earned. The biometric assertion proves the owner is present; it is not a private key.
 *
 * Three bridges to the engineer console, so the mobile face cannot drift from it:
 *
 *   - the biometric conversation is `useBiometricOwner()` (`@/lib/agent/biometric-session`), the same
 *     hook `BioAuthGuard` runs, so the iOS Safari / Android webview handling exists once;
 *   - the device-interaction copy and toast tones come from `biometric-ux.ts`, so both faces explain
 *     one refusal the same way;
 *   - the window label and the "remaining allowance" arithmetic come from `spend-view.ts`, shared with
 *     `AutonomousWalletCard`.
 *
 * The layout is mobile-first: the chat bar is docked to the bottom of the viewport and padded by
 * `env(safe-area-inset-bottom)`, so on a 390px iPhone it clears the home indicator instead of sitting
 * under it, and every primary target is at least 48px tall for a thumb.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ToastStack, useToastQueue } from "@/components/agent-console/Toast";
import {
  BIOMETRIC_PROMPT_NOTICE,
  biometricFailureToast,
  biometricFallbackCopy,
  biometricSuccessToast,
} from "@/components/agent-console/biometric-ux";
import {
  fetchAgentStatus,
  fetchNativeBalance,
  formatWeiAsEth,
  requestIntent,
  shortHex,
  type AgentStatus,
} from "@/lib/agent/client";
import { useBiometricOwner } from "@/lib/agent/biometric-session";
import { remainingWindowWei, windowLabel } from "@/lib/agent/spend-view";
import type { AgentRefusal, IntentSuccess } from "@/lib/agent/types";

/** Rendered when a value has not landed yet. Never a fabricated zero. */
const NO_VALUE = "\u2014";

/**
 * The exact sentence the deterministic M1 stub parses for a mint. Shown to the owner verbatim, because
 * the stub's grammar is fixed (`mobile-agent/slm/slm-engine.ts`) and a paraphrase would be refused.
 */
const MINT_PRESET = "Mint 0.05 ETH worth of Mao Tang token";

/** The preset answered from the local ledger instead of calling M1. */
const LEDGER_PRESET_LABEL = "查看今日节点收益";

type PresetKind = "intent" | "ledger";

interface Preset {
  readonly label: string;
  readonly kind: PresetKind;
  /** The exact text M1 receives. Empty for `ledger` presets, which never reach M1. */
  readonly text: string;
}

type StatusState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly status: AgentStatus }
  | { readonly kind: "unavailable"; readonly code: string; readonly reason: string };
export interface ConsumerViewProps {
  /** Flips the shell to the M1-M5 engineer/audit view. */
  readonly onSwitchToDeveloper: () => void;
}

export function ConsumerView({ onSwitchToDeveloper }: ConsumerViewProps) {
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [balance, setBalance] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IntentSuccess | null>(null);
  const [refusal, setRefusal] = useState<AgentRefusal | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // One shared biometric session and one shared toast queue, mirroring the engineer console.
  const session = useBiometricOwner();
  const toasts = useToastQueue();

  // -- reads ------------------------------------------------------------------------------------

  // The status read is the only source of every number on this page. It is a plain GET; it cannot
  // sign, and it cannot move money.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = await fetchAgentStatus(controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        if (result.ok) {
          setStatusState({ kind: "ready", status: result.status });
        } else {
          setStatusState({ kind: "unavailable", code: result.refusal.code, reason: result.refusal.reason });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setStatusState({ kind: "unavailable", code: "STATUS_UNREACHABLE", reason: (error as Error).message });
        }
      }
    })();
    return () => controller.abort();
  }, []);

  // The balance is a second, independent read: a dead RPC must not blank the status pill.
  useEffect(() => {
    if (statusState.kind !== "ready") {
      return;
    }
    const { rpcUrl, owner } = statusState.status.deployment;
    if (rpcUrl === null || owner === null) {
      setBalance(null);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const wei = await fetchNativeBalance(rpcUrl, owner, controller.signal);
        if (!controller.signal.aborted) {
          setBalance(formatWeiAsEth(wei.toString()));
        }
      } catch {
        if (!controller.signal.aborted) {
          setBalance(null);
        }
      }
    })();
    return () => controller.abort();
  }, [statusState]);

  // -- intent -----------------------------------------------------------------------------------

  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (trimmed === "") {
        return;
      }
      setBusy(true);
      setRefusal(null);
      setPreview(null);
      setLocalNote(null);
      session.reset();
      try {
        const answer = await requestIntent({ prompt: trimmed });
        if (answer.ok) {
          setPreview(answer);
          setConfirmOpen(true);
        } else {
          setRefusal(answer.refusal);
          // The refusal panel is easy to miss above a docked bar, so the verdict also gets a toast.
          toasts.push("warn", `已被本地策略拦截：${answer.refusal.code}（未生成交易）`);
        }
      } catch (error) {
        setRefusal({ stage: "request", code: "NETWORK_UNREACHABLE", reason: (error as Error).message });
      } finally {
        setBusy(false);
      }
    },
    [session, toasts],
  );

  const showLedger = useCallback(() => {
    setPreview(null);
    setRefusal(null);
    setConfirmOpen(false);
    session.reset();
    if (statusState.kind !== "ready") {
      setLocalNote("本地策略账本还没读回来，稍后再试。");
      return;
    }
    const { policy, spend } = statusState.status;
    const left = remainingWindowWei(policy.maxValueWeiPerWindow, spend.spentWei);
    setLocalNote(
      [
        "今日节点收益：本版本尚未接入收益账本，所以这里不显示任何未经验证的数字。",
        `可验证的本地账本：滚动窗口 ${windowLabel(policy.windowSeconds)} 内已用 ${formatWeiAsEth(spend.spentWei)} / ${formatWeiAsEth(policy.maxValueWeiPerWindow)} ETH，剩余 ${formatWeiAsEth(left.toString())} ETH。`,
      ].join("\n"),
    );
  }, [session, statusState]);

  const presets = useMemo<readonly Preset[]>(() => {
    const list: Preset[] = [{ label: "铸造 0.05 ETH 的猫糖代币", kind: "intent", text: MINT_PRESET }];
    const destination =
      statusState.kind === "ready" ? statusState.status.policy.allowedDestinations[0] : undefined;
    if (destination !== undefined) {
      list.push({
        label: "给白名单地址转账 0.05 ETH",
        kind: "intent",
        text: `Send 0.05 ETH to ${destination}`,
      });
    }
    list.push({ label: LEDGER_PRESET_LABEL, kind: "ledger", text: "" });
    return list;
  }, [statusState]);

  const runPreset = useCallback(
    (preset: Preset) => {
      if (preset.kind === "ledger") {
        showLedger();
        return;
      }
      setPrompt(preset.text);
      void submit(preset.text);
    },
    [showLedger, submit],
  );

  // -- biometric confirmation -------------------------------------------------------------------

  const confirm = useCallback(async () => {
    if (preview === null) {
      return;
    }
    // Announce the request first: the system sheet renders outside the document, so without this the
    // owner has no on-screen evidence the tap landed.
    toasts.push("info", BIOMETRIC_PROMPT_NOTICE);
    // Nothing is awaited before `authorize` on purpose - WebAuthn needs the tap's user activation, and
    // an `await` here is how iOS Safari turns the prompt into a silent NotAllowedError.
    const outcome = await session.authorize(preview.digest, "确认这笔交易");
    if (!outcome.ok) {
      const { tone, message } = biometricFailureToast(outcome.failure);
      toasts.push(tone, message);
      return;
    }
    const { tone, message } = biometricSuccessToast(outcome.assertion);
    toasts.push(tone, message);
    // Ask for the signature too, so the sheet shows the real enclave answer: on a web host with no
    // bridge that answer is a refusal, and the owner reads the module's own code instead of a tick.
    const signed = await requestIntent({ prompt: preview.inference.prompt, attemptSign: true });
    if (signed.ok) {
      setPreview(signed);
    }
  }, [preview, session, toasts]);

  const enroll = useCallback(async () => {
    const result = await session.enroll("猫糖 Web Agent OS");
    if (result.ok) {
      toasts.push("success", "本机凭据已注册，可以开始刷脸 / 指纹确认。");
      return;
    }
    const { tone, message } = biometricFailureToast(result.failure);
    toasts.push(tone, message);
  }, [session, toasts]);
  // -- render -----------------------------------------------------------------------------------

  const status = statusState.kind === "ready" ? statusState.status : null;
  const owner = status?.deployment.owner ?? null;
  const windowText = status === null ? NO_VALUE : windowLabel(status.policy.windowSeconds);
  const leftWei =
    status === null ? null : remainingWindowWei(status.policy.maxValueWeiPerWindow, status.spend.spentWei);
  // The one guidance line for an environment that cannot raise a prompt (WeChat webview, no enrolled
  // authenticator, insecure origin). `null` when the prompt can run.
  const fallback = biometricFallbackCopy(session.capability);
  const canConfirm = session.credentialId !== null && session.capability?.platformAuthenticator === true;

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-3xl flex-col">
      <ToastStack toasts={toasts.toasts} onDismiss={toasts.dismiss} />

      {/* Scroll region. `pb-safe-content` clears the docked bar plus the home indicator. */}
      <div className="flex-1 px-4 pb-safe-content pt-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">MAOTANG Protocol</p>
            <h1 className="mt-2 text-xl font-semibold text-white sm:text-2xl">猫糖 AI 个人助理</h1>
            <p className="mt-1 text-sm text-white/50">说一句话，本地策略先过一遍，再由你的指纹 / 面容确认。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dex"
              className="inline-flex min-h-11 touch-manipulation items-center rounded-full border border-maotang-border px-4 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint"
            >
              DEX 看板
            </Link>
            <button
              type="button"
              onClick={onSwitchToDeveloper}
              className="inline-flex min-h-11 touch-manipulation items-center rounded-full border border-maotang-mint/50 bg-maotang-mint/10 px-4 text-xs font-medium text-maotang-mint transition hover:bg-maotang-mint/20"
            >
              切换到 工程师/审计视图
            </button>
          </div>
        </header>

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-maotang-border bg-maotang-surface px-4 py-3 text-xs">
          <span className="text-white/45">账户</span>
          <span className="font-mono text-white/75" title={owner ?? undefined}>
            {owner === null ? NO_VALUE : shortHex(owner, 6, 4)}
          </span>
          <span className="text-white/20">|</span>
          <span className="text-white/45">余额</span>
          <span className="font-mono text-white">{balance === null ? NO_VALUE : `${balance} ETH`}</span>
          <span className="text-white/20">|</span>
          <span className="text-white/45">今日可用:</span>
          <span className="font-mono text-maotang-mint">
            {leftWei === null ? NO_VALUE : `${formatWeiAsEth(leftWei.toString())} ETH`}
          </span>
          <span className="font-mono text-white/50">/ {windowText}</span>
        </div>

        {statusState.kind === "unavailable" ? (
          <div className="mt-3 rounded-2xl border border-maotang-amber/40 bg-maotang-surface px-4 py-3 text-xs">
            <p className="text-maotang-amber">
              本地策略账本未就绪：<span className="font-mono">{statusState.code}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/45">{statusState.reason}</p>
          </div>
        ) : null}

        {fallback !== null ? (
          <div className="mt-3 rounded-2xl border border-maotang-amber/40 bg-maotang-amber/5 px-4 py-3 text-[11px] leading-relaxed text-maotang-amber">
            {fallback}
          </div>
        ) : null}

        {localNote !== null ? (
          <div className="mt-3 whitespace-pre-line rounded-2xl border border-maotang-mint/30 bg-maotang-mint/5 px-4 py-3 text-xs leading-relaxed text-white/70">
            {localNote}
          </div>
        ) : null}

        {refusal !== null ? (
          <div className="mt-3 rounded-2xl border border-maotang-pink/40 bg-maotang-pink/5 px-4 py-3">
            <p className="flex flex-wrap items-center gap-2 text-xs text-maotang-pink">
              <span className="rounded bg-maotang-pink/15 px-1.5 py-0.5 font-mono text-[10px]">
                {refusal.stage}
              </span>
              <span className="font-mono">{refusal.code}</span>
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/55">{refusal.reason}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              这条请求在本地被拦下了，没有生成交易，也没有要求你签名。
            </p>
          </div>
        ) : null}

        <footer className="mt-5 text-[11px] leading-relaxed text-white/35">
          <p>
            设备生物识别：
            {session.capability === null ? "检测中\u2026" : session.capability.detail}
            {session.credentialId === null ? " \u00b7 尚未在本机注册凭据" : " \u00b7 已注册本机凭据"}
          </p>
          <p className="mt-1">
            本页只调用 <span className="font-mono">/api/agent/*</span>；短语翻译、策略判定与摘要都发生在服务端的 M1/M2，
            浏览器不参与任何签名计算。原始指纹 / 面容数据不会离开设备。
          </p>
        </footer>
      </div>
      {/*
        The docked chat bar. `fixed` (not `sticky`) is what guarantees it is at the bottom on a short
        page, and `pb-safe-bottom` lifts it above the iPhone home indicator / Android gesture bar.
        `touch-manipulation` on every trigger kills the 300ms double-tap-zoom delay on iOS, so a second
        tap cannot zoom the page instead of re-running the action.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-maotang-border bg-maotang-ink/95 backdrop-blur">
        <div className="mx-auto w-full max-w-3xl px-4 pb-safe-bottom pt-3">
          <div className="-mx-1 flex flex-nowrap gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => runPreset(preset)}
                disabled={busy}
                className="min-h-10 shrink-0 touch-manipulation rounded-full border border-maotang-border bg-maotang-ink/60 px-3 text-xs text-white/65 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-end gap-2">
            <label className="sr-only" htmlFor="consumer-prompt">
              告诉猫糖助理你想做什么
            </label>
            <input
              id="consumer-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void submit(prompt);
                }
              }}
              placeholder={MINT_PRESET}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="send"
              inputMode="text"
              /* text-base (16px): anything smaller makes iOS Safari zoom the viewport on focus. */
              className="min-h-12 min-w-0 flex-1 touch-manipulation rounded-xl border border-maotang-border bg-maotang-ink px-3 py-3 text-base text-white outline-none focus:border-maotang-mint/60"
            />
            <button
              type="button"
              onClick={() => void submit(prompt)}
              disabled={busy || prompt.trim() === ""}
              className="min-h-12 shrink-0 touch-manipulation rounded-xl bg-maotang-mint/20 px-4 text-sm font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "思考中\u2026" : "发送"}
            </button>
          </div>
        </div>
      </div>

      {confirmOpen && preview !== null ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="确认这笔交易"
            className="max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-maotang-border bg-maotang-surface p-5 pb-safe-sheet sm:rounded-2xl"
          >
            {/* A grab handle: on a phone this sheet is a bottom drawer, not a floating dialog. */}
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
            <h2 className="text-base font-semibold text-white">确认这笔交易</h2>
            <p className="mt-2 text-xs leading-relaxed text-white/60">{preview.preview.description}</p>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-white/45">操作</dt>
              <dd className="text-right font-mono text-white/80">{preview.preview.action}</dd>
              <dt className="text-white/45">接收地址</dt>
              <dd className="text-right font-mono text-white/80">{shortHex(preview.preview.to, 10, 6)}</dd>
              <dt className="text-white/45">金额</dt>
              <dd className="text-right font-mono text-white/80">
                {formatWeiAsEth(preview.preview.valueWei)} ETH
              </dd>
              <dt className="text-white/45">链</dt>
              <dd className="text-right font-mono text-white/80">{preview.preview.chainId}</dd>
              <dt className="text-white/45">本窗口剩余</dt>
              <dd className="text-right font-mono text-white/80">
                {preview.decision.allowed
                  ? `${formatWeiAsEth(preview.decision.remainingWindowWei)} ETH`
                  : NO_VALUE}
              </dd>
            </dl>

            <p className="mt-3 break-all text-[11px] text-white/40">
              待签摘要 <span className="font-mono">{preview.digest}</span>
            </p>

            {fallback !== null ? (
              <p className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2 text-[11px] leading-relaxed text-maotang-amber">
                {fallback}
              </p>
            ) : null}

            {session.failure !== null && session.failure.code !== "NO_CHALLENGE" ? (
              <div className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2">
                <p className="text-[11px] text-maotang-amber">
                  <span className="font-mono">{session.failure.code}</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/50">{session.failure.message}</p>
              </div>
            ) : null}

            {session.assertion !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-mint/40 bg-maotang-mint/5 px-3 py-2 text-[11px]">
                <p className="text-maotang-mint">
                  设备已在 {new Date(session.assertion.assertedAt).toLocaleTimeString()} 完成验证
                </p>
                <p className="mt-1 text-white/55">
                  用户已验证：{session.assertion.userVerified ? "是" : "否"} \u00b7 硬件凭据：
                  {session.assertion.hardwareBacked ? "是" : "否"}
                </p>
                {session.nullifier !== null ? (
                  <p className="mt-1 break-all text-white/40">
                    HardwareNullifier <span className="font-mono">{shortHex(session.nullifier, 14, 10)}</span>
                  </p>
                ) : null}
              </div>
            ) : null}

            {preview.signRefusal !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2 text-[11px]">
                <p className="text-maotang-amber">
                  <span className="font-mono">{preview.signRefusal.code}</span> \u2014 硬件签名通道未接入
                </p>
                <p className="mt-1 leading-relaxed text-white/50">{preview.signRefusal.reason}</p>
              </div>
            ) : null}

            {preview.signed !== null ? (
              <p className="mt-3 break-all text-[11px] text-maotang-mint">
                已签名 <span className="font-mono">{shortHex(preview.signed.signature, 16, 8)}</span>
              </p>
            ) : null}

            <button
              type="button"
              onClick={() => void confirm()}
              disabled={session.busy || !canConfirm}
              title={canConfirm ? undefined : "先在本机注册指纹 / 面容，或改用支持 WebAuthn 的浏览器打开"}
              className="mt-4 min-h-12 w-full touch-manipulation rounded-xl bg-maotang-mint px-4 text-sm font-semibold text-maotang-ink transition hover:bg-maotang-mint/85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {session.phase === "asserting" ? "等待设备确认\u2026" : "刷脸 / 指纹安全确认"}
            </button>

            {session.credentialId === null ? (
              <button
                type="button"
                onClick={() => void enroll()}
                disabled={session.busy || session.capability?.platformAuthenticator !== true}
                className="mt-2 min-h-12 w-full touch-manipulation rounded-xl border border-maotang-border px-4 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {session.phase === "enrolling" ? "正在注册\u2026" : "先在本机注册指纹 / 面容"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 min-h-12 w-full touch-manipulation rounded-xl px-4 text-xs text-white/45 transition hover:text-white/70"
            >
              取消
            </button>

            <p className="mt-3 text-[10px] leading-relaxed text-white/30">
              生物识别只在设备内部完成，不上传任何原始指纹 / 面容数据；摘要一旦确认即绑定这笔交易，无法被复用到另一笔。
              Web 主机没有安全飞地，因此这里只证明“你本人在场”，真正的私钥签名需要设备侧的 M2/M5 飞地。
            </p>
          </div>
        </div>
      ) : null}
    </main>
  );
}