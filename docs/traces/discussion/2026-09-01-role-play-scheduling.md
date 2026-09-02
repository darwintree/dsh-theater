# Role-play 调度重写讨论记录

对应 spec change: None.

## 1. 核心意图 / Core Intent (Design Tree Root)

> Brief: Role-play 没有独立规则系统，事实应留在 Character Turns 与 DM 的结构化裁定中；调度只从这些 durable records 推导。首版删除不能证明必要性的 Stage、Transcript 与行动工具层。

### 1.1 事实与调度状态的来源

问题：Role-play 是否需要用 Stage 保存故事事实或调度状态。

决定：不创建 Role-play Stage。故事事实由 Character Sessions 中的 Turns 与成功的 DM Tool calls 表达，调度由 Performance Segment 顺序和这些 durable records 推导；Theater Preset 允许零个 Stage。

### 1.2 Role-play Transcript

问题：是否需要独立的 Role-play Transcript 作为领域实体或持久化副本。

决定：不需要。Character Sessions 保存各自历史，Performance Session 保存 Segment 顺序与 watermarks；需要的跨 Session 视图按需重建。

### 1.3 用户覆盖

问题：当前调度是否需要用户覆盖当前阶段或下一位 Character。

决定：不需要用户覆盖。

### 1.4 `speak_or_action`

问题：普通 Character 的公开表达是否仍必须通过 `speak_or_action`。

决定：删除 `speak_or_action`。普通 Character Turn 的直接 assistant 文字统一视为说话或行动尝试，由顶层 DM 裁定并通过 `voice_over` 形成事实。

## 2. Theater 读取面与 Segment 结构

> Brief: Theater 只增加两个当前用例需要的窄 seam：Director 读取已结算顶层 Turns，Tool 运行一个嵌套 Turn。所有关系从既有 durable 顺序重建，不增加缓存或身份层。

### 2.1 Director 的 durable Turn 读取

问题：无 Stage 的 Role-play Director 如何获得调度所需事实。

决定：`DirectorContext` 提供 `readSettledTurns()`；Role-play Director 自己投影 Turns 并继续返回既有 `act` 或 `complete` Decision，不新增独立 Instruction Projector contribution。

### 2.2 Settled Turn Read 形状

问题：Director 与嵌套 Tool 所需的最小 Turn read model 是什么。

决定：统一使用 `{ characterId, outcome, events }`。`readSettledTurns()` 只按 Performance 顺序返回顶层 Turns；`runNestedTurn()` 直接返回同一形状的嵌套 Turn。首版不增加 Turn ID、parent、depth、时间戳、游标或缓存。

### 2.3 Tool 触发嵌套 Character Turn

问题：`perceive_or_recall` 应如何运行 DM，而不绕过 Theater。

决定：Theater 向 Tool 提供窄能力 `runNestedTurn(characterId, instruction)`。Theater 负责嵌套 Segment、Character Turn、结算与 durable watermarks；Role-play Tool 负责结果校验和重试。

### 2.4 嵌套 Segment 语义

问题：Tool 调用 DM 后是否结束外层 Character Segment。

决定：不结束。嵌套 DM Segment 按 LIFO 结算、绕过 Director、不产生 Director Point；结果返回外层 Tool 后，同一个外层 Character Turn 继续 ReAct。

### 2.5 Segment 身份与嵌套关系

问题：是否需要为顶层/嵌套 Segment 增加 ID、parent 或 kind 字段。

决定：不需要。Performance Session 中平铺的 `segment-started` / `segment-ended` 与 durable LIFO 栈足以推导关系和当前 Turn 类型。

## 3. Director 调度流程

> Brief: Director 从顶层 Turn 序列推导唯一下一步。流程以 DM 开始，此后由普通 Character 与一到三个顶层 DM Turns 交替推进，终局只由 DM 的成功终止 Tool 决定。

### 3.1 初始 Director Point

问题：没有前序普通 Character Turn 时，Performance 如何开始。

决定：固定先调度 DM，Instruction 仅为 `开始演出。`；初始场景和 cast 内容保留在 DM system prompt 中。

### 3.2 普通 Character Turn 后的顶层 DM

问题：普通 Character Turn 结算后，哪些内容传递给顶层 DM。

决定：传递该完整 Character Turn Projection。Projection 来自整个 Turn，而不是单独的 Public Attempt 字段，也不包含进入该 Turn 的 Instruction。

### 3.3 顶层 DM 完成条件

问题：顶层 DM 如何完成一次场景裁定。

决定：一次裁定至少产生一个成功的 `voice_over`，并以恰好一个成功的 `recommend_next_character` 或 `end_performance` 结束。推荐选择普通 Character；结束 Tool 使 Director 返回 `complete`。

### 3.4 顶层 DM 校验失败

问题：DM 直接结束文字输出、但未完成结构化裁定时如何恢复。

决定：重新打开一个顶层 DM Turn，最多总计三个 DM Turns。修复 Instruction 只说明前一 Turn 为什么未满足契约，不重复已在 DM Session 中的 Character Turn Projection；三次均失败则停止 Theater Main Loop。

### 3.5 修复 Turn 前的 `voice_over`

问题：未完成终止协议的 DM Turn 中，已经成功的 `voice_over` 是否仍是事实。

决定：仍是事实，并计入同一次顶层裁定。修复 Turn 只补缺失部分，不回滚或要求重复旁白。

### 3.6 Character Recommendation 的 `reason`

问题：推荐下一位 Character 是否保留原因，以及原因是否参与调度。

决定：`recommend_next_character` 保留 `reason`，仅作为 Agent 可观测性指标；只有 `character` 影响调度，`reason` 不进入 Character Instruction。

## 4. `perceive_or_recall` 嵌套裁定

> Brief: 每个外层普通 Character Turn 只有一次私有感知请求。一次请求内部最多运行三个嵌套 DM Turns；成功回到原 ReAct，彻底失败则终止当前 Main Loop。

### 4.1 每 Turn 调用次数

问题：`perceive_or_recall` 在一个外层 Character Turn 中可调用几次。

决定：最多一次。Tool 从当前 open Turn 的 Character Session Events 判断是否已调用，不创建 Stage counter。

### 4.2 第二次调用的结果

问题：同一外层 Turn 第二次调用 `perceive_or_recall` 时是否终止 Turn。

决定：返回 `isError` Tool Result，不启动嵌套 DM Turn；外层 Character 可以继续 ReAct。

### 4.3 嵌套 DM 输入

问题：首次嵌套 DM Turn 看到多少外层 Character 内容。

决定：看到外层 Character Turn 截至当前 `perceive_or_recall` call 的自然语言 Projection 前缀。

### 4.4 `perception_result` 缺失

问题：嵌套 DM Turn 没有成功调用 `perception_result` 时如何恢复。

决定：Tool 再打开一个嵌套 DM Turn并告知失败原因，最多三个 DM Turns；成功结果作为外层 `perceive_or_recall` Tool Result 返回。

### 4.5 三次嵌套裁定均失败

问题：普通 Tool 错误默认只会让 ReAct 继续，如何满足停止 Theater Main Loop 的要求。

决定：第三次失败后取消外层 Character Turn，使外层 Segment 以失败结算并停止 Theater Main Loop。

## 5. Projection 与 Character Session 输入

> Brief: Projection 沿用旧 Role-play 的自然语言标签，不引入 JSON envelope。普通 Character 只在被调度时接收自上次行动后的可见 DM 事实。

### 5.1 Character Turn Projection 内容

问题：完整 Character Turn 中哪些内容投影给 DM。

决定：按原顺序投影 direct assistant text、Tool calls 和 Tool results；排除输入 Instruction、reasoning、Turn/Step 边界、seq、call ID 与展示 metadata。

### 5.2 Projection 编码

问题：Turn Projection 使用结构化 JSON 还是沿用旧自然语言格式。

决定：沿用旧自然语言 projection。Direct text 使用 `[character尝试说话/行动]\ncontent`；`perceive_or_recall` call 使用 `【character】询问：content`；结果使用 `[character感知/回忆结果]\ncontent`。多个 ReAct Steps 直接按顺序串联，不增加“本回合指令”或其他包装。

### 5.3 Nested 与 top-level Projection 范围

问题：嵌套 DM 与顶层 DM 是否读取相同范围。

决定：嵌套 DM 读取当前外层 Turn 前缀；外层 Turn 结算后的顶层 DM 读取完整 Turn。

### 5.4 普通 Character 的下一次 Instruction

问题：被推荐 Character 下次行动时应接收哪些 `voice_over`。

决定：按发生顺序接收其上一次 settled top-level Turn 之后所有对它可见的成功 `voice_over.content`；第一次行动从 Performance 创建开始累计。保留空字符串，不增加 wrapper text 或 recommendation reason。

### 5.5 未行动 Character Session

问题：`voice_over` 是否立即写入所有可见 Character Sessions。

决定：不立即写入。只有 Character 被调度时，其累计可见内容才作为该 Turn 的 Instruction 进入对应 Character Session。

## 6. Tool 契约与可见性

> Brief: 首版只保留五个 Role-play Tools，使用静态 catalog 与执行时 Turn-kind 校验。结构化字段只保留当前调度和反馈实际消费的内容。

### 6.1 首版 Tool 集合

问题：首版 Role-play 需要哪些 Tools。

决定：只保留 `perceive_or_recall`、`perception_result`、`voice_over`、`recommend_next_character` 和 `end_performance`；暂不引入 `d20` 或通用辅助 Tool 类别。

### 6.2 Tool 参数形状

问题：五个 Tools 的最小参数与结果是什么。

决定：`perceive_or_recall({ content }) -> { content }`；`perception_result({ content })`；`voice_over({ segments: [{ visibleTo, content }] })`；`recommend_next_character({ character, reason })`；`end_performance({})`。不保留 `targetCharacter`、推荐 content 或通用 metadata。

### 6.3 `voice_over` 覆盖规则

问题：不同 Character 的可见事实如何表达，以及空感知是否合法。

决定：每次 `voice_over` 的 segments 必须覆盖全部普通 Characters；每个 segment 的 `visibleTo` 只包含合法普通 Character，`content` 允许空字符串。

### 6.4 Tool 的 Turn-kind 边界

问题：同一个 DM Character 在顶层和嵌套 Turn 中如何限制 Tool 使用。

决定：Tool catalog 保持静态，执行时读取 Theater 当前 Turn kind。顶层 DM 允许 `voice_over`、`recommend_next_character`、`end_performance`；嵌套 DM 允许 `perception_result`。错误模式返回 `isError`，不产生事实。

### 6.5 Tool 的 Turn 终止语义

问题：哪些成功 Tool calls 结束当前 DM Turn。

决定：成功的 `perception_result` 结束嵌套 DM Turn；成功的 `recommend_next_character` 或 `end_performance` 结束顶层 DM Turn。校验失败返回错误并允许当前 DM 继续 ReAct。

## 7. YAGNI 边界与最终闭合

> Brief: 当前设计只实现可从 durable records 推导的调度与嵌套执行，不为可能的未来玩法预留状态层。讨论后的产品与架构 frontier 已闭合。

### 7.1 不持久化派生状态

问题：是否需要保存调度 cursor、Character inbox、Turn Projection 或 Director Decision。

决定：不需要；首版每次从 Performance 与 Character Session durable records 扫描推导。

### 7.2 不引入额外贡献点

问题：是否需要单独的 Projector contribution、动态 Tool 注册或 Role-play 专用 Theater 状态对象。

决定：不需要。Role-play Director 拥有 projection 和调度算法，Tool 使用静态 catalog，Theater 只提供通用 read 与 nested-turn seam。

### 7.3 产品与架构设计闭合

问题：上述决定是否足以闭合 Role-play 调度重写的当前设计。

决定：确认闭合；后续进入 spec 与实现，不增加未被当前用户故事要求的 Stage、Transcript、骰子、用户覆盖或兼容层。
