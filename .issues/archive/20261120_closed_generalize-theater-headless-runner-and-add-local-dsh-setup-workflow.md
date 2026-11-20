---
# This section is managed by the CLI. Do not edit manually.
id: "fcbd659a-9960-42da-ab69-66538bc06b23"
title: "Generalize Theater headless runner and add local DSH setup workflow"
status: "closed"
priority: "medium"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:31:00Z"
---
Parent tracking issue: [[20261120_open_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[archive/20261120_closed_unify-optional-package-dsh-bundles-and-preset-packaging]]

## Problem

1. `packages/theater/src/headless.ts` 硬编码推进 4 个 Character Segment（`completed < 4`），且只支持在 YAML 配置中写死 `presetId`，无法按需指定目标 preset、步数或运行至结束。
2. `packages/theater-gomoku/headless.cordis.patch.yml` 将 `two-character-gomoku` 写死在 gomoku 包内，想用 headless 调试 `three-board-gomoku` 或 `theater-role-play` 无法直接复用。
3. 仓库根目录缺少总览 `README.md`，各子包 README 仍残留旧目录名 `../dsh-theater-new/...`，且本地联调需要反复在两个仓库间切换并手工 `cp` preset 到 `$DSH_HOME/.agent-presets/`。

## Goal

提供一套通用、可复用的 Theater Headless 调试入口与根目录本地联调脚本/文档，使任意已挂载的场景包都可以用统一方式在 Web 或 Headless 下启动与调试。

## Acceptance Criteria

- [x] `@darwintree/dsh-theater/headless` 支持以统一方式运行任意已安装 preset，并可配置步数或运行至结束。
- [x] `packages/theater-gomoku/headless.cordis.patch.yml` 已清理或迁移至 `packages/theater` 通用 patch。
- [x] 根目录具备清晰的 `README.md` 与 preset 同步脚本，且仓库内无 `../dsh-theater-new` 残留命令说明。
- [x] 新增 headless 单元测试并通过 `pnpm check`。

## Resolution

- 升级 `packages/theater/src/headless.ts`：导出 `parseHeadlessOptions` 与 `runHeadless`，支持 YAML 配置与 DSH `cmdlineArgs` 标志（`--preset`、`--max-segments <n|all>`、`--cwd`、`--performance-id`），支持按步数截停或运行至演出结束。
- 将通用 `headless.cordis.patch.yml` 收归 `packages/theater/headless.cordis.patch.yml` 并从 `packages/theater/package.json` 导出与打包，移除 `packages/theater-gomoku/headless.cordis.patch.yml`。
- 新增 `scripts/sync-presets.mjs` 与根脚本 `pnpm presets:sync`（支持复制、`--link` 符号链接、`--only` 过滤、`--list`、`--dry-run`）。
- 新增根目录 `README.md`，统一梳理包架构、可选 DSH bundle 挂载、preset 同步、Web/Headless 启动调试及本地 `deepseek-harness` link 覆盖，并清理 `packages/theater-gomoku/README.md` 和 `example/three-board-gomoku/README.md` 中的历史残留路径。
- 新增 `packages/theater/tests/headless.spec.ts` 与 `tests/sync-presets.spec.ts`，验证 `pnpm check` 全部通过（11 个测试文件 / 61 个用例）。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
- 2026-11-20: 完成通用 headless 启动器、`scripts/sync-presets.mjs`、根目录 `README.md` 及测试，`pnpm check` 全绿（61/61），关闭并归档。
