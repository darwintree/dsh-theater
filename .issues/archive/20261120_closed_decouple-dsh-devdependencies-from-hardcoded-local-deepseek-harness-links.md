---
# This section is managed by the CLI. Do not edit manually.
id: "b90b2413-a85b-468d-9f31-829f8a0cc1ce"
title: "Decouple DSH devDependencies from hardcoded local deepseek-harness links"
status: "closed"
priority: "high"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:02:00Z"
updated_at: "2026-11-20T11:22:00Z"
---
Parent tracking issue: [[archive/20261120_closed_streamline-dsh-integration-bundle-mounting-and-local-debugging]]

## Problem

当前工作区所有子包和示例包（`packages/llm-mock`、`packages/stage`、`packages/theater`、`packages/theater-gomoku`、`packages/theater-role-play`、`example/three-board-gomoku`）的 `devDependencies` 均硬编码了本地相对路径 `link:../../../deepseek-harness/...`。

这导致在任何没有同级 `../deepseek-harness` 检出的环境（新机器、云端沙箱、CI）中都无法直接执行 `pnpm install`、`pnpm build` 或 `pnpm check`。

## Goal

让本仓库在无同级 `../deepseek-harness` 检出时也能默认通过 npm 依赖完成 `pnpm install && pnpm check`，同时为需要联调未发布 `deepseek-harness` 本地源码的开发者保留清晰的可选覆盖方式。

## Requirements

1. 核对当前代码所依赖的 `@deepseek-ai/*` API（注意 `@deepseek-ai/dsh-agent-presets` 在 npm 上最高兼容版本系列，例如 `0.1.5-rc.x` 或确认与当前代码的精确匹配版本），将各包 `devDependencies` 中的 `link:../../../deepseek-harness/...` 替换为统一、兼容的已发布 npm 版本号，并更新 `pnpm-lock.yaml`。
2. 保留各包 `peerDependencies` 对 DSH 宿主共享单例的声明（必要时收紧或保持与所选 DSH 版本一致）。
3. 提供可选的本地 `deepseek-harness` 联调方案（例如轻量脚本或文档化的 `pnpm.overrides` / 本地 link 切换方式），但不污染默认可提交的 `package.json` 和 `pnpm-lock.yaml`。
4. 验证在独立环境中执行 `pnpm install --frozen-lockfile && pnpm check` 全量构建与测试通过。

## Acceptance Criteria

- [x] 仓库中所有 `package.json` 不再硬编码 `link:../../../deepseek-harness/...`。
- [x] 在没有同级 `../deepseek-harness` 目录的环境中，`pnpm install && pnpm check` 全部通过。
- [x] 仍保留文档化（或脚本化）的可选本地 `deepseek-harness` 源码联调方式。

## Resolution

- 将所有 6 个工作区包中的 `link:../../../deepseek-harness/...` 替换为统一的 npm 发布版本（`@deepseek-ai/dsh-*@0.1.5-rc.3`、`@deepseek-ai/cordis@4.0.2`、`@deepseek-ai/cordis-plugin-loader@1.0.3`、`@deepseek-ai/cordis-plugin-include@1.0.7`、`@deepseek-ai/schemastery@3.18.2`），并在 `pnpm-workspace.yaml` 中配置统一的 `overrides`、`dedupePeerDependents: true`、`resolvePeersFromWorkspaceRoot: true` 与 `allowBuilds.koffi: false`，实现零 peer 警告与零重复实例。
- 适配了 DSH `0.1.5-rc.3` 的公开 API 变更：`@deepseek-ai/dsh-util-values`（`JsonValue` / `snapshotJsonValue`）、`session.snapshotEvents()`、`SessionPersistence` 写句柄生命周期、`SessionSeq` / `SessionLogOffset` / `inheritedEventCount`、`PERSONA_PREFIX_SECTION` / `personaPrefix`、`SessionProjections` 注入，以及不依赖本地补丁的 `agent-instructions` 作用域屏蔽兼容层。
- 新增 `scripts/dsh-local-links.mjs`，支持在需要联调本地 `deepseek-harness` 时一键打印或应用 `pnpm-workspace.yaml` 本地 link 覆盖，且不污染默认 `package.json`。
- 已验证 `pnpm install --frozen-lockfile && pnpm check`（8 个测试文件 / 52 个用例全绿）。

## Progress Log

- 2026-11-20: 从父 issue 拆出，作为后续所有集成整理子 issue 的前置基础设施。
- 2026-11-20: 完成 npm 依赖解耦、DSH `0.1.5-rc.3` 适配与 `scripts/dsh-local-links.mjs` 辅助脚本，全量 `pnpm install --frozen-lockfile && pnpm check` 通过（52/52），关闭并归档。
