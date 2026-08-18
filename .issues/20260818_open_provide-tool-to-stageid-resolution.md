---
# This section is managed by the CLI. Do not edit manually.
id: "4cce2001-d872-4ae7-895e-7966e5b85616"
title: "Provide tool-to-stageId resolution"
status: "open"
priority: "medium"
labels: ["FEATURE REQUEST", "NEEDS-TRIAGE"]
created_at: "2026-08-18T09:10:00Z"
updated_at: "2026-08-18T09:10:00Z"
---
## Problem

Stage tool 当前只能用 `${sessionId}-stage` 推导目标 stageId，因此一个 Session 实际只能对应一个 Stage。若同一 Session 需要多个 Stage，tool 无法选择目标 State Machine。

## Goal

提供一个从 tool execution 解析目标 stageId 的机制，使 tool 不需要内置 Session 到 Stage 的命名约定。

## Current temporary contract

- 当前 Stage tool 使用 `${sessionId}-stage`。
- 当前实现只支持一个 Session 对应一个 Stage。
- 在解析机制完成前，不扩展同一 Session 的多 Stage 能力。

## Acceptance criteria

- Tool 可以通过公共机制取得目标 stageId。
- 同一 Session 可将不同 tool operation 路由到不同 Stage。
- 缺失或歧义的 stageId 映射会明确失败。
- 持久化、恢复与 replay 使用解析后的 stageId。
- 有测试覆盖单 Session 多 Stage 的路由与隔离。