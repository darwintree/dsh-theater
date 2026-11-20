---
# This section is managed by the CLI. Do not edit manually.
id: "431a96ea-39ac-41d8-9b78-36aef6ec58e8"
title: "Unify optional package DSH bundles and preset packaging"
status: "open"
priority: "high"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:02:00Z"
---
Parent tracking issue: [[20261120_open_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[20261120_open_decouple-dsh-devdependencies-from-hardcoded-local-deepseek-harness-links]]

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

## Requirements

1. 将所有 shipped `agent.cordis.yml` 中的相对 `dist/` 路径替换为包名子路径：
   - `@darwintree/dsh-theater-gomoku/single-agent`
   - `@darwintree/dsh-theater-gomoku/director`
   - `@darwintree/dsh-theater-example-three-board-gomoku/director`
   - `@darwintree/dsh-theater-role-play/v3`
2. 统一目录规范为 `presets/<preset-id>/`：
   - `packages/theater-gomoku` 统一收拢到 `presets/gomoku/` 和 `presets/two-character-gomoku/`；
   - `example/three-board-gomoku` 收拢到 `presets/three-board-gomoku/`；
   - `packages/theater-role-play` 补齐 `cordis.patch.yml`、`dsh.bundle.patch` 声明，并提供 `presets/role-play-v3/`（含 `preset.yml` 与引用 `@darwintree/dsh-theater-role-play/v3` 的 `agent.cordis.yml`，同时保留 `preset/v3.yml` 数据文件或将其清晰归位）。
3. 确保所有包的 `package.json` `exports` 与 `files` 完整包含 `./cordis.patch.yml` 与 `presets`。
4. 补充自动化测试验证所有 shipped `cordis.patch.yml` 与 `presets/*/agent.cordis.yml` 不含相对 `dist/` 路径、且能通过真实 Cordis Loader 解析和挂载（包括核心 + 任意可选包组合以及 `disabled: true` 开关）。

## Acceptance Criteria

- [ ] `stage`、`theater`、`theater-gomoku`、`theater-role-play`、`example/three-board-gomoku` 全部声明 `dsh.bundle.patch` 并附带 `cordis.patch.yml`。
- [ ] 所有 shipped `presets/*/agent.cordis.yml` 均使用包名子路径，复制到任意独立目录后均可由 DSH Loader 正常加载。
- [ ] 新增或更新的测试覆盖所有 shipped bundle patch 与 preset 装载校验，`pnpm check` 通过。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
