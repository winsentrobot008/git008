# 30-Day Cold-Start Operating Plan

Target: 100,000 real Web3 mobile monthly active users within 30 days.

This is an operating plan, not an engineering guarantee. A code change cannot create 100,000 real
users; acquisition, retention and trust decide that outcome. The purpose of this document is to
make the funnel measurable, the experiments honest and the security floor non-negotiable while the
team spends on growth.

## 1. Reality check

100,000 MAU is a distribution number. It must be decomposed before any budget is committed:

```
MAU = seeded installs x activation rate x D30 retention + organic referrals
```

At a 20% D30 retention rate, 100,000 MAU requires roughly 500,000 activated installs in the window.
At 10%, it requires roughly 1,000,000. A referral loop with a K-factor of 0.3 shortens the paid
seed but does not replace it. A plan that promises 100,000 MAU without a channel budget, a real
reward and a retention curve is a fiction.

## 2. Launch blockers (must be true before paid acquisition)

1. **The reward must be real.** The claim route verifies the WebAuthn assertion server-side and,
   when `MAOTANG_FAUCET_*` is configured, submits `MaotangFaucet.claim` with a server-derived amount
   and returns a real `txHash`; `/api/agent/claim/status` reports Pending -> Confirmed from the
   receipt. A sealed X/Telegram share-intent receipt changes the amount from 10 to 12.5 MAOTANG.
   The receipt proves the composer was opened on the enrolled device, not that a platform published
   a post. With no faucet configured the route returns `503 FAUCET_UNCONFIGURED`.
2. **The zero-gas promise must be real.** `MaotangPaymaster.sol` and the signed-ticket / live-quota
   routes are implemented, and the UI reads the chain instead of a static 100/100. But no Paymaster
   is deployed or deposited, no bundler submits `UserOperation`s, and the ticket does not yet bind
   target / calldata. Until those are live and verified, the product must not advertise free gas as
   a live benefit.
3. **DeChat must carry real messages.** The current panel is a session-local preview: no relay, no
   E2EE envelope transport and no device-bound encrypted store. A viral social card is not a
   communication product until message delivery, key exchange and offline behaviour are implemented
   and tested on physical devices.
4. **Analytics must exist without PII.** `/api/growth/event` attributes app opens, referral opens,
   activations and claim starts to a server-derived pseudonymous subject. Claim broadcast and
   settlement are recorded server-side. Counters and hashed active-user bitmaps persist through a
   Redis-compatible REST store; `/api/telemetry/summary` reports D1/D7 cohort return, DAU, invite,
   conversion and share counts. Production without a durable backend reports `configured: false`.
   Never send credential IDs, nullifiers, private keys, wallet addresses or message bodies.
5. **Abuse controls must be live.** Server-side WebAuthn attestation, `userVerified`, and the
   on-chain one-claim `identityHash` ledger now exist, but they only stop replay of one credential.
   App Attest / Play Integrity, device-risk signals, per-IP and per-device rate limits, referral
   caps, and a review queue for anomalous claim velocity remain launch blockers.

## 3. Funnel targets

| Stage | Definition | 30-day target |
| --- | --- | --- |
| Install / PWA launch | First open from a valid referral or campaign | baseline + channel plan |
| Activation | Face ID enrollment completed and Vault rendered | >= 60% of launches |
| Claim request | Hardware assertion accepted and ticket issued | >= 50% of activated users |
| Claim settlement | Reward actually credited by the settlement system | >= 80% of valid requests |
| D1 retention | Returns on day 1 | >= 35% |
| D7 retention | Returns on day 7 | >= 20% |
| D30 retention | Returns on day 30 | >= 10% |
| K-factor | Invites that activate per activated user | >= 0.35 |
| Fraud rate | Claims rejected by device/risk review | < 2% |

These are hypotheses to validate in week 1, not historical results.

## 4. Weekly cadence

**Week 1 - Instrument and harden.** The event schema, receipt-gated share bonus, Genesis Points and
dashboard are implemented. Establish the activation baseline on physical iOS and Android devices.
Verify App Attest / Play Integrity rejection paths, the security hold, and the `/v1/broadcast` 404
at the edge. No paid traffic until the claim settlement path is real.

**Week 2 - Referral loop.** Test three ClaimCard variants (reward framing, social proof, QR
placement) and two share-link entry points. Run the leaderboard as a read-only display first; do
not let it become a second source of truth. Measure invite-open rate, activation rate and K-factor.

**Week 3 - Channel seeding.** Seed creators and communities with tracked links. Cap acquisition
cost per activated user and pause any channel whose fraud rate or D1 retention is outside the
guardrail. Keep the referral loop running only for variants that beat control at a pre-declared
sample size.

**Week 4 - Scale winners.** Reallocate budget to the winning channel and creative, stabilise
retention messaging, and run an incident drill. Publish the real funnel numbers internally; do not
inflate MAU with bots, emulators or duplicate identities.

## 5. Experiment rules

- One primary metric per experiment, declared before launch.
- No peeking and stopping on a favourable day; use a fixed sample or a sequential test.
- Segment by platform (iOS/Android), referral source and enrollment state.
- Every visual experiment keeps the same Face ID gate. Copy can change; authorization cannot.
- A variant that increases claims but also increases rejected assertions is a regression, not a win.

## 6. Fail-closed runbook

Engage `MAOTANG_SECURITY_HOLD=1` and redeploy when any of the following is confirmed:

- a signing, key-isolation or assertion-verification defect;
- a claim velocity anomaly consistent with a phone farm or replay;
- a service-role credential, deployment token or RPC credential is exposed;
- the error rate on `/api/agent/intent` or `/api/agent/claim` crosses the incident threshold.

The hold freezes the two value-moving routes; `/v1/broadcast` is already a hard 404. Then:

1. preserve logs and evidence, without copying secrets;
2. rotate exposed credentials in the provider console;
3. roll back to the last known-good deployment if the defect is in the release;
4. notify users only with verified facts, never with a promise that a reward settled when it did not;
5. release the hold only after the fix is verified on a physical device and every policy test passes.

## 7. Non-goals

- Purchased installs, emulator farms or synthetic MAU.
- Announcing an on-chain reward before the settlement transaction exists.
- A destructive "self-destruct" that deletes keys or user data. Containment is freeze, rotate,
  roll back and disclose; irreversible destruction creates a second incident.

## 8. Implemented growth loop

- Share unlock: `/api/growth/share-intent` seals an HttpOnly receipt bound to the hardware
  enrollment. The claim route ignores client booleans and applies `1.25x` only while the receipt is
  valid. The base reward never depends on sharing.
- Genesis Points: referral open `5`, conversion `100`, share intent `25`, claim broadcast `250`.
  Tiers are `1.0x` (seed), `1.1x` at 10 conversions, `1.25x` at 100, and `1.5x` at 1,000.
- Attribution: aggregate counters and hashed bitmap positions only. No IP, wallet, credential ID,
  assertion, message body or free-form visitor identifier is accepted by the growth-event route.
- D1/D7: the first app open creates a cohort bitmap; D1 and D7 are the share of that cohort active on
  the corresponding later UTC day. Bitmap collisions make these approximate at very large scale.
- Local attribution: without Redis outside production, the same counters persist to an atomically
  written JSON snapshot under `products/maotang/runtime_data/`. Override the path with
  `MAOTANG_GROWTH_FALLBACK_FILE`; production never silently substitutes this local file for Redis.
- Share previews: `/dechat?ref=<code>` emits referral-aware OpenGraph and X card metadata plus a
  generated 1200x630 preview image. A preview or share receipt is not evidence of a published post.
- Distribution: see `docs/GROWTH_KOL_BLITZ.md` for the golden-link format, KOL whitelist process,
  Telegram copy and X templates.
