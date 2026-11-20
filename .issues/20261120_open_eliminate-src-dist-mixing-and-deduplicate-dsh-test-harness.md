---
# This section is managed by the CLI. Do not edit manually.
id: "ea065305-8b18-4e94-949f-f9ff8f27830e"
title: "Eliminate src/dist mixing and deduplicate DSH test harness"
status: "open"
priority: "medium"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:02:00Z"
---
Parent tracking issue: [[20261120_open_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[20261120_open_unify-optional-package-dsh-bundles-and-preset-packaging]]

## Problem

1. **`src/` 与 `dist/` 混跑**：
   - `packages/theater/tests/performance.integration.spec.ts`、`packages/theater-role-play/tests/role-play.integration.spec.ts` 等测试顶部直接 `import` `src/*.ts`，但测试中的 preset fixture（如 `packages/theater/tests/fixtures/presets/*/agent.cordis.yml`）和临时 `agent.cordis.yml` 给 Cordis Loader 传的却是 `dist/*.js`；
   - 改完源码未先 `pnpm build` 时，单条测试内会同时执行新源码与旧编译产物，IDE 断点与堆栈也容易错位。
2. **集成测试 `setup()` 样板大量重复**：
   - 多个包的集成测试各自复制粘贴了 60~100 行组装 `Loader`、`Include`、`LlmRuntime`、`SessionStore`、`JsonlSessionPersistence`、`AgentRegistry`、`AgentDefaultModel`、`AgentLoop`、`AgentPresets`、`SystemPrompt`、`ToolRuntime`、`StageService`、`TheaterService` 的代码，维护成本高。

## Goal

让日常 Vitest 调试全链路直连 TypeScript `src/`（不依赖预先 `pnpm build` 产出 `dist/`），并抽出共享的进程内 DSH 测试 harness 供所有包复用。

## Requirements

1. 在根目录配置 `vitest.config.ts`，将工作区包（`@darwintree/dsh-stage`、`@darwintree/dsh-theater`、`@darwintree/dsh-theater-gomoku`、`@darwintree/dsh-theater-role-play`、`@darwintree/dsh-llm-mock`、`@darwintree/dsh-theater-example-three-board-gomoku` 及其子路径）统一解析到 `src/`，确保清空 `dist/` 后执行 `pnpm test` 也能完全跑通。
2. 抽出一个共享的进程内 DSH 测试辅助模块（保持单向依赖边界，不让 `packages/theater` 反向依赖领域包），封装标准 `Context` + `Loader` + `Include` + 核心 DSH 服务 + 模块映射（将工作区包名直接映射到 `src/` 模块）+ `MockLlmAdapter` 的创建与清理。
3. 迁移 `packages/theater`、`packages/theater-gomoku`、`packages/theater-role-play`、`example/three-board-gomoku` 的集成测试复用该 harness，并将测试 fixture 中的相对 `dist/` 路径替换为包名子路径。
4. 保留一条显式的构建产物验证路径（例如 `pnpm check` 先 `tsc -b` 再跑测试，或额外的 built-bundle 冒烟校验），确保发布的 `dist/` 入口与 `exports` 映射不会静默损坏。

## Acceptance Criteria

- [ ] 删除所有 `dist/` 目录后，直接运行 `pnpm test` 全部通过（无 `dist/` 依赖，无 `src/` 与 `dist/` 混跑）。
- [ ] `pnpm check`（构建 + 全部测试）全部通过。
- [ ] 多个包的集成测试复用共享 DSH harness，不再各自重复组装基础 DSH 服务。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
