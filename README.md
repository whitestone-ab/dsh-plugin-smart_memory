# smart-memory-dsh

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（CLI 名 `dsh`）提供持久化、可审计、按策略注入的智能记忆。

插件把「记住什么、什么时候想起、冲突怎么办」拆成独立策略层：写入经过去重 / 冲突检测 / 置信度评估，检索按词法相关性 + 重要性 + 置信度 + 新近度排序，注入受字符预算约束，另有一条可选的自动捕获与定期整合链路。

## 功能

- **持久化存储** — 默认使用 `node:sqlite`（Node 24 内置）；运行时不支持时自动降级为原子写入的 JSON 文件。
- **六种记忆类型** — `identity` / `preference` / `fact` / `decision` / `procedure` / `episode`。
- **写入策略** — 拒绝低置信度内容，合并近重复，发现矛盾时用新记忆取代旧记忆并归档旧记录。
- **检索策略** — 中英混合分词（中文按 bigram），词法相关性 + 重要性 + 置信度 + 新近度加权。
- **上下文注入** — 作为 system prompt 的独立 section 注入，带字符预算与类型优先级；`interpolate: false` 避免用户内容被当作提示变量。
- **原生命令** — `/memory-status`、`/memory-recall`、`/memory-save`、`/memory-forget`、`/memory-export`。
- **生命周期** — 可选会话事件捕获、任务感知召回、定期整合（`ctx.effect` 托管定时器，卸载即清理）。
- **可审计** — 证据、版本号、`supersedes` / `supersededBy` 均随记录持久化。

## 目录结构

```text
smart-memory-dsh/
│
├── package.json                  # npm 包与 DSH bundle 元数据
├── cordis.patch.yml              # 向 DSH 注册和组合插件
├── README.md
├── LICENSE
│
├── src/
│   ├── index.ts                  # 插件入口：apply(ctx)
│   │
│   ├── services/
│   │   ├── memory-service.ts     # 统一记忆服务
│   │   ├── memory-store.ts       # 记忆 CRUD 与版本管理
│   │   └── memory-index.ts       # 检索索引管理
│   │
│   ├── tools/
│   │   ├── memory-recall.ts
│   │   ├── memory-save.ts
│   │   ├── memory-forget.ts
│   │   ├── memory-status.ts
│   │   └── memory-export.ts
│   │
│   ├── context/
│   │   ├── memory-section.ts     # 为模型上下文提供记忆
│   │   └── injection-policy.ts   # 注入预算与优先级
│   │
│   ├── lifecycle/
│   │   ├── session-capture.ts    # 捕获可持久化的会话事件
│   │   ├── task-recall.ts        # 当前任务的记忆检索
│   │   └── consolidation-trigger.ts
│   │
│   ├── cognition/
│   │   ├── schema.ts             # 记忆数据模型
│   │   ├── save-policy.ts        # 记忆写入规则
│   │   ├── recall-policy.ts      # 检索与排序规则
│   │   ├── consolidate.ts        # 记忆去重、归纳和升级
│   │   ├── conflict-check.ts     # 新旧记忆冲突检测
│   │   └── confidence.ts         # 证据与置信度评估
│   │
│   ├── storage/
│   │   ├── sqlite-store.ts       # 持久化实现（SQLite，自动降级 JSON）
│   │   └── migrations/           # 数据结构迁移
│   │       ├── 001-init.ts
│   │       └── index.ts
│   │
│   └── commands/
│       └── memory-commands.ts    # DSH 原生命令注册
│
├── prompts/                      # 记忆策略与提示模板
│   ├── memory-recall.md
│   ├── memory-save.md
│   └── metacognitive-check.md
│
└── tests/
    ├── unit/
    ├── integration/
    └── memory-evaluation/
```

构建相关文件：`tsconfig.json`、`pnpm-lock.yaml`、`.npmrc` 与 `pnpm-workspace.yaml`（后两者关闭 peer 自动安装，避免 pnpm 去拉取未发布的 `@deepseek-ai/dsh-type-meta`）。

## 安装

要求：Node.js ≥ 22.19（推荐 24，`node:sqlite` 无需实验开关）、pnpm、已安装 `dsh`。

```sh
pnpm install
pnpm build
pnpm pack                                   # 产出 smart-memory-dsh-0.1.0.tgz
npx @deepseek-ai/dsh plugin --profile web add ./smart-memory-dsh-0.1.0.tgz
npx @deepseek-ai/dsh --profile web          # 重启 profile 后生效
```

验证：

```sh
npx @deepseek-ai/dsh --profile web --dump-config   # 应出现 id: smart-memory
```

本地源码调试（纯 Cordis 插件可用；正式调试请用 tarball）：

```yaml
# dev.patch.yml
- insert:
    - id: smart-memory
      name: 'file:///D:/dsh-plugin-smart_memory/lib/index.js'
```

```sh
npx @deepseek-ai/dsh --profile dev --patch ./dev.patch.yml web
```

> 修改 `package.json`、`cordis.patch.yml` 或构建产物后必须重启 profile；
> 只有 profile 自己的 `cordis.patch.yml` 才热重载。

## 配置

| 键 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `storagePath` | string | `''` | 数据库目录或 `.sqlite` / `.json` 文件主干；空值使用 `$DSH_HOME/smart-memory` |
| `recallLimit` | number | `8` | 单次召回 / 注入的最大条数 |
| `injectBudgetChars` | number | `1200` | 注入 section 的软字符预算 |
| `minConfidence` | number | `0.35` | 新记忆可被写入的最低置信度 |
| `autoCapture` | boolean | `false` | 是否持久化从会话中识别出的记忆语句 |
| `autoConsolidate` | boolean | `true` | 是否定期整合 |
| `consolidationIntervalMinutes` | number | `60` | 整合间隔（分钟） |
| `captureMaxChars` | number | `4000` | 捕获请求文本上限，也用于任务召回 |

修改 `~/.dsh/profiles/<name>/cordis.patch.yml` 时，`config` 是整段替换，务必保留全部键。

## 工具与命令

| 能力 | 名称 | 说明 |
|---|---|---|
| Tool | `memory_recall` | 检索记忆；空查询返回最重要的记忆 |
| Tool | `memory_save` | 保存一条记忆，可带 `subject` / `predicate` / `value` 以启用结构化冲突检测 |
| Tool | `memory_forget` | 归档（默认）或永久删除指定 id |
| Tool | `memory_status` | 记录数量、类型分布、平均置信度、存储后端 |
| Tool | `memory_export` | 导出 JSON / Markdown，可直接返回或写入文件 |
| Command | `/memory-status` | 同上，命令侧 |
| Command | `/memory-recall [query]` | 无参数时按当前任务召回 |
| Command | `/memory-save <content>` | 以用户口述证据保存 |
| Command | `/memory-forget <id> [archive\|delete]` | 归档或删除 |
| Command | `/memory-export [json\|markdown] [path]` | 导出 |

## 记忆模型

```ts
interface MemoryEntry {
  id: string
  kind: 'identity' | 'preference' | 'fact' | 'decision' | 'procedure' | 'episode'
  scope: 'global' | 'project'
  title: string
  content: string
  tags: string[]
  subject?: string
  predicate?: string
  value?: string
  evidence: { source: 'user' | 'assistant' | 'tool' | 'inference'; quote?: string; at: string }[]
  confidence: number      // 0..1，由证据评估
  importance: number      // 0..1，由调用方标注
  status: 'active' | 'archived' | 'forgotten'
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
  accessCount: number
  version: number
  supersedes?: string
  supersededBy?: string
  expiresAt?: string
}
```

### 写入决策

1. 内容长度或格式非法 → `reject`
2. 置信度低于 `minConfidence` → `reject`
3. `subject` + `predicate` 相同但 `value` 不同，或高度相似且否定相反 → `supersede`
4. 与同 scope 的现有记忆相似度 ≥ 0.82 → `merge`
5. 否则 → `insert`

### 检索评分

```text
score = 0.60 × 词法覆盖率
      + 0.18 × importance
      + 0.14 × confidence
      + 0.08 × 新近度(半衰期 30 天)
      + min(0.08, accessCount × 0.01)
```

已被归档、已过期、类型/标签不匹配的记录不会进入结果。

## 存储与隐私

- 默认位置：`$DSH_HOME/smart-memory/memory.sqlite`（或 `memory.json`）。
- 数据库只保存在本机；插件不发起任何网络请求。
- `autoCapture` 默认 **关闭**。开启后仅识别「记住…」「我更喜欢…」「我们决定…」等显式句式，并且只写入本地库。
- 不要用记忆保存密钥、令牌、密码或身份证件信息。
- 删除：`memory_forget` 的 `delete` 模式会移除记录；`archive` 保留墓碑以便审计。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

测试使用 Node 内置 `node:test` + `tsx`；检索/写入策略另有 `tests/memory-evaluation/cases.json` 数据用例。

## 已知限制

- 检索是词法索引，不是向量检索；同义改写依赖 token 重叠。
- 自动捕获是保守的句式匹配，不是通用事实抽取。
- 冲突检测在缺少 `subject` / `predicate` 时只能退化为「高相似 + 否定相反」的启发式。
- SQLite 后端依赖运行时的 `node:sqlite`；Node 22 需要 `--experimental-sqlite`，否则自动使用 JSON 后端。

## License

MIT
