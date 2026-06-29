# AI-WORKFLOW Subproject

> ZOO AGI Factory 的 **AI 工作流** 子项目，专职 'Agentic Online Earning' (自主网上赚钱) 的全链路编排.

## 核心理念
将接单赚钱拆解为标准化、可监控、可熔断的 **Workflow**:
1. Market Scan (市场扫描)
2. Pick & Filter (筛选决策)
3. Negotiate (谈判报价)
4. Deliver (交付生成)
5. Audit (审计复盘)

## 模块结构
- market/       : 市场感知与竞品分析
- picker/       : 决策 Gate (接 or 拒)
- negotiator/   : 报价与沟通引擎
- deliverator/  : 交付物生成器
- auditor/      : 财务审计与风控
- playbook/     : 平台作战手册 (Fiverr/Upwork/猪八戒)

## 接口约束
- 只读: CONSTITUTION.md, bid_policy.yaml
- 调用: zoo-web-operator (Browser/Actuator)
- 上报: heartbeat_monitor.py, watchdog.py
