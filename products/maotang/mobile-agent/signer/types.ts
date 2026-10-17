/**
 * Shared primitives for the M2 autonomous wallet.
 *
 * `Hex` and `Address` are local aliases instead of an import from `@maotang/sdk`: `mobile-agent` is a
 * standalone, dependency-free package (the same choice `agent-client` and `agent-manager` make), so a
 * mobile host can bundle it without dragging the SDK, `ethers` or any other runtime dependency in.
 */

/** Lowercase-prefixed hex string, `0x...`. */
export type Hex = `0x${string}`;

/** 20-byte EVM address, lowercase `0x` hex. */
export type Address = `0x${string}`;

/** 32-byte hash, lowercase `0x` hex. */
export type Bytes32 = `0x${string}`;

const HEX_BODY = /^[0-9a-f]*$/;
const ADDRESS_PATTERN = /^0x[0-9a-f]{40}$/;

/** True only for a lowercase, 20-byte hex address. */
export function isAddress(value: string): value is Address {
  return ADDRESS_PATTERN.test(value);
}

/** True only for a lowercase hex string of even length (a whole number of bytes). */
export function isHex(value: string): value is Hex {
  return value.startsWith("0x") && value.length % 2 === 0 && HEX_BODY.test(value.slice(2));
}

/** Normalizes an address to lowercase, throwing on anything malformed so callers cannot fail open. */
export function normalizeAddress(value: string): Address {
  const trimmed = value.trim().toLowerCase();
  if (!isAddress(trimmed)) {
    throw new RangeError(`not a 20-byte hex address: ${value}`);
  }
  return trimmed;
}

/** Number of bytes in a `0x` hex string. Throws rather than guessing on malformed input. */
export function hexByteLength(value: string): number {
  if (!isHex(value)) {
    throw new RangeError(`not an even-length 0x hex string: ${value}`);
  }
  return (value.length - 2) / 2;
}

/** How an action was authorized, in the order the wallet trusts it. */
export type AuthorizationMethod = "biometric" | "device-passcode" | "simulated";

/**
 * What the wallet asks for before releasing a signature above the policy threshold.
 *
 * `challenge` is the transaction digest itself: binding the assertion to that digest is what stops a
 * captured biometric approval from being replayed against a different transaction.
 */
export interface AuthorizationRequest {
  readonly keyId: string;
  readonly reason: string;
  readonly challenge: Hex;
  readonly to: Address;
  readonly valueWei: bigint;
  readonly selector: Hex | null;
}

/**
 * Proof that a human authorized the exact challenge it was asked about.
 *
 * `hardwareBacked` is false for every simulated or passcode-only grant. A strict policy can require
 * `true` (see `requireHardwareBackedAuthorization`), which is how a build refuses to run on a
 * simulated authenticator without saying so.
 */
export interface AuthorizationGrant {
  readonly method: AuthorizationMethod;
  readonly keyId: string;
  readonly challenge: Hex;
  readonly grantedAt: number;
  readonly hardwareBacked: boolean;
  readonly detail: string;
}

/**
 * The M5 seam consumed by the M2 wallet.
 *
 * `authorize` must **reject** (throw) when it cannot produce a real grant. Returning a grant it cannot
 * back is the one failure mode that would make every upstream guardrail decorative.
 */
export interface AuthorizationGate {
  authorize(request: AuthorizationRequest): Promise<AuthorizationGrant>;
}
