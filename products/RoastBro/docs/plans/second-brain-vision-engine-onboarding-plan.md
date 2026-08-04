# Constitutional Onboarding Plan: /second-brain & /vision-engine

> **Plan Version:** 1.0  
> **Date:** 2026-06-28  
> **Author:** ZOOCODE (Architect Mode)  
> **Governing Constitution:** [`Cline-anti-freeze/CONSTITUTION.md`](../Cline-anti-freeze/CONSTITUTION.md) v2.7

---

## 1. Constitutional Absorption Summary

After a full audit of the [`Cline-anti-freeze/`](../Cline-anti-freeze/) governance center, the following **core security constraints** have been absorbed:

### 1.1 Anti-Freeze Iron Rules (Chapter 1, Article 1.2)

| Rule | Threshold | Enforcement |
|------|-----------|-------------|
| Tool call timeout | ≤ 120s | Must interrupt & report on timeout |
| Consecutive identical errors | ≥ 3 | Stop retry, output diagnostics |
| Context usage warning | > 80% | Must compress/archive history |
| Heartbeat interval | Every 5 tool calls | Must emit heartbeat marker |
| No-output deadlock | > 60s silent | Must self-terminate & report |

### 1.2 Role Hierarchy (Chapter 2, Article 2.1)

```
CEO → Governance Instance → Development Instance
```

- **Governance Instance** has sole authority to edit [`Cline-anti-freeze/`](../Cline-anti-freeze/) constitution files
- **Development Instances** are strictly prohibited from touching governance core files
- Every instance must pass `governance_linker.py --boot-check` on startup

### 1.3 Sentinel Hook Requirements (Chapter 5, Article 5.6)

Every project under governance **must** deploy:

1. **`.governance_entry.py`** — Self-referencing governance entry point
2. **`.heartbeat`** — Heartbeat file for deadlock detection (120s timeout)
3. **`.governance_link`** — Governance center linkage marker
4. **Governance task integration** — `.vscode/tasks.json` for auto-launching governance console

Sentinel hooks enforce:
- **Boundary guarding** — No business files written back to `Cline-anti-freeze/`
- **Compliance pre-interception** — Verify Plan/Tree exists before executing code
- **Memory sync** — Automatic memory bank consolidation triggers
- **Anomaly reporting** — Any constitutional violation → WS broadcast + `fault_blackbox.json` write

### 1.4 Defensive Programming Mandates (Chapter 2, Article 2.4)

- All paths must be wrapped in double quotes
- No `cd`/`Set-Location`/`Push-Location` — use absolute paths
- Silent retry max 2 attempts, no infinite loops
- UTF-8 without BOM for all source files

### 1.5 Memory Bank Doctrine (Chapter 3)

- Memory Bank is the **single source of truth** across sessions
- Two layers: **Global** (constitutional) and **Branch** (role-specific)
- Mandatory consolidation triggers: task end, context > 70%, architecture decisions, watchdog recovery
- Zero-silence principle — no `try/except` blocks may swallow exceptions silently

### 1.6 Planning Doctrine (Chapter 4)

- **No Plan, No Code** — ≥3 day tasks require written plan
- **3-tier planning**: Strategic (Deep Planning) → Tactical (Focus Chain) → Project (Task Master)
- **Permission isolation**: Only Governance Instance can create/modify task trees

### 1.7 Sacred Boundaries (Chapter 5)

- `Cline-anti-freeze/` is the **UNIQUE governance domain**
- **No business rules** shall be written into the constitution
- **No backflow** — business files must not be written into `Cline-anti-freeze/`
- **Pollution = unconstitutional** — governance has authority to remove polluted content

---

## 2. Target Directory Architecture

### 2.1 `/second-brain/` — Second Brain Memory & Knowledge System

```
second-brain/
├── .governance_entry.py      # Sentinel hook: governance self-reference
├── .heartbeat                 # Sentinel hook: heartbeat for deadlock detection
├── .governance_link           # Sentinel hook: governance linkage marker
├── .clinerules                # Project-level governance rules (sinks business rules here, NOT in constitution)
├── raw/                       # Raw, unprocessed notes and captures
│   └── .gitkeep
├── wiki/                      # Curated, structured knowledge wiki
│   └── .gitkeep
├── logs/                      # Operational logs for the second brain
│   └── .gitkeep
└── README.md                  # Project overview + governance reference
```

**Governance Classification:** `business` (as per [`onboard_scanner.py`](../Cline-anti-freeze/onboard_scanner.py) classification rules — no anti-freeze/governance keywords in name)

### 2.2 `/vision-engine/` — Visual Processing & Media Pipeline

```
vision-engine/
├── .governance_entry.py      # Sentinel hook: governance self-reference
├── .heartbeat                 # Sentinel hook: heartbeat for deadlock detection
├── .governance_link           # Sentinel hook: governance linkage marker
├── .clinerules                # Project-level governance rules
├── inbox/                     # Incoming media files awaiting processing
│   └── .gitkeep
├── processed/                 # Completed processing output
│   └── .gitkeep
├── scripts/                   # Processing scripts and pipeline definitions
│   └── .gitkeep
└── README.md                  # Project overview + governance reference
```

**Governance Classification:** `business` (as per [`onboard_scanner.py`](../Cline-anti-freeze/onboard_scanner.py) classification rules)

---

## 3. Sentinel Hook Implementation Details

### 3.1 `.governance_entry.py` — Sentinel Hook Template

For each new module, the `.governance_entry.py` must:

1. **Locate governance root** (`Cline-anti-freeze/`) by upward traversal
2. **Establish `.governance_link`** — write `"."` to self-reference the project
3. **Verify monitor connectivity** — run `monitor.py --heartbeat` to confirm governance center is alive
4. **Touch `.heartbeat`** — update timestamp for deadlock detection
5. **Register instance** — call `governance_linker.register_instance()` via the governance center

Implementation constraints from constitution:
- **Path zero-ambiguity**: All paths wrapped in `"${path}"` (Article 2.4)
- **No cd/Set-Location**: Use absolute paths (Article 2.4)
- **Zero-silence**: `try/except` blocks must not swallow exceptions (Article 3.5)
- **UTF-8 without BOM**: All files encoded as UTF-8 (Article 2.3)

### 3.2 `.heartbeat` — Deadlock Prevention

- Format: ISO 8601 UTC timestamp string, e.g. `2026-06-28T09:35:00.000000+00:00`
- Updated by `.governance_entry.py` on each invocation
- Monitored by [`heartbeat_monitor.py`](../Cline-anti-freeze/heartbeat_monitor.py) with 120s timeout threshold
- If heartbeat stale > 120s → `fault_blackbox.json` entry + WS broadcast alert

### 3.3 `.governance_link` — Governance Linkage

- Simple marker file containing `"."` (self-reference)
- Used by [`heartbeat_monitor.py`](../Cline-anti-freeze/heartbeat_monitor.py) `discover_subprojects()` to identify governed modules
- Fallback heartbeat source if `.heartbeat` file is missing

### 3.4 `.clinerules` — Project-Level Governance Rules

Each module's `.clinerules` must:
- NOT duplicate constitution rules (Chapter 5, Article 5.1 — constitution is the UNIQUE governance domain)
- Only contain **business-specific** constraints (operational rules for this specific module)
- Start with: `# Read constitution from Cline-anti-freeze/CONSTITUTION.md` (as per root `.clinerules` convention)

### 3.5 Governance Task Integration

Each module needs `.vscode/tasks.json` (copied from [`Cline-anti-freeze/governance_task.json`](../Cline-anti-freeze/governance_task.json) template) to auto-launch governance console on folder open.

---

## 4. Compliance Verification Matrix

| Constitutional Article | Requirement | `/second-brain` | `/vision-engine` | Verification Method |
|------------------------|-------------|-----------------|-------------------|---------------------|
| Art 1.2 | Anti-freeze iron rules | ✅ Embedded in `.governance_entry.py` | ✅ Embedded in `.governance_entry.py` | Code review |
| Art 2.1 | Role hierarchy | ✅ `.governance_link` enforces governance center | ✅ `.governance_link` enforces governance center | `boot_check()` |
| Art 2.2 | Dev cannot modify governance files | ✅ No write to `Cline-anti-freeze/` | ✅ No write to `Cline-anti-freeze/` | `authorize_write()` check |
| Art 2.4 | Defensive programming | ✅ Absolute paths, quoted strings | ✅ Absolute paths, quoted strings | Code review |
| Art 2.5 | Multi-instance heartbeat | ✅ `.heartbeat` file | ✅ `.heartbeat` file | `heartbeat_monitor.py` scan |
| Art 3.1 | Memory Bank as single source | ✅ `/second-brain/logs/` for structured logging | ✅ `/vision-engine/logs/` for structured logging | Manual audit |
| Art 3.5 | Zero-silence | ✅ Exception reporting | ✅ Exception reporting | Code review |
| Art 4.1 | No Plan, No Code | ✅ `README.md` + plan docs | ✅ `README.md` + plan docs | Manual audit |
| Art 5.1 | Governance domain uniqueness | ✅ No constitution files duplicated | ✅ No constitution files duplicated | Path audit |
| Art 5.4 | No backflow to governance | ✅ `.clinerules` only has business rules | ✅ `.clinerules` only has business rules | Path audit |
| Art 5.6 | Sentinel hooks deployed | ✅ 4 hooks present | ✅ 4 hooks present | Existence check |

---

## 5. Registration Protocol

Per [`onboard_scanner.py`](../Cline-anti-freeze/onboard_scanner.py) and [`project_registry.md`](../Cline-anti-freeze/project_registry.md):

1. Create `README.md` and `.clinerules` for each module ✅ (part of this plan)
2. Run `governance_linker.py --boot-check` to verify governance mount
3. Register in `project_registry.md` with business classification
4. Provide `requirements.txt` or `pyproject.toml` (can be minimal for now)

---

## 6. Summary

The two new modules **`/second-brain`** and **`/vision-engine`** will be:

- **Fully governed** under the existing `Cline-anti-freeze/` constitution
- **Protected by sentinel hooks** (`.governance_entry.py`, `.heartbeat`, `.governance_link`)
- **Compliant with all 5 chapters** of the constitution
- **Properly registered** in the project registry
- **Safe from backflow violations** — no business logic will pollute the governance domain
