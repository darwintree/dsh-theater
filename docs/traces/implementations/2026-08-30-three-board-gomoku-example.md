# Implementation Trace: Three-Board Gomoku Example

Date: 2026-08-30
Source: 用户关于新增 `example` 目录及 Master 对战三个 Challenger 的请求
Language: 中文

## Entries

### 1. 默认逐 Turn 推进

Type: unresolved-implementation-decision

Context:
需求定义了 Director 的循环顺序，但没有指定该示例默认自动连续推进，还是由调用方逐 Turn 推进。自动推进会持续调用四个 Character 的 LLM，错误模型行为也可能无限重试。

Decision:
示例 preset 设置 `autoAdvance: false`，由调用方通过 `ctx.theater.advance()` 检查并推进每个 Character Turn；需要自动运行时可在 preset 中改为 `true`。

Reason:
逐 Turn 推进保留完整调度语义，同时让扩展示例可观察、可控，避免安装后意外产生连续 LLM 调用。

Follow-up:
None.
