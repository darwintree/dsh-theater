# Implementation Trace: Theater 动态推进

Date: 2026-08-30
Source: 用户确认 Performance `autoAdvance` 设计并要求“动态切换也加上”
Language: 中文

## Entries

### 1. 动态开关不写入 Performance Session

Type: unresolved-implementation-decision

Context:
Preset 的 `autoAdvance` 是可复现的默认配置，但用户没有规定运行中切换是否应写入 Session，以及 cold resume 和 fork 是否继承一次进程内切换。

Decision:
将 preset 默认值写入 `theater/configured`；运行中的 `setAutoAdvance()` 只修改当前 Performance runtime。create、cold resume 和 fork 均从 durable preset 默认值重新建立当前开关，不继承来源 Performance 的进程内切换。

Reason:
这与 DSH Goal 将 durable phase 和 process-local `armed`/`disarmed` activation 分离的做法一致，也避免 fork 在所选历史 cursor 之外继承未来的运行时状态。

Follow-up:
如果产品需要跨进程保存用户暂停，需要另行定义 durable Performance lifecycle event，不能复用此 activation。

### 2. 关闭自动推进不取消当前 Character Segment

Type: unresolved-implementation-decision

Context:
用户要求动态切换，但没有规定在 Director 或 Character 正在执行时关闭开关的中断语义。

Decision:
`setAutoAdvance(false)` 不取消正在进行的 Director 决策或 Character Segment；当前 Segment 正常结算，在下一个 Director Point 读取最新开关并停止派发后续 `act`。

Reason:
Director Point 是 Theater 已定义的稳定点和 fork 点；中途取消会引入新的 Segment settlement、回滚及重试语义。

Follow-up:
None.

### 3. Manual 模式仍可立即识别 complete

Type: unresolved-implementation-decision

Context:
如果 manual 模式在到达 Director Point 后完全不调用 Director，最后一个 Character 行动完成后需要额外一次 `advance()` 才能把 Performance 标记为 complete。

Decision:
Theater 在每个 Director Point 都可读取一次 Director 决策：`complete` 立即结算；没有自动推进或单步许可时，`act` 不被派发且不缓存。下次推进重新从 durable Stage 状态求值。

Reason:
DirectorContext 只有只读 Stage 能力，重新求值不需要持久化 pending decision，并能让终局在最后一个 Segment 后立即可见。

Follow-up:
None.
