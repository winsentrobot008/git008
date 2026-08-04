# VisionEngine 深度接入计划 — 战役 A

## 目标
为 MediaIndexerPro 看板接入 VisionEngine，实现 UI 自动审查与 ASR 自愈循环。

---

## A. VisionEngine 接入方案

### 架构概览
```
Playwright 截图 → src/vision_analyzer.py → 比对 docs/ui_spec.md
                     ↓
            data/test_results.json (差异报告)
                     ↓
            ASR 判定: 差异 < 阈值 → PASS / 差异 > 阈值 → FAIL → Coder 修复
```

### 组件
1. **`src/vision_analyzer.py`** — 本地视觉分析引擎
   - `VisionAnalyzer.compare(screenshot_path, spec_path)` → 返回差异报告
   - 像素级比对：截图 vs 设计规范中的预期参数
   - 布局结构分析：检测容器、网格、卡片等元素
   - 颜色一致性检查：Tailwind 类名是否渲染正确
   
2. **`docs/ui_spec.md`** — UI 设计规范（预期状态）
   - 描述页面布局结构
   - 定义颜色方案、字体、间距
   - 定义响应式断点行为
   - 定义元素语义化要求（aria-label, role 等）

3. **`tests/test_visual_asr.py`** — 增强测试脚本
   - 步骤 1: Playwright 截图
   - 步骤 2: VisionAnalyzer.compare(screenshot, spec)
   - 步骤 3: 差异写入 `data/test_results.json`
   - 步骤 4: 若差异 > 阈值 → assert 失败

### 差异报告格式 (`data/test_results.json`)
```json
{
  "timestamp": "2026-07-15T...",
  "screenshot": "data/screenshots/ui_snapshot.png",
  "spec": "docs/ui_spec.md",
  "checks": {
    "layout_structure": {"passed": true, "score": 0.95},
    "color_consistency": {"passed": true, "score": 0.98},
    "element_semantics": {"passed": true, "score": 1.0},
    "responsive_checks": {"passed": true, "score": 0.9}
  },
  "overall_score": 0.96,
  "threshold": 0.8,
  "passed": true,
  "issues": []
}
```

## B. UI 差异检测逻辑

| 检测项 | 方法 | 阈值 |
|--------|------|------|
| 布局偏移 | 检查容器 position/size 是否正确 | score ≥ 0.8 |
| 元素缺失 | 检查关键元素 (nav, table, cards) 是否存在 | score ≥ 0.8 |
| 颜色/字体 | 检查 Tailwind 类渲染的颜色值 | score ≥ 0.7 |
| Tailwind class 渲染 | 检查 class 属性是否被正确应用 | score ≥ 0.9 |
| 响应式布局 | 检查 viewport meta, 断点行为 | score ≥ 0.8 |

## C. 自愈循环触发条件

| 条件 | 触发动作 |
|------|----------|
| VisionEngine 判定 "差异 > 阈值" | Coder 修复 UI |
| Playwright 报错 | Coder 修复路径/端口/依赖 |
| 截图缺失 (0 bytes) | Coder 修复截图逻辑 |
| 页面渲染失败 (HTTP 非 200) | Coder 修复 server.py |
| HTTP 访问失败 | Coder 修复端口/地址配置 |

## D. Coder 修复策略

| 问题 | 修复方法 |
|------|----------|
| HTML/Tailwind 渲染异常 | 调整 class 名、修复模板语法 |
| 媒体卡片数据结构缺失 | 确保 indexer.py 输出所有必需字段 |
| 前端渲染逻辑 bug | 修复 JavaScript 模板渲染 |
| 路径/端口错误 | 修复 server.py 中的路径配置 |

## E. 文件修改清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/vision_analyzer.py` | **新建** | 本地 VisionEngine 分析器 |
| `docs/ui_spec.md` | **新建** | UI 设计规范 |
| `tests/test_visual_asr.py` | **修改** | 集成 VisionEngine 审查 |
| `src/server.py` | **修改** | 增强语义化 HTML |
| `src/indexer.py` | **修改** | 确保数据结构完整 |

## F. ASR 收敛标准
- 单次测试通过 (差异 < 0.8 阈值) → 战役 A 收敛成功
- 测试失败 → Coder 修复 → 重测 → 最多 3 次重试
