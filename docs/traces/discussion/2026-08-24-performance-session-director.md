# Performance Session 与 Director 讨论记录

对应 spec change: None.

## 1. Performance Session 角色

问题：Performance 是否需要新的 DSH Session 类型，以及是否由 Agent Loop 驱动。

决定：Performance Session 仍是普通 DSH Session，但不绑定 Agent Loop；它是 Performance branch 的 durable root 与公开入口。

## 2. Director 的编排语义

问题：Director 是否是唯一有权启动 Character 的调度者。

决定：不把唯一调度权作为 Director 契约；Director 描述所有 Character Agent Loop 停止后如何进入下一步。

## 3. Character 间调用

问题：Character 是否可以启动另一个 Character。

决定：概念上允许，但当前双 Character Gomoku 不实现。

## 4. Director 生命周期

问题：Director 是一次性决策函数还是可跨 await 存活的控制任务。

决定（2026-08-25 校正）：Theater 持有自动驱动 Performance 的长生命周期主循环。Director 是在每个 Director Point 被调用一次的 liveness 决策构件，明确返回 `act` 或 `complete`；它不执行 action、不持有主循环，也不保留跨决策的局部控制状态。原记录把 Theater 主循环的生命周期归给 Director，属于沟通误差。当前没有外部唤醒协议，因此不提供 `idle` Decision。

## 5. Director 算法

问题：当前是否规定通用 Director 的内部结构和算法。

决定：不规定；双 Character Gomoku 的 Director 读取棋盘状态并按当前落子颜色推进黑白轮转。

## 6. Character roster

问题：Performance 运行中是否可以增删 Character。

决定：Character roster 在 Performance 创建时固定，并为 roster 中的 Character 创建对应 Character Sessions。

## 7. Fork 公开边界

问题：是否提供独立的 Character Session fork 能力。

决定：只公开 Performance Fork；Character Sessions 仅作为 Performance Fork 的组成部分按记录位置派生。

## 8. Character Event 聚合

问题：Performance Session 是否复制 Character Session Events。

决定：不复制；Performance Session 通过各 Character 最近一次 `theater/segment-ended` 中的 Session watermark 引用各自历史。

## 9. Character Session 位置

问题：Performance prefix 中的 Character Session 位置如何表示和命名。

决定：每个 `theater/segment-ended` 保存该 Character flush 后的 `characterSessionSeq`，值取对应 Session 的 `seq`，表示 exclusive event count；fork 时取所选 Performance prefix 中每个 Character 最近的值，未行动过则为 `0`。

## 10. Director Point

问题：哪些 Performance 位置允许 fork。

决定：只允许从 Director Point fork；Director Point 是 durable Character Segment 栈为空的任一 Performance Session prefix。

## 11. Director Decision 与 fork

问题：fork 点位于 Director Decision 之前还是之后。

决定：位于 Decision 之前；fork 后由新分支基于该点的 durable state 重新决定下一步。

## 12. Theater Main Loop continuation

问题：fork 后如何恢复 Performance 的自动驱动。

决定：新分支从所选 Director Point 启动 Theater Main Loop，并重新调用 Director 产生下一项工作。不存在需要恢复的 Director 执行位置、Workflow Replay 或调用栈。

## 13. Director Point 后的工作

问题：fork 是否必须保留所选 Director Point 之后已经计算但尚未执行的 Director Decision。

决定：不保留；子分支重新调用 Director，少量重新计算属于预期语义。

## 14. Character 输入

问题：当前双 Character Gomoku 是否需要在 Character 行动前生成和注入 Projection。

决定：当前不需要 Projection；Projection 的来源、管理、持久化和投递均不进入当前范围，Character 行动只接收所需的 Instruction。

## 15. Stage 身份与所有权

问题：Stage 是否按全局 Stage ID 标识，以及 Stage Events 写入哪个 Session。

决定：Stage 由 owning Session 与 Stage ID 共同标识；`stage/configured` 和该 Stage 的 `stage/op` 始终写入 owning Session。

## 16. Performance Stage 与 Character Stage

问题：Character 调用不同所有权的 Stage 时，Stage Op 写入哪里。

决定：Performance Stage 即使由 Character Tool 调用，Stage Op 仍写入 Performance Session；Character 专属 Stage 的 Stage Events 写入对应 Character Session。

## 17. Stage Op 可见性

问题：Stage Op 是否对 Character 可见。

决定：Stage Op 对 Character 不透明。

## 18. Gomoku 运行模式

问题：现有单 Agent Gomoku 与新的 Theater Gomoku 如何共存。

决定：保留直接使用核心 Gomoku State Machine 的单 Agent demo，但它不作为 Theater 运行；新的 Theater 模式使用黑白两个 Character Sessions、同一个核心 State Machine，以及另一套 Tool 和编排。

## 19. 当前并发约束

问题：当前设计是否建立 Character 或 Performance branch 层面的串行契约。

决定：当前只约定不得并行执行 Tool Calls，不额外规定 Character 或 branch 层面的通用并发模型。

## 20. User Input 范围

问题：当前双 Character Gomoku 是否需要 Performance User Input 和等待协议。

决定：不需要；当前场景全自动运行，User Input 仅是 Director 能力讨论中的例子，不进入当前范围。

## 21. Character 棋盘访问

问题：不引入 Projection 时，Character 如何获得行动依据。

决定：Director 注入的 Instruction 提供上一步行动、当前 Character 的颜色和读取棋盘后落子的要求；只读 `read_board` Tool 提供权威的完整棋盘。

## 22. Character 落子颜色

问题：落子颜色由 Character 提交，还是由其 Tool 权限绑定。

决定：黑白 Character 分别使用绑定对应颜色的落子 Tool；Character 只提交坐标。

## 23. Character action 结束

问题：合法与非法落子如何影响当前 Character action。

决定：使用 DSH 原生 `ToolRunContext.concludeTurn()`；合法落子成功后结束当前 action，非法落子不结束并允许同一 Character 重试。

## 24. 只读棋盘 Tool 的事件归属

问题：`read_board` 的调用记录和 Stage 持久化语义是什么。

决定：原生 Tool call/result 写入发起调用的 Character Session；`read_board` 只读取 Performance-owned Gomoku Stage，不产生 `stage/op`。

## 25. Gomoku Character 与颜色

问题：当前是否需要独立的 Character-to-color 映射层。

决定：不需要；两个 Character ID 直接使用 `black` 和 `white`。

## 26. Performance 终局

问题：Stage 已结束时，Director 是否需要另行持久化 Performance completion 状态。

决定（2026-08-25 校正）：不需要 durable Performance completion Event。Gomoku Stage 仍是棋局终局事实的唯一来源；Director 读取该事实并返回 `complete`，由 Theater Main Loop 将运行状态设为 `completed`。通用 Theater 不通过聚合 Stage completion 推断 Performance completion。

## 27. 初始 Director Point

问题：首次 Character 行动之前是否存在可 fork 的 Director Point。

决定：存在；Performance Session、Character Sessions 和 Gomoku Stage 创建并 flush 后建立初始 Director Point，再由 Theater Main Loop 请求第一次 Director Decision。

## 28. 棋盘读取顺序

问题：Theater 是否必须验证 Character 在落子前已于同一 action 调用 `read_board`。

决定：不验证；Instruction 要求 Character 先读取棋盘，落子合法性仍由 Gomoku Stage 验证。

## 29. 未落子的 Character action

问题：Character 正常结束 Agent Loop、但未产生合法落子时如何继续。

决定：建立新的 Director Point，Theater Main Loop 再次调用 Director；因棋盘未改变，Director 再次返回同一个 Character 的 action，不增加失败状态或重试计数。

## 30. Character Session 身份

问题：Performance 是否需要持久化 Character ID 到 Character Session ID 的映射。

决定：不需要；Character Session ID 由 Performance Session ID 与 Character ID 确定性派生。

## 31. Character Segment 结算边界

问题：新 Theater 是否沿用旧 Theater 在 `theater/segment-ended` 之后继续执行独立 end reaction 的设计。

决定：不沿用；Character 和相关 Stage flush、所有 Theater 管理的后处理完成后，才写入并 flush `theater/segment-ended`。该 Event 使 durable Character Segment 栈归零，并构成可 fork 的结算边界。

## 32. Character Session watermark

问题：不复制 Character Events 时，fork 如何恢复各 Character Session 的截断位置。

决定：每个 `theater/segment-ended` 保存该 Character flush 后的 exclusive `characterSessionSeq`；fork 时扫描所选 Performance prefix，取每个 Character 最近的值，未行动过则为 `0`。

## 33. Performance fork cursor

问题：调用方如何标识一个可 fork 的 Performance prefix。

决定：使用 exclusive `performanceSessionSeq`，表示所选 Performance prefix 的事件数量；Theater 必须验证该 prefix 的 durable Character Segment 栈为空。

## 34. 异常 Character Segment

问题：Character Agent Loop 以 aborted 或 error 结束时，Director 是否自动继续。

决定：Character 与相关 Stage flush 后仍写入并 flush `theater/segment-ended`，形成可 fork 的空栈位置；当前 Theater Main Loop 停止并传播错误，后续 restart 或 fork 可从该位置再次调用 Director。只有 completed Segment 自动进入下一次 Director Decision。

## 35. Character Segment 身份

问题：当前是否需要为每个 Character Segment 分配稳定 ID。

决定：不需要；当前串行且严格 LIFO，`theater/segment-started` 与 `theater/segment-ended` 通过 durable 栈顺序和 Character 校验配对。

## 36. Character Segment 开始顺序

问题：Theater 何时把 Director Decision 中的 Instruction 注入 Character Session 并启动 Agent Loop。

决定：Theater 先写入并 flush `theater/segment-started`，再注入 Instruction 并启动 Character Agent Loop；Character Session 开始变化时，Performance 的 durable Character Segment 栈必须已经非空。

## 37. Theater 抽象边界

问题：通用 Theater 是否负责领域调度算法。

决定：不负责领域算法；Theater 组装 Performance、Director、Characters、Sessions 和 Stages，持有主循环并管理 durable 边界。具体下一项行动和 Performance completion 由领域 Director 决定，合法性和领域终局事实由 Stage 决定。

## 38. Performance 产品读取面

问题：当前是否提供跨 Character 的 merged transcript。

决定：不提供；Performance 读取面主要包含 Stage 状态、运行状态和 forkable positions，各 Character 对话历史通过对应 Character Session 单独读取。

## 39. Character Segment 可见性

问题：Character Segment 是否作为可独立操作的公开子资源。

决定：不是；Character Segment 只是 Theater 的 durable 编排边界，公开操作面是 Performance 与 Performance fork cursor。

## 40. Character-owned Stage 组装

问题：Theater 是否为 Character-owned Stage 增加专门声明或管理层。

决定：不增加；Performance 或 Character 的配置代码直接使用现有 Stage API，在相应 owning Session 中创建 Stage。当前 Gomoku 只创建一个 Performance-owned Stage。

## 41. Instruction 持久化归属

问题：Performance Session 是否复制派发给 Character 的 Instruction。

决定：不复制；Instruction 是 Theater 不解释的 opaque input，只作为目标 Character Session 的输入持久化。Performance Session 仅记录其 durable 编排边界和所拥有 Stage 的 Events。

## 42. Theater composition 来源

问题：Theater 是否需要引入 `TheaterDefinition` 或独立 Definition registry 来声明和恢复 Performance composition。

决定：不需要；采用 DSH preset 路径，以 preset ID 定位并恢复 standing Cordis composition。preset 可携带 Director、Character roster、Character preset 与 Stage 的静态组装配置；单个 Performance 的可变状态仍只属于 Performance Session、Character Sessions 与 Stages。

## 43. Agent Preset 兼容边界

问题：Theater 是否把现有 Agent Preset 产品语义正式泛化到 Performance Session。

决定：不泛化；现有 Agent Preset 的 Session header、事件、API、选择界面和文档语义保持不变。Theater 内部复用 Agent Preset 的 roster、standing composition 与 preset ID，但在 Theater 自己的 durable Event 中记录 Performance 使用的 `presetId`，不写入 Performance Session 的 `agentPreset` header。Character Sessions 仍独立使用其真正的 Agent Preset。

## 44. Preset scope 的 Theater seam

问题：standing preset composition 如何向 Theater 提供 Performance 组装能力。

决定（2026-08-25 修正）：preset 中的 plugin 可分别向当前 standing scope 贡献 Characters、Stages 或 Director。Theater 通过 preset ID 加载该 scope，汇总所有 Character 与 Stage contributions，并要求恰好存在一个 Director；各类贡献可以来自不同 plugin，当前 Gomoku 恰好由同一个 plugin 同时提供。preset mount 本身不创建 Performance。

## 45. Preset generation 与旧 Performance

问题：Performance 是否快照或 pin 创建时使用的 preset composition。

决定：不快照也不 pin；cold resume 和 fork 重新加载当前 preset generation。当前 contributions 必须与 durable Character roster、Character preset assignments 和 Stage configuration 兼容，否则拒绝继续驱动，但历史 Performance 仍可读取。兼容的 Director 或 prompt 修改可在下次恢复时生效。

## 46. Theater-capable preset 的部署依赖

问题：包含 Theater contributions 的 preset 是否必须在未部署 Theater 能力时仍可作为普通 Agent preset 运行。

决定：不必；该 preset 可以显式依赖 `theater`。部署缺少该能力时，preset composition 整体不可运行，并按现有 Agent Preset health 语义呈现为 broken 或 unavailable；不增加 preset kind 或降级路径。

## 47. Performance 创建参数

问题：当前是否需要向已选择的 preset 传入逐 Performance runtime arguments。

决定：不需要；Theater 的静态组装参数直接来自 preset rows。每局产生的可变状态进入 Performance Session、Character Sessions 或 Stages，不保存在 standing preset plugin instances 中。

## 48. Character Agent Preset assignment

问题：每个 Character 使用的 Agent Preset 是否可脱离 Performance 独立变化。

决定：不可；Performance 创建时解析出的 Character Agent Preset assignments 是固定 roster 的一部分，Character Session 持久化实际选择，Performance Fork 继承这些 assignments。cold resume 时，当前 Theater Character contributions 必须提供兼容的 assignments，否则拒绝继续驱动。

## 49. 产品与架构设计闭合

问题：上述决定是否足以闭合当前 Theater 迁移的产品与架构设计讨论。

决定：确认闭合；当前产品与架构 frontier 已空，后续进入实现时不再预设额外抽象。
