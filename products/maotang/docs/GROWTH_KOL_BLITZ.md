# MAOTANG Genesis KOL Blitz

This is the operating kit for the 30-day MAOTANG growth sprint. It supports aggressive distribution
without inventing users, verified posts or on-chain settlements. The 100,000-user target remains a
budgeted acquisition and retention target, not a promise that links alone can satisfy.

## 1. Golden referral links

Use one canonical destination so attribution is comparable across channels:

```text
https://maotang.008ai.online/dechat?ref=<code>
```

The `code` is the public `.008ai` alias without the suffix. A KOL must first enroll the device and
derive the alias from the app. Never put a wallet address, private key, credential ID, phone number
or Telegram user ID in the `ref` parameter.

Channel examples:

```text
X:        https://maotang.008ai.online/dechat?ref=alpha&utm_source=x
Telegram: https://maotang.008ai.online/dechat?ref=alpha&utm_source=telegram
Community:https://maotang.008ai.online/dechat?ref=alpha&utm_source=community
```

Only `ref` drives product attribution today. UTM values are retained by the channel's own analytics
and can be added later without changing the public referral grammar.

## 2. KOL whitelist policy

The whitelist marks reviewed partners and gives the dashboard an explicit status. It is not a token
allowance and it does not bypass Face ID, the faucet ledger or the security hold.

Use `MAOTANG_KOL_CODES` for a fast comma-separated list. Use the `kolWhitelist` array in
`app/config/growth.json` when a partner needs a named tier or an inactive state:

```json
{
  "code": "partnercode",
  "tier": "gold",
  "status": "active"
}
```

Minimum review before whitelisting:

1. The KOL has a real, reachable audience in Web3, DeFi, privacy or mobile consumer crypto.
2. The account has no sustained bot, engagement-farm or impersonation history.
3. The partner accepts the no-fake-claim rule and the hardware-verification flow.
4. The code is recorded in the campaign sheet with owner, channel, start date and review date.
5. The code is removed immediately on fraud, impersonation, malicious creative or a compliance hold.

Recommended seed mix for week 1:

| Segment | Partners | Purpose |
| --- | ---: | --- |
| Privacy and messaging | 3-5 | Test the social-card narrative |
| DeFi and public goods | 3-5 | Test utility and Genesis Points |
| Human/identity advocates | 2-4 | Test personhood framing |
| Mobile growth creators | 2-3 | Test the one-tap flow on camera |

Do not buy a wall of identical accounts. A smaller set of credible nodes with measured D1 return is
worth more than raw impressions.

## 3. Share bonus and Genesis Points

The ClaimCard offers X and Telegram composer links. Tapping one calls the server share-intent route;
the server seals a 15-minute receipt bound to the hardware enrollment. The claim route applies a
`1.25x` reward only if that receipt is still valid. It proves share intent, not publication.

Genesis Points:

| Action | Points |
| --- | ---: |
| Referral link opened | 5 |
| Verified referral conversion | 100 |
| Share receipt | 25 |
| Claim broadcast | 250 |

Tiers: seed `1.0x`, signal at 10 conversions `1.1x`, gold at 100 conversions `1.25x`, constellation at
1,000 conversions `1.5x`. The server computes the tier and points; the browser never supplies either.

## 4. Telegram red-packet copy

Chinese, one-message version:

```text
人类币（MAOTANG）Genesis 空投开放中。
83 亿枚硬顶，Face ID 硬件确认后领取测试网体验金。
通过专属链接进入即可进入邀请榜单，分享可解锁 1.25 倍体验加成。
名额与链上确认以页面回执为准：https://maotang.008ai.online/dechat?ref=alpha&utm_source=telegram
```

English, one-message version:

```text
Human Coin (MAOTANG) Genesis is open.
8.3B hard cap. Face ID hardware confirmation gates the testnet claim.
Enter through the referral link, then share to unlock the 1.25x experience bonus.
Rewards and confirmations are shown only after the faucet returns an on-chain receipt:
https://maotang.008ai.online/dechat?ref=alpha&utm_source=telegram
```

Follow-up after a member asks what is live:

```text
The claim amount and txHash come from the configured faucet. A pending transaction is not a credited
balance. Sharing creates a server receipt for the bonus; it does not prove that a post stayed online.
```

## 5. X campaign templates

Template A, product-first:

```text
What if a social card could carry a real claim?

MAOTANG Human Coin now runs a Face ID-gated testnet faucet: 8.3B hard cap, on-chain receipt, and a
1.25x share bonus for verified device intent.

Open the card: https://maotang.008ai.online/dechat?ref=alpha&utm_source=x
```

Template B, referral-first:

```text
I opened a Genesis node on MAOTANG.

Claim through my card, complete the hardware check, and watch the txHash settle on-chain.
Share from the card to unlock the bonus.

https://maotang.008ai.online/dechat?ref=alpha&utm_source=x
```

Template C, privacy-first:

```text
No email. No password dump. A device-bound Face ID assertion, a pseudonymous referral code, and a
public faucet receipt.

MAOTANG Genesis is testing the social-claim loop:
https://maotang.008ai.online/dechat?ref=alpha&utm_source=x
```

Each partner should adapt the creative in their own voice. Keep the contract, cap, Face ID gate and
Pending -> Confirmed distinction intact.

## 6. Launch cadence

Day 1: seed 8-12 reviewed KOLs and community admins. Watch activation, claim error codes and share
receipt failures before increasing volume.

Day 2-3: run the three X templates and two Telegram copy variants. Compare share-receipt rate,
claim-broadcast rate and D1 return rather than click volume alone.

Day 4-7: keep the top two channels, pause any partner with abnormal claim rejection or no activation.
Add one community AMA or Space with a live Face ID walkthrough.

Week 2: publish a transparent leaderboard from `/api/telemetry/summary`; never expose raw identity
keys. Test creator bundles, QR placements and referral copy with fixed samples.

Week 3: expand into adjacent privacy, public-goods and mobile-crypto communities only when the
current cohort has acceptable D1 and fraud metrics.

Week 4: double down on the highest-retention source, run an incident drill and publish internal
actuals. Do not convert paid impressions, bots or duplicate emulators into MAU.

## 7. Real-time operating checks

`GET /api/telemetry/summary?code=<code>` returns `configured`, `storage`, `invites`, `conversions`,
`shareIntents`, `dailyActiveUsers`, `d1Retention`, `d7Retention`, `genesisPoints` and the server tier.

Production must set `MAOTANG_GROWTH_REDIS_REST_URL` and `MAOTANG_GROWTH_REDIS_REST_TOKEN` (or the
Upstash/Vercel KV equivalents). Without a durable backend the dashboard says `configured: false`; it
does not display invented zeros as measured traffic.

Local development without Redis uses `runtime_data/growth-attribution.json` by default and reports
`storage: "file"`. Override that path with `MAOTANG_GROWTH_FALLBACK_FILE` when testing in an isolated
workspace. The fallback is intentionally disabled in production builds.

Every referral share URL renders an OpenGraph title naming the inviter, a testnet-claim description,
and a generated 1200x630 image. X also receives a `summary_large_image` card. Check a new creative or
domain change with a fresh X card validator and Telegram link preview before the blitz.

Incident rule: set `MAOTANG_SECURITY_HOLD=1` and redeploy if claim fraud, key exposure or abnormal
assertion failures are confirmed. Growth pages may still render, but value-moving routes must fail
closed with `SECURITY_HALTED`.
