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

1. **The reward must be real.** The current claim route returns a pending ticket with
   `onChain: false` and `faucetConfigured: false`. A 10 MAOTANG headline cannot drive retention
   until a faucet or an audited settlement ledger actually credits the reward.
2. **The zero-gas promise must be real.** The Paymaster quota card is a UX entitlement indicator.
   Until an ERC-4337 Paymaster (or equivalent) sponsors the transactions, the product must not
   advertise free gas as a live benefit.
3. **DeChat must carry real messages.** The current panel is an E2EE preview. A viral social card
   is not a communication product until message delivery, key exchange and offline behaviour are
   implemented and tested on physical devices.
4. **Analytics must exist without PII.** Define events before launch: install, PWA launch, Face ID
   enrollment, claim requested, claim settled, referral opened, message sent, payment card opened,
   payment confirmed. Use a first-party endpoint or a privacy-preserving provider; never send
   credential IDs, nullifiers, private keys or message bodies.
5. **Abuse controls must be live.** App Attest / Play Integrity, device-risk signals, per-IP and
   per-device rate limits, referral caps, and a review queue for anomalous claim velocity.

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

**Week 1 - Instrument and harden.** Ship the event schema, referral attribution and dashboard.
Establish the activation baseline on physical iOS and Android devices. Verify App Attest / Play
Integrity rejection paths, the security hold, and the `/v1/broadcast` 404 at the edge. No paid
traffic until the claim settlement path is real.

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
5. release the hold only after the fix is verified on a physical device and the policy gate is 28/28.

## 7. Non-goals

- Purchased installs, emulator farms or synthetic MAU.
- Announcing an on-chain reward before the settlement transaction exists.
- A destructive "self-destruct" that deletes keys or user data. Containment is freeze, rotate,
  roll back and disclose; irreversible destruction creates a second incident.
