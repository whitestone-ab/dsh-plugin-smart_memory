# 变更记录

> - **文档类型**：提交记录
> - **创建时间**：2026-10-26 16:05 (UTC+8)
> - **最后更新**：2026-10-26 16:05 (UTC+8)
> - **对应代码**：`HEAD f9b226c`
> - **适用版本**：`smart-memory-dsh 0.1.0`
> - **状态**：有效（由 `git log` 派生）

条目按时间倒序，时间取自 `git log` 的提交时间（`+0800`）。
完整细节用 `git show <hash>` 查看。

## 未发布（`0.1.0` 之后）

无。

## 0.1.0 — 2026-10-26

### 16:05 · 文档整理（工作区，未提交）

- 统一项目文档格式：新增元信息头、统一标题层级、表格与代码块语言标注。
- 新增 [docs/README.md](README.md)（文档索引与格式约定）与本文件。
- 根目录 `WORKLOG-2026-10-26.md` 内容并入 [PROGRESS.md](PROGRESS.md)，并按 `HEAD f9b226c`
  校正状态与测试统计；原文件删除，历史版本见 `git show e8c5b07:WORKLOG-2026-10-26.md`。
- 代码零改动。

### 15:53 · `f9b226c` — fix(save-policy): keep the earliest at when deduping the same quote

- **问题**：`evidenceKey` 不含 `at`（便于占位折叠），但去重发生在排序之前，
  存活的副本取决于输入顺序（`existing` 先于 `incoming`）而非时间先后；
  配合「最早 5 条」窗口，真正更早的观测可能被当成较新记录而裁掉。
- **修复**：先去重前排序，使同一 `source` + `quote` 首次出现的副本总是 `at` 最早的一条。
- **影响面**：不同 quote 的记录行为不变；占位不受影响。
- **测试**：新增 1 条（`keeps the earliest timestamp when the same quote is observed twice`），改前红、改后绿。

### 15:35 · `e8c5b07` — docs: add P2-1c progress notes and design record

- 新增 `WORKLOG-2026-10-26.md` 与 `design or idea.md`（后者的设计文稿早于此提交）。
- 两份文档的格式在 16:05 的整理中统一。

### 15:35 · `1d539e5` — fix(save-policy): drop quote-less placeholders once real evidence exists

- **规则**：无 quote 的证据为占位。只要存在真实证据，占位一律丢弃；
  完全无真实证据时最多保留 `at` 最早的一条占位。
- **目的**：反复无证据保存不再挤占 20 条证据窗口（P2-1c）。
- **测试**：`tests/unit/merge-evidence.test.ts` 与 `tests/integration/evidence-placeholder.test.ts` 先写后改。

### 15:12 · `fa7d460` — fix(service): tag no-evidence placeholder as inference, not assistant

- **问题**：`collectEvidence()` 对无证据保存塞入 `assistant` 占位，把系统生成的观测
  归因于某位说话者。
- **修复**：改标 `inference`，语义为「系统占位，而非任何参与者的断言」。
- **置信度影响**：单条占位 0.4975 → 0.4075。默认 `minConfidence = 0.35` 下仍会插入；
  若部署把 `minConfidence` 调到 0.41 以上，此类保存会转为拒绝。
- **影响面**：`memory_save` 工具从不传 evidence / confidence，因此**所有工具保存**都走这条兜底分支。
- **后续**：占位累积问题不在本提交内，由 `1d539e5` 处理。

### 15:08 · `5245c47` — fix(save-policy): keep oldest 5 + newest 15 evidence, sort and dedupe

- 证据截断由 `slice(-20)` 改为「最早 5 + 最新 15」，避免长期记忆丢失最初来源。
- 新增按 `at` → `source` → `quote` 的确定性排序（纯字符串比较，ISO 字典序即时间序）。
- 新增按 `source` + `quote` 去重。
- 新增模块私有常量 `MAX_EVIDENCE_ITEMS = 20`、`OLDEST_EVIDENCE_KEPT = 5`。
- 标注 tag `p1-evidence-cap`。

### 15:08 · `f6abc56` — test: lock describeEvent metadata contract

- 新增 `tests/unit/describe-event.test.ts`（3 条），通过真实入口
  `installSessionCapture` + 假 `ctx.on('session/event')` + 记录型 logger 间接测试：
  - 元数据行不含消息正文（canary 同时放进 text 与 image URL）；
  - 8 种畸形输入不抛异常，降级为 `missing` / `none`；
  - `DSH_SMART_MEMORY_DEBUG` 未开启时零日志。
- `src/` 零改动，测试一次全绿。

### 12:49 · `6888d66` — chore: baseline (33 tests green)

- 仓库初始化，45 个文件入库，标注 tag `baseline-33-green`。
- 已包含完整插件实现：六类记忆、写入 / 检索 / 整合策略、SQLite 与 JSON 双后端、
  5 工具 + 5 命令、上下文注入、会话捕获与定期整合。
- 基线测试 33 条。

## 统计

| 提交 | 日期 | 类型 |
|---|---|---|
| `6888d66` | 2026-10-26 12:49 | 基线 |
| `f6abc56` | 2026-10-26 15:08 | 测试 |
| `5245c47` | 2026-10-26 15:08 | 修复 |
| `fa7d460` | 2026-10-26 15:12 | 修复 |
| `1d539e5` | 2026-10-26 15:35 | 修复 |
| `e8c5b07` | 2026-10-26 15:35 | 文档 |
| `f9b226c` | 2026-10-26 15:53 | 修复 |
