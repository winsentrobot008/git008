# Governance Dependency Graph

Generated: 2026-07-13T18:01:51.205186+00:00

## Node Summary

| Category | Files | Total Imports |
|----------|-------|---------------|
| business | 825 | 5499 |
| constitution | 1 | 0 |
| executor | 17 | 209 |
| governance_core | 12 | 148 |
| other | 1 | 3 |
| protected_asset | 10 | 76 |
| sandbox | 1 | 17 |
| scripts | 3 | 16 |

## Governance Flow

```
Constitution (rules.py)
  └─┬─ Executor (online_agent, server, fork_*)
    ├─ Sandbox (code_execution_sandbox)
    ├─ Fork System (fork_*.json)
    └─ Sentinel (guard, hooks)

Cline-anti-freeze/
  ├── constitution/     ← Governance rules
  ├── executor/         ← Task execution
  ├── sandbox/          ← Code sandbox
  ├── fork_system/      ← Fork management
  └── ...
```
