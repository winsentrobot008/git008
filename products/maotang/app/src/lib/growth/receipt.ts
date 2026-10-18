import {
  open,
  readCookie,
  seal,
  type EnrollmentPayload,
} from "@/lib/agent/webauthn-server";

import { SHARE_RECEIPT_TTL_SECONDS, type SharePlatform } from "./rules";

export const GROWTH_SHARE_COOKIE = "mt_growth_share";
export const GROWTH_SHARE_TYPE = "growth-share-intent";

export interface ShareReceiptPayload {
  readonly credentialId: string;
  readonly identityHash: string;
  readonly platform: SharePlatform;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export function createShareReceipt(
  secret: string,
  enrollment: EnrollmentPayload,
  platform: SharePlatform,
): { readonly value: string; readonly payload: ShareReceiptPayload } {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: ShareReceiptPayload = {
    credentialId: enrollment.credentialId,
    identityHash: enrollment.identityHash,
    platform,
    issuedAt,
    expiresAt: issuedAt + SHARE_RECEIPT_TTL_SECONDS,
  };
  return {
    value: seal(GROWTH_SHARE_TYPE, payload, secret, SHARE_RECEIPT_TTL_SECONDS),
    payload,
  };
}

export function readShareReceipt(
  request: Request,
  secret: string,
  enrollment: EnrollmentPayload,
): ShareReceiptPayload | null {
  const receipt = open<ShareReceiptPayload>(
    readCookie(request, GROWTH_SHARE_COOKIE),
    GROWTH_SHARE_TYPE,
    secret,
  );
  if (receipt === null) {
    return null;
  }
  if (receipt.credentialId !== enrollment.credentialId) {
    return null;
  }
  if (receipt.identityHash !== enrollment.identityHash) {
    return null;
  }
  if (receipt.platform !== "x" && receipt.platform !== "telegram") {
    return null;
  }
  return receipt;
}
