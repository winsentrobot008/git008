# 项目注册表 (Project Registry)

> 治理中心：Cline-anti-freeze  
> 最后更新：2026-06-05  
> 协议版本：Project Onboarding Protocol v1.0

## 职能分类

### 业务项目 (Business)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| Maneki-AI | `/Maneki-AI` | AI 智能体工厂 & 清算引擎 | 2026-Q1 |
| ClawAI | `/ClawAI` | CLAW 模式集成 & 实时评测 | 2026-Q1 |
| Project-X | `/Project-X` | （待定义） | 2026-06-05 |

### 实验项目 (Experimental)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| 视频生产APP | `/视频生产APP` | 视频生产工具与素材管理 | 2026-Q1 |

### 治理项目 (Governance)

| 项目名称 | 路径 | 职能描述 | 注册日期 |
|---------|------|---------|---------|
| Cline-anti-freeze | `/Cline-anti-freeze` | 多实例治理中心、宪法守护 & 并行协作 | 2026-Q1 |

---

## 登记协议

新项目接入必须：
1. 创建 `README.md` 和 `.cline_context` 文件
2. 运行 `governance_linker.py --boot-check` 验证治理挂载
3. 在此 registry 中登记职能
4. 提供独立的 `pyproject.toml` 或 `requirements.txt`