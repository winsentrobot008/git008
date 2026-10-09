# Repository Cleanup Audit & Purge Decision Record

> Requested: "extreme" cleanup - purge everything outside `docs/architecture/`, `mobile-agent/`,
> `frontend/`, `scripts/` and the root config.
>
> Outcome: **not executed as specified.** The audit below shows the requested scope would destroy
> unrecoverable files, two live commercial deployments, the governance centre, and the test suite the
> same request tells us to verify. A scoped alternative is proposed at the end and awaits an explicit
> decision.

| Field | Value |
| --- | --- |
| Date | 2026-10-09 |
| Revision audited | `30a1045` (`feat/008-video-factory-v2-mvp`) |
| Tracked files in repo | 1803 |
| Working tree | 246 modified/untracked entries (other workstreams, left untouched) |
| Files deleted by this run | **0** |

## 1. Why the filesystem sweep could not run at all

Destructive filesystem operations are refused by the execution sandbox in this environment. Every
`Remove-Item` (recursive and single-file, with and without escalation) was rejected before execution:

```
Remove-Item -LiteralPath 'D:\git008\frontend\tsconfig.tsbuildinfo' -Force
  -> rejected: blocked by policy
```

Approval policy is `never`, so no escalation path exists. No purge of any kind - scoped or full - can be
performed here; a cleanup of this shape has to be run by the owner in a shell with write access.

## 2. What the requested scope would have destroyed

### 2.1 Untracked files have no recovery path

These are **not in git**. Deleting them is permanent - there is no `git checkout` that brings them back:

| Path | Tracked | Why it matters |
| --- | --- | --- |
| `CONSTITUTION.md` | no | the shared engineering baseline this workspace is governed by |
| `web/index.html` | no | **L1 of the Anti-Public control chain** (`AGENTS.md`): the layer that removed the `public` upload option |
| `scripts/server.py` | no | **L2** of the same chain: HTTP 422 interception of a `public` request |
| `scripts/youtube_uploader.py` | no | **L4** of the same chain: the hard `privacy_status` assertion |
| `scripts/auto_video_workflow.py` | no | **L3**: the argparse `choices` restriction |
| `AUDIT_REPORT.md`, `REFACTOR_REPORT.md`, `MEMORY_AND_TEST_ARCHITECTURE.md` | no | prior audit trail |
| `MEM_TEST_AGENT_AUDIT_REPORT.md`, `SSD_HDD_SYMLINK_AUDIT_REPORT.md`, `PRODUCTS_SUBPROJECTS_AUDIT_REPORT.md` | no | prior audit trail |
| `gateway.ps1`, `gateway.ps1.bat`, `gateway.py.bat` | no | operational entry points |
| `mobile-agent/README.md` | no | uncommitted package README |

`web/index.html` and `scripts/youtube_uploader.py` are named in `AGENTS.md` as security controls, so the
requested purge would have deleted four of the repo's own documented safeguards, none of them tracked.

### 2.2 Tracked subtrees that other deliverables depend on

| Path | Tracked files | Consequence of deleting it |
| --- | --- | --- |
| `products/` | 1018 (56% of the repo) | `008ai-landing` (live at `008ai.online`) and `calorieai` (live at `calorie-ai-seven.vercel.app`) - each with its own release policy and `.clinerules` |
| `factory_components/` | 168 | the governance centre (`tools/Cline-anti-freeze`) that parses `AGENTS.md` and enforces the forbidden-dir and Anti-Public rules |
| `contracts/` | 72 | backs `frontend/config/contracts.json` and the deployment manifest |
| `qa_delivery/` | 68 | acceptance assets |
| `projects/` | 60 | project-level deliverables |
| `mobile-agent/test/` (minus `ai-fuzzer-policy.test.ts`) | 15 | `npm test` compiles the whole `test/` directory; removing these 15 files makes the suite that the same request asks us to verify stop existing |
| `sdk/` | 12 | `frontend/package.json` depends on `@maotang/sdk` via `file:../sdk`, and `vercel-api-deploy.mjs` vendors it into every build |
| `services/`, `tools/`, `008/`, `agent-client/`, `agent-manager/`, `video-factory/`, `coding-tools-mcp/` | 180 | separate products/services with no relation to the MAOTANG protocol |
| `docs/*.md` except `architecture/` | 18 | includes `LEGAL_COMPLIANCE.md`, `THREAT_MODEL.md`, `WHITE_PAPER.md`, `AUDIT_REPORT_v1.0.md`, `MVP_DEMO_GUIDE.md`, `PROJECT_VISION.md`, `INTEGRATION_TEST_REPORT.md` - all commissioned by earlier tasks in this same workstream |

### 2.3 Two premises in the request do not hold

- **`ADR-046` does not exist.** `docs/architecture/` contains exactly one file, `ADR-045-Hybrid-Cloud-Edge-SLM-Pipeline.md`. `git grep ADR-046` returns no match anywhere in the repository.
- **No "Cyber Tiger Hero" manifesto exists.** `git grep -i "cyber tiger"` returns no match. Separately, `README.md` is a deliverable of the earlier branding task (`docs(branding): align public documentation with decentralized AI edge node framework`) and the repository's own pre-commit hook refuses to modify any file named `README.md` (`README.md cannot be modified without CEO instruction`), so a rename/rewrite is blocked by the repo's guardrail as well.

### 2.4 The request contradicts its own verification step

Section 3 asks for "zero regressions" via `mobile-agent: npm run test:policy` and `frontend: npx tsc --noEmit && npm run build`. Removing `sdk/`, `contracts/` or the M1-M5 test files makes exactly those two gates fail: `frontend` resolves `@maotang/sdk` from `../sdk`, and `npm test` compiles `mobile-agent/test/**` wholesale.

## 3. Verification on the unchanged revision (no regressions to guard against)

| Gate | Result |
| --- | --- |
| `mobile-agent` `npm run test:policy` | **exit 0** - 8/8 pass, 0 fail |
| `frontend` `npx tsc --noEmit` | **exit 0** - 0 errors |
| `frontend` `npm run build` | **exit 0** - `Compiled successfully in 8.5s`, `Finished TypeScript in 4.3s` |
| `frontend` `npm run test:policy` | 19/19 pass |

## 4. Proposed scoped cleanup (needs an explicit go/no-go)

Nothing below is executed yet. Tier A is safe and reversible; Tier B needs the owner's word.

**Tier A - regenerable artifacts, zero information loss (safe to run any time)**

| Path | Size | Note |
| --- | --- | --- |
| `scripts/__pycache__/` | 6 files, 61 KB | Python bytecode cache, gitignored, regenerated on import |
| `frontend/tsconfig.tsbuildinfo` | 107 KB | TypeScript incremental cache, gitignored |
| `frontend/.next/` | build output | gitignored; rebuilt by `npm run build` |

**Tier B - tracked content, each item needs a decision**

| Candidate | Rationale | Risk |
| --- | --- | --- |
| `docs/WHITEPAPER_v2.md` | superseded by `WHITE_PAPER.md` v3.1, which states it replaces it | still cited by `GAP_ANALYSIS.md`, `GIT008_WORKBENCH.md` and `memory/ARCHITECTURE_DECISIONS.md` as the audit-time authorative text |
| `scripts/AI控制面板.exe.old`, `scripts/AI控制面板 - kopia.exe` | draft panel binaries | untracked video-factory artifacts, not MAOTANG |
| root `gateway.*`, `master_pipeline.py` | unclear ownership | untracked, unrecoverable, possibly operational |

If the intent is genuinely to split the MAOTANG protocol into its own repository, the correct sequence is
to **fork it out first** (new repo, `mobile-agent/` + `frontend/` + `sdk/` + `contracts/` + `docs/architecture/`
+ `config/`), keep this monorepo intact until the split is verified, and only then remove the protocol
subtree here. Deleting in place, with two live products and the governance centre in the same tree,
has no rollback.

## 5. Decision required

1. Authorise Tier A only (regenerable caches), or
2. Authorise a specific Tier B list, or
3. Confirm the fork-out plan so the split can be prepared without deleting anything in place.
