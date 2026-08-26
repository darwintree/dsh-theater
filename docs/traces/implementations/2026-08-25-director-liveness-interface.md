# Implementation Trace: Director liveness interface

Date: 2026-08-25
Source: 2026-08-25 用户确认的 Theater-owned main loop / Director liveness 契约
Language: 中文

## Entries

### 1. Director 的可读状态面

Type: unresolved-implementation-decision

Context:
已确认 Director 每次只返回下一项工作且不产生编排副作用，但没有规定它可以读取哪些状态。旧接口同时暴露可变 Performance Session、Character Session 与 Stage state；当前双 Character Gomoku 只需要 Stage state。

Decision:
`DirectorContext` 当前只提供只读 `readStage(stageId)`。不继续暴露原始 Session；后续出现阻塞用例时再增加窄的只读查询。

Reason:
这满足当前 liveness 决策所需信息，并避免 Director 绕过 Theater 修改 Session 或 durable 编排边界。

Follow-up:
None.

### 2. 无下一项工作的运行状态

Type: unresolved-implementation-decision

Context:
契约允许 Director 返回“无可执行工作”，但没有规定 Theater 应将 Performance 标记为 completed 还是 idle。

Decision:
原实现让 Theater Main Loop 在无 action 时检查所有 Stage，并据此选择 `completed` 或 `idle`。2026-08-25 用户先将 completion 改为显式 Director Decision，随后因当前没有外部唤醒协议而删除 `idle`；Director 现在只返回 `act` 或 `complete`。

Reason:
Stage 仍提供领域终局事实，但只有领域 Director 能判断这些事实是否意味着整个 Performance 完成；通用 Theater 不应内置“所有 Stage 完成”的策略。

Follow-up:
外部唤醒协议进入范围时，再连同相应的非终局等待 Decision 一并设计。

### 3. 分散贡献的注册接口

Type: unresolved-implementation-decision

Context:
用户确认 Characters、Stages 与 Director 可以由同一 preset 中的不同 plugin 分别贡献，但没有规定注册接口采用三个专用方法，还是采用带 kind 的通用 contribution 结构。

Decision:
提供 `registerCharacter()`、`registerStage()` 与 `registerDirector()` 三个窄接口。Theater 在 standing preset scope 中分别累积贡献，解析时要求至少一个 Character、至少一个 Stage，以及恰好一个 Director。

Reason:
三类值的结构和基数约束不同；专用接口直接表达这些约束，也不需要新增通用 contribution DTO、kind 枚举或 Definition/provider 层。

Follow-up:
None.
