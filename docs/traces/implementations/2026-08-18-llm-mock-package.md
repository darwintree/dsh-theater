# Implementation Trace: 独立 Mock LLM Adapter 包

Date: 2026-08-18
Source: 用户要求“一个独立的包，是一个新的 llm adapter，用于端到端或自动化测试”
Language: 中文

## Entries

### 1. 包名与目录

Type: unresolved-implementation-decision

Context:
需求明确要求独立包，但未指定包名和 workspace 目录。

Decision:
使用 `packages/llm-mock`，包名为 `@darwintree/dsh-llm-mock`。

Reason:
遵循当前 workspace 的 `packages/*` 布局，并直接表达它是 DSH LLM seam 的 mock adapter。

Follow-up:
None.

### 2. 自动化配置与编程接口

Type: unresolved-implementation-decision

Context:
端到端测试需要从 Cordis 配置加载，复杂自动化测试又可能需要按请求动态生成响应；需求未规定只支持哪一种方式。

Decision:
插件配置接受可序列化的线性 `script`，同时导出 `Behaviour`、`createScriptedBehaviour` 和 `MockLlmAdapter` 供测试代码直接组合。

Reason:
线性配置覆盖无代码的端到端场景；编程接口覆盖按消息、工具或 purpose 分支的场景，无需引入额外 DSL。

Follow-up:
None.
