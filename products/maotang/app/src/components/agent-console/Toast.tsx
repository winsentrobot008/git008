"use client";

/**
 * Toasts - short, self-dismissing feedback for a device interaction the page cannot show itself.
 *
 * The biometric prompt is why this exists. Face ID / Touch ID renders *outside* the document, so when
 * it is dismissed, times out, or a webview refuses to raise it at all, the only evidence the owner has
 * is what we put on screen. A toast says "we asked, and here is what came back" without moving the
 * button they just tapped - which matters on iOS Safari, where re-entering the handler is the whole
 * retry affordance.
 *
 * Accessibility: the stack is a `role="status"` live region, so a screen reader announces each line,
 * and the container is `pointer-events-none` so a toast never swallows a tap meant for the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type ToastTone = "info" | "success" | "warn" | "error";

export interface ToastMessage {
  readonly id: number;
  readonly tone: ToastTone;
  readonly message: string;
}

const TONE_CLASS: Readonly<Record<ToastTone, string>> = Object.freeze({
  info: "border-maotang-border bg-maotang-surface text-white/80",
  success: "border-maotang-mint/50 bg-maotang-mint/10 text-maotang-mint",
  warn: "border-maotang-amber/50 bg-maotang-amber/10 text-maotang-amber",
  error: "border-maotang-pink/50 bg-maotang-pink/10 text-maotang-pink",
});

/** Long enough to read one line on a phone, short enough not to pile up behind a retry. */
const DEFAULT_DISMISS_MS = 5200;

/** At most this many toasts are on screen; a burst of failures must not cover the confirm button. */
const MAX_VISIBLE = 3;

export interface ToastQueue {
  readonly toasts: readonly ToastMessage[];
  push(tone: ToastTone, message: string): void;
  dismiss(id: number): void;
}

export function useToastQueue(autoDismissMs: number = DEFAULT_DISMISS_MS): ToastQueue {
  const [toasts, setToasts] = useState<readonly ToastMessage[]>([]);
  const timers = useRef<number[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { id, tone, message }].slice(-MAX_VISIBLE));
      const handle = window.setTimeout(() => dismiss(id), autoDismissMs);
      timers.current.push(handle);
    },
    [autoDismissMs, dismiss],
  );

  // Timers are cleared on unmount only; the queue is otherwise self-draining.
  useEffect(
    () => () => {
      for (const handle of timers.current) {
        window.clearTimeout(handle);
      }
      timers.current = [];
    },
    [],
  );

  return useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
}

export interface ToastStackProps {
  readonly toasts: readonly ToastMessage[];
  readonly onDismiss: (id: number) => void;
}

/** Fixed at the top (below the notch) so it never fights the docked chat bar at the bottom. */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) {
    return null;
  }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-safe-top">
      <div role="status" aria-live="polite" className="flex w-full max-w-md flex-col gap-2">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            onClick={() => onDismiss(toast.id)}
            className={`pointer-events-auto w-full touch-manipulation rounded-xl border px-4 py-3 text-left text-xs leading-relaxed shadow-lg backdrop-blur ${TONE_CLASS[toast.tone]}`}
          >
            {toast.message}
          </button>
        ))}
      </div>
    </div>
  );
}