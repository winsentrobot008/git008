/**
 * The words the two biometric surfaces show, in one place.
 *
 * The C-end confirmation sheet and the M5 engineer card render the same events - prompt requested,
 * prompt cancelled, webview refused, no credential enrolled - and they must say the same thing about
 * them. Keeping the copy here (rather than in each component) is what stops the two faces from
 * explaining one refusal in two different ways; only the surrounding chrome differs between them.
 *
 * Every string is deliberately explicit that no raw fingerprint or face data leaves the device, and
 * that a cancelled prompt signs nothing.
 */

import type { BiometricFailure } from "@/lib/agent/biometric-session";
import type { BiometricCapability, OwnerAssertion } from "@/lib/agent/webauthn";
import type { ToastTone } from "@/components/agent-console/Toast";

/** Shown the moment the system sheet is requested, so the owner knows the tap landed. */
export const BIOMETRIC_PROMPT_NOTICE = "已请求硬件验证：请在系统弹窗中完成 Face ID / Touch ID。";

/**
 * Actionable guidance when this environment cannot raise a biometric prompt.
 *
 * Returns `null` when the prompt *can* run - the absence of a warning is itself information, and an
 * unconditional banner would train the owner to ignore it.
 */
export function biometricFallbackCopy(capability: BiometricCapability | null): string | null {
  if (capability === null || capability.platformAuthenticator) {
    return null;
  }
  if (capability.embeddedWebview) {
    return `当前在 ${capability.embeddingLabel ?? "内置浏览器"} 内打开，系统级 Face ID / Touch ID 可能被限制。请用 Safari 或 Chrome 打开本页后重试。`;
  }
  if (!capability.supported) {
    return "当前环境没有可用的 WebAuthn，无法调起系统生物识别。";
  }
  if (!capability.secureContext) {
    return "请用 HTTPS（或 localhost）打开本页，浏览器才允许调用生物识别。";
  }
  return "本机未检测到可用的 Face ID / Touch ID，请先在系统设置中录入指纹或面容。";
}

/** Tone + wording for a failed biometric step. */
export function biometricFailureToast(failure: BiometricFailure): { tone: ToastTone; message: string } {
  switch (failure.code) {
    case "USER_CANCELLED":
      return { tone: "warn", message: "已取消生物识别验证，没有任何交易被签名。" };
    case "NO_CREDENTIAL":
      return { tone: "info", message: "本机还没有注册凭据，请先点“注册本机指纹 / 面容”。" };
    case "WEBVIEW_RESTRICTED":
      return { tone: "warn", message: "内置浏览器限制了系统生物识别，请改用 Safari / Chrome 打开本页。" };
    case "NO_PLATFORM_AUTHENTICATOR":
      return { tone: "warn", message: "本机未启用 Face ID / Touch ID，请先在系统设置中录入。" };
    case "NOT_SECURE_CONTEXT":
      return { tone: "error", message: "当前不是安全上下文（HTTPS / localhost），浏览器拒绝调用生物识别。" };
    case "NO_CHALLENGE":
      return { tone: "info", message: "还没有待签摘要，先让助理生成一笔交易再验证。" };
    default:
      return { tone: "error", message: `生物识别未完成：${failure.code}` };
  }
}

/**
 * Tone + wording for a completed assertion.
 *
 * A signature without the authenticator's own User Verified bit is reported as a warning rather than a
 * celebration: some platforms return an assertion even when the biometric itself failed, and the flags
 * byte is the only thing that separates "the device signed" from "the owner was verified".
 */
export function biometricSuccessToast(assertion: OwnerAssertion): { tone: ToastTone; message: string } {
  if (!assertion.userVerified) {
    return { tone: "warn", message: "设备返回了签名，但未确认“用户已验证”，请重新验证。" };
  }
  return { tone: "success", message: "硬件验证通过：本机凭据签署了待签摘要，未上传任何原始指纹 / 面容数据。" };
}