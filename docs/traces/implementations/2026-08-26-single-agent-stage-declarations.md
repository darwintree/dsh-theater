# Implementation Trace: Single-Agent Stage Declarations

Date: 2026-08-26
Source: 用户确认的 `stages.<stageId>.machine/params` 配置设计与单 Agent Gomoku 迁移请求
Language: 中文

## Entries

### 1. Agent Context 只用于定位声明 scope

Type: unresolved-implementation-decision

Context:
配置设计没有约定运行时如何从 Agent 定位 preset 声明。实现时发现 DSH 的 `agent.ctx` 不会自动获得 `stages` Service 的注入权限，因此工具不能直接调用 `agent.ctx.stages.ensure(...)`；而从 Gomoku 插件的 host context 调用又无法隐式知道 Agent 所属的 preset scope。

Decision:
Stage Service 提供 `ensureDeclared(declarationCtx, session, stageId)`。Gomoku 工具仍通过其已注入 `stages` 的插件 context 调用 Service，并显式传入 `agent.ctx`，Stage Service 只从中读取 scope chain 来查找声明。Stage 的持久 owner 仍然只由 `session` 参数决定。

Reason:
该接口不要求修改 DSH Agent Loop 的注入集合，也不让 Stage 依赖 Agent Registry；Context 只承担已有的 scope 定位职责，不进入 preset 配置或持久事件。

Follow-up:
None.
