# 开发工作流（双工作副本）

本仓库被 DSH 的 profile 以 `link:` 方式挂载，`lib/` 一旦落后于 `src/`，
运行中的 DSH 就会加载旧 JS。为避免"改到一半把日常环境搞坏"，采用双工作副本：

| 位置 | 分支 | 角色 | 谁在用 |
| --- | --- | --- | --- |
| `D:\dsh-plugin-smart_memory` | `main` | 稳定副本，保持干净 | `desktop` profile（日常） |
| `D:\dsh-plugin-smart_memory-dev` | `dev` | 实验副本，随便改 | `memtest` profile（调试） |

两者共享同一个 `.git`（git worktree），提交历史是一份。

## 日常循环

```powershell
cd D:\dsh-plugin-smart_memory-dev
pnpm dev            # tsc --watch，保存即编译
# 另开终端，用 memtest profile 启动 DSH 验证
```

改完、验证通过后再合回主线：

```powershell
cd D:\dsh-plugin-smart_memory
git merge dev
```

`post-merge` 钩子会自动 `pnpm build`，合完只剩"重启 DSH"一步。

## 钩子做了什么

`post-checkout`、`post-merge`、`post-rewrite` 都转发给 `_rebuild-lib.sh`：
切分支、拉取、变基之后自动重建 `lib/`，编译失败只打印尾部日志、不阻断 git
操作。钩子在两个工作副本中共享同一份（worktree 共用 `.git/hooks`）。

源码在 `scripts/git-hooks/`（`.git/hooks` 不随仓库分发）。新克隆的环境执行：

```powershell
pnpm run hooks:install
```

## 记忆数据

数据库不在仓库里，默认位于 `~/.dsh/smart-memory/memory.sqlite`。
`memtest` profile 使用独立库 `~/.dsh/smart-memory-dev/`，实验不会污染真实记忆。

备份（对运行中的库安全，基于 `VACUUM INTO`）：

```powershell
pnpm run backup:memory          # 备份默认库，保留最近 20 份
pnpm run backup:memory -- <源.sqlite> <目标目录>
```

备份落在 `~/.dsh/smart-memory-backups/`。

## 为什么必须重启

服务端插件在 DSH 启动时一次性加载进内存，没有 HMR。改完（自动）编译后，
仍需重启 DSH 进程；刷新网页不够。
