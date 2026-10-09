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
 *     "today's remaining allowance" is `maxValueWeiPerWindow - spentWei` from the server-ledger; the
 *     window label is derived from `windowSeconds`, so a shortened test deployment is never described
 *     as "24h".
 *   - it does not claim a signature happened. The web host has no secure-enclave bridge, so
 *     `attemptSign` comes back refused - and this sheet shows that refusal rather than a green tick
 *     nobody earned. The biometric assertion proves the owner is present; it is not a private key.
 *
 * The one prompt preset exists because the shipped M1 stub parses a fixed grammar. The preset label is
 * Chinese for the owner; the text M1 receives is the exact English sentence the stub accepts.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchAgentStatus,
  fetchNativeBalance,
  formatWeiAsEth,
  requestIntent,
  shortHex,
  type AgentStatus,
} from "@/lib/agent/client";
import type { AgentRefusal, Hex, IntentSuccess } from "@/lib/agent/types";
import {
  WebBiometricError,
  deriveOwnerNullifier,
  enrollOwnerCredential,
  readBiometricCapability,
  readEnrolledCredentialId,
  requestOwnerAssertion,
  type BiometricCapability,
  type OwnerAssertion,
} from "@/lib/agent/webauthn";

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

function windowLabel(seconds: number): string {
  if (seconds > 0 && seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  return `${seconds}s`;
}

/** Remaining window allowance, clamped at zero. Integer-exact: no float ever touches an amount. */
function remainingWei(capWei: string, spentWei: string): bigint {
  try {
    const left = BigInt(capWei) - BigInt(spentWei);
    return left > 0n ? left : 0n;
  } catch {
    return 0n;
  }
}

function authErrorOf(error: unknown): { code: string; message: string } {
  if (error instanceof WebBiometricError) {
    return { code: error.code, message: error.message };
  }
  return { code: "ASSERTION_FAILED", message: (error as Error).message };
}
export interface ConsumerViewProps {
  /** Flips the shell to the M1-M5 engineer/audit view. */
  readonly onSwitchToDeveloper: () => void;
}

export function ConsumerView({ onSwitchToDeveloper }: ConsumerViewProps) {
  const [statusState, setStatusState] = useState<StatusState>({ kind: "loading" });
  const [balance, setBalance] = useState<string | null>(null);

  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [credentialId, setCredentialId] = useState<string | null>(null);
  const [nullifier, setNullifier] = useState<Hex | null>(null);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<IntentSuccess | null>(null);
  const [refusal, setRefusal] = useState<AgentRefusal | null>(null);
  const [localNote, setLocalNote] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [asserting, setAsserting] = useState(false);
  const [assertion, setAssertion] = useState<OwnerAssertion | null>(null);
  const [authError, setAuthError] = useState<{ code: string; message: string } | null>(null);
  const [enrolling, setEnrolling] = useState(false);

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

  // Probing a platform authenticator and reading the enrolled credential id are capability *reads*;
  // neither raises a biometric sheet, so both are safe without an owner gesture.
  useEffect(() => {
    let cancelled = false;
    const enrolled = readEnrolledCredentialId();
    setCredentialId(enrolled);
    void (async () => {
      const report = await readBiometricCapability();
      if (cancelled) {
        return;
      }
      setCapability(report);
      if (enrolled !== null) {
        try {
          setNullifier(await deriveOwnerNullifier(enrolled));
        } catch {
          setNullifier(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
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

  const submit = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (trimmed === "") {
      return;
    }
    setBusy(true);
    setRefusal(null);
    setPreview(null);
    setLocalNote(null);
    setAssertion(null);
    setAuthError(null);
    try {
      const answer = await requestIntent({ prompt: trimmed });
      if (answer.ok) {
        setPreview(answer);
        setConfirmOpen(true);
      } else {
        setRefusal(answer.refusal);
      }
    } catch (error) {
      // `requestIntent` already folds a transport failure into a refusal value; this is belt-and-braces.
      setRefusal({ stage: "request", code: "NETWORK_UNREACHABLE", reason: (error as Error).message });
    } finally {
      setBusy(false);
    }
  }, []);

  const showLedger = useCallback(() => {
    setPreview(null);
    setRefusal(null);
    setConfirmOpen(false);
    setAssertion(null);
    if (statusState.kind !== "ready") {
      setLocalNote("本地策略账本还没读回来，稍后再试。");
      return;
    }
    const { policy, spend } = statusState.status;
    const left = remainingWei(policy.maxValueWeiPerWindow, spend.spentWei);
    setLocalNote(
      [
        "今日节点收益：本版本尚未接入收益账本，所以这里不显示任何未经验证的数字。",
        `可验证的本地账本：滚动窗口 ${windowLabel(policy.windowSeconds)} 内已用 ${formatWeiAsEth(spend.spentWei)} / ${formatWeiAsEth(policy.maxValueWeiPerWindow)} ETH，剩余 ${formatWeiAsEth(left.toString())} ETH。`,
      ].join("\n"),
    );
  }, [statusState]);

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
    setAsserting(true);
    setAuthError(null);
    try {
      const asserted = await requestOwnerAssertion(preview.digest, "确认这笔交易");
      setAssertion(asserted);
      // Ask for the signature too, so the sheet shows the real enclave answer: on a web host with no
      // bridge that answer is a refusal, and the owner reads the module's own code instead of a tick.
      const signed = await requestIntent({ prompt: preview.inference.prompt, attemptSign: true });
      if (signed.ok) {
        setPreview(signed);
      }
    } catch (error) {
      setAuthError(authErrorOf(error));
    } finally {
      setAsserting(false);
    }
  }, [preview]);

  const enroll = useCallback(async () => {
    setEnrolling(true);
    setAuthError(null);
    try {
      const created = await enrollOwnerCredential("猫糖 Web Agent OS");
      setCredentialId(created.credentialId);
      setNullifier(await deriveOwnerNullifier(created.credentialId));
    } catch (error) {
      setAuthError(authErrorOf(error));
    } finally {
      setEnrolling(false);
    }
  }, []);
  // -- render -----------------------------------------------------------------------------------

  const status = statusState.kind === "ready" ? statusState.status : null;
  const owner = status?.deployment.owner ?? null;
  const windowText = status === null ? NO_VALUE : windowLabel(status.policy.windowSeconds);
  const leftWei = status === null ? null : remainingWei(status.policy.maxValueWeiPerWindow, status.spend.spentWei);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-maotang-mint">MAOTANG Protocol</p>
          <h1 className="mt-2 text-2xl font-semibold text-white">猫糖 AI 个人助理</h1>
          <p className="mt-1 text-sm text-white/50">说一句话，本地策略先过一遍，再由你的指纹 / 面容确认。</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dex"
            className="rounded-full border border-maotang-border px-3 py-1.5 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint"
          >
            DEX 看板
          </Link>
          <button
            type="button"
            onClick={onSwitchToDeveloper}
            className="rounded-full border border-maotang-mint/50 bg-maotang-mint/10 px-3 py-1.5 text-xs font-medium text-maotang-mint transition hover:bg-maotang-mint/20"
          >
            切换到 工程师/审计视图
          </button>
        </div>
      </header>

      {statusState.kind === "unavailable" ? (
        <div className="mb-4 rounded-2xl border border-maotang-amber/40 bg-maotang-surface px-4 py-3 text-xs">
          <p className="text-maotang-amber">
            本地策略账本未就绪：<span className="font-mono">{statusState.code}</span>
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/45">{statusState.reason}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-maotang-border bg-maotang-surface px-4 py-3 text-xs">
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

      <section className="mt-5 rounded-2xl border border-maotang-border bg-maotang-surface p-5">
        <h2 className="text-sm font-semibold text-white">告诉我你想做什么</h2>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void submit(prompt);
              }
            }}
            placeholder={MINT_PRESET}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-xl border border-maotang-border bg-maotang-ink px-3 py-2.5 text-sm text-white outline-none focus:border-maotang-mint/60"
          />
          <button
            type="button"
            onClick={() => void submit(prompt)}
            disabled={busy || prompt.trim() === ""}
            className="rounded-xl bg-maotang-mint/20 px-4 py-2.5 text-sm font-semibold text-maotang-mint transition hover:bg-maotang-mint/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "思考中\u2026" : "发送"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => runPreset(preset)}
              disabled={busy}
              className="rounded-full border border-maotang-border bg-maotang-ink/60 px-3 py-1.5 text-xs text-white/65 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-white/35">
          离线 M1 只识别固定句式，例如 <span className="font-mono">Send 0.05 ETH to 0x\u2026</span>。其他句子会被本地策略直接拒绝，
          这正是护栏在起作用。
        </p>
      </section>

      {localNote !== null ? (
        <div className="mt-4 whitespace-pre-line rounded-2xl border border-maotang-mint/30 bg-maotang-mint/5 px-4 py-3 text-xs leading-relaxed text-white/70">
          {localNote}
        </div>
      ) : null}

      {refusal !== null ? (
        <div className="mt-4 rounded-2xl border border-maotang-pink/40 bg-maotang-pink/5 px-4 py-3">
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
      <footer className="mt-6 text-[11px] leading-relaxed text-white/35">
        <p>
          设备生物识别：
          {capability === null ? "检测中\u2026" : capability.detail}
          {credentialId === null ? " \u00b7 尚未在本机注册凭据" : " \u00b7 已注册本机凭据"}
        </p>
        <p className="mt-1">
          本页只调用 <span className="font-mono">/api/agent/*</span>；短语翻译、策略判定与摘要都发生在服务端的 M1/M2，
          浏览器不参与任何签名计算。
        </p>
      </footer>

      {confirmOpen && preview !== null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-maotang-border bg-maotang-surface p-5">
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

            {authError !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-amber/40 bg-maotang-amber/5 px-3 py-2">
                <p className="text-[11px] text-maotang-amber">
                  <span className="font-mono">{authError.code}</span>
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/50">{authError.message}</p>
              </div>
            ) : null}

            {assertion !== null ? (
              <div className="mt-3 rounded-lg border border-maotang-mint/40 bg-maotang-mint/5 px-3 py-2 text-[11px]">
                <p className="text-maotang-mint">
                  设备已在 {new Date(assertion.assertedAt).toLocaleTimeString()} 完成验证
                </p>
                <p className="mt-1 text-white/55">
                  用户已验证：{assertion.userVerified ? "是" : "否"} \u00b7 硬件凭据：
                  {assertion.hardwareBacked ? "是" : "否"}
                </p>
                {nullifier !== null ? (
                  <p className="mt-1 break-all text-white/40">
                    HardwareNullifier <span className="font-mono">{shortHex(nullifier, 14, 10)}</span>
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
              disabled={asserting}
              className="mt-4 w-full rounded-xl bg-maotang-mint px-4 py-3 text-sm font-semibold text-maotang-ink transition hover:bg-maotang-mint/85 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {asserting ? "等待设备确认\u2026" : "刷脸 / 指纹安全确认"}
            </button>

            {credentialId === null ? (
              <button
                type="button"
                onClick={() => void enroll()}
                disabled={enrolling}
                className="mt-2 w-full rounded-xl border border-maotang-border px-4 py-2.5 text-xs text-white/60 transition hover:border-maotang-mint/50 hover:text-maotang-mint disabled:cursor-not-allowed disabled:opacity-40"
              >
                {enrolling ? "正在注册\u2026" : "先在本机注册指纹 / 面容"}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setConfirmOpen(false)}
              className="mt-2 w-full rounded-xl px-4 py-2 text-xs text-white/45 transition hover:text-white/70"
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