---
# This section is managed by the CLI. Do not edit manually.
id: "ea065305-8b18-4e94-949f-f9ff8f27830e"
title: "Eliminate src/dist mixing and deduplicate DSH test harness"
status: "closed"
priority: "medium"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:36:00Z"
---
Parent tracking issue: [[archive/20261120_closed_streamline-dsh-integration-bundle-mounting-and-local-debugging]]
Depends on: [[archive/20261120_closed_unify-optional-package-dsh-bundles-and-preset-packaging]]

## Problem

1. **`src/` 与 `dist/` 混跑**：
   - `packages/theater/tests/performance.integration.spec.ts`、`packages/theater-role-play/tests/role-play.integration.spec.ts` 等测试顶部直接 `import` `src/*.ts`，但测试中的 preset fixture（如 `packages/theater/tests/fixtures/presets/*/agent.cordis.yml`）和临时 `agent.cordis.yml` 给 Cordis Loader 传的却是 `dist/*.js`；
   - 改完源码未先 `pnpm build` 时，单条测试内会同时执行新源码与旧编译产物，IDE 断点与堆栈也容易错位。
2. **集成测试 `setup()` 样板大量重复**：
   - 多个包的集成测试各自复制粘贴了 60~100 行组装 `Loader`、`Include`、`LlmRuntime`、`SessionStore`、`JsonlSessionPersistence`、`AgentRegistry`、`AgentDefaultModel`、`AgentLoop`、`AgentPresets`、`SystemPrompt`、`ToolRuntime`、`StageService`、`TheaterService` 的代码，维护成本高。

## Goal

让日常 Vitest 调试全链路直连 TypeScript `src/`（不依赖预先 `pnpm build` 产出 `dist/`），并抽出共享的进程内 DSH 测试 harness 供所有包复用。

## Acceptance Criteria

- [x] 删除所有 `dist/` 目录后，直接运行 `pnpm test` 全部通过（无 `dist/` 依赖，无 `src/` 与 `dist/` 混跑）。
- [x] `pnpm check`（构建 + 全部测试）全部通过。
- [x] 多个包的集成测试复用共享 DSH harness，不再各自重复组装基础 DSH 服务。

## Resolution

- 新增根目录 `vitest.config.ts`，将全部工作区包与子路径统一 alias 到 `src/*.ts`。
- 新增共享测试基础设施 `tests/harness.ts`（`createDshTestContext`、`installWorkspaceSourceLoader`、`extractSystemPrompt`），拦截 Cordis Loader 的 `@darwintree/*` 导入直连 Vitest 源码模块图，消除同一测试内的 `src/`/`dist/` 双版本混跑。
- 将 `packages/theater/tests/fixtures/presets/*/agent.cordis.yml` 与 `writeCompatibilityPresets` 中的全部相对 `dist/` 路径替换为包名子路径，并迁移 `packages/theater`、`packages/theater-gomoku`、`packages/theater-role-play`、`example/three-board-gomoku` 及 `tests/bundles-and-presets.spec.ts` 复用共享 harness。
- 新增 `tests/built-exports.spec.ts` 作为显式构建产物冒烟检查（无 `dist/` 时自动跳过，`pnpm check` 构建后验证所有 `package.json` `exports` 目标落盘）。
- 已验证 `pnpm clean && pnpm test`（61/61 通过，1 skipped）与 `pnpm check`（62/62 全绿）。

## Progress Log

- 2026-11-20: 从父 issue 拆出。
- 2026-11-20: 完成源码直连 `vitest.config.ts`、共享 `tests/harness.ts`、fixture 迁移与 `tests/built-exports.spec.ts`，验证无 `dist/` 运行与 `pnpm check` 全绿，关闭并归档。
