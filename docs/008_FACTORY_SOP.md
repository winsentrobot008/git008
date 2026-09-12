# 008 AI Factory Standard Operating Specification (SOP)

## 1. Core Roles & Division (核心角色分工)
* **Gemini (Architecture & Decision Center)**: Formulates task instructions, analyzes execution and VLM test error logs (e.g., 390px CSS overflows, API 429 rate limits), designs VLM test assertions, enforces security gatekeeping, and controls release workflows.
* **Codex (Local Execution Engine)**: Handles implementation code writing, executes local CLI commands (`playwright`, `tsc`, `eslint`), isolates environment variables (`.env.local`), fixes responsive CSS bugs, and performs Git commits and pushes.

## 2. Standardized 4-Pillar SOP for New App Releases (新 App 工业化发布 SOP)

### Pillar 1: Engine & Middleware Sync (商业化引擎与中间件同步)
* Run `npm run check:engine-sync` to ensure authentication, payment, rate limiting, and dynamic Feature Flags (Vercel KV) remain consistent across applications.
* Maintain fail-open fallback mechanics to prevent missing environment variables from causing global 403 lockouts.

### Pillar 2: VLM Visual Agent QA (VLM 视觉自动化 QA)
* Reuse `playwright.config.ts` and `Midscene.ai` configuration targeting the `gemini-3.7-flash` model endpoint.
* Write natural language actions and assertions (`ai()`, `aiAssert()`) to automatically detect 390px mobile layout overflows and pixel tap offsets.

### Pillar 3: Security Lockdown Gate (安全死锁与质量把关)
* Enforce `ADMIN_AUTH_BYPASS = false` in `src/lib/admin-auth-bypass.ts` before any release.
* Run `npx tsc --noEmit` and `npx eslint` to verify zero TypeScript errors and linting warnings.

### Pillar 4: Monorepo Release & Version Consistency (Monorepo 强一致发布)
* Commit app code alongside `package-lock.json` and `playwright.config.ts` to guarantee CI reproducibility.
* Bump the root `git008` monorepo gitlink pointer and push to `main` for automated Vercel/Cloudflare deployment.
