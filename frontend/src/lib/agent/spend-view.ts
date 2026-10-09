/**
 * Shared rendering rules for the M2 spend envelope.
 *
 * The M2 card (engineer view) and the C-end status pill show the same two numbers - the rolling window
 * length and what is left in it - so the rule that turns them into text lives here, once. A second copy
 * of that rule is how the 3600-vs-86400 drift happened in the first place (ADR-034 / ADR-035).
 */

/**
 * `86400` -> `"24h"`, `3600` -> `"1h"`, `90` -> `"90s"`.
 *
 * The window is a policy number, so its label is derived from it rather than hard-coded: a shortened
 * test deployment must never be described as "24h".
 */
export function windowLabel(seconds: number): string {
  if (seconds > 0 && seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }
  return `${seconds}s`;
}

/**
 * What is left of the window budget, clamped at zero.
 *
 * Integer-exact - `bigint` end to end - because these are wei, and a float that silently rounds is
 * exactly how a spend becomes the wrong spend. A malformed cap reads as "nothing left", the fail-closed
 * answer, rather than as a fabricated positive balance.
 */
export function remainingWindowWei(capWei: string, spentWei: string): bigint {
  try {
    const left = BigInt(capWei) - BigInt(spentWei);
    return left > 0n ? left : 0n;
  } catch {
    return 0n;
  }
}