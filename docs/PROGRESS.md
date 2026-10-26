# 进度日志

> - **文档类型**：进度日志（滚动更新）
> - **创建时间**：2026-10-26 15:35 (UTC+8)
> - **最后更新**：2026-10-26 16:05 (UTC+8)
> - **对应代码**：`HEAD f9b226c`
> - **适用版本**：`smart-memory-dsh 0.1.0`
> - **状态**：有效
> - **前身**：根目录 `WORKLOG-2026-10-26.md`（原文件已删除，内容并入本文；历史版本见 `git show e8c5b07:WORKLOG-2026-10-26.md`）

本文记录开发进度、测试现状、未完成项与已知风险。已完成的历史细节压缩为
第 2 节的里程碑表；需要复盘过程时查 `git show <hash>`。

## 1. 60 秒摘要

| 项 | 状态 |
|---|---|
| 代码规模 | `src/` 25 个 TypeScript 文件，七个层次（cognition / storage / services / tools / commands / lifecycle / context） |
| 类型检查 | `tsc --noEmit` 通过（本次整理时实测，退出码 0） |
| 单元测试 | 41 条，6 个文件，本次整理时实测全部通过 |
| 集成测试 | 12 条，3 个文件（本次沙箱环境无法执行，见 3.2） |
| 构建产物 | `lib/` 已存在，未入库（`.gitignore`） |
| 可用性 | 可加载、可保存、可召回、可导出；存在 5 项已知设计缺陷（第 5 节） |
| 下一步 | P2-2（SQLite 静默回退）与 P2-3/4（写入原子性）优先 |

**一句话**：功能闭环已经跑通并有集成验证，当前处于「补健壮性」阶段，
未完成项集中在存储失败路径与召回索引，不影响基本使用。

## 2. 里程碑

时间取自 `git log`（`+0800`）。

| 时间 | 提交 | 内容 | 结果 |
|---|---|---|---|
| 12:49 | `6888d66` | 基线入库，45 文件，tag `baseline-33-green` | 33 条测试绿 |
| 15:08 | `f6abc56` | `describeEvent` 元数据契约测试（3 条） | `src/` 零改动，一次全绿 |
| 15:08 | `5245c47` | 证据上限：最早 5 + 最新 15、排序、去重，tag `p1-evidence-cap` | 4 条单测 + 1 条集成 |
| 15:12 | `fa7d460` | P2-1a：无证据占位 `assistant` → `inference` | 2 条集成，改前红改后绿 |
| 15:35 | `1d539e5` | P2-1c：真实证据出现后丢弃无 quote 占位 | 占位不再挤占证据窗口 |
| 15:35 | `e8c5b07` | 文档入库（设计存档 + 进度日志） | 格式未统一，本次整理 |
| 15:53 | `f9b226c` | 同一 source + quote 去重时保留最早 `at` | 1 条单测，改前红改后绿 |
| 16:05 | 本次整理 | 文档统一格式、建索引与 CHANGELOG | 无代码改动 |

### 2.1 证据链（P0 端到端实测，2026-10-26）

真实 desktop profile 下两次独立验证，均通过 `memory_recall` 命中：

| 次 | 时间 | 记录 id | 得分 |
|---|---|---|---|
| 前任会话 | 12:32 | `mem_mvorglyg_z16wkh` | 0.86 |
| 本轮会话 | 13:01 | `mem_mvosh7zh_omr5tn` | 0.90 |

验收 6 项全部满足：插件加载、`session/event` 触发、回调取第二参数 `(session, event)`、
来源四条件、`autoCapture: true` 落库、`memory_recall` 命中。临时记忆已删除。

### 2.2 证据窗口的三个修复（`5245c47`、`f9b226c`）

| 缺陷 | 修复前 | 修复后 |
|---|---|---|
| 截断策略 | `slice(-20)` 丢最早 | `slice(0, 5)` + `slice(-15)` |
| 顺序 | 按数组顺序 | 按 `at` → `source` → `quote` 纯字符串排序 |
| 去重 | 相同三元组各留一份 | 按 `source` + `quote` 去重，保留最早 `at` |
| 占位 | 无 quote 占位参与窗口 | 真实证据存在时占位被丢弃，否则只留最早一条 |

设计决定：

- 「最早」按 `at` 时间戳排序，不按数组顺序。
- 排序用纯字符串比较（ISO 字典序即时间序），避免 `Date.parse` 的 `NaN` 风险与 `localeCompare` 的 locale 依赖。
- 去重先于截断，因此重复观测只保留最早时间戳，`at` 单调递增的契约不被破坏。
- 常量 `MAX_EVIDENCE_ITEMS = 20`、`OLDEST_EVIDENCE_KEPT = 5` 模块私有、不 export，防止「改了常量但测试没覆盖」的静默漂移。

## 3. 测试现状

### 3.1 清单

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `tests/unit/recall-policy.test.ts` | 5 | 分词、排序、过滤、空查询高亮 |
| `tests/unit/save-policy.test.ts` | 8 | 相似度、拒绝、插入、合并、取代、跨项目隔离 |
| `tests/unit/merge-evidence.test.ts` | 13 | 证据上限、排序、去重、占位折叠、最早时间戳 |
| `tests/unit/session-capture.test.ts` | 9 | 事件来源判定、抽取边界、证据 quote |
| `tests/unit/describe-event.test.ts` | 3 | 诊断日志不泄露正文、畸形输入降级 |
| `tests/unit/injection-policy.test.ts` | 3 | 类型优先级、预算、空 section |
| `tests/integration/memory-service.test.ts` | 8 | 保存 / 召回 / 状态 / 导出 / 重开 / 取代 / 遗忘 / 整合 |
| `tests/integration/evidence-cap.test.ts` | 1 | 25 次真实 save → 合并 → 重开后仍 20 条 |
| `tests/integration/evidence-placeholder.test.ts` | 3 | 占位来源、置信度门槛、真实证据替换占位 |

合计 **53 条**：单元 41，集成 12。

### 3.2 本次整理的执行结果

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | 退出码 0 |
| `npx tsx tests/unit/*.test.ts`（逐文件） | 41/41 通过 |
| `npx tsx tests/integration/*.test.ts` | **无法执行**：`mkdtemp` 返回 `EPERM`（本次会话为只读沙箱，禁止写临时目录） |

集成测试的环境要求：可写的临时目录。请在正常终端执行 `pnpm test` 复核。

### 3.3 历史绿灯记录

| 阶段 | 条数 | 记录来源 |
|---|---|---|
| 基线 | 33 | `6888d66` 提交信息 |
| + describeEvent | 36 | `f6abc56` |
| + 证据上限 | 41 | `5245c47` |
| + 占位改 inference | 43 | `fa7d460` |
| + 占位折叠 | 46 | `1d539e5` |
| + 最早时间戳 | 53 | `f9b226c` |

## 4. 能力清单（代码层面已实现）

| 能力 | 落点 | 备注 |
|---|---|---|
| 六类记忆 + 三种状态 | `src/cognition/schema.ts` | `identity` / `preference` / `fact` / `decision` / `procedure` / `episode` |
| 写入策略 | `src/cognition/save-policy.ts` | 拒绝、合并、取代、插入四分支 |
| 冲突检测 | `src/cognition/conflict-check.ts` | 结构化 `subject`/`predicate`/`value` + 否定启发式 |
| 置信度 | `src/cognition/confidence.ts` | 证据加权折叠、时间衰减、增量合并 |
| 检索排序 | `src/cognition/recall-policy.ts` | 词法 0.60 / 重要性 0.18 / 置信度 0.14 / 新近度 0.08 |
| 中文分词 | `src/cognition/recall-policy.ts` | 汉字 bigram + 拉丁整词，无分词器依赖 |
| 整合 | `src/cognition/consolidate.ts` | 合并重复、归档陈旧低置信、episode 升级 |
| 存储 | `src/storage/sqlite-store.ts` | `node:sqlite` 优先，JSON 原子写降级 |
| 工具 / 命令 | `src/tools/`、`src/commands/` | 5 个工具 + 5 个命令 |
| 注入 | `src/context/` | 独立 section，字符预算，`{{` 转义 |
| 生命周期 | `src/lifecycle/` | 会话捕获、任务召回、定期整合 |

## 5. 未完成项

| 编号 | 内容 | 现状 | 建议 |
|---|---|---|---|
| **P2-2** | SQLite 初始化失败时静默回退 JSON | `openPersistence` 的 `catch` 不记录原因，用户无从得知降级 | 记录 `warn`，并在 `memory_status` 暴露降级原因 |
| **P2-3** | `putMany` 非原子 | 逐条 `put`，中途失败留下部分写入 | 事务或「先写临时后换名」 |
| **P2-4** | `put()` 持久化失败后内存与索引已变更 | `entries.set` 在 `await save` 之前 | 失败时回滚内存与索引 |
| **P2-5** | 冲突检测与「决定胜者」耦合 | `save-policy` 既判定冲突又决定取代 | 拆成「冲突报告」与「解决策略」两层 |
| **P2-6** | 召回全量扫描 | `rankEntries` 遍历 `store.all()`，`MemoryIndex` 未被服务层使用 | 索引先行过滤，再打分 |
| **P3-1** | 采集残句 | 引号 / 句末边界处理不完整，曾产生污染记录 | 约束匹配结果止于句末标点且引号配对 |

已完成的 P2-1a / P2-1c 见 2.2 与里程碑表。

## 6. 已知风险

1. **`lib/` 未入库但被 profile 加载**：改 `src/` 后必须 `pnpm build`，否则运行的是旧代码。
2. **desktop profile 被 Electron 独占**：CLI 无法 `dump-config`，有效配置只能靠磁盘文件加实测推断。
3. **DSH 可能热加载 patch**：不能仅凭「进程启动时间早于配置修改时间」判定需要重启。
4. **`source.kind === 'user'` 是来源分类，不是身份认证**：不要扩大 `TRUSTED_USER_SOURCES`。
5. **`memory_save` 工具不传 evidence / confidence**：每次工具保存都走 `collectEvidence` 兜底分支。
6. **不要执行 `git clean -xdf`**：`-x` 会删除 `lib/` 与 `node_modules/`。
7. **置信度权重**：`user 0.95` > `tool 0.85` > `assistant 0.55` > `inference 0.35`；`assessConfidence([])` 返回 0.3，但 `save()` 路径走不到。
8. **`assistant` 仍是合法证据来源**：P2-1a 只改了兜底标签，未改 schema 与权重。

## 7. 工作约定

- 中文交流，技术名词保留英文。
- 测试先行：先写测试确认红 → 最小修复 → 绿 → `typecheck` + `test` + `build`。
- 动手前 `git status --short` 必须为空；不为空先查清来源。
- 改 `src/` 后必须 `pnpm build`，并确认 `lib/` 时间戳更新。
- 提交前用 `git diff -- <file>` 证明只改该改的部分。
- 提交信息经文件传入（`git commit -F`），避免 shell 对反引号与括号的转义差异。
- 不以「LLM 声称已保存」作为验收，以工具原始返回为准。
- 环境判断需交叉验证：进程时间、配置文件、日志、实测四者取交集。
- 补测试与改行为分开提交。

## 8. 常用命令

```sh
# 开发循环
pnpm install
pnpm typecheck
pnpm test          # Node 内置 node:test + tsx
pnpm build

# 单文件调试（绕过 --test 的子进程限制）
npx tsx tests/unit/merge-evidence.test.ts

# 打包与安装
pnpm pack
npx @deepseek-ai/dsh plugin --profile web add ./smart-memory-dsh-0.1.0.tgz
npx @deepseek-ai/dsh --profile web --dump-config
```

## 9. 当前状态一句话

**P0、P1、P2-1 已完成并入库（`f9b226c`，53 条测试），类型检查通过；
剩余 P2-2 至 P2-6 与 P3-1 集中在存储失败路径、写入原子性与召回索引，
不阻塞日常使用；下一轮建议从 P2-2 开始。**
