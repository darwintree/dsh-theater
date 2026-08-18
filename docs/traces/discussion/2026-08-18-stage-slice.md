# Stage 切片讨论记录

对应 spec change: None.

## 1. Stage Service 形状

问题：Stage 是否拆成抽象 Service Definition 与独立 runtime provider。

决定：不额外拆分；Stage 是一个具体 Cordis Service，暴露为 `ctx.stages`。

## 2. Tool 调用身份

问题：Tool 从哪里取得当前 Session 身份，以及缺少 Agent 时如何处理。

决定：Tool 从 `exec.agent.id` / `exec.agent.session` 取得身份；没有 Agent 时直接报错。

## 3. 当前参与者模型

问题：当前 Gomoku 是否支持多 Agent 或 Agent 自我对弈。

决定：当前只有一个 Agent；用户执黑、Agent 执白，Agent 负责记录双方落子。

## 4. Stage 持久化位置

问题：Stage 事件由哪个持久化日志承载。

决定：使用当前 Agent 的 Session 作为权威日志，不创建额外 Stage Session。

## 5. Stage ID

问题：Stage 运行实例如何标识，以及 Service 接口是否继续接收 agentId。

决定：`stageId` 是 Stage 中 State Machine 的唯一标识；Service 接口不接收 agentId。

## 6. 当前 Stage ID 解析

问题：在通用 tool-to-stageId 解析机制完成前如何得到 stageId。

决定：当前 tool 使用 `${sessionId}-stage`；实现范围内一个 Session 只对应一个 Stage。

## 7. 多 Stage 解析能力

问题：单个 Session 对应多个 Stage 是否属于当前切片。

决定：不属于；另建 issue 跟踪从 tool 解析 stageId 的公共机制。

## 8. Live State Machine Registry

问题：Stage Service 如何保存 live State Machine。

决定：按 stageId 保存同一个 State Machine 对象指针，不复制对象。

## 9. State Machine 职责

问题：State Machine 是否负责 Session、事件和 flush。

决定：State Machine 是只包含 live state 与领域规则的确定性对象，不接触 Session、Context、事件或 flush；持久化由 Stage Service 负责。

## 10. State Machine 转换接口

问题：State Machine 的状态转换方法如何命名。

决定：使用状态机术语 `transition(op)`；公共 Stage Service 使用 `interact(stageId, op)`。

## 11. Op 抽象

问题：是否区分 Interaction 与 committed Operation。

决定：不区分；同一个 canonical `op` 用于 live transition 与 replay。

## 12. Gomoku Op 的颜色语义

问题：Op 是否携带 DSH Character，以及 SM 是否校验颜色。

决定：Op 不携带 DSH Character 身份；它携带黑/白 Stone Color，SM 维护并校验黑白轮转。

## 13. Gomoku 规则

问题：Gomoku State Machine 负责哪些规则。

决定：负责棋盘边界、位置占用、黑白轮转、胜负、和棋与终局校验。

## 14. Gomoku 配置

问题：当前棋盘与胜利条件如何配置。

决定：沿用旧 Gomoku 的默认 `15×15` 与五子连珠，并保留 `boardSize` / `winLength` 配置解析。

## 15. 配置权威

问题：preset/plugin config 与持久化配置谁是恢复时的权威。

决定：preset/plugin config 只提供首次创建输入；解析后的 `{ stageId, machine, version, config }` 写入 `stage/configured`，此后持久事件是权威。

## 16. State Machine 种类

问题：唯一实例 stageId 如何指明应恢复 Gomoku 还是 Dice。

决定：`stage/configured` 另行记录 `machine` 与 `version`；stageId 不承担 State Machine 种类语义。

## 17. 懒创建与恢复

问题：全局 Gomoku tool 何时创建或恢复 State Machine。

决定：tool 首次执行时使用 stageId、当前 Agent Session 与 Gomoku 构造能力幂等 ensure；随后调用 `ctx.stages.interact(stageId, op)`。

## 18. Factory 合同

问题：State Machine factory 的具体接口是否写入当前 spec。

决定：不写入；由实现决定。

## 19. Transition 结果

问题：合法与非法 op 如何返回。

决定：合法 op 返回 `accepted`，可带一个可选 observational outcome；规则拒绝返回 `domain-rejected` 与 reason；程序故障抛异常。

## 20. 持久化 Stage Op

问题：哪些请求会形成持久化 Stage Op。

决定：只有成功推进状态的 accepted op 会写入 `stage/op`；domain-rejected 与 runtime failure 不写事件。

## 21. Stage Op 字段

问题：Stage Op 是否记录 cause，以及 outcome 是否参与 replay。

决定：不记录 cause；outcome 是可选观测字段，replay 由 op 本身决定。

## 22. 持久化顺序

问题：accepted op 何时对调用者报告成功。

决定：先将 op 转为 detached JSON，再执行 transition；accepted 后追加 `stage/op` 并 flush，flush 成功后才返回 accepted。

## 23. Flush 失败

问题：flush 失败是否回滚或触发 retry 协议。

决定：`interact()` 抛出 flush 错误，不承诺回滚已经推进的 live state，也不提供自动重试、去重或 retry API；调用者不能把交互视为成功。

## 24. Read 与 Completion

问题：Tool 如何取得最新棋盘和终局状态。

决定：Stage Service 提供 `read(stageId)` 的通用 JSON snapshot 与 `completed(stageId)`；Gomoku tool 负责解释并渲染完整棋盘、胜者和终局状态。

## 25. Agent Turn 流程

问题：一次用户输入如何完成用户棋、Agent 棋与最终回复。

决定：Gomoku tool 不调用 `concludeTurn()`；Agent 先调用 tool 记录用户黑棋，读取结果后选择并记录自己的白棋，再基于第二次结果自然回复。

## 26. Session Event 类型注册

问题：自定义 Stage Session Event 如何注册。

决定：沿用旧仓库的生命周期计数 registrar，不修改 deepseek-harness。

## 27. 包边界

问题：Stage 与 Gomoku 放在哪些包中。

决定：新增独立 `packages/stage` 与 `packages/theater-gomoku`；Dice 暂不实现。

## 28. 现有 Theater 骨架

问题：是否删除当前 `packages/theater` 的 greet 骨架。

决定：若新实现需要复用 `packages/theater`，删除 greet 并替换其内容；若两个新包即可完成切片，则暂时保留。

## 29. 当前非目标

问题：哪些行为不进入当前 spec。

决定：不规定 factory 的具体接口、同一 Stage 的并发交互、Stage/Session 销毁时的 Map 清理、retry/幂等，以及单 Session 多 Stage 的解析机制。
