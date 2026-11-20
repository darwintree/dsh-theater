---
# This section is managed by the CLI. Do not edit manually.
id: "fcbd659a-9960-42da-ab69-66538bc06b23"
title: "Generalize Theater headless runner and add local DSH setup workflow"
status: "open"
priority: "medium"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:02:00Z"
---
Parent tracking issue: [[20261120_open_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[archive/20261120_closed_unify-optional-package-dsh-bundles-and-preset-packaging]]

## Problem

1. `packages/theater/src/headless.ts` 硬编码推进 4 个 Character Segment（`completed < 4`），且只支持在 YAML 配置中写死 `presetId`，无法按需指定目标 preset、步数或运行至结束。
2. `packages/theater-gomoku/headless.cordis.patch.yml` 将 `two-character-gomoku` 写死在 gomoku 包内，想用 headless 调试 `three-board-gomoku` 或 `theater-role-play` 无法直接复用。
3. 仓库根目录缺少总览 `README.md`，各子包 README 仍残留旧目录名 `../dsh-theater-new/...`，且本地联调需要反复在两个仓库间切换并手工 `cp` preset 到 `$DSH_HOME/.agent-presets/`。

## Goal

提供一套通用、可复用的 Theater Headless 调试入口与根目录本地联调脚本/文档，使任意已挂载的场景包都可以用统一方式在 Web 或 Headless 下启动与调试。

## Requirements

1. 升级 `packages/theater/src/headless.ts`：
   - 支持配置（以及结合 DSH `cmdlineArgs` 时的命令行参数，若环境未注入则优雅回退到配置默认值）：`presetId`、`maxSegments`（可选，未传或为 `null` 时运行到演出结束，保留合理默认行为）、`cwd`。
   - 将通用的 `headless.cordis.patch.yml` 收口到 `packages/theater`（并导出/打包），移除 `packages/theater-gomoku/headless.cordis.patch.yml` 中对单一场景的硬编码。
2. 提供轻量根目录脚本（如 `scripts/sync-presets.mjs` 或类似 pnpm script）：
   - 自动发现本仓库各包 `presets/*` 目录并同步（复制或按选项链接）到 `${DSH_HOME:-$HOME/.dsh}/.agent-presets/`；
   - 支持可选过滤只同步指定包/场景。
3. 新增根目录 `README.md`，统一说明架构、可选包清单、DSH profile 挂载/卸载命令、preset 同步命令、Web 与 Headless 启动调试方式，并清理所有子包 README 中的 `../dsh-theater-new` 历史残留路径。
4. 为通用 headless runner 补充单元测试（覆盖 `maxSegments`、跑至结束、参数校验与错误处理）。

## Acceptance Criteria

- [ ] `@darwintree/dsh-theater/headless` 支持以统一方式运行任意已安装 preset，并可配置步数或运行至结束。
- [ ] `packages/theater-gomoku/headless.cordis.patch.yml` 已清理或迁移至 `packages/theater` 通用 patch。
- [ ] 根目录具备清晰的 `README.md` 与 preset 同步脚本，且仓库内无 `../dsh-theater-new` 残留命令说明。
- [ ] 新增 headless 单元测试并通过 `pnpm check`。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
