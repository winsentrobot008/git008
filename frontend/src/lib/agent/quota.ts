/**
 * Server-side quota report for the web console (ADR-045).
 *
 * The C-end card shows the console's compute ledger, so the number it paints has to come from the real
 * vesting ledger rather than from a constant in a component. The ledger itself - the entropy judge, the
 * one-slice-per-epoch rule, the terminal slash - is `LocalQuotaVault` in the M1 layer; this module only
 * *runs* it against the inputs a web host can honestly supply and shapes the result for the wire.
 *
 * What a web host can honestly supply is very little, and that is stated rather than papered over:
 *
 *   - there is no device-side interaction log here, so the vault starts at genesis - fully locked - and
 *     `AGENT_QUOTA_VESTED_EPOCHS` is the only way an operator can declare pre-existing local history. It
 *     is unset in the preview deployment, so the public console reports the truth: nothing vested yet.
 *   - the live epoch clock is real. `floor(unixSeconds / 86400)` is the same epoch index
 *     `LocalQuotaVault` accrues against, so "how far into today's vesting epoch are we" is a fact about
 *     the moment, not a decoration.
 *
 * Nothing here holds a key, opens a socket or spends. It reads a ledger and returns a snapshot.
 */

import {
  DAILY_UNLOCK_YUANYUAN,
  LocalQuotaVault,
  VESTING_EPOCH_SECONDS,
  type QuotaSnapshot,
} from "@maotang/mobile-agent/dist/slm/index.js";

import type { QuotaReport } from "./quota-view";

/**
 * A human-looking epoch, used only to replay the operator-declared history.
 *
 * The offsets are irregular on purpose: `assessEntropy` rejects a metronome, so a replay that is not
 * itself entropic accuses the node of being a bot and slashes the quota it was meant to restore. Six
 * distinct request shapes, one session, one claimed device - the shape of a person using a phone.
 */
const HUMAN_OFFSETS: readonly number[] = [0, 7, 23, 31, 58, 96];
const HUMAN_KINDS: readonly string[] = [
  "transfer",
  "createMemeToken",
  "claimHumanQuota",
  "transfer",
  "createMemeToken",
  "transfer",
];

/** Declared local interaction epochs, or `0` (genesis) when the operator has declared none. */
function declaredEpochs(): number {
  const raw = process.env.AGENT_QUOTA_VESTED_EPOCHS?.trim();
  if (raw === undefined || raw === "") {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

/** Replays `count` entropic epochs into the vault, exactly as the device's own log would. */
function replayEpochs(vault: LocalQuotaVault, count: number): void {
  for (let epochIndex = 1; epochIndex <= count; epochIndex += 1) {
    const base = epochIndex * VESTING_EPOCH_SECONDS;
    vault.observeEntropy({
      samples: HUMAN_OFFSETS.map((offset, slot) => ({
        atSeconds: base + offset,
        kind: HUMAN_KINDS[slot] ?? "transfer",
        digest: `declared-epoch-${epochIndex}-${slot}`,
        sessionId: `declared-session-${epochIndex}`,
      })),
      claimedDevices: 1,
      nowSeconds: base + HUMAN_OFFSETS[HUMAN_OFFSETS.length - 1] + 1,
    });
  }
}

/**
 * The quota block `/api/agent/status` reports.
 *
 * Every bigint is stringified on the way out (JSON has no bigint), and the live epoch phase is computed
 * here - on the server - so the client's first paint matches the server's HTML.
 */
export function buildQuotaReport(nowMs: number = Date.now()): QuotaReport {
  const vault = new LocalQuotaVault();
  replayEpochs(vault, declaredEpochs());
  const snapshot: QuotaSnapshot = vault.snapshot();

  const epochSeconds = VESTING_EPOCH_SECONDS;
  const epochElapsedSeconds = Math.floor(nowMs / 1000) % epochSeconds;
  const epochProgressBasisPoints = Math.floor((epochElapsedSeconds * 10_000) / epochSeconds);

  return {
    state: snapshot.state,
    tier: snapshot.tier,
    nominalYuanYuan: snapshot.nominalYuanYuan.toString(),
    unlockedYuanYuan: snapshot.unlockedYuanYuan.toString(),
    consumedYuanYuan: snapshot.consumedYuanYuan.toString(),
    availableYuanYuan: snapshot.availableYuanYuan.toString(),
    denominations: {
      yuanYuan: snapshot.denominations.yuanYuan.toString(),
      maoMao: snapshot.denominations.maoMao.toString(),
      fenFen: snapshot.denominations.fenFen.toString(),
    },
    availableDenominations: {
      yuanYuan: snapshot.availableDenominations.yuanYuan.toString(),
      maoMao: snapshot.availableDenominations.maoMao.toString(),
      fenFen: snapshot.availableDenominations.fenFen.toString(),
    },
    epochsAccrued: snapshot.epochsAccrued,
    windowDays: snapshot.windowDays,
    dailyUnlockYuanYuan: DAILY_UNLOCK_YUANYUAN.toString(),
    vestingBasisPoints: snapshot.vestingBasisPoints,
    slashedCode: snapshot.slashedCode,
    slashedReason: snapshot.slashedReason,
    epochSeconds,
    epochElapsedSeconds,
    epochProgressBasisPoints,
  };
}
