---
# This section is managed by the CLI. Do not edit manually.
id: "8e959d2c-7d1f-4141-8cb9-e3d388ec9d13"
title: "Streamline DSH integration, bundle mounting, and local debugging"
status: "open"
priority: "high"
labels: ["TECH DEBT", "READY-FOR-AGENT"]
created_at: "2026-11-20T11:00:00Z"
updated_at: "2026-11-20T11:02:00Z"
---
## Problem

当前 `refactor` 分支在接入 DSH 宿主（启动、可选包挂载、Preset 分发、本地开发调试）方面存在多处割裂和不一致，导致新增场景包、本地联调、跨机器运行和排障成本较高：

1. **DSH 依赖硬编码单机同级路径**：所有子包和示例包的 `devDependencies` 都写死了 `link:../../../deepseek-harness/...`（例如 `packages/theater/package.json`、`packages/theater-gomoku/package.json`、`packages/theater-role-play/package.json`、`packages/stage/package.json`、`example/three-board-gomoku/package.json`），脱离同级 `../deepseek-harness` 目录结构后无法独立安装和运行测试；部分 README 仍残留旧仓库目录名 `../dsh-theater-new/...`。
2. **可选挂载包的 DSH Bundle 约定不统一**：
   - `packages/stage`、`packages/theater`、`packages/theater-gomoku`、`example/three-board-gomoku` 声明了 `dsh.bundle` + `cordis.patch.yml`；
   - `packages/theater-role-play` 缺少 `cordis.patch.yml`、`dsh.bundle` 和可安装的 `agent.cordis.yml` preset 目录（集成测试里只能在临时目录现拼）；
   - `packages/theater-gomoku` 同时存在 `preset/`（单人）与 `presets/`（双人）两种目录结构。
3. **Preset YAML 中混用相对 `dist/` 路径，复制到 `$DSH_HOME/.agent-presets/` 后断裂**：
   - `packages/theater-gomoku/preset/agent.cordis.yml` 引用 `'../dist/single-agent.js'`；
   - `packages/theater-gomoku/presets/two-character-gomoku/agent.cordis.yml` 引用 `'../../dist/director.js'`；
   - `example/three-board-gomoku/preset/agent.cordis.yml` 引用 `'../dist/director.js'`；
   - 这些入口在对应 `package.json` 的 `exports` 中均已导出为包名子路径（如 `@darwintree/dsh-theater-gomoku/director`），但 YAML 未统一使用包名。
4. **启动和联调流程高度手工且无统一入口**：
   - 仓库根目录缺少总览 `README.md`，安装与启动步骤分散在各子包 README；
   - 每次联调需要在两个仓库间来回切换：构建、手动 `dsh plugin add link:...`、手动 `cp` preset 到 `~/.dsh/.agent-presets/`、再手动 `--patch` 启动。
5. **Headless 调试入口写死，无法跨场景复用**：
   - `packages/theater/src/headless.ts` 硬编码仅推进 4 个 Character Segment（`completed < 4`），仅接受配置里的 `presetId`；
   - `packages/theater-gomoku/headless.cordis.patch.yml` 把 `presetId: two-character-gomoku` 写死在 gomoku 包里，并覆写了全局 `agent-presets` 的 `default`，无法直接用于 `three-board-gomoku` 或 `theater-role-play`。
6. **集成测试混用 `src/` 与 `dist/` 且样板代码重复**：
   - `packages/theater/tests/performance.integration.spec.ts` 与 `packages/theater-role-play/tests/role-play.integration.spec.ts` 顶部直接 `import` `src/*.ts`，但 Loader 加载的 preset YAML 指向 `dist/*.js`，未先构建时会出现同一测试内混跑新源码和旧产物的问题；
   - 各集成测试重复手写数十行组装 DSH 基础服务（`Loader`、`LlmRuntime`、`SessionStore`、`AgentRegistry`、`AgentLoop`、`AgentPresets`、`ToolRuntime`、`SystemPrompt` 等）的 `setup()` 样板。
7. **跨进程观察痛点（Headless 推进 vs Web GUI 查看）**：
   - `packages/theater-role-play/README.md` 记录了独立 headless 进程推进后，已打开的 Web GUI 因内存会话缓存必须重启服务才能看到最新进度。

## Issue Assessment

- Impact: 高。直接影响日常开发、断点调试、可选场景包接入，以及多机器/CI 下的可复现性。
- Evidence: 见上述具体文件（`packages/*/package.json`、`packages/*/*cordis*.yml`、`example/three-board-gomoku/`、`packages/theater/src/headless.ts`、`packages/*/tests/*.integration.spec.ts`）。
- Scope: 开发构建、DSH bundle/preset 打包规范、headless 调试启动器、集成测试 harness 与根目录文档；不涉及改变核心 Performance/Stage 领域语义（问题 7 依赖 DSH 上游跨进程刷新能力，暂作为已知限制记录，不阻塞本 issue）。
- Decision: valid

## Child Issues (Execution Order)

为了避免改动面过大并保证独立环境可验证，拆分为以下 4 个按顺序执行的子 issue（优先解耦本地 `link:` 依赖，让后续每一步都能直接跑通 `pnpm install && pnpm check`）：

1. [[archive/20261120_closed_decouple-dsh-devdependencies-from-hardcoded-local-deepseek-harness-links]]
2. [[20261120_open_unify-optional-package-dsh-bundles-and-preset-packaging]]
3. [[20261120_open_generalize-theater-headless-runner-and-add-local-dsh-setup-workflow]]
4. [[20261120_open_eliminate-src-dist-mixing-and-deduplicate-dsh-test-harness]]

## Verification Checklist

- [x] 子 issue 1 完成：独立 checkout 下 `pnpm install && pnpm check` 可直接运行
- [ ] 子 issue 2 完成：所有可挂载包具备统一的 `dsh.bundle`、`cordis.patch.yml` 与基于包名导出的 `presets/`
- [ ] 子 issue 3 完成：通用 `@darwintree/dsh-theater/headless`、根目录 `README.md` 与 preset 同步脚本落地
- [ ] 子 issue 4 完成：测试不再出现 `src/` 与 `dist/` 混跑，并复用共享 DSH test harness

## Progress Log

- 2026-11-20: 梳理 `refactor` 分支全部包的 DSH 集成、bundle/preset 声明、headless 启动与测试链路，记录 7 类现状问题并拆分为 4 个推进阶段。
- 2026-11-20: 确认所需 `@deepseek-ai/*` 包均已发布到 npm，将工作拆为 4 个 `READY-FOR-AGENT` 子 issue 并调整执行顺序（先解耦 `link:` 依赖以打通独立构建与验证闭环）。
