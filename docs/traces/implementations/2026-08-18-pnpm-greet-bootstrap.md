# 实现追踪：pnpm greet 初始化

Date: 2026-08-18
Source: 用户请求“复用 deepseek-harness tutorial 中的 greet 工具，初始化 pnpm 结构”
Language: 中文

## Entries

### 1. 从临时教程文件落到单包工作区

Type: unresolved-implementation-decision

Context:
教程将 greet 作为临时源码文件运行，没有规定 dsh-theater-new 的 package 边界；旧仓库的六包结构又明确不应整体迁移。

Decision:
建立 pnpm workspace，并只创建 `packages/theater` 一个包，沿用 `@darwintree/dsh-theater` 包名。

Reason:
单包工作区提供真实的构建边界，同时不预先恢复旧仓库的其他 package 划分。

Follow-up:
None.

### 2. 使用无模型 smoke test 作为初始检查

Type: unresolved-implementation-decision

Context:
用户要求用 greet 初始化结构，但没有规定验证方式；教程的 Web UI 路径需要完整运行环境和模型配置。

Decision:
测试挂载真实的 Cordis、System Prompt 和 Tool Runtime，直接通过工具执行管线调用 greet，不启动模型或 Web UI。

Reason:
这能验证 package、TypeScript、DSH 依赖和工具注册，同时保持检查无密钥、确定且快速。

Follow-up:
None.

### 3. 通过 Web profile 提供用户端到端流程

Type: unresolved-implementation-decision

Context:
用户要求说明并确认 DeepSeek Harness 中的端到端使用流程；临时 `--patch` 和可安装 bundle 都能加载插件，但前者需要机器相关的插件路径。

Decision:
将 `packages/theater` 声明为 DSH bundle，由 `cordis.patch.yml` 注册插件；本地流程先构建 checkout，再安装到 `web` profile。

Reason:
bundle 复用 DSH 的正式插件安装入口，文档无需保存绝对路径，安装、配置检查、Web 使用和卸载形成完整用户流程。

Follow-up:
GitHub 或 npm 分发确定后，再增加自包含的构建与发布配置。
