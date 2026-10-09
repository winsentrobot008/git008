/**
 * The words the two biometric surfaces show, in one place, in either language.
 *
 * The C-end confirmation sheet and the M5 engineer card render the same events - prompt requested,
 * prompt cancelled, webview refused, no credential enrolled - and they must say the same thing about
 * them. Keeping the copy here (rather than in each component) is what stops the two faces from
 * explaining one refusal in two different ways; only the surrounding chrome differs between them.
 *
 * The strings themselves live in `@/lib/i18n/dictionary`, so this module is now a translator for one
 * event vocabulary rather than a second copy of the English/Chinese text. Every language it can return
 * is deliberately explicit that no raw fingerprint or face data leaves the device, and that a cancelled
 * prompt signs nothing - that claim is the reason both surfaces share the copy at all.
 */

import type { ToastTone } from "@/components/agent-console/Toast";
import type { BiometricFailure } from "@/lib/agent/biometric-session";
import type { BiometricCapability, OwnerAssertion } from "@/lib/agent/webauthn";
import { translate, type Language } from "@/lib/i18n/dictionary";

/** Shown the moment the system sheet is requested, so the owner knows the tap landed. */
export function biometricPromptNotice(language: Language): string {
  return translate(language, "biometric.promptNotice");
}

/**
 * Actionable guidance when this environment cannot raise a biometric prompt.
 *
 * Returns `null` when the prompt *can* run - the absence of a warning is itself information, and an
 * unconditional banner would train the owner to ignore it.
 */
export function biometricFallbackCopy(
  capability: BiometricCapability | null,
  language: Language,
): string | null {
  if (capability === null || capability.platformAuthenticator) {
    return null;
  }
  if (capability.embeddedWebview) {
    return translate(language, "biometric.fallbackWebview", {
      shell: capability.embeddingLabel ?? translate(language, "biometric.shellFallback"),
    });
  }
  if (!capability.supported) {
    return translate(language, "biometric.fallbackUnsupported");
  }
  if (!capability.secureContext) {
    return translate(language, "biometric.fallbackInsecure");
  }
  return translate(language, "biometric.fallbackNoAuthenticator");
}

/** Tone + wording for a failed biometric step. The tone is language-independent; only the words move. */
export function biometricFailureToast(
  failure: BiometricFailure,
  language: Language,
): { tone: ToastTone; message: string } {
  switch (failure.code) {
    case "USER_CANCELLED":
      return { tone: "warn", message: translate(language, "biometric.failureCancelled") };
    case "NO_CREDENTIAL":
      return { tone: "info", message: translate(language, "biometric.failureNoCredential") };
    case "WEBVIEW_RESTRICTED":
      return { tone: "warn", message: translate(language, "biometric.failureWebview") };
    case "NO_PLATFORM_AUTHENTICATOR":
      return { tone: "warn", message: translate(language, "biometric.failureNoPlatformAuthenticator") };
    case "NOT_SECURE_CONTEXT":
      return { tone: "error", message: translate(language, "biometric.failureNotSecureContext") };
    case "NO_CHALLENGE":
      return { tone: "info", message: translate(language, "biometric.failureNoChallenge") };
    default:
      return {
        tone: "error",
        message: translate(language, "biometric.failureGeneric", { code: failure.code }),
      };
  }
}

/**
 * Tone + wording for a completed assertion.
 *
 * A signature without the authenticator's own User Verified bit is reported as a warning rather than a
 * celebration: some platforms return an assertion even when the biometric itself failed, and the flags
 * byte is the only thing that separates "the device signed" from "the owner was verified".
 */
export function biometricSuccessToast(
  assertion: OwnerAssertion,
  language: Language,
): { tone: ToastTone; message: string } {
  if (!assertion.userVerified) {
    return { tone: "warn", message: translate(language, "biometric.successUnverified") };
  }
  return { tone: "success", message: translate(language, "biometric.success") };
}