---
# This section is managed by the CLI. Do not edit manually.
id: "431a96ea-39ac-41d8-9b78-36aef6ec58e8"
title: "Unify optional package DSH bundles and preset packaging"
status: "closed"
priority: "high"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:27:00Z"
---
Parent tracking issue: [[archive/20261120_closed_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[archive/20261120_closed_decouple-dsh-devdependencies-from-hardcoded-local-deepseek-harness-links]]

## Problem

当前各个可选挂载包在 DSH bundle 元数据、Preset 目录结构和 `agent.cordis.yml` 模块引用上存在三处不一致与缺陷：

1. **Preset YAML 中使用相对 `dist/` 路径**：
   - `packages/theater-gomoku/preset/agent.cordis.yml` 写了 `name: '../dist/single-agent.js'`；
   - `packages/theater-gomoku/presets/two-character-gomoku/agent.cordis.yml` 写了 `name: '../../dist/director.js'`；
   - `example/three-board-gomoku/preset/agent.cordis.yml` 写了 `name: '../dist/director.js'`。
   按 README 指引把这些 YAML 复制到 `$DSH_HOME/.agent-presets/` 后，相对路径立即断裂。
2. **`packages/theater-role-play` 未按 DSH bundle 规范交付**：
   - 缺少 `cordis.patch.yml` 与 `package.json` 中的 `dsh.bundle.patch`；
   - 只有 `preset/v3.yml`，没有可被 DSH 发现的 `presets/<id>/agent.cordis.yml`（集成测试只能在临时目录手拼）。
3. **Preset 目录命名分裂**：`packages/theater-gomoku` 同时存在 `preset/` 和 `presets/`，而 `example/three-board-gomoku` 使用 `preset/`。

## Goal

建立统一的可选包交付约定：每个可挂载包独立作为标准 DSH bundle（`dsh.bundle.patch` -> `./cordis.patch.yml`），所有随包交付的 presets 统一放在 `presets/<preset-id>/` 下，且 `agent.cordis.yml` 一律通过已导出的包名子路径引用插件。

## Acceptance Criteria

- [x] `stage`、`theater`、`theater-gomoku`、`theater-role-play`、`example/three-board-gomoku` 全部声明 `dsh.bundle.patch` 并附带 `cordis.patch.yml`。
- [x] 所有 shipped `presets/*/agent.cordis.yml` 均使用包名子路径，复制到任意独立目录后均可由 DSH Loader 正常加载。
- [x] 新增或更新的测试覆盖所有 shipped bundle patch 与 preset 装载校验，`pnpm check` 通过。

## Resolution

- 将所有 shipped `agent.cordis.yml` 统一迁移到包名子路径（`@darwintree/dsh-theater-gomoku/single-agent`、`@darwintree/dsh-theater-gomoku/director`、`@darwintree/dsh-theater-example-three-board-gomoku/director`、`@darwintree/dsh-theater-role-play/v3`）。
- 统一所有 preset 目录为 `presets/<preset-id>/`：`packages/theater-gomoku/presets/{gomoku,two-character-gomoku}`、`example/three-board-gomoku/presets/three-board-gomoku`、`packages/theater-role-play/presets/role-play-v3`。
- 为 `packages/theater-role-play` 补齐 `cordis.patch.yml`、`dsh.bundle.patch`、`presets/role-play-v3/`，并统一了全部 5 个可挂载包的 `exports`（含 `./cordis.patch.yml`）与 `files`。
- 新增 `tests/bundles-and-presets.spec.ts`，验证 5 个 bundle 清单与 `cordis.patch.yml`、反序挂载与独立 `disabled: true` 开关，以及将全部 4 个 preset 复制到独立外部临时目录后通过真实 `AgentPresets` 发现与装载。
- 已验证 `pnpm check` 全部通过（9 个测试文件 / 56 个用例）。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
- 2026-11-20: 完成全部可选包 bundle 与 preset 规范统一，补充 `tests/bundles-and-presets.spec.ts` 并通过 `pnpm check`（56/56），关闭并归档。
